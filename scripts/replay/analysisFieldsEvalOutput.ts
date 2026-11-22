/**
 * Pure parts of the `output` mode (WP-16 §9.1, §9.3): per-case pairs of an after run and a
 * before run (and a repeat run, the noise floor), what the model wrote in each field, and
 * the live gates O1, O2, F1, F2, L1, L2, V1 to V5 with the card-trend baseline D7.
 *
 * "Model-written" is the result minus what code attaches (`id`, `confidenceWeight`,
 * `renderConfig`, `reconciledLevels`, `planCheck`, `planState`, and from WP-16 core-2 on the
 * computed indicator cards and cycle cards). Every definition is recomputed from the stored
 * result and prompt; no core function is called.
 */
import {
    CYCLE_STRATEGY_SKILLS,
    hasTrendRule,
    ruleTrendOfKind,
} from './analysisFieldsEvalCards';
import { median, share } from './analysisFieldsEvalCompute';
import { listAfter, printedQualified } from './analysisFieldsEvalPrompt';
import type { RunCallStats } from './analysisFieldsEvalPlan';
import {
    levelOverlapPerCase,
    type LevelCase,
} from './analysisFieldsEvalSkills';
import {
    FIELDS_EVAL_CONSTANTS as C,
    type GateResult,
    type Share,
} from './analysisFieldsEvalTypes';
import { sha256Hex } from './fsUtil';
import { mulberry32 } from '@/domain/outcomes/weekClusterBootstrap';
import { jaccard, mean } from './stats';
import { quantile } from '@/domain/outcomes/weekClusterBootstrap';
import type { CaseResultFile } from './types';

type Rec = Record<string, unknown>;

const asRec = (value: unknown): Rec | null =>
    typeof value === 'object' && value !== null && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value))
        : null;

const asArray = (value: unknown): readonly unknown[] =>
    Array.isArray(value) ? value : [];

const asStr = (value: unknown): string | null =>
    typeof value === 'string' ? value : null;

const asNum = (value: unknown): number | null =>
    typeof value === 'number' && Number.isFinite(value) ? value : null;

/** Compact JSON length of a present value; `0` for an absent one. */
const jlen = (value: unknown): number =>
    value === undefined || value === null ? 0 : JSON.stringify(value).length;

const omit = (rec: Rec | null, keys: readonly string[]): Rec =>
    Object.fromEntries(
        Object.entries(rec ?? {}).filter(([k]) => !keys.includes(k))
    );

// ─── One result ───────────────────────────────────────────────────────────────

export const MODEL_FIELDS = [
    'summary',
    'indicatorResults',
    'strategyResults',
    'patternSummaries',
    'candlePatterns',
    'keyLevels',
    'priceTargets',
    'actionRecommendation',
] as const;
export type ModelField = (typeof MODEL_FIELDS)[number];

/** The pattern skills of the catalog the instrument matches names and ids against. */
export interface PatternSkill {
    name: string;
    triggers: readonly string[];
}

export interface PatternEntry {
    skillName: string | null;
    detected: boolean;
    candidateId: string | null;
}

/** One result of a run, reduced to what the comparisons read. */
export interface ArmCase {
    caseId: string;
    failed: boolean;
    fallback: boolean;
    hasSummary: boolean;
    hasPlan: boolean;
    outputTokens: number | null;
    inputTokens: number | null;
    uncachedTokens: number | null;
    latencyMs: number;
    /** Characters of what the model wrote, per field. */
    chars: Record<ModelField, number>;
    modelChars: number;
    /** Characters of the cards code attached (zero before WP-16 core-2). */
    computedChars: number;
    computedCards: number;
    summary: string;
    summaryChars: number;
    /** Listed strategy skills the model writes (the cycle strategies excluded). */
    listedStrategies: readonly string[];
    strategyChars: Readonly<Record<string, number>>;
    strategyEntries: number;
    qualifiedIds: readonly string[];
    patternEntries: readonly PatternEntry[];
    planPosition: string | null;
    promptFull: string | null;
    /** The model's trend per indicator signal and per strategy entry, by skill name. */
    trendRows: readonly { skill: string; model: string | null }[];
    /** The stored dynamic prompt (D7 reads each rule off its printed lines). */
    prompt: string;
    /** The result's own analysed-bar close (`dataAsOf.close`). */
    close: number | null;
}

const EMPTY_SUMMARY = '__none__';

const NO_CHARS: Record<ModelField, number> = {
    summary: 0,
    indicatorResults: 0,
    strategyResults: 0,
    patternSummaries: 0,
    candlePatterns: 0,
    keyLevels: 0,
    priceTargets: 0,
    actionRecommendation: 0,
};

function hasReading(entry: unknown): boolean {
    const signal = asRec(asArray(asRec(entry)?.signals)[0]);
    return signal?.reading !== undefined && signal.reading !== null;
}

