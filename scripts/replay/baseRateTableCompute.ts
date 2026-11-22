/**
 * The numbers of the measured base-rate table (WP-18 §4.1): one row per chart-pattern family
 * and candle pattern, and one for the printed price levels, each with the event share, the
 * matched placebo's share, their difference with a week-clustered interval and a verdict.
 * Pure functions over the events of an engine evaluation and the summary of a level
 * evaluation; `baseRateTable.ts` loads the runs, refuses inputs it cannot trust and writes
 * the table.
 *
 * Verdict rule (WP-17 G3, one rule for every subject): `verdictOf` in
 * `src/domain/analysis/baseRateVerdict.ts`. A row below `BASE_RATE_MIN_N` events carries the
 * pooled figures of its subject, `key: 'pooled'`.
 */
import {
    candleHitObservations,
    candleObservations,
    candlePoolEvents,
    edgeStat,
    makeResamplings,
    patternObservations,
    toBlocks,
    widerInterval,
    type EdgeStat,
} from './engineEvalCompute';
import {
    verdictOf,
    type VerdictInputs,
} from '@/domain/analysis/baseRateVerdict';
import { holmAdjust } from './engineEvalStats';
import type { CandleEvent, Observation, PatternEvent } from './engineEvalTypes';
import { mean } from './stats';

/** The pre-registered sample floor of a row (the engine evaluation's `minFamilyN`). */
export const BASE_RATE_MIN_N = 100;
/** Significance level of the Holm-adjusted test. */
export const BASE_RATE_ALPHA = 0.05;

export type BaseRateSubject =
    'chart_pattern' | 'candle_pattern' | 'price_level';
export type BaseRateVerdict =
    'beats_placebo' | 'no_edge' | 'insufficient_sample';

export interface BaseRateScope {
    timeframe: '1Day';
    symbols: number;
    from: string;
    to: string;
}

export interface BaseRateRow {
    subject: BaseRateSubject;
    key: string;
    n: number;
    eventShare: number;
    placeboShare: number;
    difference: { mean: number; low: number; high: number };
    verdict: BaseRateVerdict;
    scope: BaseRateScope;
}

export interface RowDetail {
    /** The id the table is keyed by (a chart pattern id or a candle name; `pooled` for the pooled row). */
    family: string;
    row: BaseRateRow;
    inputs: VerdictInputs;
    /** Candles: the primary ATR-normalised edge at 5 bars, kept beside the one share per row. */
    atrEdge: {
        mean: number | null;
        low: number | null;
        high: number | null;
    } | null;
    /** Holm-adjusted p of the family's difference (`null` for pooled rows and below the floor). */
    holmP: number | null;
}

export interface SubjectTable {
    /** One row per family seen, in key order; a family below the floor carries the pooled figures. */
    rows: readonly RowDetail[];
    pooled: RowDetail;
}

const meanOf = (observations: readonly Observation[]): number | null =>
    mean(observations.map(o => o.value));

interface Splittable {
    market: 'us' | 'kr';
    half: 'early' | 'late';
}

/** The difference's mean per half and market of a family's events. */
function splitMeans<E extends Splittable>(
    events: readonly E[],
    observe: (own: readonly E[]) => Observation[]
): VerdictInputs['splits'] {
    const at = (pick: (e: E) => boolean): number | null =>
        meanOf(observe(events.filter(pick)));
    return {
        early: at(e => e.half === 'early'),
        late: at(e => e.half === 'late'),
        us: at(e => e.market === 'us'),
        kr: at(e => e.market === 'kr'),
    };
}

const finite = (value: number | null, what: string): number => {
    if (value === null || !Number.isFinite(value)) {
        throw new Error(`base-rate row: ${what} is not computable`);
    }
    return value;
};

interface FamilyMeasure {
    key: string;
    n: number;
    eventShare: number | null;
    placeboShare: number | null;
    week: EdgeStat;
    /** The wider of the week and block intervals (patterns); the week interval for candles. */
    low: number | null;
    high: number | null;
    p: number | null;
    splits: VerdictInputs['splits'];
    atrEdge: RowDetail['atrEdge'];
}

function rowOf(
    subject: BaseRateSubject,
    measure: FamilyMeasure,
    holmP: number | null,
    scope: BaseRateScope
): RowDetail {
    const inputs: VerdictInputs = {
        n: measure.n,
        significant:
            measure.n < BASE_RATE_MIN_N
                ? null
                : holmP === null
                  ? null
                  : holmP < BASE_RATE_ALPHA,
        mean: measure.week.mean,
        low: measure.low,
        splits: measure.splits,
    };
    return {
        family: measure.key,
        row: {
            subject,
            key: measure.key,
            n: measure.n,
            eventShare: finite(
                measure.eventShare,
                `${measure.key} event share`
            ),
            placeboShare: finite(
                measure.placeboShare,
                `${measure.key} placebo share`
            ),
            difference: {
                mean: finite(measure.week.mean, `${measure.key} difference`),
                low: finite(measure.low, `${measure.key} interval low`),
                high: finite(measure.high, `${measure.key} interval high`),
            },
            verdict: verdictOf(inputs),
            scope,
        },
        inputs,
        atrEdge: measure.atrEdge,
        holmP,
    };
}

