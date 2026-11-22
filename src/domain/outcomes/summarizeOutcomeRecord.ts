import {
    BASE_RATE_MIN_N,
    type BaseRateVerdict,
} from '@/domain/analysis/measuredBaseRates';
import {
    verdictOf,
    type VerdictInputs,
} from '@/domain/analysis/baseRateVerdict';
import {
    OUTCOME_LABEL_VERSION,
    PLACEBO_SHIFT_ATR,
} from '@/domain/outcomes/constants';
import type {
    AnalysisOutcomeLabels,
    LevelOutcome,
    LevelOutcomeEntry,
    PlanOutcome,
} from '@/domain/outcomes/types';
import {
    mulberry32,
    quantile,
    resampleMultiplicities,
    resampledMean,
    type WeekAggregate,
} from '@/domain/outcomes/weekClusterBootstrap';
import { maxOf, minOf } from '@/domain/extent';
import type { Timeframe } from '@/domain/types';

/**
 * One stored, labelled analysis. `anchorBarTime` is the anchor bar's time in Unix seconds
 * (`OutcomeSubject.anchor.barTime`): the labels do not carry it, and the dedupe key, the
 * week clusters and the scope dates all need it.
 */
export interface OutcomeRecordRow {
    symbol: string;
    market: 'us' | 'kr';
    timeframe: Timeframe;
    anchorBarTime: number;
    generatedAtMs: number;
    labelVersion: number;
    labels: AnalysisOutcomeLabels;
}

/**
 * One measured share next to the placebo it is compared with. `n` is the number of paired
 * observations the shares are over; `eventShare`, `placeboShare` and `difference` are
 * `null` below `BASE_RATE_MIN_N` (`n`, the verdict and the scope are still reported).
 * `difference` is `eventShare - placeboShare` with its 95% interval from a seeded bootstrap
 * that resamples anchor weeks (Monday-based, UTC) with replacement, 2,000 percentile
 * replicates. `verdict` is `verdictOf` with the interval's low bound above zero as the test;
 * the sign must also hold in the earlier and later half of the anchor dates (split at the
 * midpoint between the first and last) and in the US and Korean rows separately, and a part
 * with no observation fails the rule, so a record without a Korean row never beats its
 * placebo.
 */
export interface OutcomeShareRecord {
    n: number;
    eventShare: number | null;
    placeboShare: number | null;
    difference: { mean: number; low: number; high: number } | null;
    verdict: BaseRateVerdict;
}

/**
 * The live record of the analyses. Shares only: no return, profit or price field exists
 * on it, and none may be added (WP-26 §2).
 *
 * Counting conventions:
 *  - `counts.rows` is every input row, whatever its timeframe; only `1Day` rows are read
 *    further. `counts.deduped` is the daily rows left after the duplicates of one
 *    (symbol, timeframe, anchor bar) were dropped, keeping the earliest `generatedAtMs`
 *    (then the earlier input position). Dedupe runs before the exclusions, so an excluded
 *    earliest copy is never replaced by a later one.
 *  - `counts.excluded` are rows of `deduped` taken out of every measure, each counted once
 *    under the first reason that applies, in the order `stale_label` (`labelVersion` below
 *    `OUTCOME_LABEL_VERSION`, or not a number), `generated_at` (`anchorSource`),
 *    `anchor_unobserved` (`plan.anchorBarUnobserved`).
 *  - `plans.planned` is the retained rows whose plan was evaluated (outcome other than
 *    `no_plan`); `plans.triggered` those whose entry zone was filled (`target_first`,
 *    `stop_first`, `ambiguous`, `open_at_horizon`). `plans.n` is the triggered rows that
 *    also carry a finite `rwNullTargetFirst` in `[0, 1]`: a row without one leaves the event
 *    and the placebo side together.
 *  - `levels.n` counts levels, not rows: a level is observed only when the real level and
 *    both shift placebos (+ and - `PLACEBO_SHIFT_ATR`) resolved (`respected`/`broken`).
 *  - `scope.markets` lists the markets with a retained row, `us` before `kr`, with their
 *    distinct symbols; `scope.from`/`to` are the first and last retained anchor date
 *    (`YYYY-MM-DD`, UTC), `''` for an empty record.
 */