/** Reads one stored result. A failed call has no result and counts as failed only. */
export function readArmCase(result: CaseResultFile): ArmCase {
    const body = asRec(result.unfilteredResult);
    const prompt = result.promptDynamic ?? '';
    const indicator = asArray(body?.indicatorResults);
    const strategies = asArray(body?.strategyResults);
    const computedIndicators = indicator.filter(hasReading);
    const computedStrategies = strategies.filter(
        s => asRec(s)?.cycle !== undefined && asRec(s)?.cycle !== null
    );
    const modelStrategies = strategies.filter(
        s => !computedStrategies.includes(s)
    );
    const strategyChars = Object.fromEntries(
        modelStrategies.flatMap(s => {
            const name = asStr(asRec(s)?.strategyName);
            return name === null
                ? []
                : [[name, jlen(omit(asRec(s), ['id', 'confidenceWeight']))]];
        })
    );
    const chars: Record<ModelField, number> =
        body === null
            ? NO_CHARS
            : {
                  summary: jlen(body?.summary),
                  indicatorResults: jlen(indicator.filter(e => !hasReading(e))),
                  strategyResults: jlen(
                      modelStrategies.map(s =>
                          omit(asRec(s), ['id', 'confidenceWeight'])
                      )
                  ),
                  patternSummaries: jlen(
                      asArray(body?.patternSummaries).map(e =>
                          omit(asRec(e), [
                              'id',
                              'confidenceWeight',
                              'renderConfig',
                          ])
                      )
                  ),
                  candlePatterns: jlen(
                      asArray(body?.candlePatterns).map(e =>
                          omit(asRec(e), ['id'])
                      )
                  ),
                  keyLevels: jlen(body?.keyLevels),
                  priceTargets: jlen(body?.priceTargets),
                  actionRecommendation: jlen(
                      omit(asRec(body?.actionRecommendation), [
                          'reconciledLevels',
                          'planCheck',
                          'planState',
                      ])
                  ),
              };
    const ar = asRec(body?.actionRecommendation);
    const summary = asStr(body?.summary);
    const usage = result.usage;
    const arrays = [
        'indicatorResults',
        'patternSummaries',
        'strategyResults',
        'candlePatterns',
        'trendlines',
    ].every(k => asArray(body?.[k]).length === 0);
    const levels = asRec(body?.keyLevels);
    return {
        caseId: result.caseId,
        failed: result.error !== null || body === null,
        fallback:
            body !== null &&
            arrays &&
            asArray(levels?.support).length === 0 &&
            asArray(levels?.resistance).length === 0 &&
            (summary ?? '').startsWith('AI로부터 분석 결과를 받지 못했습니다'),
        hasSummary: summary !== null && summary.trim() !== '',
        hasPlan:
            ar !== null && asArray(ar.entryPrices).some(p => asNum(p) !== null),
        outputTokens: usage?.outputTokens ?? null,
        inputTokens: usage?.inputTokens ?? null,
        uncachedTokens:
            usage === null ||
            usage.inputTokens === null ||
            usage.cachedTokens === null
                ? null
                : usage.inputTokens - usage.cachedTokens,
        latencyMs: result.latencyMs,
        chars,
        modelChars: Object.values(chars).reduce((s, v) => s + v, 0),
        computedChars: jlen(computedIndicators) + jlen(computedStrategies),
        computedCards: computedIndicators.length + computedStrategies.length,
        summary: summary ?? EMPTY_SUMMARY,
        summaryChars: (summary ?? '').length,
        listedStrategies: listAfter(
            prompt,
            'Strategy skill list to analyze:'
        ).filter(name => CYCLE_STRATEGY_SKILLS[name] === undefined),
        strategyChars,
        strategyEntries: strategies.length,
        qualifiedIds: printedQualified(prompt).ids,
        patternEntries: asArray(body?.patternSummaries).map(e => {
            const rec = asRec(e);
            return {
                skillName: asStr(rec?.skillName),
                detected: rec?.detected === true,
                candidateId: asStr(rec?.candidateId),
            };
        }),
        planPosition: asStr(asRec(ar?.planState)?.position),
        promptFull: result.promptHashes?.full ?? null,
        trendRows: trendRowsOf(body),
        prompt,
        close: asNum(asRec(body?.dataAsOf)?.close),
    };
}

function trendRowsOf(body: Rec | null): ArmCase['trendRows'] {
    return [
        ...asArray(body?.indicatorResults).flatMap(entry => {
            const rec = asRec(entry);
            const name = asStr(rec?.indicatorName);
            return name === null
                ? []
                : asArray(rec?.signals).map(s => ({
                      skill: name,
                      model: asStr(asRec(s)?.trend),
                  }));
        }),
        ...asArray(body?.strategyResults).flatMap(entry => {
            const rec = asRec(entry);
            const name = asStr(rec?.strategyName);
            return name === null
                ? []
                : [{ skill: name, model: asStr(rec?.trend) }];
        }),
    ];
}

// ─── Statistics ───────────────────────────────────────────────────────────────

export interface Ci {
    n: number;
    point: number | null;
    low: number | null;
    high: number | null;
}

/** Percentile bootstrap 95% interval of `stat` over `values`, seeded and reproducible. */
export function bootstrapCi(
    values: readonly number[],
    stat: (v: readonly number[]) => number | null
): Ci {
    const point = stat(values);
    if (values.length < 2 || point === null) {
        return { n: values.length, point, low: null, high: null };
    }
    const random = mulberry32(C.bootstrap.seed);
    const replicates = Array.from({ length: C.bootstrap.replicates }, () =>
        stat(values.map(() => values[Math.floor(random() * values.length)]))
    ).flatMap(v => (v === null ? [] : [v]));
    return {
        n: values.length,
        point,
        low: quantile(replicates, 0.025),
        high: quantile(replicates, 0.975),
    };
}