/**
 * Rows for every family of `measures` plus the pooled row. Holm runs over the families at or
 * above the floor; a family below it takes the pooled figures under `key: 'pooled'`.
 */
function assemble(
    subject: BaseRateSubject,
    measures: readonly FamilyMeasure[],
    pooled: FamilyMeasure,
    scope: BaseRateScope
): SubjectTable {
    const eligible = measures.filter(m => m.n >= BASE_RATE_MIN_N);
    const adjusted = holmAdjust(eligible.map(m => m.p));
    const holmOf = new Map(eligible.map((m, i) => [m.key, adjusted[i]]));
    const pooledRow = rowOf(
        subject,
        { ...pooled, key: 'pooled' },
        pooled.p,
        scope
    );
    return {
        pooled: pooledRow,
        rows: measures
            .toSorted((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
            .map(m =>
                m.n >= BASE_RATE_MIN_N
                    ? rowOf(subject, m, holmOf.get(m.key) ?? null, scope)
                    : {
                          ...pooledRow,
                          family: m.key,
                          row: {
                              ...pooledRow.row,
                              verdict: 'insufficient_sample',
                          },
                          inputs: { ...pooledRow.inputs, n: m.n },
                      }
            ),
    };
}

/** The smaller of the two bootstrap p-values' complements: a test rejects only if both clusterings do. */
const widerP = (a: EdgeStat, b: EdgeStat): number | null =>
    a.p === null || b.p === null ? null : Math.max(a.p, b.p);

export function patternTable(
    events: readonly PatternEvent[],
    weeks: readonly string[],
    scope: BaseRateScope
): SubjectTable {
    const resamplings = makeResamplings(weeks);
    const measure = (
        key: string,
        own: readonly PatternEvent[]
    ): FamilyMeasure => {
        const observations = patternObservations(own, 'target');
        const week = edgeStat(observations, resamplings.weeks);
        const block = edgeStat(toBlocks(observations), resamplings.blocks);
        const wider = widerInterval(week, block);
        return {
            key,
            n: own.length,
            eventShare: mean(own.map(e => (e.target60 === 'hit' ? 1 : 0))),
            placeboShare: mean(own.map(e => e.placeboTargetHit)),
            week,
            low: wider.low,
            high: wider.high,
            p: widerP(week, block),
            splits: splitMeans(own, e => patternObservations(e, 'target')),
            atrEdge: null,
        };
    };
    const ids = [...new Set(events.map(e => e.id))];
    return assemble(
        'chart_pattern',
        ids.map(id =>
            measure(
                id,
                events.filter(e => e.id === id)
            )
        ),
        measure('pooled', events),
        scope
    );
}

export function candleTable(
    events: readonly CandleEvent[],
    weeks: readonly string[],
    scope: BaseRateScope
): SubjectTable {
    const resamplings = makeResamplings(weeks);
    const tested = candlePoolEvents(events, 'pooled');
    const measure = (key: string, own: typeof tested): FamilyMeasure => {
        const week = edgeStat(
            candleHitObservations(own, 'h5'),
            resamplings.weeks
        );
        const atr = edgeStat(
            candleObservations(own, 'y', 'h5', 'matched'),
            resamplings.weeks
        );
        return {
            key,
            n: own.length,
            eventShare: mean(own.map(e => (e.y.h5 > 0 ? 1 : 0))),
            placeboShare: mean(own.map(e => e.matched.hit.h5)),
            week,
            low: week.low,
            high: week.high,
            p: week.p,
            splits: splitMeans(own, e => candleHitObservations(e, 'h5')),
            atrEdge: { mean: atr.mean, low: atr.low, high: atr.high },
        };
    };
    const names = [...new Set(tested.map(e => e.pattern))];
    return assemble(
        'candle_pattern',
        names.map(name =>
            measure(
                name,
                tested.filter(e => e.pattern === name)
            )
        ),
        measure('pooled', tested),
        scope
    );
}

// ─── Price levels ─────────────────────────────────────────────────────────────

interface LevelGroup {
    held: { n: number; share: number | null };
    transplant: { n: number; share: number | null };
    difference: {
        mean: number | null;
        low: number | null;
        high: number | null;
    };
}

/** The slice of a level evaluation's `summary.json` the table reads. */
export interface LevelSummaryInput {
    overall: LevelGroup;
    tables: {
        market: Record<string, LevelGroup | undefined>;
        half: Record<string, LevelGroup | undefined>;
        /** Held rate per kind family (all markets and halves pooled). */
        family: Record<string, LevelGroup | undefined>;
    };
}

const levelRowOf = (
    key: string,
    group: LevelGroup,
    inputs: VerdictInputs,
    holmP: number | null,
    scope: BaseRateScope
): RowDetail => ({
    family: key,
    row: {
        subject: 'price_level',
        key,
        n: group.held.n,
        eventShare: finite(group.held.share, `level ${key} held share`),
        placeboShare: finite(
            group.transplant.share,
            `level ${key} placebo share`
        ),
        difference: {
            mean: finite(group.difference.mean, `level ${key} difference`),
            low: finite(group.difference.low, `level ${key} interval low`),
            high: finite(group.difference.high, `level ${key} interval high`),
        },
        verdict: verdictOf(inputs),
        scope,
    },
    inputs,
    atrEdge: null,
    holmP,
});

export function priceLevelRow(
    summary: LevelSummaryInput,
    scope: BaseRateScope
): RowDetail {
    const { overall, tables } = summary;
    const differenceOf = (g: LevelGroup | undefined): number | null =>
        g?.difference.mean ?? null;
    const inputs: VerdictInputs = {
        n: overall.held.n,
        significant:
            overall.difference.low === null ? null : overall.difference.low > 0,
        mean: overall.difference.mean,
        low: overall.difference.low,
        splits: {
            early: differenceOf(tables.half['pre-2022']),
            late: differenceOf(tables.half['2022+']),
            us: differenceOf(tables.market.us),
            kr: differenceOf(tables.market.kr),
        },
    };
    return {
        ...levelRowOf('pooled', overall, inputs, null, scope),
        family: 'pooled',
    };
}

/** 97.5th percentile of the standard normal: the half-width of a 95% interval in standard errors. */
const Z_975 = 1.959964;

/** Complementary error function (Numerical Recipes `erfc`, fractional error below 1.2e-7). */
function erfc(x: number): number {
    const z = Math.abs(x);
    const t = 1 / (1 + 0.5 * z);
    const ans =
        t *
        Math.exp(
            -z * z -
                1.26551223 +
                t *
                    (1.00002368 +
                        t *
                            (0.37409196 +
                                t *
                                    (0.09678418 +
                                        t *
                                            (-0.18628806 +
                                                t *
                                                    (0.27886807 +
                                                        t *
                                                            (-1.13520398 +
                                                                t *
                                                                    (1.48851587 +
                                                                        t *
                                                                            (-0.82215223 +
                                                                                t *
                                                                                    0.17087277))))))))
        );
    return x >= 0 ? ans : 2 - ans;
}

/**
 * Two-sided p of a difference from its mean and 95% interval, treating the interval as a
 * normal one (standard error = width / (2 * 1.96)). A level evaluation's `summary.json` keeps
 * the interval of every group but not the bootstrap p, so the family tests of the price-level
 * table are ranked by this p. `null` when the interval is missing or has no width.
 */
export function intervalP(difference: LevelGroup['difference']): number | null {
    const { mean: m, low, high } = difference;
    if (m === null || low === null || high === null) return null;
    const se = (high - low) / (2 * Z_975);
    return se > 0 ? erfc(Math.abs(m) / se / Math.SQRT2) : null;
}

/**
 * One row per kind family of the printed price levels (`families`, in key order), same held and
 * transplant definitions as `priceLevelRow`, Holm over the families at or above
 * `BASE_RATE_MIN_N` resolved touches and the shared `verdictOf`. A family below the floor, or
 * with no levels at all, carries the pooled figures under `key: 'pooled'` with
 * `insufficient_sample` (the rule of the pattern rows). The summary holds no per-family market
 * or half breakdown, so a family's splits are `null` and, fail closed, it cannot read
 * `beats_placebo` until they are measured.
 */
export function priceLevelFamilyTable(
    summary: LevelSummaryInput,
    scope: BaseRateScope,
    families: readonly string[]
): SubjectTable {
    const pooled = priceLevelRow(summary, scope);
    const groups = families.toSorted().map(family => ({
        family,
        group: summary.tables.family[family],
    }));
    const eligible = groups.flatMap(({ family, group }) =>
        group !== undefined && group.held.n >= BASE_RATE_MIN_N
            ? [{ family, group }]
            : []
    );
    const adjusted = holmAdjust(
        eligible.map(e => intervalP(e.group.difference))
    );
    const holmOf = new Map(eligible.map((e, i) => [e.family, adjusted[i]]));
    return {
        pooled,
        rows: groups.map(({ family, group }) => {
            if (group === undefined || group.held.n < BASE_RATE_MIN_N) {
                return {
                    ...pooled,
                    family,
                    row: { ...pooled.row, verdict: 'insufficient_sample' },
                    inputs: { ...pooled.inputs, n: group?.held.n ?? 0 },
                };
            }
            const holmP = holmOf.get(family) ?? null;
            return levelRowOf(
                family,
                group,
                {
                    n: group.held.n,
                    significant:
                        holmP === null ? null : holmP < BASE_RATE_ALPHA,
                    mean: group.difference.mean,
                    low: group.difference.low,
                    splits: { early: null, late: null, us: null, kr: null },
                },
                holmP,
                scope
            );
        }),
    };
}
