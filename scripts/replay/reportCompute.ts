/**
 * The numbers of the replay report. Pure functions over `LabelRow`s; `report.ts` formats
 * them. Rules every function follows:
 *  - a rate always comes with its `n`; an empty denominator gives `null`, never `0`;
 *  - headline rows are labelled rows whose anchor is a price the analysis saw: rows with
 *    `anchorSource === 'generated_at'` or `plan.anchorBarUnobserved === true` are counted
 *    in their own bucket and never enter a headline number;
 *  - everything is split by the plan's recommendation, never pooled across verdicts;
 *  - the `target_first` share is compared with the mean `rwNullTargetFirst` over **all**
 *    triggered plans (the null has no horizon), and `not_triggered`, `void_at_entry` and
 *    `no_plan` are counted apart, never as wins.
 */
import { PLACEBO_SHIFT_ATR } from '@/domain/outcomes/constants';
import type { LevelOutcome, PatternOutcome, PlanOutcome } from '@/domain/types';
import { jaccard, mean, median, pairsOf, standardError } from './stats';
import { quantile } from '@/domain/outcomes/weekClusterBootstrap';
import {
    REPLAY_REGIMES,
    type LabelRow,
    type ReplayMarket,
    type ReplayRegime,
    type Verdict,
} from './types';

// ─── Buckets, verdicts, groups ────────────────────────────────────────────────
export type Bucket = 'failed' | 'unlabelled' | 'excluded' | 'headline';

export function bucketOf(row: LabelRow): Bucket {
    if (row.status === 'failed') return 'failed';
    if (row.status !== 'labelled' || row.labels === null) return 'unlabelled';
    return row.labels.anchorSource === 'generated_at' ||
        row.labels.plan.anchorBarUnobserved
        ? 'excluded'
        : 'headline';
}

/** `plan.recommendation`; `none` when the plan carried no verdict (or there is no plan). */
export function verdictOf(row: LabelRow): Verdict {
    return (
        row.labels?.plan.recommendation ??
        row.subject?.plan?.recommendation ??
        'none'
    );
}

export interface Group {
    name: string;
    matches: (row: LabelRow) => boolean;
}

const MARKETS: readonly ReplayMarket[] = ['us', 'kr'];

const regimeGroup = (regime: ReplayRegime): Group => ({
    name: regime,
    matches: row => row.regime === regime,
});
const marketGroup = (market: ReplayMarket): Group => ({
    name: market,
    matches: row => row.market === market,
});

/** All rows, each regime, each market. */
export const MARGINAL_GROUPS: readonly Group[] = [
    { name: 'all', matches: () => true },
    ...REPLAY_REGIMES.map(regimeGroup),
    ...MARKETS.map(marketGroup),
];

/** The marginal groups plus every regime within each market. */
export const FULL_GROUPS: readonly Group[] = [
    ...MARGINAL_GROUPS,
    ...REPLAY_REGIMES.flatMap(regime =>
        MARKETS.map(market => ({
            name: `${regime}/${market}`,
            matches: (row: LabelRow) =>
                row.regime === regime && row.market === market,
        }))
    ),
];

export function headlineRows(rows: readonly LabelRow[]): readonly LabelRow[] {
    return rows.filter(row => bucketOf(row) === 'headline');
}

// ─── Rates ────────────────────────────────────────────────────────────────────
export interface Rate {
    count: number;
    /** The denominator. */
    n: number;
    /** `count / n`, `null` when `n` is 0. */
    share: number | null;
}

export function rate(count: number, n: number): Rate {
    return { count, n, share: n === 0 ? null : count / n };
}

export interface MeanStat {
    n: number;
    mean: number | null;
    /** Standard error of the mean; `null` below two values. */
    se: number | null;
}

export function meanStat(values: readonly number[]): MeanStat {
    return { n: values.length, mean: mean(values), se: standardError(values) };
}