const ratioOf = (a: number | null, b: number | null): number | null =>
    a === null || b === null || !(b > 0) ? null : a / b;

const keep = (values: readonly (number | null)[]): number[] =>
    values.flatMap(v => (v === null ? [] : [v]));

// ─── Comparison ───────────────────────────────────────────────────────────────

export interface RateComparison {
    before: Share;
    after: Share;
    repeat: Share | null;
    /** `after - before`. */
    diff: number | null;
    /** The noise floor: the repeat run's own drift from the before run, else the given one. */
    floor: number;
}

export interface ComparisonInput {
    /** Card kind of a skill by name (a catalog tag, else the core-0 baseline names). */
    kindOfSkill: Readonly<Record<string, string>>;
    /** The trigger ids of each event guide (an event card's trend comes from the signals the prompt printed). */
    triggersOfSkill?: Readonly<Record<string, readonly string[]>>;
    /** The `computed_card` kinds the catalog tags. */
    taggedKinds: readonly string[];
    after: readonly ArmCase[];
    before: readonly ArmCase[];
    repeat: readonly ArmCase[] | null;
    patterns: readonly PatternSkill[];
    levels: {
        after: readonly LevelCase[];
        before: readonly LevelCase[];
        repeat: readonly LevelCase[] | null;
    };
    calls: {
        after: RunCallStats;
        before: RunCallStats;
        repeat: RunCallStats | null;
    };
    noiseFloor: number;
    tier: 'free' | 'member';
}

function pair<T extends { caseId: string }>(
    a: readonly T[],
    b: readonly T[],
    labels: string
): readonly (readonly [T, T])[] {
    const byId = new Map(b.map(c => [c.caseId, c]));
    const pairs = a.flatMap(c => {
        const other = byId.get(c.caseId);
        return other === undefined ? [] : [[c, other] as const];
    });
    if (pairs.length !== a.length || pairs.length !== b.length) {
        throw new Error(
            `${labels}: the runs do not cover the same cases (${a.length} and ${b.length} results, ${pairs.length} in common)`
        );
    }
    return pairs;
}

function rateOf(
    cases: readonly ArmCase[],
    flag: (c: ArmCase) => boolean,
    among: (c: ArmCase) => boolean = () => true
): Share {
    const own = cases.filter(among);
    return share(own.filter(flag).length, own.length);
}

function rateComparison(
    input: ComparisonInput,
    flag: (c: ArmCase) => boolean,
    among: (c: ArmCase) => boolean
): RateComparison {
    const [after, before] = [
        rateOf(input.after, flag, among),
        rateOf(input.before, flag, among),
    ];
    const repeat =
        input.repeat === null ? null : rateOf(input.repeat, flag, among);
    return {
        before,
        after,
        repeat,
        diff:
            after.share === null || before.share === null
                ? null
                : after.share - before.share,
        floor:
            repeat?.share != null && before.share !== null
                ? Math.abs(repeat.share - before.share)
                : input.noiseFloor,
    };
}

/** Pattern skills whose trigger ids include `id`. */
const skillsOfId = (
    patterns: readonly PatternSkill[],
    id: string
): readonly string[] =>
    patterns.filter(p => p.triggers.includes(id)).map(p => p.name);

const normalize = (text: string): string =>
    text.toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Pattern names and ids a summary mentions that the prompt did not qualify. Whitespace is
 * normalised on both sides (a name with a space and a line break inside still matches). The
 * match is a mention, not an assertion: "no double top is visible" counts, so the rate is
 * an upper bound on summaries that claim an unqualified pattern, and only the difference
 * between arms (V5) is read.
 */
export function ungroundedMentions(
    summary: string,
    qualifiedIds: readonly string[],
    patterns: readonly PatternSkill[]
): readonly string[] {
    const text = normalize(summary);
    return patterns
        .filter(p =>
            [
                p.name,
                ...p.triggers,
                ...p.triggers.map(t => t.replaceAll('_', ' ')),
            ]
                .map(normalize)
                .some(n => n !== '' && text.includes(n))
        )
        .filter(p => !p.triggers.some(t => qualifiedIds.includes(t)))
        .map(p => p.name);
}

/** The candidates a prompt qualified that got a verdict entry (by skill or by candidate id). */
function candidateCoverage(
    cases: readonly ArmCase[],
    patterns: readonly PatternSkill[]
): Share {
    const covered = cases.flatMap(c =>
        [...new Set(c.qualifiedIds)].map(id => {
            const skills = skillsOfId(patterns, id);
            return c.patternEntries.some(
                e =>
                    (e.skillName !== null && skills.includes(e.skillName)) ||
                    (e.candidateId?.startsWith(`pattern:${id}:`) ?? false)
            );
        })
    );
    return share(covered.filter(Boolean).length, covered.length);
}

const detectedCandidateIds = (c: ArmCase): readonly string[] =>
    c.patternEntries.flatMap(e =>
        e.detected && e.candidateId !== null ? [e.candidateId] : []
    );

/** Detected patterns whose skill none of the prompt's printed ids selects (WP-16 §2.2 removes them). */
function modelOnlyDetected(
    c: ArmCase,
    patterns: readonly PatternSkill[]
): number {
    return c.patternEntries.filter(
        e =>
            e.detected &&
            !c.qualifiedIds.some(id =>
                skillsOfId(patterns, id).includes(e.skillName ?? '')
            )
    ).length;
}

