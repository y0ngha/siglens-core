/**
 * Pure parts of the `gating` mode (WP-16 §9.1, §9.3 D1 to D9): which pattern and candle
 * guides reach a rendered prompt, read against what the same prompt prints (the qualified
 * chart-pattern candidates and the candle lines), and the checks of the computed cards.
 *
 * "Printed" and "injected" are both decided from the prompt text. The instrument never
 * asks the selector why a guide is there, so the same code measures `main` (guides follow
 * the loose pre-screener) and a branch that gates them on what is printed.
 */
import {
    checkCycleCards,
    checkIndicatorCards,
    CYCLE_STRATEGY_SKILLS,
    isCycleKind,
    READER_KINDS,
    readCycleCards,
    readIndicatorCards,
    type CycleCardCheck,
    type IndicatorCardCheck,
    type TaggedGuide,
} from './analysisFieldsEvalCards';
import {
    quantilesOf,
    share,
    type Quantiles,
} from './analysisFieldsEvalCompute';
import {
    CANDLE_GUIDES_HEADER,
    headingPosition,
    listAfter,
    PATTERN_GUIDES_HEADER,
    printedCandleNames,
    printedQualified,
    sectionOf,
    withoutGuideParts,
} from './analysisFieldsEvalPrompt';
import {
    SKILL_TIERS,
    type CatalogSkill,
    type PromptSample,
    type SkillTier,
} from './analysisFieldsEvalSkills';
import {
    FIELDS_EVAL_CONSTANTS as C,
    type GateResult,
    type Share,
} from './analysisFieldsEvalTypes';
import { sha256Hex } from './fsUtil';

const gate = (
    id: string,
    description: string,
    pass: boolean | null,
    value: number | string | null,
    threshold: string
): GateResult => ({ id, description, pass, value, threshold });

/** What the card checks need of a case's bars: the closes the prompt saw, oldest first. */
export interface CardContext {
    closes: readonly number[];
}

/** Hashes of one prompt of an earlier gating run (`rows.jsonl`), for D3. */
export interface BaselineRow {
    caseId: string;
    tier: SkillTier;
    strippedSha256: string;
    /** The unfolded remainder; absent in an output written before it was reported. */
    remainderSha256?: string;
    stableSha256: string;
}

export interface GatingInput {
    catalog: readonly CatalogSkill[];
    samples: readonly PromptSample[];
    cardContext: (caseId: string) => CardContext | null;
    baseline: readonly BaselineRow[] | null;
    /** Whether the technical response schema still asks for `indicatorResults`. */
    schemaAsksIndicatorResults: boolean;
}

const triggersOf = (skill: CatalogSkill): readonly string[] =>
    skill.triggers ?? [];

const isGatedGuide = (skill: CatalogSkill, group: string): boolean =>
    skill.group === group &&
    !skill.alwaysOn &&
    skill.injected &&
    triggersOf(skill).length > 0;

const keyOf = (r: { caseId: string; tier: string }): string =>
    `${r.caseId}|${r.tier}`;

export interface GatingRow {
    caseId: string;
    tier: SkillTier;
    qualifiedIds: readonly string[];
    printedCandles: readonly string[];
    patternGuides: readonly string[];
    /** Injected pattern guides no printed qualified id selects. */
    patternHintOnly: readonly string[];
    /** Printed qualified ids with a guide in the catalog that the prompt does not carry (within the free cap). */
    patternMissing: readonly string[];
    candleGuides: readonly string[];
    candleUnprinted: readonly string[];
    candleMissing: readonly string[];
    patternSectionChars: number;
    candleSectionChars: number;
    stableChars: number;
    dynamicChars: number;
    strippedSha256: string;
    /** Hash of the dynamic prompt with the parts removed and no blank line folded. */
    remainderSha256: string;
    stableSha256: string;
    instructionsMentionIndicatorResults: boolean;
    strategyListHasCycle: boolean;
    cards: {
        indicator: IndicatorCardCheck | null;
        cycle: CycleCardCheck | null;
    };
}

