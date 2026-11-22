import { describe, expect, it } from 'vitest';
import {
    gatingGates,
    readGatingRow,
    summarizeGating,
    type BaselineRow,
    type GatingInput,
} from '../../../../scripts/replay/analysisFieldsEvalGating';
import type {
    CatalogSkill,
    PromptSample,
    SkillTier,
} from '../../../../scripts/replay/analysisFieldsEvalSkills';
import { sha256Hex } from '../../../../scripts/replay/fsUtil';
import { withoutGuideParts } from '../../../../scripts/replay/analysisFieldsEvalPrompt';
import {
    CANDLE_GUIDE_DOJI,
    CANDLE_GUIDE_HAMMER,
    CATALOG,
    dynamicPrompt,
    PATTERN_GUIDE_A,
    PATTERN_GUIDE_B,
    STABLE,
    type PromptOptions,
} from './wp16Fixtures';

const sample = (
    tier: SkillTier,
    options: PromptOptions,
    caseId = 'C1',
    extra: Partial<PromptSample> = {}
): PromptSample => ({
    caseId,
    tier,
    stable: STABLE,
    dynamic: dynamicPrompt(options),
    ...extra,
});

const input = (
    samples: readonly PromptSample[],
    over: Partial<GatingInput> = {}
): GatingInput => ({
    catalog: CATALOG,
    samples,
    cardContext: () => null,
    baseline: null,
    schemaAsksIndicatorResults: false,
    ...over,
});

const row = (s: PromptSample) =>
    readGatingRow(s, { catalog: CATALOG, cardContext: () => null });

const gateOf = (
    id: string,
    samples: readonly PromptSample[],
    over: Partial<GatingInput> = {}
) => {
    const { summary } = summarizeGating(input(samples, over));
    const found = gatingGates(summary).find(g => g.id === id);
    if (found === undefined) throw new Error(`gate ${id} not produced`);
    return found;
};

describe('readGatingRow: patterns', () => {
    it('calls a guide matched when a printed id selects it, hint-only otherwise', () => {
        const r = row(
            sample('member', {
                qualified: ['double_top'],
                patternGuides: [PATTERN_GUIDE_A, PATTERN_GUIDE_B],
            })
        );
        expect(r.qualifiedIds).toEqual(['double_top']);
        expect(r.patternGuides).toEqual([PATTERN_GUIDE_A, PATTERN_GUIDE_B]);
        expect(r.patternHintOnly).toEqual([PATTERN_GUIDE_B]);
        expect(r.patternMissing).toEqual([]);
    });

    it('names a printed id whose guide is not carried as missing', () => {
        const r = row(
            sample('member', {
                qualified: ['double_top', 'double_bottom'],
                patternGuides: [PATTERN_GUIDE_A],
            })
        );
        expect(r.patternMissing).toEqual(['double_bottom']);
    });

    it('does not call a printed id without any guide in the catalog missing', () => {
        const r = row(
            sample('member', { qualified: ['rectangle'], patternGuides: [] })
        );
        expect(r.patternMissing).toEqual([]);
    });

    it('reads a guide only from its heading, not from a mention', () => {
        const s = sample('member', { qualified: ['double_top'] });
        const mention = {
            ...s,
            dynamic: `${s.dynamic}\nsee ${PATTERN_GUIDE_A} here`,
        };
        expect(row(mention).patternGuides).toEqual([]);
        expect(row(mention).patternMissing).toEqual(['double_top']);
    });
});

describe('readGatingRow: free cap', () => {
    const many: readonly CatalogSkill[] = [
        ...CATALOG,
        ...['pa', 'pb', 'pc'].map(name => ({
            name,
            group: 'pattern',
            alwaysOn: false,
            injected: true,
            triggers: [`id_${name}`],
        })),
    ];
    const read = (tier: SkillTier, guides: readonly string[]) =>
        readGatingRow(
            sample(tier, {
                qualified: ['double_top', 'id_pc'],
                patternGuides: guides,
            }),
            { catalog: many, cardContext: () => null }
        );

    it('tolerates a missing guide for free once the cap of guides is carried', () => {
        const atCap = [PATTERN_GUIDE_A, 'pa', 'pb'];
        expect(read('free', atCap).patternMissing).toEqual([]);
        expect(read('member', atCap).patternMissing).toEqual(['id_pc']);
    });

    it('does not tolerate it below the cap, for free', () => {
        expect(read('free', [PATTERN_GUIDE_A, 'pa']).patternMissing).toEqual([
            'id_pc',
        ]);
    });
});