const panelItems = (c: ArmCase, patterns: readonly PatternSkill[]): number =>
    c.patternEntries.filter(e => e.detected).length -
    modelOnlyDetected(c, patterns) +
    c.strategyEntries;

export interface CardTrendKind {
    kind: string;
    n: number;
    agree: number;
    opposite: number;
}

/**
 * D7: the model's per-card trend against the rule for the skill's kind on the printed lines
 * (WP-16 §3.4), per skill. A row whose kind has no rule, or whose rule has no reading on that
 * prompt, is left out.
 */
export function cardTrendAgreement(
    cases: readonly ArmCase[],
    kindOfSkill: Readonly<Record<string, string>>,
    triggersOfSkill: Readonly<Record<string, readonly string[]>> = {}
): Record<string, CardTrendKind> {
    return cases
        .flatMap(c =>
            c.trendRows.flatMap(row => {
                const kind = kindOfSkill[row.skill];
                return kind === undefined || row.model === null
                    ? []
                    : [
                          {
                              skill: row.skill,
                              kind,
                              model: row.model,
                              rule: ruleTrendOfKind(kind, c.prompt, {
                                  triggers: triggersOfSkill[row.skill],
                              }),
                          },
                      ];
            })
        )
        .filter(t => t.rule !== null)
        .reduce<Record<string, CardTrendKind>>((acc, t) => {
            const prev = acc[t.skill] ?? {
                kind: t.kind,
                n: 0,
                agree: 0,
                opposite: 0,
            };
            return {
                ...acc,
                [t.skill]: {
                    ...prev,
                    n: prev.n + 1,
                    agree: prev.agree + (t.model === t.rule ? 1 : 0),
                    opposite:
                        prev.opposite +
                        ((t.model === 'bullish' && t.rule === 'bearish') ||
                        (t.model === 'bearish' && t.rule === 'bullish')
                            ? 1
                            : 0),
                },
            };
        }, {});
}

export interface OutputComparison {
    n: number;
    tier: 'free' | 'member';
    tokens: {
        ratio: Ci;
        medianBefore: number | null;
        medianAfter: number | null;
        medianInputBefore: number | null;
        medianInputAfter: number | null;
        medianUncachedBefore: number | null;
        medianUncachedAfter: number | null;
    };
    latency: {
        ratio: Ci;
        msPerToken: {
            before: number | null;
            after: number | null;
            ratio: number | null;
        };
    };
    rates: Record<
        'failed' | 'fallback' | 'missingSummary' | 'missingPlan',
        RateComparison
    >;
    ungroundedPlan: {
        before: Share;
        after: Share;
        diff: number | null;
        floor: number;
    };
    /** Median model-written characters per field, after and before. */
    fieldChars: Record<
        ModelField | 'modelChars' | 'computedChars',
        { before: number | null; after: number | null }
    >;
    /** Mean model-written characters per field and their share of all model-written characters. */
    fieldMeans: Record<
        ModelField | 'modelChars',
        {
            before: { mean: number | null; share: number | null };
            after: { mean: number | null; share: number | null };
        }
    >;
    computedCardsPerAnalysis: { before: number | null; after: number | null };
    levels: { agreement: Ci | null; vsBefore: Ci | null };
    position: { diff: Ci | null; equalToBefore: Ci };
    summaryRatio: Ci;
    strategies: {
        listedCoverage: { before: Share; after: Share };
        entryRatio: Ci;
    };
    patterns: {
        candidateCoverage: { before: Share; after: Share };
        detectedWithCandidate: Ci | null;
        modelOnlyDetected: { before: number; after: number };
        panelItems: { before: number | null; after: number | null; diff: Ci };
        ungroundedSummary: RateComparison;
    };
    cardTrend: Record<string, CardTrendKind>;
    /** Tagged card kinds D7 has no trend rule for: any makes D7 undecided. */
    unruledKinds: readonly string[];
    /** Cases with a paired measurement per gate, of `n` (a gate under the minimum share is undecided). */
    paired: Record<
        'o1' | 'o2' | 'l1' | 'l2' | 'v1' | 'v2' | 'v3' | 'v4' | 'v5',
        number
    >;
    proseSample: Record<'qualified' | 'cycle' | 'random', readonly string[]>;
    promptsIdentical: Share | null;
}

const sortKey = (caseId: string, bucket: string): string =>
    sha256Hex(`${caseId}|${bucket}`);