/**
 * A record with one entry per key. `Object.fromEntries` types its result as an index
 * signature, so the one cast here restores the key type; it holds at runtime because every
 * key of `keys` gets an entry.
 */
function recordOf<K extends string, V>(
    keys: readonly K[],
    make: (key: K) => V
): Record<K, V> {
    return Object.fromEntries(keys.map(key => [key, make(key)])) as Record<
        K,
        V
    >;
}

/** How many times each key occurs: one pass, no copying accumulator (CONVENTIONS.md#CP-5). */
function countBy(keys: readonly string[]): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const key of keys) {
        counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
}

/**
 * Per-observation differences `1[hit] − null` (the model's `target_first` indicator minus
 * the null's probability for the same plan): their mean is the share minus the null mean,
 * and their sample standard error is the sampling error of that difference, which treats
 * the cases as independent.
 */
function hitMinusNull(
    items: readonly { hit: boolean; nullProbability: number | null }[]
): MeanStat {
    return meanStat(
        items.flatMap(item =>
            item.nullProbability === null
                ? []
                : [Number(item.hit) - item.nullProbability]
        )
    );
}

// ─── Section 1: counts and failures ───────────────────────────────────────────
export interface CountsSummary {
    rows: number;
    failed: Rate;
    unlabelled: Rate;
    excluded: Rate;
    headline: Rate;
    /** Headline rows whose analysis had no plan at all (no `actionRecommendation`). */
    missingPlan: Rate;
}

export function summarizeCounts(rows: readonly LabelRow[]): CountsSummary {
    const count = (bucket: Bucket): number =>
        rows.filter(row => bucketOf(row) === bucket).length;
    const headline = headlineRows(rows);
    return {
        rows: rows.length,
        failed: rate(count('failed'), rows.length),
        unlabelled: rate(count('unlabelled'), rows.length),
        excluded: rate(count('excluded'), rows.length),
        headline: rate(count('headline'), rows.length),
        missingPlan: rate(
            headline.filter(row => row.labels?.plan.reason === 'none').length,
            headline.length
        ),
    };
}

// ─── Section 2/3: plan outcomes ───────────────────────────────────────────────
export const PLAN_OUTCOMES: readonly PlanOutcome[] = [
    'no_plan',
    'not_triggered',
    'void_at_entry',
    'target_first',
    'stop_first',
    'ambiguous',
    'open_at_horizon',
];

/** Plans that filled: the only ones the target-first comparison is about. */
export const TRIGGERED: ReadonlySet<PlanOutcome> = new Set<PlanOutcome>([
    'target_first',
    'stop_first',
    'ambiguous',
    'open_at_horizon',
]);

const EXIT_OUTCOMES: ReadonlySet<PlanOutcome> = new Set<PlanOutcome>([
    'target_first',
    'stop_first',
    'open_at_horizon',
]);

export interface PlanSummary {
    n: number;
    outcomes: Record<PlanOutcome, number>;
    triggered: number;
    targetFirst: Rate;
    /** Mean `rwNullTargetFirst` over the same triggered plans. */
    nullMean: MeanStat;
    /** `targetFirst.share − nullMean.mean`, `null` when either is missing. */
    diff: number | null;
    /** The per-plan differences behind `diff`: mean and sampling standard error. */
    diffStat: MeanStat;
    /** Exit return of non-gap and of gap exits, apart. */
    returnNonGap: MeanStat;
    returnGap: MeanStat;
    /** Exit return minus the exposure-matched same-symbol baseline, apart by gap. */
    excessNonGap: MeanStat;
    excessGap: MeanStat;
    reasons: Record<string, number>;
}