export interface OutcomeRecordSummary {
    v: 1;
    labelVersion: number;
    scope: {
        timeframe: '1Day';
        markets: { market: 'us' | 'kr'; symbols: number }[];
        from: string;
        to: string;
    };
    counts: {
        rows: number;
        deduped: number;
        excluded: Record<
            'generated_at' | 'anchor_unobserved' | 'stale_label',
            number
        >;
    };
    plans: OutcomeShareRecord & { planned: number; triggered: number };
    levels: OutcomeShareRecord;
}

/** Plan outcomes that mean the entry zone was filled (WP-06 R7). */
const TRIGGERED: ReadonlySet<PlanOutcome> = new Set<PlanOutcome>([
    'target_first',
    'stop_first',
    'ambiguous',
    'open_at_horizon',
]);

const RESOLVED_LEVEL: ReadonlySet<LevelOutcome> = new Set<LevelOutcome>([
    'respected',
    'broken',
]);

const BOOTSTRAP_REPLICATES = 2000;
/** Distinct streams so the plan and level intervals do not share draws. */
const PLAN_STREAM_SALT = 0x9e3779b9;
const LEVEL_STREAM_SALT = 0x85ebca6b;

const SECONDS_PER_DAY = 86_400;

/** One paired observation: `value = event - placebo`, clustered by anchor week. */
interface Pair {
    event: number;
    placebo: number;
    week: number;
    anchorBarTime: number;
    market: 'us' | 'kr';
}

/** Monday-based week number; 1970-01-01 was a Thursday. */
const weekOf = (anchorBarTime: number): number =>
    Math.floor((Math.floor(anchorBarTime / SECONDS_PER_DAY) + 3) / 7);

const isoDate = (anchorBarTime: number): string =>
    new Date(anchorBarTime * 1000).toISOString().slice(0, 10);

const meanOf = (values: readonly number[]): number | null =>
    values.length === 0
        ? null
        : values.reduce((sum, v) => sum + v, 0) / values.length;

/**
 * Mean difference and its 95% percentile interval, resampling anchor weeks with
 * replacement. A replicate with no observation is skipped. Pure in `(pairs, streamSeed)`.
 */
function weekClusterInterval(
    pairs: readonly Pair[],
    streamSeed: number
): { mean: number; low: number; high: number } | null {
    if (pairs.length === 0) return null;
    const weeks = [...new Set(pairs.map(p => p.week))].sort((a, b) => a - b);
    const index = new Map(weeks.map((w, i) => [w, i]));
    const sums = weeks.map(() => 0);
    const counts = weeks.map(() => 0);
    pairs.forEach(p => {
        const i = index.get(p.week);
        if (i === undefined) return;
        sums[i] += p.event - p.placebo;
        counts[i] += 1;
    });
    const aggregate: WeekAggregate = { sums, counts };
    const replicates = resampleMultiplicities(
        weeks.length,
        BOOTSTRAP_REPLICATES,
        mulberry32(streamSeed)
    )
        .map(multiplicity => resampledMean(aggregate, multiplicity))
        .filter((v): v is number => v !== null);
    const pooled = meanOf(pairs.map(p => p.event - p.placebo));
    const low = quantile(replicates, 0.025);
    const high = quantile(replicates, 0.975);
    if (pooled === null || low === null || high === null) return null;
    return { mean: pooled, low, high };
}

/** The difference's mean in each time half and market of the pairs; `null` where a part is empty. */
function splitsOf(pairs: readonly Pair[]): VerdictInputs['splits'] {
    const times = pairs.map(p => p.anchorBarTime);
    const midpoint = times.length === 0 ? 0 : (minOf(times) + maxOf(times)) / 2;
    const at = (pick: (p: Pair) => boolean): number | null =>
        meanOf(pairs.filter(pick).map(p => p.event - p.placebo));
    return {
        early: at(p => p.anchorBarTime <= midpoint),
        late: at(p => p.anchorBarTime > midpoint),
        us: at(p => p.market === 'us'),
        kr: at(p => p.market === 'kr'),
    };
}