const INDICATOR_RULE_MARKERS = [
    'indicatorResults Writing Rules',
    'use these exact names for indicatorName',
] as const;

interface GuideReading {
    injected: readonly string[];
    unmatched: readonly string[];
    missing: readonly string[];
}

/** One guide family (patterns or candles) against the ids the prompt prints. */
function readFamily(input: {
    text: string;
    guides: readonly CatalogSkill[];
    printed: readonly string[];
    tier: SkillTier;
}): GuideReading {
    const injected = input.guides.filter(
        g => headingPosition(input.text, g.name) >= 0
    );
    const matches = (g: CatalogSkill): boolean =>
        triggersOf(g).some(t => input.printed.includes(t));
    const capped =
        input.tier === 'free' &&
        injected.length >= C.gates.skillsFreeGatedPerGroup;
    const missing = [...new Set(input.printed)].filter(
        id =>
            !capped &&
            input.guides.some(g => triggersOf(g).includes(id)) &&
            !injected.some(g => triggersOf(g).includes(id))
    );
    return {
        injected: injected.map(g => g.name),
        unmatched: injected.filter(g => !matches(g)).map(g => g.name),
        missing,
    };
}

const taggedGuides = (
    catalog: readonly CatalogSkill[],
    group: string
): readonly TaggedGuide[] =>
    catalog.flatMap(s =>
        s.group === group && s.computedCard !== undefined
            ? [
                  {
                      name: s.name,
                      computedCard: s.computedCard,
                      triggers: triggersOf(s),
                  },
              ]
            : []
    );

/** Reads one rendered prompt. */
export function readGatingRow(
    sample: PromptSample,
    input: Pick<GatingInput, 'catalog' | 'cardContext'>
): GatingRow {
    const text = `${sample.stable}\n${sample.dynamic}`;
    const stripped = withoutGuideParts(sample.dynamic);
    const qualified = printedQualified(sample.dynamic);
    const candles = printedCandleNames(sample.dynamic);
    const patterns = readFamily({
        text,
        guides: input.catalog.filter(s => isGatedGuide(s, 'pattern')),
        printed: qualified.ids,
        tier: sample.tier,
    });
    const candleGuides = readFamily({
        text,
        guides: input.catalog.filter(s => isGatedGuide(s, 'candlestick')),
        printed: candles,
        tier: sample.tier,
    });
    const cards = sample.cards ?? null;
    const context = cards === null ? null : input.cardContext(sample.caseId);
    const tagged = taggedGuides(input.catalog, 'indicator_guide');
    const cycleSkills = new Set([
        ...Object.keys(CYCLE_STRATEGY_SKILLS),
        ...taggedGuides(input.catalog, 'strategy')
            .filter(g => isCycleKind(g.computedCard))
            .map(g => g.name),
    ]);
    return {
        caseId: sample.caseId,
        tier: sample.tier,
        qualifiedIds: qualified.ids,
        printedCandles: candles,
        patternGuides: patterns.injected,
        patternHintOnly: patterns.unmatched,
        patternMissing: patterns.missing,
        candleGuides: candleGuides.injected,
        candleUnprinted: candleGuides.unmatched,
        candleMissing: candleGuides.missing,
        patternSectionChars: sectionOf(sample.dynamic, PATTERN_GUIDES_HEADER)
            .length,
        candleSectionChars: sectionOf(sample.dynamic, CANDLE_GUIDES_HEADER)
            .length,
        stableChars: sample.stable.length,
        dynamicChars: sample.dynamic.length,
        strippedSha256: sha256Hex(stripped.folded),
        remainderSha256: sha256Hex(stripped.unfolded),
        stableSha256: sha256Hex(sample.stable),
        instructionsMentionIndicatorResults: INDICATOR_RULE_MARKERS.some(m =>
            text.includes(m)
        ),
        strategyListHasCycle: listAfter(
            sample.dynamic,
            'Strategy skill list to analyze:'
        ).some(name => cycleSkills.has(name)),
        cards: {
            indicator:
                cards !== null && tagged.length > 0
                    ? checkIndicatorCards({
                          // The computed lines are printed in the dynamic part; the guides'
                          // own digests (stable) quote line formats and must not be read.
                          prompt: sample.dynamic,
                          injected: tagged.filter(
                              g => headingPosition(text, g.name) >= 0
                          ),
                          cards: readIndicatorCards(cards.indicator),
                      })
                    : null,
            cycle:
                cards !== null && context !== null
                    ? checkCycleCards({
                          prompt: sample.dynamic,
                          closes: context.closes,
                          cards: readCycleCards(cards.cycle),
                      })
                    : null,
        },
    };
}