export function summarizePlans(rows: readonly LabelRow[]): PlanSummary {
    const plans = rows.flatMap(row =>
        row.labels === null ? [] : [row.labels.plan]
    );
    const outcomes = recordOf(
        PLAN_OUTCOMES,
        outcome => plans.filter(plan => plan.outcome === outcome).length
    );
    const triggered = plans.filter(plan => TRIGGERED.has(plan.outcome));
    const comparable = triggered.filter(
        plan => plan.rwNullTargetFirst !== null
    );
    const targetFirst = rate(
        comparable.filter(plan => plan.outcome === 'target_first').length,
        comparable.length
    );
    const nullMean = meanStat(
        comparable.flatMap(plan =>
            plan.rwNullTargetFirst === null ? [] : [plan.rwNullTargetFirst]
        )
    );
    const exits = plans.filter(
        plan => EXIT_OUTCOMES.has(plan.outcome) && plan.returnPct !== null
    );
    const returns = (gap: boolean): readonly number[] =>
        exits.flatMap(plan =>
            (plan.gap === true) === gap && plan.returnPct !== null
                ? [plan.returnPct]
                : []
        );
    const excess = (gap: boolean): readonly number[] =>
        exits.flatMap(plan =>
            (plan.gap === true) === gap &&
            plan.returnPct !== null &&
            plan.baselineSameLengthPct !== null
                ? [plan.returnPct - plan.baselineSameLengthPct]
                : []
        );
    const reasons = countBy(
        plans.flatMap(plan =>
            plan.reason === null ? [] : [`${plan.outcome}:${plan.reason}`]
        )
    );
    return {
        n: plans.length,
        outcomes,
        triggered: triggered.length,
        targetFirst,
        nullMean,
        diff:
            targetFirst.share === null || nullMean.mean === null
                ? null
                : targetFirst.share - nullMean.mean,
        diffStat: hitMinusNull(
            comparable.map(plan => ({
                hit: plan.outcome === 'target_first',
                nullProbability: plan.rwNullTargetFirst,
            }))
        ),
        returnNonGap: meanStat(returns(false)),
        returnGap: meanStat(returns(true)),
        excessNonGap: meanStat(excess(false)),
        excessGap: meanStat(excess(true)),
        reasons,
    };
}

// ─── Section 4: levels against the placebo ────────────────────────────────────
export interface LevelSideStat {
    /** Levels evaluated (not skipped). */
    evaluated: number;
    respected: number;
    /** Respected or broken: a touch that resolved. */
    resolved: number;
    brokenByGap: number;
}

export interface LevelPlaceboSummary {
    shiftAtr: number;
    /** Levels where the real level and this placebo were both evaluated. */
    pairs: number;
    real: LevelSideStat;
    placebo: LevelSideStat;
    /** `respected / pairs` of the real level minus that of the placebo. */
    diff: number | null;
    /** The per-pair differences behind `diff` (1, 0 or -1): mean and sampling standard error. */
    diffStat: MeanStat;
}

interface LevelPair {
    outcome: LevelOutcome;
    gap: boolean;
    placeboOutcome: LevelOutcome;
}

function sideStat(
    outcomes: readonly { outcome: LevelOutcome; gap: boolean }[]
): LevelSideStat {
    return {
        evaluated: outcomes.length,
        respected: outcomes.filter(o => o.outcome === 'respected').length,
        resolved: outcomes.filter(
            o => o.outcome === 'respected' || o.outcome === 'broken'
        ).length,
        brokenByGap: outcomes.filter(o => o.outcome === 'broken' && o.gap)
            .length,
    };
}

/**
 * Real levels against the level moved `shiftAtr` ATRs, only where both were evaluated
 * (neither `skipped`). The placebo's own `gap` is not stored, so its gap count is 0.
 */