function shareRecord(
    unordered: readonly Pair[],
    streamSeed: number
): OutcomeShareRecord {
    // A canonical order, so the float sums (and the last digit of every figure) do not
    // depend on the order the rows were read in.
    const pairs = [...unordered].sort(
        (a, b) =>
            a.anchorBarTime - b.anchorBarTime ||
            (a.market < b.market ? -1 : a.market > b.market ? 1 : 0) ||
            a.event - b.event ||
            a.placebo - b.placebo
    );
    if (pairs.length < BASE_RATE_MIN_N) {
        return {
            n: pairs.length,
            eventShare: null,
            placeboShare: null,
            difference: null,
            verdict: 'insufficient_sample',
        };
    }
    const difference = weekClusterInterval(pairs, streamSeed);
    const eventShare = meanOf(pairs.map(p => p.event));
    const placeboShare = meanOf(pairs.map(p => p.placebo));
    if (difference === null || eventShare === null || placeboShare === null) {
        return {
            n: pairs.length,
            eventShare: null,
            placeboShare: null,
            difference: null,
            verdict: 'no_edge',
        };
    }
    return {
        n: pairs.length,
        eventShare,
        placeboShare,
        difference,
        verdict: verdictOf({
            n: pairs.length,
            significant: difference.low > 0,
            mean: difference.mean,
            low: difference.low,
            splits: splitsOf(pairs),
        }),
    };
}

const isProbability = (value: number | null): value is number =>
    value !== null && Number.isFinite(value) && value >= 0 && value <= 1;

/** `1`/`0` for a resolved level, `null` otherwise. */
const respectedOf = (outcome: LevelOutcome): 0 | 1 | null =>
    outcome === 'respected' ? 1 : outcome === 'broken' ? 0 : null;

/**
 * The level's own respect against the mean of its two shift placebos (`+` and `-`
 * `PLACEBO_SHIFT_ATR`); `null` unless the level and both placebos resolved.
 */
function levelPair(
    level: LevelOutcomeEntry
): { event: number; placebo: number } | null {
    if (!RESOLVED_LEVEL.has(level.outcome)) return null;
    const farther = level.placebo.find(p => p.shiftAtr === PLACEBO_SHIFT_ATR);
    const closer = level.placebo.find(p => p.shiftAtr === -PLACEBO_SHIFT_ATR);
    if (farther === undefined || closer === undefined) return null;
    const event = respectedOf(level.outcome);
    const a = respectedOf(farther.outcome);
    const b = respectedOf(closer.outcome);
    if (event === null || a === null || b === null) return null;
    return { event, placebo: (a + b) / 2 };
}

/** Earlier `generatedAtMs` wins, then earlier input position. */
const earlier = (
    a: { row: OutcomeRecordRow; order: number },
    b: { row: OutcomeRecordRow; order: number }
): boolean =>
    a.row.generatedAtMs < b.row.generatedAtMs ||
    (a.row.generatedAtMs === b.row.generatedAtMs && a.order < b.order);

type ExclusionReason = keyof OutcomeRecordSummary['counts']['excluded'];

function exclusionOf(row: OutcomeRecordRow): ExclusionReason | null {
    // `!(x >= v)` so a NaN version is stale, not current.
    if (!(row.labelVersion >= OUTCOME_LABEL_VERSION)) return 'stale_label';
    if (row.labels.anchorSource === 'generated_at') return 'generated_at';
    if (row.labels.plan.anchorBarUnobserved) return 'anchor_unobserved';
    return null;
}

function assertRowUsable(row: OutcomeRecordRow): void {
    if (
        !Number.isFinite(row.anchorBarTime) ||
        !Number.isFinite(row.generatedAtMs)
    ) {
        throw new RangeError(
            `summarizeOutcomeRecord: ${row.symbol} has a non-finite anchorBarTime or generatedAtMs`
        );
    }
}

/**
 * Summarises the labelled analyses into the live record: of the plans whose entry zone was
 * filled, the share that reached their target before their stop, and of the key levels
 * that were touched and resolved, the share that held, each next to the placebo it is
 * measured against. Pre-registered rules (WP-26 §7.2):
 *
 *  - daily rows only; a row is one (symbol, timeframe, anchor bar), the earliest
 *    `generatedAtMs` (then input order) of its duplicates, taken before any exclusion so a
 *    later copy never replaces an excluded earliest one;
 *  - excluded and counted, never mixed in: `labelVersion` below `OUTCOME_LABEL_VERSION`,
 *    `anchorSource: 'generated_at'`, `plan.anchorBarUnobserved`;
 *  - plans: denominator is the triggered set (`target_first`, `stop_first`, `ambiguous`,
 *    `open_at_horizon`); event is `target_first`, placebo is `rwNullTargetFirst` of the same
 *    rows (a row without a finite one leaves both sides);
 *  - levels: one observation per level whose real label and both shift placebos resolved
 *    (`respected`/`broken`); event is `respected`, placebo the mean of the two placebos'
 *    respected share (the shift's sign cancels);
 *  - interval: week-cluster bootstrap by anchor week (2,000 resamples, percentile), seeded;
 *  - verdict: `verdictOf` with the interval's low bound above zero as the test; a missing
 *    market or time half fails the rule (a set with no Korean rows never beats);
 *  - fewer than `BASE_RATE_MIN_N` observations gives `insufficient_sample` and `null` shares.
 *
 * Throws `RangeError` on a non-finite `seed`, `anchorBarTime` or `generatedAtMs`.
 *
 * @see OutcomeRecordSummary Shares only: no return figure exists on it.
 */