describe('readGatingRow: candles', () => {
    it('matches a candle guide to the printed candle line only', () => {
        const r = row(
            sample('member', {
                candles: ['doji'],
                candleGuides: [CANDLE_GUIDE_DOJI, CANDLE_GUIDE_HAMMER],
            })
        );
        expect(r.printedCandles).toEqual(['doji']);
        expect(r.candleGuides).toEqual([
            CANDLE_GUIDE_DOJI,
            CANDLE_GUIDE_HAMMER,
        ]);
        expect(r.candleUnprinted).toEqual([CANDLE_GUIDE_HAMMER]);
        expect(r.candleMissing).toEqual([]);
    });

    it('matches any trigger of the guide and names a printed candle with no guide carried as missing', () => {
        const r = row(
            sample('member', {
                candles: ['gravestone_doji', 'hammer'],
                candleGuides: [CANDLE_GUIDE_DOJI],
            })
        );
        expect(r.candleUnprinted).toEqual([]);
        expect(r.candleMissing).toEqual(['hammer']);
    });

    it('does not count the always-on primer as a gated guide', () => {
        const r = row(
            sample('member', {
                candles: [],
                candleGuides: ['Candle Reading Primer'],
            })
        );
        expect(r.candleGuides).toEqual([]);
    });
});

describe('readGatingRow: sizes and instructions', () => {
    it('reports section and prompt sizes and the strategy list', () => {
        const s = sample('member', {
            qualified: ['double_top'],
            patternGuides: [PATTERN_GUIDE_A],
            strategies: ['MACD 대순환 분석', 'Strategy One'],
        });
        const r = row(s);
        expect(r.patternSectionChars).toBeGreaterThan(20);
        expect(r.candleSectionChars).toBe(0);
        expect(r.dynamicChars).toBe(s.dynamic.length);
        expect(r.stableChars).toBe(STABLE.length);
        expect(r.strippedSha256).toBe(
            sha256Hex(withoutGuideParts(s.dynamic).folded)
        );
        expect(r.remainderSha256).toBe(
            sha256Hex(withoutGuideParts(s.dynamic).unfolded)
        );
        expect(r.stableSha256).toBe(sha256Hex(STABLE));
        expect(r.strategyListHasCycle).toBe(true);
        expect(r.instructionsMentionIndicatorResults).toBe(true);
    });

    it('sees neither the indicator rules nor a cycle strategy when they are gone', () => {
        const r = row(
            sample('member', {
                indicatorRules: false,
                strategies: ['Strategy One'],
            })
        );
        expect(r.strategyListHasCycle).toBe(false);
        expect(r.instructionsMentionIndicatorResults).toBe(false);
    });
});

describe('gates D1 and D2', () => {
    const clean = sample('member', {
        qualified: ['double_top'],
        candles: ['doji'],
        patternGuides: [PATTERN_GUIDE_A],
        candleGuides: [CANDLE_GUIDE_DOJI],
    });

    it('pass when every guide follows what is printed', () => {
        expect(gateOf('D1', [clean]).pass).toBe(true);
        expect(gateOf('D2', [clean]).pass).toBe(true);
    });

    it('fail on a hint-only pattern guide, and on an unprinted-candle guide', () => {
        const hint = sample('member', {
            patternGuides: [PATTERN_GUIDE_B],
            candleGuides: [CANDLE_GUIDE_HAMMER],
        });
        expect(gateOf('D1', [clean, hint])).toMatchObject({
            pass: false,
            value: expect.stringContaining('hint-only guide 1/2'),
        });
        expect(gateOf('D2', [clean, hint])).toMatchObject({
            pass: false,
            value: expect.stringContaining('unprinted-candle guide 1/2'),
        });
    });

    it('fail on a printed id whose guide is absent', () => {
        const missing = sample('member', {
            qualified: ['double_top'],
            candles: ['doji'],
        });
        expect(gateOf('D1', [missing]).pass).toBe(false);
        expect(gateOf('D2', [missing]).pass).toBe(false);
    });
});

