import {
    OUTCOME_PRE_BARS,
    OUTCOME_WINDOW_BARS,
} from '@/domain/outcomes/constants';
import type {
    OutcomeAnchorSource,
    OutcomeBarTuple,
    OutcomeWindow,
} from '@/domain/outcomes/types';
import type { Bar } from '@/domain/types';

/** `[open, high, low, close]` of one forward bar. */
export type Ohlc = readonly [
    open: number,
    high: number,
    low: number,
    close: number,
];

export const SECONDS_PER_DAY = 86_400;

/** A bar that never moves, the neutral filler between the bars a test cares about. */
export function flat(price: number): Ohlc {
    return [price, price, price, price];
}

export interface WindowSpec {
    readonly referencePrice?: number;
    readonly atr?: number | null;
    readonly adjFactor?: number;
    readonly anchorForming?: boolean;
    readonly anchorSource?: OutcomeAnchorSource;
    /** The anchor bar's final range and close; defaults to a flat bar at the reference price. */
    readonly anchorBar?: Ohlc;
    /** Bars from forward offset 1; the rest up to the window length are filled with {@link flat}(`pad`). */
    readonly forward?: readonly Ohlc[];
    /** Price of the filler bars; defaults to the reference price. */
    readonly pad?: number;
    readonly preCloses?: readonly number[];
}

/**
 * Hand-built window: `referencePrice` 100 and ATR 2 unless told otherwise, 60 flat closes
 * before the anchor (the last one is always the reference price, as the builder makes it).
 */
export function makeWindow(spec: WindowSpec = {}): OutcomeWindow {
    const referencePrice = spec.referencePrice ?? 100;
    const pad = spec.pad ?? referencePrice;
    const given = spec.forward ?? [];
    const bars: readonly Ohlc[] = [
        ...given,
        ...Array.from(
            { length: Math.max(0, OUTCOME_WINDOW_BARS - given.length) },
            () => flat(pad)
        ),
    ];
    const pre =
        spec.preCloses ??
        Array.from({ length: OUTCOME_PRE_BARS }, () => referencePrice);
    return {
        referencePrice,
        adjFactor: spec.adjFactor ?? 1,
        anchorForming: spec.anchorForming ?? false,
        anchorSource: spec.anchorSource ?? 'prompt_bar',
        anchorBar: [0, ...(spec.anchorBar ?? flat(referencePrice))],
        atr: spec.atr === undefined ? 2 : spec.atr,
        preCloses: [...pre.slice(0, -1), referencePrice],
        forward: bars.map(([open, high, low, close], i): OutcomeBarTuple => [
            (i + 1) * SECONDS_PER_DAY,
            open,
            high,
            low,
            close,
        ]),
    };
}

/**
 * Closed daily bars whose range is always 2 and whose close rises by 1 per bar from
 * `firstClose`: true range and so ATR(14) is exactly 2 after the warm-up. Times are
 * `(index + 1)` days, so the bar at index `i` has `time = (i + 1) × 86 400`.
 */
export function risingBars(count: number, firstClose = 30): Bar[] {
    return Array.from({ length: count }, (_, i) => {
        const close = firstClose + i;
        return {
            time: (i + 1) * SECONDS_PER_DAY,
            open: close - 0.5,
            high: close + 1,
            low: close - 1,
            close,
            volume: 1_000,
        };
    });
}

/** Small deterministic generator (mulberry32): the same seed always gives the same sequence. */
export function seededRandom(seed: number): () => number {
    const state = { value: seed };
    return () => {
        state.value = (state.value + 0x6d2b79f5) | 0;
        const mixed = Math.imul(
            state.value ^ (state.value >>> 15),
            1 | state.value
        );
        const final =
            (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
        return ((final ^ (final >>> 14)) >>> 0) / 4_294_967_296;
    };
}

/**
 * A pseudo-random walk of closed daily bars around `start`, reproducible from `seed`.
 * One pass with the running price in a const object (the same pattern as {@link seededRandom}).
 */
export function walkBars(count: number, seed: number, start = 100): Bar[] {
    const next = seededRandom(seed);
    const steps = Array.from({ length: count }, () => ({
        noise: next(),
        wiggle: next(),
    }));
    const state = { price: start };
    return steps.map(({ noise, wiggle }, i) => {
        const prev = state.price;
        const close = prev * (1 + (noise - 0.5) * 0.04);
        state.price = close;
        const open = prev * (1 + (wiggle - 0.5) * 0.01);
        return {
            time: (i + 1) * SECONDS_PER_DAY,
            open,
            high: Math.max(open, close) * (1 + wiggle * 0.01),
            low: Math.min(open, close) * (1 - noise * 0.01),
            close,
            volume: 1_000,
        };
    });
}