// ─── Summary ──────────────────────────────────────────────────────────────────

export interface FamilySummary {
    injectedPerPrompt: Quantiles;
    /** Injected guides a printed id selects. */
    matchedPerPrompt: Quantiles;
    /** Injected guides no printed id selects (hint-only patterns, unprinted candles). */
    unmatchedPerPrompt: Quantiles;
    printedPerPrompt: Quantiles;
    promptsWithUnmatched: Share;
    promptsWithMissing: Share;
    /** Prompts that print nothing of this family yet inject a guide of it. */
    nothingPrintedWithGuides: Share;
    sectionChars: Quantiles;
    /** Per guide: share of prompts that carry it, and the share where nothing printed selects it. */
    perGuide: Record<string, { injected: Share; unmatched: Share }>;
}

export interface TierGating {
    n: number;
    patterns: FamilySummary;
    candles: FamilySummary;
    stableChars: Quantiles;
    dynamicChars: Quantiles;
}

export interface CardSummary {
    taggedIndicatorGuides: number;
    taggedCycleStrategies: number;
    /** Rendered prompts that carried the cards of an assembled prompt. */
    promptsWithCards: number;
    indicator: {
        expected: number;
        observed: number;
        setViolations: number;
        cards: number;
        valueMismatches: number;
        stateMismatches: number;
        trendMismatches: number;
        newlyLitMismatches: number;
        partial: number;
        unreadable: number;
        naAlwaysOn: number;
    } | null;
    cycle: CycleCardCheck | null;
}

export interface GatingSummary {
    cases: number;
    tiers: Partial<Record<SkillTier, TierGating>>;
    catalog: { patternGuides: number; candleGuides: number };
    d3: {
        compared: number;
        dynamicEqual: number;
        stableEqual: number;
        /** Rows of the baseline that report the unfolded remainder, and how many of them equal. */
        remainderCompared: number;
        remainderEqual: number;
        missing: number;
    } | null;
    cards: CardSummary;
    instructions: {
        promptsMentioningIndicatorResults: number;
        promptsListingCycleStrategy: number;
        schemaAsksIndicatorResults: boolean;
    };
}

function familySummary(
    rows: readonly GatingRow[],
    family: 'patterns' | 'candles',
    guides: readonly CatalogSkill[]
): FamilySummary {
    const pick = (r: GatingRow) =>
        family === 'patterns'
            ? {
                  injected: r.patternGuides,
                  unmatched: r.patternHintOnly,
                  missing: r.patternMissing,
                  printed: r.qualifiedIds,
                  chars: r.patternSectionChars,
              }
            : {
                  injected: r.candleGuides,
                  unmatched: r.candleUnprinted,
                  missing: r.candleMissing,
                  printed: r.printedCandles,
                  chars: r.candleSectionChars,
              };
    const picks = rows.map(pick);
    return {
        injectedPerPrompt: quantilesOf(picks.map(p => p.injected.length)),
        matchedPerPrompt: quantilesOf(
            picks.map(p => p.injected.length - p.unmatched.length)
        ),
        unmatchedPerPrompt: quantilesOf(picks.map(p => p.unmatched.length)),
        printedPerPrompt: quantilesOf(picks.map(p => p.printed.length)),
        promptsWithUnmatched: share(
            picks.filter(p => p.unmatched.length > 0).length,
            picks.length
        ),
        promptsWithMissing: share(
            picks.filter(p => p.missing.length > 0).length,
            picks.length
        ),
        nothingPrintedWithGuides: share(
            picks.filter(p => p.printed.length === 0 && p.injected.length > 0)
                .length,
            picks.length
        ),
        sectionChars: quantilesOf(picks.map(p => p.chars)),
        perGuide: Object.fromEntries(
            guides.map(g => [
                g.name,
                {
                    injected: share(
                        picks.filter(p => p.injected.includes(g.name)).length,
                        picks.length
                    ),
                    unmatched: share(
                        picks.filter(p => p.unmatched.includes(g.name)).length,
                        picks.length
                    ),
                },
            ])
        ),
    };
}

