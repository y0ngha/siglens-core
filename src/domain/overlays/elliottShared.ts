import type {
    Bar,
    ElliottLevel,
    OverlayFormat,
    OverlayLabel,
    OverlayLevel,
    OverlayPoint,
    OverlaySegment,
    PivotPoint,
} from '@/domain/types';
import { SCREEN_LOOKBACK_BARS } from '@/domain/patterns/constants';
import {
    EW_ABC_B_MAX,
    EW_ABC_C_PROJECTIONS,
    EW_FLAT_B_BEYOND_START,
    EW_FLAT_B_MIN,
    EW_FLAT_C_TOLERANCE,
    EW_IMPULSE_PIVOTS,
    EW_MIN_IMPULSE_SPAN_BARS,
    EW_MIN_WAVE_BARS,
    EW_RATIO_DECIMALS,
    EW_REGULAR_FLAT_C_MAX,
    EW_SCORE_DECIMALS,
    EW_ZIGZAG_B_MAX,
    OVERLAY_LEVEL_LABELS,
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

/** @internal The count is long enough (EW_MIN_IMPULSE_SPAN_BARS) to be more than sub-degree noise. */
export const spansEnough = (seq: readonly PivotPoint[]): boolean =>
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
    // A loop over a local array: a reduce copying the list per pivot would be
    // O(n²) for no gain in clarity (MISTAKES Coding Paradigm 15.5).
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
    const first = Math.max(0, partialAtEdge ? pivots.length - n : 0);
    return Array.from(
        { length: Math.max(0, pivots.length - n - first + 1) },
        (_, k) => pivots.slice(first + k, first + k + n)
    ).filter(seq => alternates(seq) && spansEnough(seq));
}

// ─── Drawing ────────────────────────────────────────────────────────────────

/** @internal A pivot as a chart point (bar time, not index). */
export const pointOf = (bars: readonly Bar[], p: PivotPoint): OverlayPoint => ({
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

/**
 * @internal
 * `levels` drawn from the count's first pivot, across the whole structure
 * like a pattern's breakout line — a line starting at the last leg sits a
 * few bars from the right edge and hides behind its own axis label
 * (2026-10-02 live render). Prices are rounded to the prompt's `priceDp`, so
 * a line's axis label matches the number the card cites.
 */
export const structureLevels = (
    bars: readonly Bar[],
    pivots: readonly PivotPoint[],
    levels: readonly ElliottLevel[],
    fmt: OverlayFormat
): OverlayLevel[] =>
    levels
        // Like a pattern level: a projection at or below zero is not a price
        // to draw (the prompt line still states it).
        .filter(l => l.price > 0)
        .map(({ label, price }) => ({
            label,
            price: Number(price.toFixed(fmt.priceDp)),
            fromTime: bars[pivots[0].index].time,
        }));

/** @internal `up` for a positive sign — the breach direction of a level. */
export const breachOf = (sign: number): ElliottLevel['breach'] =>
    sign > 0 ? 'up' : 'down';

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

/** @internal `1` when the first leg rises, `-1` when it falls — signs prices so "with the first leg" is positive. */
export const legSign = (seq: readonly PivotPoint[]): 1 | -1 =>
    seq[1].price > seq[0].price ? 1 : -1;

/** @internal `up` when the first leg rises. */
export const firstLegDir = (seq: readonly PivotPoint[]): 'up' | 'down' =>
    legSign(seq) === 1 ? 'up' : 'down';

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
 * the dead band; a zero-size A). While C is still forming (`cInProgress`) the conditions
 * C may yet meet are waived; a forming C already past A's end after a B
 * beyond A's start is an expanded flat (C only extends), one short of it is
 * `expanded or running flat`.
 */
export function classifyAbc(
    seq: readonly PivotPoint[],
    cInProgress: boolean
): AbcType | null {
    const [a, b, c] = legSizes(seq);
    // A zero-size A leaves no ratio to read (NaN would fall through every band).
    if (!(a > 0)) return null;
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
 * `seq[0]` is not the extreme of those bars (no trend ends there) or `size`
 * is not positive. Reads the
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
        !(size > 0) ||
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

const PERCENT = 100;

/** @internal `61.8%` — `part` as a share of `whole`, EW_RATIO_DECIMALS decimals. */
export const pct = (part: number, whole: number): string =>
    `${((part / whole) * PERCENT).toFixed(EW_RATIO_DECIMALS)}%`;

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

/** `100%`, `161.8%`: a projection ratio as a percentage, trailing zeros dropped. */
const ratioLabel = (r: number): `${number}%` =>
    `${Number((r * PERCENT).toFixed(EW_RATIO_DECIMALS))}%`;

/**
 * @internal
 * C's EW_ABC_C_PROJECTIONS (100% and 161.8%) of A projected from B, for a
 * 4-pivot A–B–C (start, A, B, C), as levels labelled `target 100%`, …,
 * reached as C runs on in A's direction.
 */
export function abcTargetLevels(seq: readonly PivotPoint[]): ElliottLevel[] {
    const [a] = legSizes(seq);
    const sign = legSign(seq);
    return EW_ABC_C_PROJECTIONS.map((r): ElliottLevel => ({
        label: `${OVERLAY_LEVEL_LABELS.target} ${ratioLabel(r)}`,
        price: seq[2].price + sign * r * a,
        // C runs with A.
        breach: breachOf(sign),
    }));
}

/**
 * @internal
 * The same projections as a prompt fact: `C target 100% 118.00, 161.8% 112.44`.
 */
export function abcTargets(
    seq: readonly PivotPoint[],
    fmt: OverlayFormat
): string {
    const prices = abcTargetLevels(seq).map(l => l.price);
    return `C target ${EW_ABC_C_PROJECTIONS.map(
        (r, i) => `${ratioLabel(r)} ${formatOverlayPrice(prices[i], fmt)}`
    ).join(', ')}`;
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
        `score ${score.toFixed(EW_SCORE_DECIMALS)}`,
    ].join('; ');
}