export function summarizeOutcomeRecord(
    rows: readonly OutcomeRecordRow[],
    opts: { seed: number }
): OutcomeRecordSummary {
    if (!Number.isFinite(opts.seed)) {
        throw new RangeError('summarizeOutcomeRecord: seed must be finite');
    }
    const daily = rows
        .map((row, order) => ({ row, order }))
        .filter(({ row }) => row.timeframe === '1Day');
    daily.forEach(({ row }) => assertRowUsable(row));

    const firstOfKey = new Map<
        string,
        { row: OutcomeRecordRow; order: number }
    >();
    daily.forEach(entry => {
        const key = JSON.stringify([
            entry.row.symbol,
            entry.row.timeframe,
            entry.row.anchorBarTime,
        ]);
        const held = firstOfKey.get(key);
        if (held === undefined || earlier(entry, held)) {
            firstOfKey.set(key, entry);
        }
    });
    const deduped = [...firstOfKey.values()]
        .sort((a, b) => a.order - b.order)
        .map(entry => entry.row);

    const excluded: Record<ExclusionReason, number> = {
        generated_at: 0,
        anchor_unobserved: 0,
        stale_label: 0,
    };
    const kept = deduped.filter(row => {
        const reason = exclusionOf(row);
        if (reason === null) return true;
        excluded[reason] += 1;
        return false;
    });

    const planRows = kept.filter(row => row.labels.plan.outcome !== 'no_plan');
    const triggeredRows = planRows.filter(row =>
        TRIGGERED.has(row.labels.plan.outcome)
    );
    const planPairs: Pair[] = triggeredRows.flatMap(row => {
        const rw = row.labels.plan.rwNullTargetFirst;
        return isProbability(rw)
            ? [
                  {
                      event: row.labels.plan.outcome === 'target_first' ? 1 : 0,
                      placebo: rw,
                      week: weekOf(row.anchorBarTime),
                      anchorBarTime: row.anchorBarTime,
                      market: row.market,
                  },
              ]
            : [];
    });
    const levelPairs: Pair[] = kept.flatMap(row =>
        row.labels.levels.flatMap(level => {
            const pair = levelPair(level);
            return pair === null
                ? []
                : [
                      {
                          ...pair,
                          week: weekOf(row.anchorBarTime),
                          anchorBarTime: row.anchorBarTime,
                          market: row.market,
                      },
                  ];
        })
    );

    const times = kept.map(row => row.anchorBarTime);
    const symbolsOf = (market: 'us' | 'kr'): number =>
        new Set(
            kept.filter(row => row.market === market).map(row => row.symbol)
        ).size;
    const markets = (['us', 'kr'] as const)
        .map(market => ({ market, symbols: symbolsOf(market) }))
        .filter(entry => entry.symbols > 0);

    return {
        v: 1,
        labelVersion: OUTCOME_LABEL_VERSION,
        scope: {
            timeframe: '1Day',
            markets,
            from: times.length === 0 ? '' : isoDate(minOf(times)),
            to: times.length === 0 ? '' : isoDate(maxOf(times)),
        },
        counts: {
            rows: rows.length,
            deduped: deduped.length,
            excluded,
        },
        plans: {
            ...shareRecord(planPairs, (opts.seed ^ PLAN_STREAM_SALT) >>> 0),
            planned: planRows.length,
            triggered: triggeredRows.length,
        },
        levels: shareRecord(levelPairs, (opts.seed ^ LEVEL_STREAM_SALT) >>> 0),
    };
}