const sum = (values: readonly number[]): number =>
    values.reduce((s, v) => s + v, 0);

function cardSummary(
    rows: readonly GatingRow[],
    catalog: readonly CatalogSkill[]
): CardSummary {
    const indicator = rows.flatMap(r =>
        r.cards.indicator === null ? [] : [r.cards.indicator]
    );
    const cycle = rows.flatMap(r =>
        r.cards.cycle === null ? [] : [r.cards.cycle]
    );
    return {
        taggedIndicatorGuides: taggedGuides(catalog, 'indicator_guide').length,
        taggedCycleStrategies: taggedGuides(catalog, 'strategy').filter(g =>
            isCycleKind(g.computedCard)
        ).length,
        promptsWithCards: rows.filter(
            r => r.cards.indicator !== null || r.cards.cycle !== null
        ).length,
        indicator:
            indicator.length === 0
                ? null
                : {
                      expected: sum(indicator.map(c => c.cardSet.expected)),
                      observed: sum(indicator.map(c => c.cardSet.observed)),
                      setViolations: sum(
                          indicator.map(c => c.cardSet.violations)
                      ),
                      cards: sum(indicator.map(c => c.values.cards)),
                      valueMismatches: sum(
                          indicator.map(c => c.values.valueMismatches)
                      ),
                      stateMismatches: sum(
                          indicator.map(c => c.values.stateMismatches)
                      ),
                      trendMismatches: sum(
                          indicator.map(c => c.trendMismatches)
                      ),
                      newlyLitMismatches: sum(
                          indicator.map(c => c.newlyLitMismatches)
                      ),
                      partial: sum(indicator.map(c => c.values.partial)),
                      unreadable: sum(indicator.map(c => c.values.unreadable)),
                      naAlwaysOn: sum(indicator.map(c => c.naAlwaysOn)),
                  },
        cycle:
            cycle.length === 0
                ? null
                : {
                      cards: sum(cycle.map(c => c.cards)),
                      withoutPrintedStage: sum(
                          cycle.map(c => c.withoutPrintedStage)
                      ),
                      stageMismatches: sum(cycle.map(c => c.stageMismatches)),
                      historyMismatches: sum(
                          cycle.map(c => c.historyMismatches)
                      ),
                      trendMismatches: sum(cycle.map(c => c.trendMismatches)),
                      valueMismatches: sum(cycle.map(c => c.valueMismatches)),
                      setViolations: sum(cycle.map(c => c.setViolations)),
                  },
    };
}