export function summarizeLevels(
    rows: readonly LabelRow[],
    shiftAtr: number
): LevelPlaceboSummary {
    const pairs = rows.flatMap(row =>
        (row.labels?.levels ?? []).flatMap((level): LevelPair[] => {
            const placebo = level.placebo.find(p => p.shiftAtr === shiftAtr);
            return level.outcome !== 'skipped' &&
                placebo !== undefined &&
                placebo.outcome !== 'skipped'
                ? [
                      {
                          outcome: level.outcome,
                          gap: level.gap,
                          placeboOutcome: placebo.outcome,
                      },
                  ]
                : [];
        })
    );
    const real = sideStat(pairs);
    const placebo = sideStat(
        pairs.map(pair => ({ outcome: pair.placeboOutcome, gap: false }))
    );
    return {
        shiftAtr,
        pairs: pairs.length,
        real,
        placebo,
        diff:
            pairs.length === 0
                ? null
                : (real.respected - placebo.respected) / pairs.length,
        diffStat: meanStat(
            pairs.map(
                pair =>
                    Number(pair.outcome === 'respected') -
                    Number(pair.placeboOutcome === 'respected')
            )
        ),
    };
}

export const PLACEBO_SHIFTS: readonly number[] = [
    PLACEBO_SHIFT_ATR,
    -PLACEBO_SHIFT_ATR,
];

// ─── Section 5: patterns ──────────────────────────────────────────────────────
const PATTERN_OUTCOMES: readonly PatternOutcome[] = [
    'skipped',
    'no_breakout',
    'invalidated_before_breakout',
    'target_first',
    'invalidation_first',
    'ambiguous',
    'open_at_horizon',
];

const RACED: ReadonlySet<PatternOutcome> = new Set<PatternOutcome>([
    'target_first',
    'invalidation_first',
    'ambiguous',
    'open_at_horizon',
]);

export interface PatternSummary {
    n: number;
    outcomes: Record<PatternOutcome, number>;
    /** `target_reached` and `target_reached_on_breakout` are separate reasons. */
    skipReasons: Record<
        'geometry_invalid' | 'target_reached' | 'target_reached_on_breakout',
        number
    >;
    raced: number;
    targetFirst: Rate;
    nullMean: MeanStat;
    diff: number | null;
    diffStat: MeanStat;
    gapExits: number;
}

export function summarizePatterns(rows: readonly LabelRow[]): PatternSummary {
    const patterns = rows.flatMap(row => row.labels?.patterns ?? []);
    const raced = patterns.filter(p => RACED.has(p.outcome));
    const comparable = raced.filter(p => p.rwNullTargetFirst !== null);
    const targetFirst = rate(
        comparable.filter(p => p.outcome === 'target_first').length,
        comparable.length
    );
    const nullMean = meanStat(
        comparable.flatMap(p =>
            p.rwNullTargetFirst === null ? [] : [p.rwNullTargetFirst]
        )
    );
    const skipped = (reason: string): number =>
        patterns.filter(p => p.skipReason === reason).length;
    return {
        n: patterns.length,
        outcomes: recordOf(
            PATTERN_OUTCOMES,
            outcome => patterns.filter(p => p.outcome === outcome).length
        ),
        skipReasons: {
            geometry_invalid: skipped('geometry_invalid'),
            target_reached: skipped('target_reached'),
            target_reached_on_breakout: skipped('target_reached_on_breakout'),
        },
        raced: raced.length,
        targetFirst,
        nullMean,
        diff:
            targetFirst.share === null || nullMean.mean === null
                ? null
                : targetFirst.share - nullMean.mean,
        diffStat: hitMinusNull(
            comparable.map(p => ({
                hit: p.outcome === 'target_first',
                nullProbability: p.rwNullTargetFirst,
            }))
        ),
        gapExits: patterns.filter(p => p.gap === true).length,
    };
}

// ─── Section 6: forward returns ───────────────────────────────────────────────
export interface ForwardSummary {
    h: number;
    returns: MeanStat;
    /** Return minus the mean `h`-bar return over the window's own closes. */
    excessWindow: MeanStat;
    /** Return minus the mean `h`-bar return over the symbol's whole bars file. */
    excessPeriod: MeanStat;
}

