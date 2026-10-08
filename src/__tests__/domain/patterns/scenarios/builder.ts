import type { Bar } from '@/domain/types';

/**
 * Deterministic bar-series builder for the chart-pattern scenario suite.
 *
 * A scenario is written as swing anchors `[barIndex, close]`; closes run in
 * straight lines between consecutive anchors and every bar gets an upper and
 * a lower wick drawn from a seeded generator (no `Math.random()`), so the
 * same anchors and seed always give the same bars. `open` is the previous
 * close, so a bar's body spans its own step of the leg.
 */

/** One swing anchor: the close at a bar index. */
export type Anchor = readonly [index: number, close: number];

export interface SeriesOptions {
    /** Largest wick on either side of the body; each wick is 50–100% of it. */
    wick?: number;
    /** Seed of the wick generator. */
    seed?: number;
    /** Unix seconds between bars (default one day). */
    step?: number;
}

const DAY = 86_400;
const START_TIME = 1_700_006_400;

/** mulberry32 — a small seeded PRNG, enough to vary wicks reproducibly. */
function seededRandom(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
    };
}

/** Closes through the anchors, one per bar from the first anchor's index to the last's. */
function closesThrough(anchors: readonly Anchor[]): number[] {
    const closes: number[] = [anchors[0][1]];
    for (let k = 1; k < anchors.length; k++) {
        const [i0, p0] = anchors[k - 1];
        const [i1, p1] = anchors[k];
        for (let i = i0 + 1; i <= i1; i++) {
            closes.push(p0 + ((p1 - p0) * (i - i0)) / (i1 - i0));
        }
    }
    return closes;
}

/** Builds the bars for `anchors` (indices must start at 0 and increase). */
export function buildSeries(
    anchors: readonly Anchor[],
    options: SeriesOptions = {}
): Bar[] {
    const wick = options.wick ?? 0.15;
    const step = options.step ?? DAY;
    const random = seededRandom(options.seed ?? 7);
    return closesThrough(anchors).map((close, i, closes) => {
        const open = i === 0 ? close : closes[i - 1];
        const up = wick * (0.5 + 0.5 * random());
        const down = wick * (0.5 + 0.5 * random());
        return {
            time: START_TIME + i * step,
            open,
            high: Math.max(open, close) + up,
            low: Math.min(open, close) - down,
            close,
            volume: 1_000_000,
        };
    });
}

/** Mirrors prices around `pivot` (high ↔ low), turning a top into a bottom. */
export function mirrorBars(bars: readonly Bar[], pivot: number): Bar[] {
    return bars.map(bar => ({
        ...bar,
        open: pivot - bar.open,
        high: pivot - bar.low,
        low: pivot - bar.high,
        close: pivot - bar.close,
    }));
}

/** Mirrors anchors around `pivot`. */
export function mirrorAnchors(
    anchors: readonly Anchor[],
    pivot: number
): Anchor[] {
    return anchors.map(([i, p]) => [i, pivot - p] as const);
}

/** Replaces one bar's fields (a pierce, a dip). */
export function patchBar(
    bars: readonly Bar[],
    index: number,
    patch: Partial<Bar>
): Bar[] {
    return bars.map((bar, i) => (i === index ? { ...bar, ...patch } : bar));
}

/** Appends bars closing at `closes`, each with a fixed `wick`. */
export function appendCloses(
    bars: readonly Bar[],
    closes: readonly number[],
    wick = 0.1
): Bar[] {
    const last = bars[bars.length - 1];
    const step = bars.length > 1 ? last.time - bars[bars.length - 2].time : DAY;
    let open = last.close;
    const tail = closes.map((close, k) => {
        const bar: Bar = {
            time: last.time + (k + 1) * step,
            open,
            high: Math.max(open, close) + wick,
            low: Math.min(open, close) - wick,
            close,
            volume: 1_000_000,
        };
        open = close;
        return bar;
    });
    return [...bars, ...tail];
}

/** Closes that keep moving the last leg's way by `step` per bar, `count` bars. */
export function continueLeg(
    bars: readonly Bar[],
    count: number,
    step: number
): number[] {
    const last = bars[bars.length - 1].close;
    const sign = last >= bars[bars.length - 2].close ? 1 : -1;
    return Array.from(
        { length: count },
        (_, k) => last + sign * step * (k + 1)
    );
}