/** Reads every sample. Throws when nothing was rendered or a baseline lacks a prompt. */
export function summarizeGating(input: GatingInput): {
    rows: readonly GatingRow[];
    summary: GatingSummary;
} {
    if (input.samples.length === 0) throw new Error('no prompt was rendered');
    const rows = input.samples.map(s => readGatingRow(s, input));
    const patternGuides = input.catalog.filter(s => isGatedGuide(s, 'pattern'));
    const candleGuides = input.catalog.filter(s =>
        isGatedGuide(s, 'candlestick')
    );
    const tiers = Object.fromEntries(
        SKILL_TIERS.flatMap(tier => {
            const own = rows.filter(r => r.tier === tier);
            return own.length === 0
                ? []
                : [
                      [
                          tier,
                          {
                              n: own.length,
                              patterns: familySummary(
                                  own,
                                  'patterns',
                                  patternGuides
                              ),
                              candles: familySummary(
                                  own,
                                  'candles',
                                  candleGuides
                              ),
                              stableChars: quantilesOf(
                                  own.map(r => r.stableChars)
                              ),
                              dynamicChars: quantilesOf(
                                  own.map(r => r.dynamicChars)
                              ),
                          },
                      ] as const,
                  ];
        })
    );
    const baselineOf = new Map((input.baseline ?? []).map(b => [keyOf(b), b]));
    const memberRows = rows.filter(r => r.tier === 'member');
    const compared = memberRows.flatMap(r => {
        const b = baselineOf.get(keyOf(r));
        return b === undefined ? [] : [{ row: r, base: b }];
    });
    return {
        rows,
        summary: {
            cases: new Set(rows.map(r => r.caseId)).size,
            tiers,
            catalog: {
                patternGuides: patternGuides.length,
                candleGuides: candleGuides.length,
            },
            d3:
                input.baseline === null
                    ? null
                    : {
                          compared: compared.length,
                          dynamicEqual: compared.filter(
                              c =>
                                  c.row.strippedSha256 === c.base.strippedSha256
                          ).length,
                          remainderCompared: compared.filter(
                              c => c.base.remainderSha256 !== undefined
                          ).length,
                          remainderEqual: compared.filter(
                              c =>
                                  c.base.remainderSha256 !== undefined &&
                                  c.row.remainderSha256 ===
                                      c.base.remainderSha256
                          ).length,
                          stableEqual: compared.filter(
                              c => c.row.stableSha256 === c.base.stableSha256
                          ).length,
                          missing: memberRows.length - compared.length,
                      },
            cards: cardSummary(rows, input.catalog),
            instructions: {
                promptsMentioningIndicatorResults: rows.filter(
                    r => r.instructionsMentionIndicatorResults
                ).length,
                promptsListingCycleStrategy: rows.filter(
                    r => r.strategyListHasCycle
                ).length,
                schemaAsksIndicatorResults: input.schemaAsksIndicatorResults,
            },
        },
    };
}

// ─── Gates ────────────────────────────────────────────────────────────────────

const familyViolations = (
    summary: GatingSummary,
    family: 'patterns' | 'candles'
): { prompts: number; unmatched: number; missing: number } => {
    const tiers = Object.values(summary.tiers);
    return {
        prompts: sum(tiers.map(t => t.n)),
        unmatched: sum(tiers.map(t => t[family].promptsWithUnmatched.count)),
        missing: sum(tiers.map(t => t[family].promptsWithMissing.count)),
    };
};