export function summarizeForward(
    rows: readonly LabelRow[],
    h: number
): ForwardSummary {
    const entries = rows.flatMap(row => {
        const label = row.labels?.forward.find(f => f.h === h);
        return label === undefined || label.returnPct === null
            ? []
            : [{ label, period: row.periodBaselinePct[String(h)] ?? null }];
    });
    return {
        h,
        returns: meanStat(
            entries.flatMap(e =>
                e.label.returnPct === null ? [] : [e.label.returnPct]
            )
        ),
        excessWindow: meanStat(
            entries.flatMap(e =>
                e.label.returnPct === null || e.label.baselinePct === null
                    ? []
                    : [e.label.returnPct - e.label.baselinePct]
            )
        ),
        excessPeriod: meanStat(
            entries.flatMap(e =>
                e.label.returnPct === null || e.period === null
                    ? []
                    : [e.label.returnPct - e.period]
            )
        ),
    };
}

// ─── Section 7/8: provenance and invariants ───────────────────────────────────
export interface ProvenanceStat {
    /** Rows with a provenance check. */
    rows: number;
    planChecked: number;
    plan: Rate;
    planControl: Rate;
    other: Rate;
    keyPrices: Rate;
}

export function summarizeProvenance(rows: readonly LabelRow[]): ProvenanceStat {
    const checked = rows.flatMap(row =>
        row.provenance === null ? [] : [row.provenance]
    );
    const controls = rows.flatMap(row =>
        row.provenanceControl === null ? [] : [row.provenanceControl]
    );
    const total = (
        items: readonly {
            checked: { plan: number; other: number; keyPrices: number };
            ungrounded: { plan: number; other: number; keyPrices: number };
        }[],
        kind: 'plan' | 'other' | 'keyPrices'
    ): Rate =>
        rate(
            items.reduce((sum, item) => sum + item.ungrounded[kind], 0),
            items.reduce((sum, item) => sum + item.checked[kind], 0)
        );
    return {
        rows: checked.length,
        planChecked: total(checked, 'plan').n,
        plan: total(checked, 'plan'),
        planControl: total(controls, 'plan'),
        other: total(checked, 'other'),
        keyPrices: total(checked, 'keyPrices'),
    };
}

/** Rows breaking each plan invariant (rows with a result, whatever their bucket). */
export function summarizeInvariants(rows: readonly LabelRow[]): {
    n: number;
    byRule: Record<string, number>;
} {
    const withResult = rows.filter(row => row.status !== 'failed');
    return {
        n: withResult.length,
        byRule: countBy(withResult.flatMap(row => row.invariants)),
    };
}

// ─── Variance: agreement, spread, overlap, flips ──────────────────────────────
export type FlipLabel =
    | 'trend'
    | 'entryRecommendation'
    | 'planOutcome'
    | 'levelOutcome'
    | 'patternOutcome';

export const FLIP_LABELS: readonly FlipLabel[] = [
    'trend',
    'entryRecommendation',
    'planOutcome',
    'levelOutcome',
    'patternOutcome',
];

export interface FlipStat {
    flips: number;
    /** Comparisons made (run pairs, or matched levels / patterns across run pairs). */
    n: number;
    rate: number | null;
}

export type FlipRates = Record<FlipLabel, FlipStat>;

/**
 * Rows of every case that has at least two runs carrying an analysis (a subject), grouped
 * by case. A case with fewer usable runs than the run's repeat count is still used, with
 * the runs it has.
 */
export function rowsByCase(
    rows: readonly LabelRow[]
): readonly (readonly LabelRow[])[] {
    const usable = rows.filter(row => row.subject !== null);
    return [...new Set(usable.map(row => row.caseId))]
        .map(caseId => usable.filter(row => row.caseId === caseId))
        .filter(group => group.length >= 2);
}

const levelKey = (level: { role: string; price: number }): string =>
    `${level.role}:${level.price}`;