/** The 40 results the prose reading takes (P): 10 with a qualified pattern, 10 with a cycle card, 20 others. */
function proseSample(
    after: readonly ArmCase[]
): OutputComparison['proseSample'] {
    const take = (
        bucket: string,
        cases: readonly ArmCase[],
        count: number,
        skip: ReadonlySet<string>
    ): readonly string[] =>
        cases
            .filter(c => !skip.has(c.caseId))
            .map(c => ({ id: c.caseId, key: sortKey(c.caseId, bucket) }))
            .toSorted((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
            .slice(0, count)
            .map(c => c.id);
    const qualified = take(
        'qualified',
        after.filter(c => c.qualifiedIds.length > 0),
        10,
        new Set()
    );
    const cycle = take(
        'cycle',
        after.filter(c => c.computedCards > 0),
        10,
        new Set(qualified)
    );
    const random = take('random', after, 20, new Set([...qualified, ...cycle]));
    return { qualified, cycle, random };
}

function fieldMeansOf(input: ComparisonInput): OutputComparison['fieldMeans'] {
    const of = (
        cases: readonly ArmCase[],
        field: ModelField | 'modelChars'
    ) => {
        const ok = cases.filter(c => !c.failed);
        const value = (c: ArmCase): number =>
            field === 'modelChars' ? c.modelChars : c.chars[field];
        const total = ok.reduce((s, c) => s + c.modelChars, 0);
        return {
            mean: mean(ok.map(value)),
            share:
                total === 0
                    ? null
                    : ok.reduce((s, c) => s + value(c), 0) / total,
        };
    };
    const both = (field: ModelField | 'modelChars') => ({
        before: of(input.before, field),
        after: of(input.after, field),
    });
    return {
        summary: both('summary'),
        indicatorResults: both('indicatorResults'),
        strategyResults: both('strategyResults'),
        patternSummaries: both('patternSummaries'),
        candlePatterns: both('candlePatterns'),
        keyLevels: both('keyLevels'),
        priceTargets: both('priceTargets'),
        actionRecommendation: both('actionRecommendation'),
        modelChars: both('modelChars'),
    };
}

/** Compares the arms case by case. Throws when the runs do not cover the same cases. */
export function compareArms(input: ComparisonInput): OutputComparison {
    const pairs = pair(input.after, input.before, 'after and before');
    const repeatPairs =
        input.repeat === null
            ? null
            : pair(input.before, input.repeat, 'before and repeat');
    const both = pairs.filter(([a, b]) => !a.failed && !b.failed);
    const outRatios = keep(
        both.map(([a, b]) => ratioOf(a.outputTokens, b.outputTokens))
    );
    const latRatios = keep(
        both.map(([a, b]) => ratioOf(a.latencyMs, b.latencyMs))
    );
    const perToken = (cases: readonly ArmCase[]): number | null =>
        median(
            keep(
                cases.map(c =>
                    c.outputTokens === null || c.outputTokens === 0
                        ? null
                        : c.latencyMs / c.outputTokens
                )
            )
        );
    const medianOf = (
        cases: readonly ArmCase[],
        pick: (c: ArmCase) => number | null
    ): number | null => median(keep(cases.filter(c => !c.failed).map(pick)));
    const fieldMedian = (
        cases: readonly ArmCase[],
        field: ModelField | 'modelChars' | 'computedChars'
    ): number | null =>
        medianOf(cases, c =>
            field === 'modelChars' || field === 'computedChars'
                ? c[field]
                : c.chars[field]
        );
    const pairOfMedians = (
        field: ModelField | 'modelChars' | 'computedChars'
    ): { before: number | null; after: number | null } => ({
        before: fieldMedian(input.before, field),
        after: fieldMedian(input.after, field),
    });
    const chars: OutputComparison['fieldChars'] = {
        summary: pairOfMedians('summary'),
        indicatorResults: pairOfMedians('indicatorResults'),
        strategyResults: pairOfMedians('strategyResults'),
        patternSummaries: pairOfMedians('patternSummaries'),
        candlePatterns: pairOfMedians('candlePatterns'),
        keyLevels: pairOfMedians('keyLevels'),
        priceTargets: pairOfMedians('priceTargets'),
        actionRecommendation: pairOfMedians('actionRecommendation'),
        modelChars: pairOfMedians('modelChars'),
        computedChars: pairOfMedians('computedChars'),
    };
    const summaryRatios = keep(
        both.map(([a, b]) =>
            a.hasSummary && b.hasSummary
                ? ratioOf(a.summaryChars, b.summaryChars)
                : null
        )
    );
    const entryRatios = both.flatMap(([a, b]) =>
        Object.entries(a.strategyChars).flatMap(([name, length]) => {
            const other = b.strategyChars[name];
            return other === undefined || other === 0 ? [] : [length / other];
        })
    );
    const listedCoverage = (cases: readonly ArmCase[]): Share => {
        const rows = cases
            .filter(c => !c.failed)
            .flatMap(c =>
                c.listedStrategies.map(
                    name => c.strategyChars[name] !== undefined
                )
            );
        return share(rows.filter(Boolean).length, rows.length);
    };
    const positionEqual = (a: ArmCase, b: ArmCase): number | null =>
        a.planPosition === null || b.planPosition === null
            ? null
            : a.planPosition === b.planPosition
              ? 1
              : 0;
    // The repeat form: the after run's agreement with before, minus the repeat run's.
    const nonInferior = (
        measure: (a: ArmCase, b: ArmCase) => number | null,
        include: (a: ArmCase, b: ArmCase, r: ArmCase) => boolean = () => true
    ): Ci | null => {
        if (repeatPairs === null) return null;
        const repeatBy = new Map(repeatPairs.map(([b, r]) => [b.caseId, r]));
        return bootstrapCi(
            keep(
                both.map(([a, b]) => {
                    const r = repeatBy.get(b.caseId);
                    if (r === undefined || !include(a, b, r)) return null;
                    const own = measure(a, b);
                    const noise = measure(r, b);
                    return own === null || noise === null ? null : own - noise;
                })
            ),
            mean
        );
    };
    const positionDiff = nonInferior(positionEqual);
    const levelAgreement = (
        run: readonly LevelCase[],
        base: readonly LevelCase[]
    ): ReadonlyMap<string, number> => levelOverlapPerCase(run, base);
    const levelsAfter = levelAgreement(input.levels.after, input.levels.before);
    const levelsRepeat =
        input.levels.repeat === null
            ? null
            : levelAgreement(input.levels.repeat, input.levels.before);
    const levelDiffs =
        levelsRepeat === null
            ? null
            : [...levelsAfter.entries()].flatMap(([k, v]) => {
                  const noise = levelsRepeat.get(k);
                  return noise === undefined ? [] : [v - noise];
              });
    const detectedAgreement = (a: ArmCase, b: ArmCase): number | null =>
        jaccard(detectedCandidateIds(a), detectedCandidateIds(b));
    const ungrounded = rateComparison(
        input,
        c =>
            ungroundedMentions(c.summary, c.qualifiedIds, input.patterns)
                .length > 0,
        c => c.hasSummary
    );
    const callsDiff = (a: Share, b: Share): number | null =>
        a.share === null || b.share === null ? null : a.share - b.share;
    return {
        n: pairs.length,
        tier: input.tier,
        tokens: {
            ratio: bootstrapCi(outRatios, median),
            medianBefore: medianOf(input.before, c => c.outputTokens),
            medianAfter: medianOf(input.after, c => c.outputTokens),
            medianInputBefore: medianOf(input.before, c => c.inputTokens),
            medianInputAfter: medianOf(input.after, c => c.inputTokens),
            medianUncachedBefore: medianOf(input.before, c => c.uncachedTokens),
            medianUncachedAfter: medianOf(input.after, c => c.uncachedTokens),
        },
        latency: {
            ratio: bootstrapCi(latRatios, median),
            msPerToken: {
                before: perToken(input.before),
                after: perToken(input.after),
                ratio: ratioOf(perToken(input.after), perToken(input.before)),
            },
        },
        rates: {
            failed: rateComparison(
                input,
                c => c.failed,
                () => true
            ),
            fallback: rateComparison(
                input,
                c => c.fallback,
                c => !c.failed
            ),
            missingSummary: rateComparison(
                input,
                c => !c.hasSummary,
                c => !c.failed
            ),
            missingPlan: rateComparison(
                input,
                c => !c.hasPlan,
                c => !c.failed
            ),
        },
        ungroundedPlan: {
            before: input.calls.before.ungroundedPlan,
            after: input.calls.after.ungroundedPlan,
            diff: callsDiff(
                input.calls.after.ungroundedPlan,
                input.calls.before.ungroundedPlan
            ),
            floor:
                input.calls.repeat === null
                    ? input.noiseFloor
                    : Math.abs(
                          callsDiff(
                              input.calls.repeat.ungroundedPlan,
                              input.calls.before.ungroundedPlan
                          ) ?? 0
                      ),
        },
        fieldChars: chars,
        fieldMeans: fieldMeansOf(input),
        computedCardsPerAnalysis: {
            before: mean(input.before.map(c => c.computedCards)),
            after: mean(input.after.map(c => c.computedCards)),
        },
        levels: {
            agreement: bootstrapCi([...levelsAfter.values()], mean),
            vsBefore:
                levelDiffs === null ? null : bootstrapCi(levelDiffs, mean),
        },
        position: {
            diff: positionDiff,
            equalToBefore: bootstrapCi(
                keep(both.map(([a, b]) => positionEqual(a, b))),
                mean
            ),
        },
        summaryRatio: bootstrapCi(summaryRatios, median),
        strategies: {
            listedCoverage: {
                before: listedCoverage(input.before),
                after: listedCoverage(input.after),
            },
            entryRatio: bootstrapCi(entryRatios, median),
        },
        patterns: {
            candidateCoverage: {
                before: candidateCoverage(input.before, input.patterns),
                after: candidateCoverage(input.after, input.patterns),
            },
            // Only cases where some arm detected a candidate: the rest agree on nothing.
            detectedWithCandidate: nonInferior(detectedAgreement, (a, b, r) =>
                [a, b, r].some(c => detectedCandidateIds(c).length > 0)
            ),
            modelOnlyDetected: {
                before: input.before.reduce(
                    (s, c) => s + modelOnlyDetected(c, input.patterns),
                    0
                ),
                after: input.after.reduce(
                    (s, c) => s + modelOnlyDetected(c, input.patterns),
                    0
                ),
            },
            panelItems: {
                before: mean(
                    input.before.map(c => panelItems(c, input.patterns))
                ),
                after: mean(
                    input.after.map(c => panelItems(c, input.patterns))
                ),
                diff: bootstrapCi(
                    both.map(
                        ([a, b]) =>
                            panelItems(a, input.patterns) -
                            panelItems(b, input.patterns)
                    ),
                    mean
                ),
            },
            ungroundedSummary: ungrounded,
        },
        cardTrend: cardTrendAgreement(
            input.before,
            input.kindOfSkill,
            input.triggersOfSkill
        ),
        unruledKinds: [...new Set(input.taggedKinds)]
            .filter(kind => !hasTrendRule(kind))
            .toSorted(),
        paired: {
            o1: outRatios.length,
            o2: latRatios.length,
            l1: levelDiffs?.length ?? 0,
            l2: positionDiff?.n ?? 0,
            v1: summaryRatios.length,
            v2: both.length,
            v3: both.length,
            v4: both.length,
            v5: both.length,
        },
        proseSample: proseSample(input.after),
        promptsIdentical:
            repeatPairs === null
                ? null
                : share(
                      repeatPairs.filter(
                          ([b, r]) =>
                              b.promptFull !== null &&
                              b.promptFull === r.promptFull
                      ).length,
                      repeatPairs.length
                  ),
    };
}

// ─── Gates ────────────────────────────────────────────────────────────────────

const gate = (
    id: string,
    description: string,
    pass: boolean | null,
    value: number | string | null,
    threshold: string
): GateResult => ({ id, description, pass, value, threshold });

const fmt = (v: number | null, digits = 3): string =>
    v === null ? 'n/a' : v.toFixed(digits);
const pp = (v: number | null): string =>
    v === null ? 'n/a' : `${(v * 100).toFixed(2)} pp`;

/** D7 to V5 of WP-16 §9.3. A gate the input cannot decide has `pass: null`. */
export function outputGates(c: OutputComparison): readonly GateResult[] {
    const decided = decideGates(c);
    const needed = Math.ceil(C.gates.minPairedShare * c.n - 1e-9);
    const countOf: Record<string, number> = {
        O1: c.paired.o1,
        O2: c.paired.o2,
        L1: c.paired.l1,
        L2: c.paired.l2,
        V1: c.paired.v1,
        V2: c.paired.v2,
        V3: c.paired.v3,
        V4: c.paired.v4,
        V5: c.paired.v5,
    };
    return decided.map(gate => {
        const count = countOf[gate.id];
        return count === undefined || count >= needed
            ? gate
            : {
                  ...gate,
                  pass: null,
                  value: `paired ${count} of ${c.n} cases, under the ${C.gates.minPairedShare * 100}% a decision needs (${gate.value})`,
              };
    });
}

function decideGates(c: OutputComparison): readonly GateResult[] {
    const g = C.gates;
    const member = c.tier === 'member';
    const maxRatio = member ? g.outputMaxRatioMember : g.outputMaxRatioFree;
    const maxHigh = member ? g.outputCiHighMember : g.outputCiHighFree;
    const rateGate = (
        id: string,
        description: string,
        rates: readonly (readonly [string, RateComparison])[]
    ): GateResult => {
        const verdicts = rates.map(([, r]) =>
            r.diff === null
                ? null
                : r.diff <= Math.max(g.rateMarginPp, r.floor) + 1e-12
        );
        return gate(
            id,
            description,
            verdicts.includes(null) ? null : verdicts.every(v => v === true),
            rates
                .map(
                    ([name, r]) =>
                        `${name} ${pp(r.diff)} (margin ${pp(Math.max(g.rateMarginPp, r.floor))})`
                )
                .join(', '),
            'each after - before <= max(1 pp, repeat floor)'
        );
    };
    const cardKinds = Object.entries(c.cardTrend).filter(
        ([, k]) => k.n >= g.cardTrendMinN
    );
    const failing = cardKinds.filter(
        ([, k]) => k.opposite / k.n > g.cardTrendMaxOpposite
    );
    const lowerOk = (ci: Ci | null, margin: number): boolean | null =>
        ci === null || ci.low === null ? null : ci.low >= margin - 1e-12;
    const listed = c.strategies.listedCoverage;
    const cover = c.patterns.candidateCoverage;
    const detected = c.patterns.detectedWithCandidate;
    const panel = c.patterns.panelItems;
    const ungrounded = c.patterns.ungroundedSummary;
    const v2a =
        listed.after.share === null || listed.before.share === null
            ? null
            : listed.after.share >=
              listed.before.share - g.rateMarginPp - 1e-12;
    const v2b =
        c.strategies.entryRatio.point === null
            ? null
            : c.strategies.entryRatio.point >= g.strategyEntryRatioMin;
    const v3a =
        cover.after.share === null || cover.before.share === null
            ? null
            : cover.after.share >=
              cover.before.share - g.candidateCoverageMargin - 1e-12;
    const v3b = lowerOk(detected, g.detectedCandidateMargin);
    return [
        gate(
            'D7',
            'card trend against the rule on the printed lines: opposite share per skill with n >= 30',
            c.unruledKinds.length > 0 || cardKinds.length === 0
                ? null
                : failing.length === 0,
            c.unruledKinds.length > 0
                ? `tagged kinds with no trend rule in the instrument: ${c.unruledKinds.join(', ')}`
                : cardKinds.length === 0
                  ? 'no skill has 30 trend readings in the before run'
                  : cardKinds
                        .map(
                            ([name, k]) =>
                                `${name} (${k.kind}) n ${k.n} agree ${pct(k.agree / k.n)} opposite ${pct(k.opposite / k.n)}`
                        )
                        .join('; '),
            `opposite <= ${g.cardTrendMaxOpposite * 100}% (a failing kind maps to neutral)`
        ),
        gate(
            'O1',
            'median per-case output-token ratio and its bootstrap 95% upper bound',
            c.tokens.ratio.point === null || c.tokens.ratio.high === null
                ? null
                : c.tokens.ratio.point <= maxRatio &&
                      c.tokens.ratio.high <= maxHigh,
            `median ${fmt(c.tokens.ratio.point)} (95% high ${fmt(c.tokens.ratio.high)}, n ${c.tokens.ratio.n})`,
            `<= ${maxRatio}, upper <= ${maxHigh} (${c.tier})`
        ),
        gate(
            'O2',
            'median per-case latency ratio (ms per token reported beside it)',
            c.latency.ratio.point === null
                ? null
                : c.latency.ratio.point <= g.latencyMaxRatio,
            `median ${fmt(c.latency.ratio.point)} (95% high ${fmt(c.latency.ratio.high)}), ms/token x${fmt(c.latency.msPerToken.ratio)}`,
            `<= ${g.latencyMaxRatio}; ms/token within +-${g.msPerTokenBand * 100}% is a diagnostic`
        ),
        rateGate(
            'F1',
            'failure, empty fallback, missing summary and missing plan rates',
            [
                ['failed', c.rates.failed],
                ['fallback', c.rates.fallback],
                ['missingSummary', c.rates.missingSummary],
                ['missingPlan', c.rates.missingPlan],
            ]
        ),
        gate(
            'F2',
            'ungrounded plan prices',
            c.ungroundedPlan.diff === null
                ? null
                : c.ungroundedPlan.diff <=
                      Math.max(g.rateMarginPp, c.ungroundedPlan.floor) + 1e-12,
            `${pp(c.ungroundedPlan.diff)} (margin ${pp(Math.max(g.rateMarginPp, c.ungroundedPlan.floor))})`,
            '<= max(1 pp, repeat floor)'
        ),
        gate(
            'L1',
            "key-level agreement with before, minus the repeat run's agreement (non-inferiority)",
            lowerOk(c.levels.vsBefore, g.levelMargin),
            c.levels.vsBefore === null
                ? 'no --repeat run: the noise floor is unknown'
                : `${pp(c.levels.vsBefore.point)} (95% low ${pp(c.levels.vsBefore.low)}, n ${c.levels.vsBefore.n})`,
            `95% low >= ${pp(g.levelMargin)}`
        ),
        gate(
            'L2',
            "equal plan position with before, minus the repeat run's (non-inferiority)",
            lowerOk(c.position.diff, g.positionMargin),
            c.position.diff === null
                ? 'no --repeat run: the noise floor is unknown'
                : `${pp(c.position.diff.point)} (95% low ${pp(c.position.diff.low)}, n ${c.position.diff.n})`,
            `95% low >= ${pp(g.positionMargin)}`
        ),
        gate(
            'V1',
            'median per-case summary length ratio',
            c.summaryRatio.point === null
                ? null
                : c.summaryRatio.point >= g.summaryRatioMin &&
                      c.summaryRatio.point <= g.summaryRatioMax,
            `median ${fmt(c.summaryRatio.point)} (n ${c.summaryRatio.n})`,
            `in [${g.summaryRatioMin}, ${g.summaryRatioMax}]`
        ),
        gate(
            'V2',
            'listed strategies with an entry, and the median entry length ratio',
            both(v2a, v2b),
            `coverage ${pct(listed.before.share)} -> ${pct(listed.after.share)}, entry length x${fmt(c.strategies.entryRatio.point)}`,
            `coverage >= before - 1 pp, length >= ${g.strategyEntryRatioMin}`
        ),
        gate(
            'V3',
            'qualified candidates with a verdict entry, and detected candidates agreement (non-inferiority)',
            both(v3a, v3b),
            `coverage ${pct(cover.before.share)} -> ${pct(cover.after.share)}, detected agreement ${detected === null ? 'no --repeat run' : `${pp(detected.point)} (95% low ${pp(detected.low)}, over ${detected.n} cases with a detected candidate)`}`,
            `coverage >= before - 2 pp, agreement 95% low >= ${pp(g.detectedCandidateMargin)}`
        ),
        gate(
            'V4',
            'panel-visible items per case (detected patterns with a candidate and strategy entries), after minus before',
            panel.diff.point === null
                ? null
                : panel.diff.point >= -g.panelItemsMargin,
            `${fmt(panel.diff.point)} (before ${fmt(panel.before)}, after ${fmt(panel.after)}; model-only detected ${c.patterns.modelOnlyDetected.before} -> ${c.patterns.modelOnlyDetected.after})`,
            `>= -${g.panelItemsMargin}`
        ),
        // A mention is not a claim ("no double top is visible" counts), so the rate itself is
        // an upper bound; the gate reads only the difference between the arms.
        gate(
            'V5',
            'summaries naming a chart pattern the prompt did not qualify',
            ungrounded.diff === null
                ? null
                : ungrounded.diff <= g.rateMarginPp + 1e-12,
            `${pct(ungrounded.before.share)} -> ${pct(ungrounded.after.share)} (${pp(ungrounded.diff)})`,
            'after <= before + 1 pp'
        ),
    ];
}

/** Two conditions: false as soon as one is, undecided when neither is false and one is unknown. */
const both = (a: boolean | null, b: boolean | null): boolean | null =>
    a === false || b === false ? false : a === null || b === null ? null : true;

const pct = (v: number | null): string =>
    v === null ? 'n/a' : `${(v * 100).toFixed(1)}%`;