describe('gates D1 and D2 without something to measure', () => {
    const catalogOf = (group: string): readonly CatalogSkill[] =>
        CATALOG.filter(s => s.group !== group);
    const prompt = sample('member', {
        qualified: ['double_top'],
        candles: ['doji'],
        patternGuides: [PATTERN_GUIDE_B],
        candleGuides: [CANDLE_GUIDE_HAMMER],
    });

    it('are undecided when the catalog has no gated guide of the family', () => {
        expect(
            gateOf('D1', [prompt], { catalog: catalogOf('pattern') }).pass
        ).toBeNull();
        expect(
            gateOf('D2', [prompt], { catalog: catalogOf('candlestick') }).pass
        ).toBeNull();
        expect(gateOf('D1', [prompt]).pass).toBe(false);
        expect(gateOf('D2', [prompt]).pass).toBe(false);
    });

    it('do not take the always-on primer for a gated candle guide', () => {
        const onlyPrimer = CATALOG.filter(
            s => s.group !== 'candlestick' || s.alwaysOn
        );
        expect(gateOf('D2', [prompt], { catalog: onlyPrimer }).pass).toBeNull();
    });
});

describe('gate D3', () => {
    const member = sample('member', {
        qualified: ['double_top'],
        patternGuides: [PATTERN_GUIDE_A],
    });
    const baselineOf = (
        s: PromptSample,
        over: Partial<BaselineRow> = {}
    ): BaselineRow => ({
        caseId: s.caseId,
        tier: s.tier,
        strippedSha256: sha256Hex(withoutGuideParts(s.dynamic).folded),
        remainderSha256: sha256Hex(withoutGuideParts(s.dynamic).unfolded),
        stableSha256: sha256Hex(s.stable),
        ...over,
    });

    it('is not computable without a baseline', () => {
        expect(gateOf('D3', [member]).pass).toBeNull();
    });

    it('passes when the prompt without the guide parts equals the baseline, whatever the guides', () => {
        const before = sample('member', {
            qualified: ['double_top'],
            patternGuides: [PATTERN_GUIDE_A, PATTERN_GUIDE_B],
            candleGuides: [CANDLE_GUIDE_DOJI],
        });
        expect(
            gateOf('D3', [member], { baseline: [baselineOf(before)] })
        ).toMatchObject({
            pass: true,
            value: expect.stringContaining('dynamic equal 1/1'),
        });
    });

    it('fails on a change outside the guide parts, and on a changed stable prefix', () => {
        const changed = {
            ...member,
            dynamic: member.dynamic.replace('Symbol: TEST', 'Symbol: OTHER'),
        };
        expect(
            gateOf('D3', [changed], { baseline: [baselineOf(member)] }).pass
        ).toBe(false);
        expect(
            gateOf('D3', [member], {
                baseline: [baselineOf(member, { stableSha256: 'x' })],
            }).pass
        ).toBe(false);
    });

    it('fails on a change in the text of a rule block that is not stripped, and reports the plain remainder', () => {
        const changed = {
            ...member,
            dynamic: member.dynamic.replace('- one each', '- one each, please'),
        };
        const g = gateOf('D3', [changed], { baseline: [baselineOf(member)] });
        expect(g.pass).toBe(false);
        expect(g.value).toContain(
            'dynamic equal 0/1 (unfolded remainder equal 0/1'
        );
        expect(
            gateOf('D3', [member], { baseline: [baselineOf(member)] }).value
        ).toContain('unfolded remainder equal 1/1');
    });

    it('fails on a change in a candidate block, not on one in the instruction paragraph above it', () => {
        const edit = (from: string, to: string) => ({
            ...member,
            dynamic: member.dynamic.replace(from, to),
        });
        const baseline = [baselineOf(member)];
        expect(
            gateOf('D3', [edit('Height: 5', 'Height: 6')], { baseline }).pass
        ).toBe(false);
        expect(
            gateOf(
                'D3',
                [edit('Each pattern below is measured.', 'Rewritten.')],
                { baseline }
            ).pass
        ).toBe(true);
    });

    it('fails on a member prompt the baseline lacks, and ignores free prompts', () => {
        expect(
            gateOf('D3', [member, { ...member, caseId: 'C2' }], {
                baseline: [baselineOf(member)],
            })
        ).toMatchObject({
            pass: false,
            value: expect.stringContaining('not in baseline 1'),
        });
        const free = { ...member, tier: 'free' as const };
        expect(
            gateOf('D3', [free], { baseline: [baselineOf(free)] }).pass
        ).toBeNull();
    });
});