/** D1, D2, D3 and D9 always; D5, D6 and D8 when the catalog carries card skills. */
export function gatingGates(summary: GatingSummary): readonly GateResult[] {
    const d1 = familyViolations(summary, 'patterns');
    const d2 = familyViolations(summary, 'candles');
    const cards = summary.cards;
    const cardCapable = cards.taggedIndicatorGuides > 0;
    const cycleCapable = cards.taggedCycleStrategies > 0;
    const ind = cards.indicator;
    const noCards =
        'no computed-card skill in the catalog (core without cards)';
    const noRender = 'the rendered prompts carry no cards';
    return [
        gate(
            'D1',
            'every injected pattern guide matches a printed qualified id and every printed id with a guide has it',
            d1.prompts === 0 || summary.catalog.patternGuides === 0
                ? null
                : d1.unmatched === 0 && d1.missing === 0,
            `${summary.catalog.patternGuides} gated pattern guides in the catalog; prompts with a hint-only guide ${d1.unmatched}/${d1.prompts}, with a missing guide ${d1.missing}/${d1.prompts}`,
            '0 violating prompts'
        ),
        gate(
            'D2',
            'every injected gated candle guide matches a printed candle and every printed candle with a guide has it',
            d2.prompts === 0 || summary.catalog.candleGuides === 0
                ? null
                : d2.unmatched === 0 && d2.missing === 0,
            `${summary.catalog.candleGuides} gated candle guides in the catalog; prompts with an unprinted-candle guide ${d2.unmatched}/${d2.prompts}, with a missing guide ${d2.missing}/${d2.prompts}`,
            '0 violating prompts'
        ),
        gate(
            'D3',
            'member prompts without the pattern and candle guide parts equal the baseline run byte for byte',
            summary.d3 === null || summary.d3.compared === 0
                ? null
                : summary.d3.missing === 0 &&
                      summary.d3.dynamicEqual === summary.d3.compared &&
                      summary.d3.stableEqual === summary.d3.compared,
            summary.d3 === null
                ? 'no --baseline given'
                : `dynamic equal ${summary.d3.dynamicEqual}/${summary.d3.compared} (unfolded remainder equal ${summary.d3.remainderEqual}/${summary.d3.remainderCompared}, reported), stable equal ${summary.d3.stableEqual}/${summary.d3.compared}, not in baseline ${summary.d3.missing}`,
            '100%'
        ),
        gate(
            'D5',
            'one card per injected tagged guide (always-on N/A excepted), no card otherwise',
            !cardCapable || ind === null || ind.expected + ind.observed === 0
                ? null
                : ind.setViolations === 0,
            !cardCapable
                ? noCards
                : ind === null
                  ? noRender
                  : `violations ${ind.setViolations} over ${ind.expected} expected and ${ind.observed} observed cards (always-on N/A ${ind.naAlwaysOn})`,
            '0 violations'
        ),
        gate(
            'D6',
            'card values are printed numbers, the recomputed state equals the card state, the trend is the rule trend of the printed lines and an event card shows the event newly lit on this bar when one is printed',
            !cardCapable || ind === null
                ? null
                : ind.valueMismatches > 0 ||
                    ind.stateMismatches > 0 ||
                    ind.trendMismatches > 0 ||
                    ind.newlyLitMismatches > 0
                  ? false
                  : ind.unreadable > 0
                    ? null
                    : true,
            !cardCapable
                ? noCards
                : ind === null
                  ? noRender
                  : `value mismatches ${ind.valueMismatches}, state mismatches ${ind.stateMismatches}, trend mismatches ${ind.trendMismatches}, event not the newly lit one ${ind.newlyLitMismatches}, cards of a kind without a reader ${ind.unreadable} of ${ind.cards}, of them with a state the printed lines only bound ${ind.partial} (readers: ${READER_KINDS.length} kinds)`,
            '0 mismatches, every kind has a reader (partial kinds: the state must be an allowed one)'
        ),
        gate(
            'D8',
            'cycle stage equals the printed stage and the history equals the recomputation',
            !cycleCapable || cards.cycle === null || cards.cycle.cards === 0
                ? null
                : cards.cycle.withoutPrintedStage === 0 &&
                      cards.cycle.stageMismatches === 0 &&
                      cards.cycle.historyMismatches === 0 &&
                      cards.cycle.trendMismatches === 0 &&
                      cards.cycle.valueMismatches === 0 &&
                      cards.cycle.setViolations === 0,
            !cycleCapable
                ? noCards
                : cards.cycle === null
                  ? noRender
                  : `cards ${cards.cycle.cards}, without a printed stage ${cards.cycle.withoutPrintedStage}, stage ${cards.cycle.stageMismatches}, history ${cards.cycle.historyMismatches}, trend ${cards.cycle.trendMismatches}, values/order ${cards.cycle.valueMismatches}, card set ${cards.cycle.setViolations}`,
            '0 mismatches'
        ),
        gate(
            'D9',
            'no indicatorResults in the schema or the instructions, no computed-card strategy in the strategy list',
            !summary.instructions.schemaAsksIndicatorResults &&
                summary.instructions.promptsMentioningIndicatorResults === 0 &&
                summary.instructions.promptsListingCycleStrategy === 0,
            `schema asks ${summary.instructions.schemaAsksIndicatorResults}, prompts with the indicatorResults rules ${summary.instructions.promptsMentioningIndicatorResults}, prompts listing a cycle strategy ${summary.instructions.promptsListingCycleStrategy}`,
            'none'
        ),
    ];
}
