import type {
    Bar,
    OverlayFormat,
    OverlayLabel,
    OverlayPoint,
    OverlaySegment,
    PivotPoint,
} from '@/domain/types';
import { SCREEN_LOOKBACK_BARS } from '@/domain/patterns/constants';
import {
    EW_ABC_B_MAX,
    EW_FLAT_B_BEYOND_START,
    EW_FLAT_B_MIN,
    EW_FLAT_C_TOLERANCE,
    EW_IMPULSE_PIVOTS,
    EW_MIN_IMPULSE_SPAN_BARS,
    EW_MIN_WAVE_BARS,
    EW_REGULAR_FLAT_C_MAX,
    EW_ZIGZAG_B_MAX,
} from '@/domain/overlays/constants';
import {
    formatOverlayPoint,
    formatOverlayPrice,
} from '@/domain/overlays/format';

/**
 * Building blocks shared by the Elliott structure counters (spec
 * 2026-10-02): pivot runs and rules, the A–B–C type, and drawing helpers.
 */

// ─── Shared count helpers ───────────────────────────────────────────────────

/** @internal 1 when `x` lies in [lo, hi], else 0. */
export const within = (x: number, lo: number, hi: number): number =>
    x >= lo && x <= hi ? 1 : 0;

/** @internal Adjacent pivots alternate high/low and sit at least EW_MIN_WAVE_BARS apart. */
export const alternates = (seq: readonly PivotPoint[]): boolean =>
    seq.every(
        (p, i) =>
            i === 0 ||
            (p.kind !== seq[i - 1].kind &&
                p.index - seq[i - 1].index >= EW_MIN_WAVE_BARS)
    );

/**
 * @internal Whether `seq`'s last pivot is the last pivot in `pivots` — i.e.
 * it is the still-forming, provisional right-edge pivot rather than a
 * confirmed one.
 */
export const isLastPivotInList = (
    seq: readonly PivotPoint[],
    pivots: readonly PivotPoint[]
): boolean => seq[seq.length - 1] === pivots[pivots.length - 1];

/** @internal 1 for a count ending at the right edge, 0 for one ending a full lookback window back. */
export const recency = (lastPivotIndex: number, lastBarIndex: number): number =>
    Math.max(0, 1 - (lastBarIndex - lastPivotIndex) / SCREEN_LOOKBACK_BARS);

/** @internal Absolute price move of each leg of `seq`. */
export const legSizes = (seq: readonly PivotPoint[]): number[] =>
    seq.slice(1).map((p, i) => Math.abs(p.price - seq[i].price));

/** The count is long enough (EW_MIN_IMPULSE_SPAN_BARS) to be more than sub-degree noise. */
const spansEnough = (seq: readonly PivotPoint[]): boolean =>
    seq[seq.length - 1].index - seq[0].index >= EW_MIN_IMPULSE_SPAN_BARS;

/**
 * @internal
 * Collapses legs shorter than EW_MIN_WAVE_BARS. A wide bar that both makes a
 * new extreme and reverses 1.5 ATR emits a high AND a low on the same (or the
 * next) bar; left in, that zero-length "wave" breaks every count running
 * through it, and real daily charts carry many of them. A pivot arriving too
 * soon after the previous one is dropped; a pivot then meeting one of its own
 * kind keeps the more extreme of the two, so the list still alternates and
 * each swing keeps its true extreme.
 */
export function mergeShortLegs(pivots: readonly PivotPoint[]): PivotPoint[] {
    const out: PivotPoint[] = [];
    for (const p of pivots) {
        const last = out[out.length - 1];
        if (last === undefined) out.push(p);
        else if (p.kind === last.kind) {
            const moreExtreme =
                p.kind === 'high' ? p.price > last.price : p.price < last.price;
            if (moreExtreme) out[out.length - 1] = p;
        } else if (p.index - last.index >= EW_MIN_WAVE_BARS) out.push(p);
    }
    return out;
}

/**
 * @internal
 * Every run of `n` consecutive pivots that alternates and spans enough bars.
 * With `partialAtEdge`, only runs ending at the last (right-edge) pivot.
 */
export function pivotRuns(
    pivots: readonly PivotPoint[],
    n: number,
    partialAtEdge = false
): PivotPoint[][] {
    const runs: PivotPoint[][] = [];
    const first = partialAtEdge ? pivots.length - n : 0;
    for (let s = Math.max(0, first); s + n <= pivots.length; s++) {
        const seq = pivots.slice(s, s + n);
        if (alternates(seq) && spansEnough(seq)) runs.push(seq);
    }
    return runs;
}