describe('gate D9', () => {
    const plain = sample('member', {
        indicatorRules: false,
        strategies: ['Strategy One'],
    });

    it('passes without the rules, the cycle strategy and the schema field', () => {
        expect(gateOf('D9', [plain]).pass).toBe(true);
    });

    it('fails on each of the three', () => {
        expect(gateOf('D9', [sample('member', {})]).pass).toBe(false);
        expect(
            gateOf('D9', [
                sample('member', {
                    indicatorRules: false,
                    strategies: ['MACD 대순환 분석'],
                }),
            ]).pass
        ).toBe(false);
        expect(
            gateOf('D9', [plain], { schemaAsksIndicatorResults: true }).pass
        ).toBe(false);
    });
});

describe('summarizeGating', () => {
    it('summarises per tier with per-guide rates, and rejects an empty render', () => {
        const samples = [
            sample('member', {
                candles: ['doji'],
                candleGuides: [CANDLE_GUIDE_DOJI, CANDLE_GUIDE_HAMMER],
            }),
            sample('member', { patternGuides: [PATTERN_GUIDE_A] }, 'C2'),
            sample('free', {
                candles: ['doji'],
                candleGuides: [CANDLE_GUIDE_DOJI],
            }),
        ];
        const { summary, rows } = summarizeGating(input(samples));
        expect(rows).toHaveLength(3);
        expect(summary.cases).toBe(2);
        const member = summary.tiers.member;
        expect(member?.n).toBe(2);
        expect(member?.candles.perGuide[CANDLE_GUIDE_HAMMER]).toMatchObject({
            injected: { count: 1, n: 2 },
            unmatched: { count: 1, n: 2 },
        });
        expect(member?.patterns.nothingPrintedWithGuides).toMatchObject({
            count: 1,
            n: 2,
        });
        expect(summary.tiers.free?.n).toBe(1);
        expect(summary.catalog).toEqual({ patternGuides: 2, candleGuides: 2 });
        expect(() => summarizeGating(input([]))).toThrow(
            'no prompt was rendered'
        );
    });

    it('omits a tier that was not rendered', () => {
        const { summary } = summarizeGating(input([sample('free', {})]));
        expect(Object.keys(summary.tiers)).toEqual(['free']);
    });
});

describe('gate D6 for a kind without a reader', () => {
    const tagged: readonly CatalogSkill[] = [
        ...CATALOG,
        {
            name: 'RSI Signal Guide',
            group: 'indicator_guide',
            alwaysOn: false,
            injected: true,
            computedCard: 'rsi',
        },
    ];
    const d6 = (valueOk: boolean) => {
        const { summary } = summarizeGating(
            input(
                [
                    {
                        ...sample('member', {}),
                        stable: `${STABLE}### RSI Signal Guide [High Confidence]\nbody\n`,
                        cards: {
                            indicator: [
                                {
                                    indicatorName: 'RSI Signal Guide',
                                    signals: [
                                        {
                                            trend: 'bullish',
                                            reading: {
                                                kind: valueOk ? 'rsi' : 'macd',
                                                state: 'rsi_oversold',
                                                values: { rsi: 28 },
                                            },
                                        },
                                    ],
                                },
                            ],
                            cycle: [],
                        },
                    },
                ],
                { catalog: tagged, cardContext: () => ({ closes: [1] }) }
            )
        );
        const gates = gatingGates(summary);
        return gates.find(g => g.id === 'D6');
    };

    it('is undecided, naming the readers, rather than passing', () => {
        const g = d6(true);
        expect(g?.pass).toBeNull();
        expect(g?.value).toContain('without a reader 1 of 1');
        expect(g?.value).toContain('readers: ma, ema, adx');
    });

    it('still fails on a mismatch the instrument can see', () => {
        expect(d6(false)?.pass).toBe(false);
    });
});