/** Level outcomes keyed by role and price; the key is how two runs' levels are matched. */
function levelOutcomes(row: LabelRow): ReadonlyMap<string, string> {
    return new Map(
        (row.labels?.levels ?? []).map(level => [
            levelKey(level),
            level.outcome,
        ])
    );
}

function patternOutcomes(row: LabelRow): ReadonlyMap<string, string> {
    return new Map(
        (row.labels?.patterns ?? []).map(p => [
            `${p.name}:${p.candidateId ?? ''}`,
            p.outcome,
        ])
    );
}

/** Comparisons `[a, b]` of one label over two rows of the same case; one entry per comparable item. */
function comparisons(
    label: FlipLabel,
    a: LabelRow,
    b: LabelRow
): readonly (readonly [string, string])[] {
    const matched = (
        left: ReadonlyMap<string, string>,
        right: ReadonlyMap<string, string>
    ): readonly (readonly [string, string])[] =>
        [...left.entries()].flatMap(([key, value]) => {
            const other = right.get(key);
            return other === undefined ? [] : [[value, other] as const];
        });
    switch (label) {
        case 'trend':
            return a.subject === null || b.subject === null
                ? []
                : [[a.subject.trend, b.subject.trend]];
        case 'entryRecommendation':
            return [[verdictOf(a), verdictOf(b)]];
        case 'planOutcome':
            return a.labels === null || b.labels === null
                ? []
                : [[a.labels.plan.outcome, b.labels.plan.outcome]];
        case 'levelOutcome':
            return matched(levelOutcomes(a), levelOutcomes(b));
        case 'patternOutcome':
            return matched(patternOutcomes(a), patternOutcomes(b));
    }
}

/** Flips among comparisons `[a, b]`: where the two differ. */
function flipStat(compared: readonly (readonly [string, string])[]): FlipStat {
    const flips = compared.filter(([left, right]) => left !== right).length;
    return {
        flips,
        n: compared.length,
        rate: compared.length === 0 ? null : flips / compared.length,
    };
}

/**
 * Pairwise flip rate per label over every pair of runs of every case with at least two
 * runs: the run-to-run noise floor. A level or pattern is compared only when both runs
 * of the pair produced it.
 */
export function computeFlipRates(rows: readonly LabelRow[]): FlipRates {
    const cases = rowsByCase(rows);
    return recordOf(FLIP_LABELS, label =>
        flipStat(
            cases.flatMap(group =>
                pairsOf(group).flatMap(([a, b]) => comparisons(label, a, b))
            )
        )
    );
}

export interface VarianceSummary {
    /** Cases with at least two runs that carry an analysis. */
    cases: number;
    /** How many of those cases have each number of usable runs, ascending by run count. */
    runCounts: readonly { runs: number; cases: number }[];
    /** Share of those cases whose runs all agree, per label (levels over matched levels). */
    agreement: Record<FlipLabel, Rate>;
    /** Spread (max − min across runs) in ATR units of three plan prices. */
    spreadAtr: Record<
        'stop' | 'zoneHigh' | 'firstTarget',
        { n: number; median: number | null; p90: number | null }
    >;
    /** Mean Jaccard overlap of the key-level sets over run pairs. */
    levelJaccard: MeanStat;
    flips: FlipRates;
}