// ─── Drawing ────────────────────────────────────────────────────────────────

/** A pivot as a chart point (bar time, not index). */
const pointOf = (bars: readonly Bar[], p: PivotPoint): OverlayPoint => ({
    time: bars[p.index].time,
    price: p.price,
});

/** @internal Consecutive-pivot legs of `seq`, one role per leg. */
export const legSegments = (
    bars: readonly Bar[],
    seq: readonly PivotPoint[],
    roles: readonly string[]
): OverlaySegment[] =>
    seq.slice(1).map((p, i) => ({
        from: pointOf(bars, seq[i]),
        to: pointOf(bars, p),
        role: roles[i],
        style: 'solid',
        pane: 'price',
    }));

/** @internal A label on each pivot: above a high, below a low. */
export const pivotLabels = (
    bars: readonly Bar[],
    pivots: readonly PivotPoint[],
    texts: readonly string[]
): OverlayLabel[] =>
    pivots.map((p, i) => ({
        at: pointOf(bars, p),
        text: texts[i],
        position: p.kind === 'high' ? 'above' : 'below',
    }));

/** @internal Price of the line through `a` and `b` at bar `index`. */
export const lineAt = (a: PivotPoint, b: PivotPoint, index: number): number =>
    a.price + ((b.price - a.price) * (index - a.index)) / (b.index - a.index);

/** @internal Dashed boundary through `a` and `b`, drawn from `a` to bar `toIndex`. */
export const boundaryLine = (
    bars: readonly Bar[],
    a: PivotPoint,
    b: PivotPoint,
    toIndex: number,
    role: string
): OverlaySegment => ({
    from: pointOf(bars, a),
    to: { time: bars[toIndex].time, price: lineAt(a, b, toIndex) },
    role,
    style: 'dashed',
    pane: 'price',
});

/** @internal `A 2026-01-05 101.20, B …` — named points for a prompt line. */
export const namedPoints = (
    bars: readonly Bar[],
    pivots: readonly PivotPoint[],
    names: readonly string[],
    fmt: OverlayFormat
): string =>
    pivots
        .map(
            (p, i) => `${names[i]} ${formatOverlayPoint(pointOf(bars, p), fmt)}`
        )
        .join(', ');

/** @internal `up` when the first leg rises. */
export const firstLegDir = (seq: readonly PivotPoint[]): 'up' | 'down' =>
    seq[1].price > seq[0].price ? 'up' : 'down';

// ─── A–B–C type ─────────────────────────────────────────────────────────────

/** @internal Textbook A–B–C families; `expanded or running flat` while C is still forming. */
export type AbcType =
    | 'zigzag'
    | 'regular flat'
    | 'expanded flat'
    | 'running flat'
    | 'expanded or running flat';

/**
 * @internal
 * Classifies a 4-pivot A–B–C (start, A, B, C ends) by how far B retraces A
 * and where C ends against A's end (spec 2026-10-02 §4). `null` when the
 * shape is neither a zigzag nor a flat (B between 78.6% and 90% of A, or
 * past 138.2%; a zigzag whose C stays inside A; a flat whose C lands inside
 * the dead band). While C is still forming (`cInProgress`) the conditions
 * C may yet meet are waived; a forming C already past A's end after a B
 * beyond A's start is an expanded flat (C only extends), one short of it is
 * `expanded or running flat`.
 */
export function classifyAbc(
    seq: readonly PivotPoint[],
    cInProgress: boolean
): AbcType | null {
    const [a, b, c] = legSizes(seq);
    const bRetrace = b / a;
    // How far C ends past A's end, in units of A (negative: short of it).
    const cPastA = (c - b) / a;
    if (bRetrace <= EW_ZIGZAG_B_MAX)
        return cInProgress || cPastA > 0 ? 'zigzag' : null;
    if (bRetrace < EW_FLAT_B_MIN || bRetrace > EW_ABC_B_MAX) return null;
    if (bRetrace <= EW_FLAT_B_BEYOND_START)
        return cPastA <= EW_REGULAR_FLAT_C_MAX &&
            (cInProgress || cPastA >= -EW_FLAT_C_TOLERANCE)
            ? 'regular flat'
            : null;
    // A forming C only extends: once past A's end it can only end farther.
    if (cPastA > (cInProgress ? 0 : EW_FLAT_C_TOLERANCE))
        return 'expanded flat';
    if (cInProgress) return 'expanded or running flat';
    return cPastA < -EW_FLAT_C_TOLERANCE ? 'running flat' : null;
}

/**
 * @internal Shortest / longest bar count among the legs of `seq`, leaving out
 * the last leg when it is still `forming` (it has not had its full time).
 */