describe('the card gates', () => {
    const tagged: readonly CatalogSkill[] = [
        ...CATALOG,
        {
            name: 'MA Signal Guide',
            group: 'indicator_guide',
            alwaysOn: true,
            injected: true,
            computedCard: 'ma',
        },
        {
            name: 'MACD 대순환 분석',
            group: 'strategy',
            alwaysOn: false,
            injected: true,
            computedCard: 'macd_cycle',
        },
    ];
    const stateLines = [
        '- MA: MA(5): 10 / MA(20): 20',
        '- MA stack: mixed (x)',
        '- MACD cycle (EMA9/21/60): upper (EMA9−EMA21) 1, middle (EMA9−EMA60) 1, lower (EMA21−EMA60) 1; stage 4',
    ];
    const closes = Array.from({ length: 300 }, (_, i) => 900 - i);
    const withCards = (indicator: unknown, cycle: unknown): PromptSample => ({
        ...sample('member', { stateLines }),
        stable: `${STABLE}### MA Signal Guide [High Confidence]\nbody\n`,
        cards: { indicator, cycle },
    });
    const maCard = {
        indicatorName: 'MA Signal Guide',
        signals: [
            {
                trend: 'neutral',
                reading: { kind: 'ma', state: 'mixed', values: { ma5: 10 } },
            },
        ],
    };
    const cycleCard = {
        strategyName: 'MACD 대순환 분석',
        trend: 'bearish',
        cycle: {
            kind: 'macd_cycle',
            stage: 4,
            previousStage: null,
            barsInStage: null,
            progression: null,
            stageChanges: 0,
        },
    };
    const gates = (s: PromptSample) => {
        const { summary } = summarizeGating(
            input([s], { catalog: tagged, cardContext: () => ({ closes }) })
        );
        return Object.fromEntries(gatingGates(summary).map(g => [g.id, g]));
    };

    it('cannot be computed on a catalog without computed-card skills', () => {
        const g = gateOf('D5', [sample('member', {})]);
        expect(g.pass).toBeNull();
        expect(g.value).toContain('no computed-card skill');
        expect(gateOf('D6', [sample('member', {})]).pass).toBeNull();
        expect(gateOf('D8', [sample('member', {})]).pass).toBeNull();
    });

    it('cannot be computed when the prompts carry no cards', () => {
        const { summary } = summarizeGating(
            input([sample('member', { stateLines })], { catalog: tagged })
        );
        const byId = Object.fromEntries(
            gatingGates(summary).map(g => [g.id, g])
        );
        expect(byId.D5.pass).toBeNull();
        expect(byId.D5.value).toContain('carry no cards');
        expect(byId.D8.pass).toBeNull();
    });

    it('passes D5, D6 and D8 for correct cards', () => {
        const g = gates(withCards([maCard], [cycleCard]));
        expect(g.D5).toMatchObject({ pass: true });
        expect(g.D6).toMatchObject({ pass: true });
        expect(g.D8).toMatchObject({ pass: true });
    });

    it('fails D5 for a missing card, D6 for a wrong state and D8 for a wrong stage', () => {
        expect(gates(withCards([], [cycleCard])).D5.pass).toBe(false);
        const wrongState = {
            ...maCard,
            signals: [
                {
                    ...maCard.signals[0],
                    reading: {
                        ...maCard.signals[0].reading,
                        state: 'bullish_stack',
                    },
                },
            ],
        };
        expect(gates(withCards([wrongState], [cycleCard])).D6.pass).toBe(false);
        const wrongStage = {
            ...cycleCard,
            cycle: { ...cycleCard.cycle, stage: 3 },
        };
        expect(gates(withCards([maCard], [wrongStage])).D8.pass).toBe(false);
    });

    it('leaves D5 and D8 undecided when no card and nothing expected exist', () => {
        const none = gates({
            ...sample('member', {}),
            cards: { indicator: [], cycle: [] },
        });
        expect(none.D5.pass).toBeNull();
        expect(none.D8.pass).toBeNull();
    });

    it('counts the prompts that carry cards and the cards of both kinds in the summary', () => {
        const { summary } = summarizeGating(
            input([withCards([maCard], [cycleCard])], {
                catalog: tagged,
                cardContext: () => ({ closes }),
            })
        );
        expect(summary.cards).toMatchObject({
            taggedIndicatorGuides: 1,
            taggedCycleStrategies: 1,
            promptsWithCards: 1,
            indicator: { expected: 1, observed: 1, unreadable: 0 },
            cycle: { cards: 1, stageMismatches: 0 },
        });
    });
});