export function summarizeVariance(rows: readonly LabelRow[]): VarianceSummary {
    const cases = rowsByCase(rows);
    const agreement = (label: FlipLabel): Rate => {
        // A case agrees when no pair of its runs flips on any comparable item.
        const perCase = cases.map(group =>
            pairsOf(group).flatMap(([a, b]) => comparisons(label, a, b))
        );
        const comparable = perCase.filter(items => items.length > 0);
        return rate(
            comparable.filter(items => items.every(([x, y]) => x === y)).length,
            comparable.length
        );
    };
    const spread = (
        pick: (row: LabelRow) => number | null
    ): { n: number; median: number | null; p90: number | null } => {
        const values = cases.flatMap(group => {
            const atr =
                group.find(row => (row.labels?.atr ?? 0) > 0)?.labels?.atr ??
                null;
            const prices = group.flatMap(row => {
                const value = pick(row);
                return value === null ? [] : [value];
            });
            return atr === null || prices.length < 2
                ? []
                : [(Math.max(...prices) - Math.min(...prices)) / atr];
        });
        return {
            n: values.length,
            median: median(values),
            p90: quantile(values, 0.9),
        };
    };
    const levelSets = (row: LabelRow): readonly string[] =>
        (row.subject?.levels ?? []).map(levelKey);
    return {
        cases: cases.length,
        runCounts: [...new Set(cases.map(group => group.length))]
            .toSorted((a, b) => a - b)
            .map(runs => ({
                runs,
                cases: cases.filter(group => group.length === runs).length,
            })),
        agreement: recordOf(FLIP_LABELS, label => agreement(label)),
        spreadAtr: {
            stop: spread(row => row.subject?.plan?.stop ?? null),
            zoneHigh: spread(row => row.subject?.plan?.entryHigh ?? null),
            firstTarget: spread(row => row.subject?.plan?.targets[0] ?? null),
        },
        levelJaccard: meanStat(
            cases.flatMap(group =>
                pairsOf(group).map(([a, b]) =>
                    jaccard(levelSets(a), levelSets(b))
                )
            )
        ),
        flips: computeFlipRates(rows),
    };
}

// ─── Noise note ───────────────────────────────────────────────────────────────
export type NoiseVerdict = 'within_noise' | 'above_noise' | 'unknown';

/**
 * A difference smaller than the run's own flip rate is within run-to-run noise. With no
 * flip rate (no variance run) the noise floor is unknown, which is not the same as "no noise".
 */
export function noiseVerdict(
    diff: number | null,
    flipRate: number | null
): NoiseVerdict {
    if (diff === null || flipRate === null) return 'unknown';
    return Math.abs(diff) < flipRate ? 'within_noise' : 'above_noise';
}

// ─── Run-level warnings ───────────────────────────────────────────────────────
export interface RunWarnings {
    /** Labelled rows anchored on `generated_at` or an unobserved anchor bar (expected 0 in replay). */
    excluded: number;
    generatedAt: number;
    anchorBarUnobserved: number;
    /** Rows whose `dataAsOf.barTime` is not the case's `asOf` bar. */
    dataAsOfMismatch: number;
}

export function collectWarnings(rows: readonly LabelRow[]): RunWarnings {
    const labelled = rows.filter(row => row.labels !== null);
    return {
        excluded: rows.filter(row => bucketOf(row) === 'excluded').length,
        generatedAt: labelled.filter(
            row => row.labels?.anchorSource === 'generated_at'
        ).length,
        anchorBarUnobserved: labelled.filter(
            row => row.labels?.plan.anchorBarUnobserved === true
        ).length,
        dataAsOfMismatch: rows.filter(row => row.dataAsOfMatches === false)
            .length,
    };
}

// ─── Compare: two runs over the same cases ────────────────────────────────────
export interface PairedStat {
    name: string;
    n: number;
    meanA: number | null;
    meanB: number | null;
    /** Paired difference `B − A` with its standard error. */
    diff: MeanStat;
    /** The flip label whose rate is this item's noise floor; `null` when none applies. */
    noiseLabel: FlipLabel | null;
}

export interface CompareSummary {
    /** Rows present in both runs (same `caseId` and repeat). */
    pairs: number;
    flips: FlipRates;
    paired: readonly PairedStat[];
}

const pairKey = (row: LabelRow): string => `${row.caseId}#${row.repeat}`;

