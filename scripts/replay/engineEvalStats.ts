/**
 * Seeded randomness, ISO weeks and the cluster bootstrap of the engine evaluation. Pure.
 * Everything random is a pure function of the seed and a key, so identical events draw
 * identical placebos in every arm.
 */
import { sha256Hex } from './fsUtil';
import { quantile } from './stats';
import {
    EVAL_CONSTANTS,
    type EvalHalf,
    type Observation,
} from './engineEvalTypes';

/** mulberry32: a 32-bit seeded generator returning floats in `[0, 1)`. */
export function mulberry32(seed: number): () => number {
    const state = { a: seed >>> 0 };
    return () => {
        state.a = (state.a + 0x6d2b79f5) >>> 0;
        const t1 = Math.imul(state.a ^ (state.a >>> 15), 1 | state.a);
        const t2 = (t1 + Math.imul(t1 ^ (t1 >>> 7), 61 | t1)) ^ t1;
        return ((t2 ^ (t2 >>> 14)) >>> 0) / 4294967296;
    };
}

/** The stream of one key: `sha256(key)`'s first 32 bits mixed with the base seed. */
export function streamForKey(baseSeed: number, key: string): () => number {
    const keyed = Number.parseInt(sha256Hex(key).slice(0, 8), 16);
    return mulberry32((keyed ^ baseSeed) >>> 0);
}

/**
 * `k` items drawn without replacement (partial Fisher-Yates over a copy); every item, in
 * order, when there are `k` or fewer.
 */
export function sampleWithoutReplacement<T>(
    items: readonly T[],
    k: number,
    rand: () => number
): T[] {
    if (items.length <= k) return [...items];
    const pool = [...items];
    return Array.from({ length: k }, (_, i) => {
        const j = i + Math.floor(rand() * (pool.length - i));
        const picked = pool[j];
        pool[j] = pool[i];
        pool[i] = picked;
        return picked;
    });
}

/**
 * A record with one value per key. `Object.fromEntries` types its result as an index
 * signature; the cast restores the key union. It is exact because the keys are the
 * `keys` list the caller typed, each assigned exactly once.
 */
export function recordOf<K extends string, V>(
    keys: readonly K[],
    make: (key: K) => V
): Record<K, V> {
    return Object.fromEntries(keys.map(key => [key, make(key)])) as Record<
        K,
        V
    >;
}

const MS_PER_DAY = 86_400_000;

/** ISO 8601 week of a Unix-seconds timestamp, `YYYY-Www` (the ISO week-year). */
export function isoWeekKey(timeSeconds: number): string {
    const date = new Date(timeSeconds * 1000);
    const dayStart = Date.UTC(
        date.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate()
    );
    const weekday = (date.getUTCDay() + 6) % 7;
    const thursday = new Date(dayStart + (3 - weekday) * MS_PER_DAY);
    const year = thursday.getUTCFullYear();
    const dayOfYear = (thursday.getTime() - Date.UTC(year, 0, 1)) / MS_PER_DAY;
    const week = Math.floor(dayOfYear / 7) + 1;
    return `${year}-W${String(week).padStart(2, '0')}`;
}

/** `YYYY-MM-DD` of a Unix-seconds timestamp (UTC). */
export function isoDate(timeSeconds: number): string {
    return new Date(timeSeconds * 1000).toISOString().slice(0, 10);
}

/** The time half of a bar: dated up to `earlyHalfLastYear` is early. One rule for every event. */
export function halfOf(timeSeconds: number): EvalHalf {
    return new Date(timeSeconds * 1000).getUTCFullYear() <=
        EVAL_CONSTANTS.earlyHalfLastYear
        ? 'early'
        : 'late';
}

/** The sorted distinct ISO weeks of a set of bar times (the bootstrap's week list). */
export function weeksOfTimes(times: readonly number[]): string[] {
    return [...new Set(times.map(isoWeekKey))].toSorted();
}

/** Consecutive-week serial number of an ISO week key (the week's Monday / 7 days). */
export function weekSerial(week: string): number {
    const [year, number] = week.split('-W').map(Number);
    const jan4 = Date.UTC(year, 0, 4);
    const monday =
        jan4 -
        ((new Date(jan4).getUTCDay() + 6) % 7) * MS_PER_DAY +
        (number - 1) * 7 * MS_PER_DAY;
    return Math.floor(monday / (7 * MS_PER_DAY));
}