export const timeBalance = (
    seq: readonly PivotPoint[],
    forming = false
): number => {
    const d = seq
        .slice(1, forming ? -1 : undefined)
        .map((p, i) => p.index - seq[i].index);
    return Math.min(...d) / Math.max(...d);
};

/**
 * @internal
 * Absolute impulse rules on however many waves `seq` has. `P(i)` is price signed so
 * "up" is always positive. `diagonal` skips rule 3 — the one rule a diagonal
 * breaks.
 */
export function passesRules(
    seq: readonly PivotPoint[],
    up: boolean,
    diagonal = false
): boolean {
    const P = (i: number) => (up ? seq[i].price : -seq[i].price);
    const w = (i: number) => Math.abs(seq[i + 1].price - seq[i].price);
    const n = seq.length;
    if (n >= 3 && !(P(2) > P(0))) return false; // rule 1
    if (n >= 5 && !(P(3) > P(1))) return false; // wave 3 clears wave 1
    if (n >= 5 && w(2) < w(0) && n < EW_IMPULSE_PIVOTS) return false; // rule 2, wave 5 unformed
    if (n >= EW_IMPULSE_PIVOTS && w(2) < w(0) && w(2) < w(4)) return false; // rule 2
    if (!diagonal && n >= 5 && !(P(4) > P(1))) return false; // rule 3
    return true;
}

/**
 * @internal
 * The trend a structure starting at `seq[0]` corrects, in units of `size`:
 * over the `span` bars before it, how far price came from — or `0` when
 * `seq[0]` is not the extreme of those bars (no trend ends there). Reads the
 * bars, not the pivots, so a trend older than the pivot lookback counts.
 */
export function priorTrend(
    bars: readonly Bar[],
    seq: readonly PivotPoint[],
    span: number,
    size: number
): number {
    const start = seq[0];
    const before = bars.slice(Math.max(0, start.index - span), start.index);
    const isHigh = start.kind === 'high';
    if (
        before.length === 0 ||
        !before.every(b =>
            isHigh ? b.high <= start.price : b.low >= start.price
        )
    )
        return 0;
    const far = isHigh
        ? Math.min(...before.map(b => b.low))
        : Math.max(...before.map(b => b.high));
    return Math.abs(start.price - far) / size;
}

// ─── Prompt facts ───────────────────────────────────────────────────────────
// Everything the logic can compute rides in the prompt line, so the model
// cites invalidation levels, ratios and targets instead of computing them.

/** `61.8%` — `part` as a share of `whole`, one decimal. */
const pct = (part: number, whole: number): string =>
    `${((part / whole) * 100).toFixed(1)}%`;

/**
 * @internal
 * Wave ratios of a 1–5 count for its finished waves (a `forming` last wave
 * is left out): `W2 61.8% of W1, W3 184.0% of W1, W4 23.6% of W3, W5 100.0% of W1`.
 */
export function waveRatios(
    seq: readonly PivotPoint[],
    forming: boolean
): string {
    const w = legSizes(seq);
    const done = forming ? w.length - 1 : w.length;
    const ratios: Array<[number, string]> = [
        [2, `W2 ${pct(w[1], w[0])} of W1`],
        [3, `W3 ${pct(w[2], w[0])} of W1`],
        [4, `W4 ${pct(w[3], w[2])} of W3`],
        [5, `W5 ${pct(w[4], w[0])} of W1`],
    ];
    return ratios
        .filter(([wave]) => wave <= done)
        .map(([, text]) => text)
        .join(', ');
}

/**
 * @internal
 * C's 100% and 161.8% of A projected from B, for a 4-pivot A–B–C (start, A,
 * B, C): `C target 100% 118.00, 161.8% 112.44`.
 */
export function abcTargets(
    seq: readonly PivotPoint[],
    fmt: OverlayFormat
): string {
    const [a] = legSizes(seq);
    const sign = seq[1].price > seq[0].price ? 1 : -1;
    const target = (r: number) =>
        formatOverlayPrice(seq[2].price + sign * r * a, fmt);
    return `C target 100% ${target(1)}, 161.8% ${target(1.618)}`;
}

/**
 * @internal
 * One elliott prompt line: `head; state; points; fact; …; score 0.71`.
 * Empty facts are dropped.
 */
export function elliottPromptLine(
    head: string,
    state: string,
    points: string,
    facts: readonly string[],
    score: number
): string {
    return [
        head,
        state,
        points,
        ...facts.filter(f => f !== ''),
        `score ${score.toFixed(2)}`,
    ].join('; ');
}