/** Rows of the two runs with the same case and repeat index. */
export function pairRows(
    a: readonly LabelRow[],
    b: readonly LabelRow[]
): readonly (readonly [LabelRow, LabelRow])[] {
    const inB = new Map(b.map(row => [pairKey(row), row]));
    return a.flatMap(row => {
        const other = inB.get(pairKey(row));
        return other === undefined ? [] : [[row, other] as const];
    });
}

function levelRespectedShare(row: LabelRow): number | null {
    const evaluated = (row.labels?.levels ?? []).filter(
        l => l.outcome !== 'skipped'
    );
    return evaluated.length === 0
        ? null
        : evaluated.filter(l => l.outcome === 'respected').length /
              evaluated.length;
}

/** Item: an indicator over the pairs it applies to (`null` skips the pair). */
interface PairedItem {
    name: string;
    noiseLabel: FlipLabel | null;
    indicator: (a: LabelRow, b: LabelRow) => readonly [number, number] | null;
}

const bothHeadline = (a: LabelRow, b: LabelRow): boolean =>
    bucketOf(a) === 'headline' && bucketOf(b) === 'headline';

const planIndicator =
    (test: (outcome: PlanOutcome) => boolean) =>
    (a: LabelRow, b: LabelRow): readonly [number, number] | null =>
        bothHeadline(a, b) && a.labels !== null && b.labels !== null
            ? [
                  Number(test(a.labels.plan.outcome)),
                  Number(test(b.labels.plan.outcome)),
              ]
            : null;

const PAIRED_ITEMS: readonly PairedItem[] = [
    {
        name: 'failure rate (all pairs)',
        noiseLabel: null,
        indicator: (a, b) => [
            Number(a.status === 'failed'),
            Number(b.status === 'failed'),
        ],
    },
    {
        name: 'missing plan (share of labelled cases)',
        noiseLabel: 'planOutcome',
        indicator: (a, b) =>
            bothHeadline(a, b)
                ? [
                      Number(a.labels?.plan.reason === 'none'),
                      Number(b.labels?.plan.reason === 'none'),
                  ]
                : null,
    },
    {
        name: 'plan triggered (share of labelled cases)',
        noiseLabel: 'planOutcome',
        indicator: planIndicator(outcome => TRIGGERED.has(outcome)),
    },
    {
        name: 'target_first (share of labelled cases)',
        noiseLabel: 'planOutcome',
        indicator: planIndicator(outcome => outcome === 'target_first'),
    },
    {
        name: 'stop_first (share of labelled cases)',
        noiseLabel: 'planOutcome',
        indicator: planIndicator(outcome => outcome === 'stop_first'),
    },
    {
        name: 'level respected (share of evaluated levels, cases with levels in both)',
        noiseLabel: 'levelOutcome',
        indicator: (a, b) => {
            const left = levelRespectedShare(a);
            const right = levelRespectedShare(b);
            return bothHeadline(a, b) && left !== null && right !== null
                ? [left, right]
                : null;
        },
    },
];

/** Pairs two runs by case and repeat; flips per label and the paired difference of each rate. */
export function compareRuns(
    a: readonly LabelRow[],
    b: readonly LabelRow[]
): CompareSummary {
    const pairs = pairRows(a, b);
    return {
        pairs: pairs.length,
        flips: recordOf(FLIP_LABELS, label =>
            flipStat(
                pairs.flatMap(([left, right]) =>
                    comparisons(label, left, right)
                )
            )
        ),
        paired: PAIRED_ITEMS.map(item => {
            const values = pairs.flatMap(([left, right]) => {
                const value = item.indicator(left, right);
                return value === null ? [] : [value];
            });
            return {
                name: item.name,
                n: values.length,
                meanA: mean(values.map(([x]) => x)),
                meanB: mean(values.map(([, y]) => y)),
                diff: meanStat(values.map(([x, y]) => y - x)),
                noiseLabel: item.noiseLabel,
            };
        }),
    };
}