/** The block of `blockWeeks` consecutive weeks an ISO week falls in. */
export function blockOfWeek(week: string, blockWeeks: number): string {
    return `B${Math.floor(weekSerial(week) / blockWeeks)}`;
}

// ─── Cluster bootstrap ────────────────────────────────────────────────────────

/** Per-cluster sums and counts of a pool, aligned with a sorted cluster list. */
export interface WeekAggregate {
    sums: readonly number[];
    counts: readonly number[];
}

export function aggregateByWeek(
    observations: readonly Observation[],
    weeks: readonly string[]
): WeekAggregate {
    const index = new Map(weeks.map((week, i) => [week, i]));
    const sums = weeks.map(() => 0);
    const counts = weeks.map(() => 0);
    observations.forEach(({ week, value }) => {
        const i = index.get(week);
        if (i === undefined) return;
        sums[i] += value;
        counts[i] += 1;
    });
    return { sums, counts };
}

/**
 * `replicates` resamples of `weekCount` clusters drawn with replacement, as multiplicity
 * vectors. Shared by every pool of one comparison, so a difference of two pools is taken
 * inside the same resample.
 */
export function resampleMultiplicities(
    weekCount: number,
    replicates: number,
    rand: () => number
): number[][] {
    return Array.from({ length: replicates }, () => {
        const multiplicity = Array.from({ length: weekCount }, () => 0);
        Array.from({ length: weekCount }).forEach(() => {
            multiplicity[Math.floor(rand() * weekCount)] += 1;
        });
        return multiplicity;
    });
}

/** The pool's mean in one resample; `null` when the resample holds no observation. */
export function resampledMean(
    aggregate: WeekAggregate,
    multiplicity: readonly number[]
): number | null {
    const total = multiplicity.reduce(
        (acc, m, i) => ({
            sum: acc.sum + m * aggregate.sums[i],
            n: acc.n + m * aggregate.counts[i],
        }),
        { sum: 0, n: 0 }
    );
    return total.n === 0 ? null : total.sum / total.n;
}

export function pooledMean(aggregate: WeekAggregate): number | null {
    const n = aggregate.counts.reduce((a, b) => a + b, 0);
    return n === 0 ? null : aggregate.sums.reduce((a, b) => a + b, 0) / n;
}

export interface Interval {
    low: number | null;
    high: number | null;
    /** Two-sided bootstrap p-value of "the statistic is 0"; `null` without replicates. */
    p: number | null;
    /** Replicates that held no observation (their statistic is undefined) and were skipped. */
    droppedReplicates: number;
}

/** 95% percentile interval and the two-sided bootstrap p-value of a replicate list. */
export function intervalOf(replicates: readonly (number | null)[]): Interval {
    const values = replicates.filter((v): v is number => v !== null);
    const droppedReplicates = replicates.length - values.length;
    if (values.length === 0) {
        return { low: null, high: null, p: null, droppedReplicates };
    }
    const notAbove = values.filter(v => v <= 0).length;
    const notBelow = values.filter(v => v >= 0).length;
    const tail = (Math.min(notAbove, notBelow) + 1) / (values.length + 1);
    return {
        low: quantile(values, 0.025),
        high: quantile(values, 0.975),
        p: Math.min(1, 2 * tail),
        droppedReplicates,
    };
}

/** Holm step-down adjustment; adjusted p-values in the input order. */
export function holmAdjust(
    pValues: readonly (number | null)[]
): (number | null)[] {
    const ranked = pValues
        .map((p, i) => ({ p, i }))
        .filter((r): r is { p: number; i: number } => r.p !== null)
        .toSorted((a, b) => a.p - b.p);
    const adjusted = new Map<number, number>();
    ranked.reduce((maxSoFar, { p, i }, rank) => {
        const value = Math.max(
            maxSoFar,
            Math.min(1, p * (ranked.length - rank))
        );
        adjusted.set(i, value);
        return value;
    }, 0);
    return pValues.map((_, i) => adjusted.get(i) ?? null);
}
