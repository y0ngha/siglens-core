import type {
    Bar,
    ChartPatternId,
    PatternBreakoutDirection,
    Timeframe,
} from '@/domain/types';
import {
    type Anchor,
    appendCloses,
    buildSeries,
    mirrorAnchors,
    patchBar,
} from '@/__tests__/domain/patterns/scenarios/builder';

/**
 * Pattern × case scenario table for the qualification suite (spec
 * 2026-10-07). Every scenario is a deterministic bar series and the outcome
 * the spec requires for it. Prices sit near 100 on a `1Day` chart with a
 * pinned ATR (1 unless a case says otherwise), so every threshold is exact
 * arithmetic: the minimum height is `max(2.5·ATR, 3%·price)` ≈ 3.
 *
 * Mirrored ids (top ↔ bottom, ascending ↔ descending, bull ↔ bear) reuse
 * their partner's anchors flipped around `MIRROR_PIVOT`, expectations and
 * all — see `mirrored` below.
 */

export type CaseKind =
    | 'a textbook'
    | 'b pierce'
    | 'c near-miss'
    | 'e breakout'
    | 'e failure'
    | 'f arbitration'
    | 'g intraday';

/** Expected levels; each is compared within `LEVEL_TOLERANCE` (wicks are ≤ 0.15). */
export interface LevelExpectation {
    breakout?: number;
    invalidation?: number;
    target?: number;
    upper?: number;
    lower?: number;
}

export type Expectation =
    | {
          /** This id is drawn (qualified after arbitration). */
          drawn: ChartPatternId;
          direction?: PatternBreakoutDirection | null;
          levels?: LevelExpectation;
          status?: 'forming' | 'broken' | 'failed breakout';
          /** The full set of drawn ids, when the case pins it. */
          only?: readonly ChartPatternId[];
      }
    | {
          /** This id is NOT drawn. */
          notDrawn: ChartPatternId;
          /** The full set of drawn ids instead (`[]` = nothing drawn). */
          instead?: readonly ChartPatternId[];
      };

export interface Scenario {
    pattern: ChartPatternId;
    kind: CaseKind;
    name: string;
    bars: Bar[];
    atr: number;
    timeframe: Timeframe;
    expect: Expectation;
}

export const LEVEL_TOLERANCE = 0.35;
const MIRROR_PIVOT = 220;

const scenario = (
    pattern: ChartPatternId,
    kind: CaseKind,
    name: string,
    bars: Bar[],
    expect: Expectation,
    atr = 1,
    timeframe: Timeframe = '1Day'
): Scenario => ({ pattern, kind, name, bars, atr, timeframe, expect });

// ─── Mirroring ──────────────────────────────────────────────────────────────

const MIRROR_ID: Partial<Record<ChartPatternId, ChartPatternId>> = {
    ascending_triangle: 'descending_triangle',
    ascending_wedge: 'descending_wedge',
    ascending_channel: 'descending_channel',
    double_top: 'double_bottom',
    triple_top: 'triple_bottom',
    head_and_shoulders: 'inverse_head_and_shoulders',
    bull_flag: 'bear_flag',
    rounding_bottom: 'rounding_top',
};
const mirrorId = (id: ChartPatternId): ChartPatternId =>
    MIRROR_ID[id] ??
    (Object.entries(MIRROR_ID).find(([, v]) => v === id)?.[0] as
        ChartPatternId | undefined) ??
    id;

const flipPrice = (p: number | undefined): number | undefined =>
    p === undefined ? undefined : MIRROR_PIVOT - p;

function mirrorExpectation(e: Expectation): Expectation {
    if ('notDrawn' in e) {
        return {
            notDrawn: mirrorId(e.notDrawn),
            ...(e.instead
                ? {
                      instead: e.instead
                          .map(mirrorId)
                          .toSorted((a, b) => a.localeCompare(b, 'en')),
                  }
                : {}),
        };
    }
    const flipDir = (d: PatternBreakoutDirection | null | undefined) =>
        d === undefined || d === null ? d : d === 'up' ? 'down' : 'up';
    return {
        drawn: mirrorId(e.drawn),
        ...(e.direction !== undefined
            ? { direction: flipDir(e.direction) }
            : {}),
        ...(e.status ? { status: e.status } : {}),
        ...(e.only
            ? {
                  only: e.only
                      .map(mirrorId)
                      .toSorted((a, b) => a.localeCompare(b, 'en')),
              }
            : {}),
        ...(e.levels
            ? {
                  levels: {
                      breakout: flipPrice(e.levels.breakout),
                      invalidation: flipPrice(e.levels.invalidation),
                      target: flipPrice(e.levels.target),
                      // Upper and lower swap sides in the mirror.
                      upper: flipPrice(e.levels.lower),
                      lower: flipPrice(e.levels.upper),
                  },
              }
            : {}),
    };
}

/** The same scenario flipped around MIRROR_PIVOT (prices, ids, levels, directions). */
function mirrored(s: Scenario): Scenario {
    return {
        ...s,
        pattern: mirrorId(s.pattern),
        name: `${s.name} (mirror)`,
        bars: s.bars.map(bar => ({
            ...bar,
            open: MIRROR_PIVOT - bar.open,
            high: MIRROR_PIVOT - bar.low,
            low: MIRROR_PIVOT - bar.high,
            close: MIRROR_PIVOT - bar.close,
        })),
        expect: mirrorExpectation(s.expect),
    };
}

// ─── Templates (swing anchors) ──────────────────────────────────────────────
// Legs move at most ~1.15 per bar with wicks ≤ 0.15, so no single bar spans
// the 1.5-ATR pivot reversal on its own (`calm` below enforces it): every
// pivot the qualifier sees is a real swing of the template, not an artifact
// of one wide bar.

/** Flat resistance 110 ×3 over support 100 → 102.5 → 105 on one line. */
export const ASC_TRIANGLE: Anchor[] = [
    [0, 103],
    [8, 100],
    [18, 110],
    [25, 102.5],
    [33, 110],
    [42, 105],
    [50, 110],
    [52, 108.2],
    [54, 108.6],
];

/** Support of a maturing triangle: 96 + 0.08 per bar. */
const maturingSupport = (i: number): number => 96 + 0.08 * i;

/**
 * Four flat highs over four rising lows — eight confirmed pivots — with a
 * fifth high at 107 still unconfirmed (the last close is within 1.5 ATR of
 * it). See `MATURING_TRIANGLE_BARS`.
 */
const MATURING_TRIANGLE: Anchor[] = [
    [0, 101],
    [10, 110],
    [22, maturingSupport(22)],
    [35, 110],
    [47, maturingSupport(47)],
    [60, 110],
    [72, maturingSupport(72)],
    [85, 110],
    [97, maturingSupport(97)],
    [107, 110],
    [109, 109.2],
];

/**
 * `MATURING_TRIANGLE` with every peak bar's high set to exactly 110.3, so any
 * line through two resistance touches is the same flat line and the breakout
 * read at the last bar cannot move with a refit.
 */
export const MATURING_TRIANGLE_BARS: Bar[] = buildSeries(MATURING_TRIANGLE, {
    wick: 0.15,
}).map((bar, i) =>
    [10, 35, 60, 85, 107].includes(i) ? { ...bar, high: 110.3 } : bar
);

/** Height 2.8 at price ~103 (ATR 0.5): fails only the 1Day 3%-of-price floor. */
export const SMALL_TRIANGLE: Anchor[] = [
    [0, 101.5],
    [3, 100],
    [8, 102.8],
    [13, 100.8],
    [18, 102.8],
    [23, 101.6],
    [28, 102.8],
    [30, 102.0],
    [31, 102.2],
];

/** Peaks 110 / 110.2, 14 bars apart, trough 108.4 — ATR 0.5 scale. */
export const SMALL_DOUBLE_TOP: Anchor[] = [
    [0, 106],
    [20, 110],
    [27, 108.4],
    [34, 110.2],
    [37, 109.3],
    [39, 109.4],
];

/** The user's IONQ chart: "resistance" highs 45.46 / 44.43 / 46.05 / 47.91 over rising lows, last close 43.29. */
export const IONQ: Anchor[] = [
    [0, 30],
    [15, 38],
    [25, 45.46],
    [33, 36],
    [42, 44.43],
    [50, 37.5],
    [60, 46.05],
    [68, 40],
    [78, 47.91],
    [84, 43.5],
    [88, 46],
    [91, 43.29],
];

/** Highs 110 → 108 → 106, lows 100 → 101.5 → 103, after a rise from 96. */
export const SYM_TRIANGLE: Anchor[] = [
    [0, 96],
    [14, 110],
    [23, 100],
    [31, 108],
    [38, 101.5],
    [48, 106],
    [53, 103],
    [55, 104.8],
];
const SYM_TRIANGLE_NO_TREND: Anchor[] = [
    [0, 109],
    [7, 107],
    ...SYM_TRIANGLE.slice(1),
];

/** Highs 110 ×3, lows 100 ×3, after a rise from 96. */
export const RECTANGLE: Anchor[] = [
    [0, 96],
    [14, 110],
    [23, 100],
    [32, 110],
    [41, 100],
    [50, 110],
    [59, 100],
    [61, 101.8],
];
const RECTANGLE_NO_TREND: Anchor[] = [
    [0, 108.8],
    [5, 103.5],
    ...RECTANGLE.slice(1),
];

/** Both lines rising 0.25/bar, 6 apart, after a rise from 93. */
export const ASC_CHANNEL: Anchor[] = [
    [0, 93],
    [8, 101.5],
    [10, 100],
    [18, 108],
    [26, 104],
    [34, 112],
    [42, 108],
    [50, 116],
    [52, 114.2],
    [54, 114.6],
];

/** Upper line of `OFFSET_LOW_CHANNEL`: 101.5 at bar 8, +0.25 per bar. */
const offsetChannelUpper = (i: number): number => 101.5 + 0.25 * (i - 8);

/**
 * A rising channel 4 wide whose first and last lows sit 0.3 above the
 * parallel through the middle (lowest) one: every line through two lows
 * either cuts a low or diverges from the upper line, so only the parallel
 * construction finds the channel.
 */
const OFFSET_LOW_CHANNEL: Anchor[] = [
    [0, 94],
    [8, offsetChannelUpper(8)],
    [16, offsetChannelUpper(16) - 4 + 0.3],
    [24, offsetChannelUpper(24)],
    [32, offsetChannelUpper(32) - 4],
    [40, offsetChannelUpper(40)],
    [48, offsetChannelUpper(48) - 4 + 0.3],
    [56, offsetChannelUpper(56)],
    [58, offsetChannelUpper(58) - 1.6],
    [60, offsetChannelUpper(60) - 1.3],
];

/** Lows rising 0.25/bar, highs 0.15/bar — converging, three touches each. */
export const ASC_WEDGE: Anchor[] = [
    [0, 93],
    [8, 101.5],
    [10, 100],
    [18, 108],
    [26, 104],
    [34, 110.4],
    [42, 108],
    [50, 112.8],
    [52, 111],
    [53, 111.3],
];

/** Highs 106 → 108.8 → 111.6 (+0.1/bar), lows 99 → 96.2 (−0.1/bar): widening. */
export const BROADENING: Anchor[] = [
    [0, 100],
    [10, 106],
    [24, 99],
    [38, 108.8],
    [52, 96.2],
    [66, 111.6],
    [68, 110],
    [70, 110.4],
];

/** Shoulders 110 / 111, head 116, troughs 104 / 105. */
export const HEAD_AND_SHOULDERS: Anchor[] = [
    [0, 98],
    [20, 110],
    [27, 104],
    [38, 116],
    [48, 105],
    [55, 111],
    [58, 108.4],
    [62, 108.6],
];

/**
 * H&S h27 / l36 / h45 / l55 / h63, then l75 and h87 at the right shoulder's
 * level: the last two peaks also make a double top (63–87) built on the
 * right shoulder.
 */
export const HS_THEN_DOUBLE_TOP: Anchor[] = [
    [0, 98],
    [27, 110],
    [35, 104],
    [45, 115],
    [55, 105],
    [63, 110],
    [75, 103],
    [87, 110],
    [91, 107.5],
];

/**
 * A compact H&S (ATR 1.5): a rise into the left shoulder 108 (bar 30), head
 * 110.2, right shoulder 108.2 at bar 46 — 17 bars shoulder to shoulder —
 * over a neckline at 104 / 104.2.
 */
export const SHORT_HEAD_AND_SHOULDERS: Anchor[] = [
    [0, 92],
    [30, 108],
    [34, 104],
    [38, 110.2],
    [42, 104.2],
    [46, 108.2],
    [48, 105.6],
    [49, 105.8],
];

/** Neckline rising gently: troughs 104 → 105.3 (1.3 ATR, under the sloped class); the last bar closes under it. */
export const HS_GENTLE_SLOPE: Anchor[] = [
    [0, 98],
    [20, 110],
    [27, 104],
    [38, 116.5],
    [48, 105.3],
    [55, 111],
    [60, 105.4],
];

/** Neckline rising steeply: troughs 104 → 109; the last bar closes under it. */
export const HS_SLOPED: Anchor[] = [
    [0, 98],
    [20, 110],
    [27, 104],
    [38, 116.5],
    [48, 109],
    [55, 113],
    [58, 110.6],
];

/** Peaks 110 / 110.5, 14 bars apart, trough 103. */
export const DOUBLE_TOP: Anchor[] = [
    [0, 100],
    [12, 94],
    [18, 99],
    [23, 96],
    [36, 110],
    [43, 103],
    [50, 110.5],
    [54, 107],
    [62, 106.5],
];

/** Peaks 110 / 110.3 / 109.8, troughs 103 / 103.5. */
export const TRIPLE_TOP: Anchor[] = [
    [0, 98],
    [20, 110],
    [28, 103],
    [36, 110.3],
    [44, 103.5],
    [52, 109.8],
    [55, 106.8],
    [58, 107],
];

const flagLegs = (
    from: number,
    count: number,
    lo: number,
    hi: number,
    barsPerLeg = 2
): Anchor[] =>
    Array.from({ length: count }, (_, k) => [
        from + barsPerLeg * (k + 1),
        k % 2 === 0 ? lo : hi,
    ]);

const POLE: Anchor[] = [
    [0, 103],
    [8, 98],
    [18, 108],
];

/** 10-bar pole 98 → 108, then a 12-bar flat flag 106.5 ↔ 108 (spec §6 test 9). */
export const BULL_FLAG: Anchor[] = [...POLE, ...flagLegs(18, 6, 106.5, 108)];

/** Pole 98 → 108, then highs falling and lows rising to a point. */
export const PENNANT: Anchor[] = [
    ...POLE,
    [21, 105.5],
    [24, 107.6],
    [27, 106],
    [30, 107.2],
    [33, 106.4],
    [35, 106.8],
];

/** 20 → 40 (+100%) in 25 bars, flag back to 35 (12.5%). */
export const HIGH_TIGHT_FLAG: Anchor[] = [
    [0, 20],
    [10, 21],
    [20, 20],
    [45, 40],
    [52, 35],
    [58, 38],
];

/** Rims 120 / 119.5 (67 bars apart), swing base to 100, handle to 115. */
export const CUP_AND_HANDLE: Anchor[] = [
    [0, 110],
    [10, 120],
    [18, 112],
    [22, 114],
    [31, 104],
    [35, 107],
    [43, 100],
    [49, 104],
    [55, 102],
    [63, 110],
    [67, 108],
    [77, 119.5],
    [83, 115],
    [87, 118],
    [89, 117],
];

/** Closes on y = 80 + 40·((x − 60)/50)² from the left rim (bar 10, 120) every 8 bars. */
const deepCupBase = (x: number): number => 80 + 40 * ((x - 60) / 50) ** 2;

/**
 * A deep cup (ATR 2): rims 120 and 113 (5.8% apart, 21% of the 33 depth),
 * then a handle to 108.
 */
export const DEEP_CUP: Anchor[] = [
    [0, 105],
    ...Array.from({ length: 12 }, (_, k): Anchor => [
        10 + 8 * k,
        deepCupBase(10 + 8 * k),
    ]),
    [105, 113],
    [111, 108],
    [115, 111],
    [117, 110.5],
];

/** Closes on y = 100 + 20·((x − 46)/40)² from rim (6) to rim (86), then a sharp pullback. */
export const ROUNDING_BOTTOM: Anchor[] = [
    [0, 114],
    ...Array.from({ length: 11 }, (_, k): Anchor => {
        const x = 6 + 8 * k;
        return [x, x === 86 ? 119.5 : 100 + 20 * ((x - 46) / 40) ** 2];
    }),
    [89, 116.5],
];

/**
 * The pole, then twelve bars that all run from 106 to 107: every bar is a
 * touch of both channel lines, so nothing consolidates between them.
 */
const SPANNING_BOX: Bar[] = (() => {
    const pole = buildSeries([...POLE.slice(0, 2), [17, 107]], { wick: 0.05 });
    const bar = (
        i: number,
        open: number,
        high: number,
        low: number,
        close: number
    ): Bar => ({
        time: pole[0].time + i * 86_400,
        open,
        high,
        low,
        close,
        volume: 1_000_000,
    });
    const top = bar(18, 107, 108.05, 106.95, 107);
    const box = Array.from({ length: 12 }, (_, k) =>
        bar(
            19 + k,
            k === 0 ? 107 : k % 2 === 0 ? 106.7 : 106.3,
            107,
            106,
            k % 2 === 0 ? 106.3 : 106.7
        )
    );
    return [...pole, top, ...box];
})();

/** A double top near price 20 (ATR 1): trough `trough`, second peak `peak2`. */
const lowPriceDoubleTop = (trough: number, peak2: number): Anchor[] => [
    [0, 15.5],
    [10, 20],
    [13, trough],
    [24, peak2],
    [27, peak2 - 1.55],
    [29, peak2 - 1.45],
];

/** Alternating closes inside the last leg's range — no swing, just time passing. */
const quietCloses = (count: number): number[] =>
    Array.from({ length: count }, (_, k) => (k % 2 === 0 ? 106.6 : 106.4));

/** BROADENING with its three highs and two lows replaced. */
const broadeningOf = (highs: number[], lows: number[]): Anchor[] => [
    [0, 100],
    [10, highs[0]],
    [24, lows[0]],
    [38, highs[1]],
    [52, lows[1]],
    [66, highs[2]],
    [68, highs[2] - 1.6],
    [70, highs[2] - 1.2],
];

/** Rims 110 / 109.7, a 9-bar drop to 100, then a slow parabolic climb (J). */
const J_BASE: Anchor[] = [
    [0, 106],
    [6, 110],
    [15, 100],
    ...Array.from({ length: 14 }, (_, k): Anchor => {
        const t = 14 + 5 * k;
        return [6 + t, 100 + 10 * ((t - 9) / 71) ** 2];
    }),
    [89, 107.4],
];

/** A 51-bar rounding bottom (rims 112 / 111.6, base 100) with a sharp pullback. */
const SMALL_ROUNDING: Anchor[] = [
    [0, 106],
    [6, 112],
    ...Array.from({ length: 10 }, (_, k): Anchor => {
        const x = 11 + 5 * k;
        return [x, x === 56 ? 111.6 : 100 + 12 * ((x - 31) / 25) ** 2];
    }),
    [59, 109.8],
];

/**
 * The series for `anchors`. Throws when one bar would span the 1.5-ATR pivot
 * reversal by itself (ATR 1 unless given) — such a bar confirms its own
 * high and low as pivots and the scenario would test that artifact instead
 * of its shape.
 */
function calm(anchors: readonly Anchor[], wick = 0.15, atr = 1): Bar[] {
    const bars = buildSeries(anchors, { wick });
    const wide = bars.findIndex(b => b.high - b.low >= 1.5 * atr);
    if (wide !== -1)
        throw new Error(
            `bar ${wide} spans a pivot reversal: ${JSON.stringify(anchors)}`
        );
    return bars;
}

/** `appendCloses`, held to the same one-bar-per-swing rule as `calm`. */
function extend(
    bars: readonly Bar[],
    closes: readonly number[],
    wick = 0.1,
    atr = 1
): Bar[] {
    const out = appendCloses(bars, closes, wick);
    const wide = out
        .slice(bars.length)
        .findIndex(b => b.high - b.low >= 1.5 * atr);
    if (wide !== -1)
        throw new Error(`appended bar ${wide} spans a pivot reversal`);
    return out;
}

// ─── Scenarios ──────────────────────────────────────────────────────────────

const ascTriangle = calm(ASC_TRIANGLE);

/** ASC_TRIANGLE with its last resistance touch (and the pullback after it) raised by `delta`. */
const jiggleLastTouch = (delta: number): Anchor[] =>
    ASC_TRIANGLE.map(([i, p]): Anchor => [i, i >= 50 ? p + delta : p]);

const triangleScenarios: Scenario[] = [
    scenario(
        'ascending_triangle',
        'e failure',
        'a close 0.9 over resistance, then back under it: still drawn, printed as a failed breakout',
        extend(ascTriangle, [109.6, 110.4, 111, 110.3, 109.85]),
        { drawn: 'ascending_triangle', status: 'failed breakout' }
    ),
    scenario(
        'ascending_triangle',
        'a textbook',
        'flat resistance ×3 over rising support ×3',
        ascTriangle,
        {
            drawn: 'ascending_triangle',
            direction: 'up',
            // Breakout = resistance; invalidation = last support touch (105 −
            // wick); height = width at the first touch (110 − 100).
            levels: { breakout: 110.1, invalidation: 104.9, target: 120.2 },
            status: 'forming',
            only: ['ascending_triangle'],
        }
    ),
    scenario(
        'ascending_triangle',
        'b pierce',
        'IONQ: rising "resistance" 45.46 / 44.43 / 46.05 / 47.91, ATR 2.5',
        buildSeries(IONQ, { wick: 0.6 }),
        // Both lines rise by ≥ 1.5 ATR in parallel, every candle inside them:
        // an ascending channel, which is what the chart is.
        { notDrawn: 'ascending_triangle', instead: ['ascending_channel'] },
        2.5
    ),
    scenario(
        'ascending_triangle',
        'b pierce',
        'IONQ shape at a smaller ATR (1.35): resistance clearly rising',
        buildSeries(IONQ, { wick: 0.6 }),
        { notDrawn: 'ascending_triangle' },
        1.35
    ),
    scenario(
        'ascending_triangle',
        'b pierce',
        'one wick 1.2 ATR above resistance inside the pattern',
        patchBar(ascTriangle, 29, { high: 111.2 }),
        { notDrawn: 'ascending_triangle' }
    ),
    scenario(
        'ascending_triangle',
        'b pierce',
        'one wick 0.2 above resistance (inside ε) still qualifies',
        patchBar(ascTriangle, 29, { high: 110.2 }),
        { drawn: 'ascending_triangle', direction: 'up' }
    ),
    scenario(
        'ascending_triangle',
        'b pierce',
        'newest bar dips under the support line but closes above the fixed invalidation',
        extend(calm([...ASC_TRIANGLE.slice(0, 7), [56, 107.6]]), [107], 0.3),
        {
            drawn: 'ascending_triangle',
            levels: { invalidation: 104.9 },
            status: 'forming',
        }
    ),
    scenario(
        'ascending_triangle',
        'b pierce',
        'deep early low (outlier): support starts after it, height not inflated',
        calm([
            [0, 106],
            [6, 110],
            [17, 98],
            [28, 110],
            [35, 103],
            [43, 110],
            [50, 104.5],
            [58, 110],
            [65, 106],
            [69, 110],
            [71, 108.4],
            [73, 108.8],
        ]),
        {
            drawn: 'ascending_triangle',
            // Height = width at the first support touch after the outlier
            // (≈ 7.7), not 12 down to the outlier.
            levels: { breakout: 110.1, invalidation: 105.9, target: 117.9 },
        }
    ),
    scenario(
        'ascending_triangle',
        'c near-miss',
        'last resistance touch +0.3: still flat, still the triangle',
        calm(jiggleLastTouch(0.3)),
        { drawn: 'ascending_triangle' }
    ),
    scenario(
        'ascending_triangle',
        'c near-miss',
        'last resistance touch +0.6: never a wedge (a shorter window keeps the resistance flat)',
        calm(jiggleLastTouch(0.6)),
        { notDrawn: 'ascending_wedge', instead: ['ascending_triangle'] }
    ),
    scenario(
        'ascending_triangle',
        'c near-miss',
        'last resistance touch +1.2: rising, but two touches — still no wedge',
        calm(jiggleLastTouch(1.2)),
        { notDrawn: 'ascending_wedge' }
    ),
    scenario(
        'ascending_triangle',
        'c near-miss',
        'span 13 bars (< 15)',
        calm([
            [0, 101],
            [2, 100],
            [5, 103.5],
            [7, 101],
            [10, 103.5],
            [12, 102],
            [14, 103.5],
            [16, 101.9],
        ]),
        { notDrawn: 'ascending_triangle' }
    ),
    scenario(
        'ascending_triangle',
        'c near-miss',
        'only two touches per side',
        calm([
            [0, 103],
            [8, 100],
            [18, 110],
            [25, 102.5],
            [33, 110],
            [35, 108.2],
            [36, 108.5],
        ]),
        { notDrawn: 'ascending_triangle' }
    ),
    scenario(
        'ascending_triangle',
        'c near-miss',
        'height 2.9 at price ~103 on 1Day (< 3% of price)',
        calm(SMALL_TRIANGLE, 0.05, 0.5),
        { notDrawn: 'ascending_triangle' },
        0.5
    ),
    scenario(
        'ascending_triangle',
        'g intraday',
        'the same small triangle on 15Min (floor 0.5% of price) qualifies',
        calm(SMALL_TRIANGLE, 0.05, 0.5),
        { drawn: 'ascending_triangle', direction: 'up' },
        0.5,
        '15Min'
    ),
    scenario(
        'ascending_triangle',
        'g intraday',
        'the same small triangle on 1Hour (floor 1% of price) qualifies',
        calm(SMALL_TRIANGLE, 0.05, 0.5),
        { drawn: 'ascending_triangle' },
        0.5,
        '1Hour'
    ),
    scenario(
        'ascending_triangle',
        'e breakout',
        'close above resistance reads broken',
        extend(ascTriangle, [109.6, 110.6]),
        { drawn: 'ascending_triangle', status: 'broken' }
    ),
    scenario(
        'ascending_triangle',
        'e failure',
        'close under the last support touch fails it',
        extend(ascTriangle, [107.6, 106.6, 105.6, 104.5]),
        { notDrawn: 'ascending_triangle' }
    ),
    scenario(
        'ascending_triangle',
        'f arbitration',
        'flat highs also make a triple/double top: the triangle wins',
        ascTriangle,
        { drawn: 'ascending_triangle', only: ['ascending_triangle'] }
    ),
    scenario(
        'ascending_triangle',
        'c near-miss',
        'last resistance touch +0.7: the span drift leaves the flat class — not a triangle, and not a triple top either (its troughs clearly rise)',
        calm(jiggleLastTouch(0.7)),
        { notDrawn: 'ascending_triangle', instead: [] }
    ),
];

const symTriangle = calm(SYM_TRIANGLE);
const symmetricalScenarios: Scenario[] = [
    scenario(
        'symmetrical_triangle',
        'a textbook',
        'falling highs ×3, rising lows ×3, prior rise → up',
        symTriangle,
        {
            drawn: 'symmetrical_triangle',
            direction: 'up',
            levels: { invalidation: 102.9 },
            status: 'forming',
        }
    ),
    scenario(
        'symmetrical_triangle',
        'a textbook',
        'no prior trend → undetermined direction, both boundaries, no target',
        calm(SYM_TRIANGLE_NO_TREND),
        { drawn: 'symmetrical_triangle', direction: null }
    ),
    scenario(
        'symmetrical_triangle',
        'b pierce',
        'two bars poke under support: the first is one wide bar that confirms its own high, the second becomes the swing low and support is re-fit through it (never crossed)',
        // Bar 44 (low 101.2, high 104.3) reverses 1.5 ATR within itself, so it
        // confirms its high only; the swing low it starts is bar 45's 101.3.
        // A bar is never both a swing high and a swing low.
        patchBar(patchBar(symTriangle, 44, { low: 101.2 }), 45, {
            low: 101.3,
        }),
        { drawn: 'symmetrical_triangle', levels: { invalidation: 101.3 } }
    ),
    scenario(
        'symmetrical_triangle',
        'c near-miss',
        'highs fall only ~1 ATR (dead band)',
        calm(
            SYM_TRIANGLE.map(([i, p]): Anchor => [
                i,
                i === 14 ? 109.6 : i === 31 ? 109.1 : i === 48 ? 108.6 : p,
            ])
        ),
        { notDrawn: 'symmetrical_triangle' }
    ),
    scenario(
        'symmetrical_triangle',
        'e breakout',
        'close above the falling upper line reads broken',
        extend(symTriangle, [105.4, 106.2]),
        { drawn: 'symmetrical_triangle', status: 'broken' }
    ),
    scenario(
        'symmetrical_triangle',
        'e failure',
        'close under the last support touch fails it',
        extend(symTriangle, [103.8, 102.5]),
        { notDrawn: 'symmetrical_triangle' }
    ),
];

const rectangle = calm(RECTANGLE);
const rectangleNoTrend = calm(RECTANGLE_NO_TREND);
const rectangleScenarios: Scenario[] = [
    scenario(
        'rectangle',
        'a textbook',
        'flat 110 ×3 / 100 ×3 after a rise → up',
        rectangle,
        {
            drawn: 'rectangle',
            direction: 'up',
            levels: { breakout: 110.1, invalidation: 99.9, target: 120.2 },
            only: ['rectangle'],
        }
    ),
    scenario(
        'rectangle',
        'a textbook',
        'no prior trend → both boundaries, no direction',
        rectangleNoTrend,
        {
            drawn: 'rectangle',
            direction: null,
            levels: { upper: 110.1, lower: 99.9 },
        }
    ),
    scenario(
        'rectangle',
        'b pierce',
        'one bar closes 1.5 above the top inside the range',
        patchBar(rectangle, 37, { high: 111.6, close: 111.4 }),
        { notDrawn: 'rectangle' }
    ),
    scenario(
        'rectangle',
        'c near-miss',
        'both lines drift up ~4.5 (a channel, not a rectangle)',
        calm(
            RECTANGLE.map(([i, p]): Anchor => [
                i,
                i >= 14 ? p + (i - 14) / 10 : p,
            ])
        ),
        { notDrawn: 'rectangle' }
    ),
    scenario(
        'rectangle',
        'f arbitration',
        'three highs over two lows is a triple top, not a rectangle',
        calm([...RECTANGLE.slice(0, 6), [53, 107], [55, 107.4]]),
        { notDrawn: 'rectangle', instead: ['triple_top'] }
    ),
    scenario(
        'rectangle',
        'f arbitration',
        'a 3 + 3 rectangle wins over the triple top and bottom it contains',
        rectangle,
        { drawn: 'rectangle', only: ['rectangle'] }
    ),
    scenario(
        'rectangle',
        'e breakout',
        'undirected: a close outside a boundary reads broken',
        extend(
            rectangleNoTrend,
            Array.from({ length: 9 }, (_, k) => 102.8 + k)
        ),
        { drawn: 'rectangle', direction: null, status: 'broken' }
    ),
    scenario(
        'rectangle',
        'e failure',
        'directed (prior rise): close under the last lower touch fails it',
        extend(rectangle, [100.8, 99.8, 99.5]),
        { notDrawn: 'rectangle' }
    ),
];

const ascChannel = calm(ASC_CHANNEL);
const channelScenarios: Scenario[] = [
    scenario(
        'ascending_channel',
        'a textbook',
        'parallel rising lines, prior rise → up',
        ascChannel,
        { drawn: 'ascending_channel', direction: 'up' }
    ),
    scenario(
        'ascending_channel',
        'b pierce',
        'one bar 0.8 under the lower line',
        patchBar(ascChannel, 30, { low: 104.2 }),
        { notDrawn: 'ascending_channel' }
    ),
    scenario(
        'ascending_channel',
        'b pierce',
        'lows 0.3 off one line, the middle one lowest: drawn with the lower line parallel to the upper one through that low',
        calm(OFFSET_LOW_CHANNEL),
        {
            drawn: 'ascending_channel',
            direction: 'up',
            only: ['ascending_channel'],
        }
    ),
    scenario(
        'ascending_channel',
        'b pierce',
        'the same channel with one non-swing bar 0.28 under that parallel: not drawn (the slack is not widened for the parallel)',
        // Bar 34 is on the leg up from the middle low; its low 103.55 sits
        // 0.28 under the parallel there (103.83) and above the swing low, so
        // it stays a pierce, not a new extreme. 103.58 (0.25) would pass.
        patchBar(buildSeries(OFFSET_LOW_CHANNEL, { wick: 0.15 }), 34, {
            low: 103.55,
        }),
        { notDrawn: 'ascending_channel', instead: [] }
    ),
    scenario(
        'ascending_channel',
        'c near-miss',
        'upper line steeper: width grows ~26% (neither channel nor broadening)',
        calm(
            ASC_CHANNEL.map(([i, p]): Anchor => [
                i,
                i === 34 ? 112.6 : i === 50 ? 117.2 : i >= 52 ? p + 1.2 : p,
            ])
        ),
        { notDrawn: 'ascending_channel' }
    ),
    scenario(
        'ascending_channel',
        'e failure',
        'close under the last lower touch fails it',
        extend(ascChannel, [113.5, 112.4, 111.3, 110.2, 109.1, 108, 107.4]),
        { notDrawn: 'ascending_channel' }
    ),
    scenario(
        'ascending_channel',
        'e breakout',
        'close over the rising upper line reads broken',
        extend(ascChannel, [115.6, 116.6, 117.6, 118.3]),
        { drawn: 'ascending_channel', status: 'broken' }
    ),
];

const ascWedge = calm(ASC_WEDGE);
const wedgeScenarios: Scenario[] = [
    scenario(
        'ascending_wedge',
        'a textbook',
        'rising, converging, three touches per side → down',
        ascWedge,
        {
            drawn: 'ascending_wedge',
            direction: 'down',
            levels: { invalidation: 112.9 },
            status: 'forming',
        }
    ),
    scenario(
        'ascending_wedge',
        'b pierce',
        'one wick 1 above the upper line',
        patchBar(ascWedge, 40, { high: 112.6 }),
        { notDrawn: 'ascending_wedge' }
    ),
    scenario(
        'ascending_wedge',
        'c near-miss',
        'middle support low off the line: two touches on that side',
        calm(ASC_WEDGE.map(([i, p]): Anchor => [i, i === 26 ? 104.8 : p])),
        { notDrawn: 'ascending_wedge' }
    ),
    scenario(
        'ascending_wedge',
        'e breakout',
        'close under the rising lower line reads broken',
        extend(ascWedge, [110.5, 109.9]),
        { drawn: 'ascending_wedge', status: 'broken' }
    ),
    scenario(
        'ascending_wedge',
        'e failure',
        'close over the last upper touch fails it',
        extend(ascWedge, [112.3, 113.4]),
        { notDrawn: 'ascending_wedge' }
    ),
];

const broadening = calm(BROADENING);
const broadeningScenarios: Scenario[] = [
    scenario(
        'broadening_formation',
        'a textbook',
        'higher highs ×3, lower lows ×2, prior rise → up',
        broadening,
        {
            drawn: 'broadening_formation',
            direction: 'up',
            levels: { invalidation: 96.1 },
        }
    ),
    scenario(
        'broadening_formation',
        'b pierce',
        'one bar 0.6 over the upper line',
        patchBar(broadening, 45, { high: 110.1 }),
        { notDrawn: 'broadening_formation' }
    ),
    scenario(
        'broadening_formation',
        'c near-miss',
        'two touches per side only',
        calm([...BROADENING.slice(0, 5), [54, 98]]),
        { notDrawn: 'broadening_formation' }
    ),
    scenario(
        'broadening_formation',
        'e failure',
        'close under the last lower touch fails it',
        extend(
            broadening,
            Array.from({ length: 15 }, (_, k) => 109.4 - k)
        ),
        { notDrawn: 'broadening_formation' }
    ),
    scenario(
        'broadening_formation',
        'e breakout',
        'close over the rising upper line reads broken',
        extend(broadening, [111.4, 112.4, 113]),
        { drawn: 'broadening_formation', status: 'broken' }
    ),
    scenario(
        'broadening_formation',
        'c near-miss',
        'width grows ~38%: still a broadening formation',
        calm(broadeningOf([108, 108.8, 109.6], [98, 97])),
        { drawn: 'broadening_formation' }
    ),
    scenario(
        'broadening_formation',
        'c near-miss',
        'both lines sloped but the width grows only ~26% (< 30%): not a broadening formation',
        calm([
            [0, 100],
            [10, 108],
            [26, 94],
            [42, 109],
            [58, 93.2],
            [74, 110],
            [76, 108.4],
            [78, 108.8],
        ]),
        { notDrawn: 'broadening_formation' }
    ),
];

const hs = calm(HEAD_AND_SHOULDERS);
const hsScenarios: Scenario[] = [
    scenario(
        'head_and_shoulders',
        'a textbook',
        'shoulders 110/111, head 116, troughs 104/105',
        hs,
        {
            drawn: 'head_and_shoulders',
            direction: 'down',
            // Neckline through the trough lows, read at the last bar (62).
            levels: { breakout: 105.6, invalidation: 111.1, target: 94 },
            status: 'forming',
            only: ['head_and_shoulders'],
        }
    ),
    scenario(
        'head_and_shoulders',
        'e breakout',
        'gently sloped neckline (104 → 105.3): the close under it reads broken at the sloped value',
        calm(HS_GENTLE_SLOPE),
        {
            drawn: 'head_and_shoulders',
            status: 'broken',
            levels: { breakout: 105.9, invalidation: 111.1 },
        }
    ),
    scenario(
        'head_and_shoulders',
        'c near-miss',
        'neckline climbing with the prior rise (troughs 104 → 109, 5 ATR): not an H&S',
        // The neckline rises by the boundaries' sloped class in the direction
        // of the prior trend, so the troughs are the trend's rising lows and
        // the "head" its latest high. This shape used to be drawn (it tested
        // the sloped-neckline breakout, now tested by the gentle slope above).
        calm(HS_SLOPED),
        { notDrawn: 'head_and_shoulders' }
    ),
    scenario(
        'head_and_shoulders',
        'b pierce',
        '17 bars shoulder to shoulder (ATR 1.5): drawn — the span floor is 15 bars',
        calm(SHORT_HEAD_AND_SHOULDERS, 0.15, 1.5),
        { drawn: 'head_and_shoulders', direction: 'down' },
        1.5
    ),
    scenario(
        'head_and_shoulders',
        'b pierce',
        'a bar in the head leg dips 1 under the neckline: not drawn (the only five-swing window left has a "left shoulder" a hair over its trough)',
        patchBar(hs, 30, { low: 103 }),
        // The dip turns bar 30 into a swing, so the only five-pivot window
        // left is [h30, l31, h38, l49, h55]: its left shoulder 107.4 stands
        // 0.26 over the l31 trough, a pause in the leg to the head rather
        // than a shoulder (HS_SHOULDER_MIN_CLEARANCE_ATR).
        { notDrawn: 'head_and_shoulders' }
    ),
    scenario(
        'head_and_shoulders',
        'c near-miss',
        'shoulders 6% apart',
        calm([
            [0, 98],
            [20, 104.4],
            [25, 101],
            [38, 116],
            [48, 105],
            [55, 111],
            [58, 108.4],
            [62, 108.6],
        ]),
        { notDrawn: 'head_and_shoulders' }
    ),
    scenario(
        'head_and_shoulders',
        'c near-miss',
        'head only 0.5 above the right shoulder',
        calm(
            HEAD_AND_SHOULDERS.map(([i, p]): Anchor => [
                i,
                i === 38 ? 111.6 : p,
            ])
        ),
        { notDrawn: 'head_and_shoulders' }
    ),
    scenario(
        'head_and_shoulders',
        'e failure',
        'close over the right shoulder fails it',
        extend(hs, [109.6, 110.6, 111.5]),
        { notDrawn: 'head_and_shoulders' }
    ),
    scenario(
        'head_and_shoulders',
        'f arbitration',
        'the troughs also make a double bottom: only the H&S is drawn',
        hs,
        { drawn: 'head_and_shoulders', only: ['head_and_shoulders'] }
    ),
    scenario(
        'head_and_shoulders',
        'f arbitration',
        'a later double top whose first peak is the right shoulder (spans touch at that one bar): only the H&S is drawn',
        calm(HS_THEN_DOUBLE_TOP),
        { drawn: 'head_and_shoulders', only: ['head_and_shoulders'] }
    ),
    scenario(
        'head_and_shoulders',
        'b pierce',
        'two confirmed swings after the right shoulder: still drawn',
        calm([
            ...HEAD_AND_SHOULDERS.slice(0, 6),
            [58, 108.4],
            [61, 110.2],
            [64, 108.3],
            [66, 108.6],
        ]),
        { drawn: 'head_and_shoulders' }
    ),
    scenario(
        'head_and_shoulders',
        'c near-miss',
        'three confirmed swings after the right shoulder: no longer drawn',
        calm([
            ...HEAD_AND_SHOULDERS.slice(0, 6),
            [58, 108.4],
            [61, 110.2],
            [64, 108.3],
            [67, 110],
            [68, 109.8],
        ]),
        { notDrawn: 'head_and_shoulders' }
    ),
];

const doubleTop = calm(DOUBLE_TOP);
const doubleScenarios: Scenario[] = [
    scenario(
        'double_top',
        'e failure',
        'a slide through the 102.9 neckline to 99, then back over it to 106.5: still drawn, printed as a failed breakout (2026-10-18)',
        calm([...DOUBLE_TOP.slice(0, -1), [62, 99], [68, 106.5]], 0.05),
        { drawn: 'double_top', status: 'failed breakout' }
    ),
    scenario(
        'double_top',
        'a textbook',
        'peaks 110 / 110.5, 14 bars apart, trough 103',
        doubleTop,
        {
            drawn: 'double_top',
            direction: 'down',
            levels: { breakout: 102.9, invalidation: 110.6, target: 95.6 },
            status: 'forming',
            only: ['double_top'],
        }
    ),
    scenario(
        'double_top',
        'b pierce',
        'second peak is today’s still-rising bar (provisional)',
        calm([...DOUBLE_TOP.slice(0, 6), [50, 110.3]]),
        { notDrawn: 'double_top' }
    ),
    scenario(
        'double_top',
        'c near-miss',
        'peaks 8 bars apart (< 10)',
        calm([
            [0, 100],
            [20, 110],
            [24, 105.6],
            [28, 110.2],
            [31, 107],
            [33, 107.3],
        ]),
        { notDrawn: 'double_top' }
    ),
    scenario(
        'double_top',
        'c near-miss',
        'peaks 4 bars apart (spec §6 test 11)',
        calm([
            [0, 100],
            [20, 110],
            [22, 107.8],
            [24, 110.2],
            [26, 108],
            [28, 108.3],
        ]),
        { notDrawn: 'double_top' }
    ),
    scenario(
        'double_top',
        'c near-miss',
        'peaks 1.5 apart (do not match)',
        calm([...DOUBLE_TOP.slice(0, 6), [51, 111.5], [55, 107.5], [62, 107]]),
        { notDrawn: 'double_top' }
    ),
    scenario(
        'double_top',
        'c near-miss',
        'trough only 2.4 below the peaks (< 3% of price)',
        calm(
            DOUBLE_TOP.map(([i, p]): Anchor => [
                i,
                i === 43 ? 107.8 : i >= 54 ? 108.4 : p,
            ])
        ),
        { notDrawn: 'double_top' }
    ),
    scenario(
        'double_top',
        'e breakout',
        'close under the neckline reads broken',
        extend(doubleTop, [105.4, 104.3, 103.2, 102.4]),
        { drawn: 'double_top', status: 'broken' }
    ),
    scenario(
        'double_top',
        'e failure',
        'close over the higher peak fails it',
        extend(doubleTop, [107.5, 108.6, 109.7, 110.8, 111.1]),
        { notDrawn: 'double_top' }
    ),
    scenario(
        'double_top',
        'g intraday',
        'height 1.8 at price 110 (ATR 0.5): drawn on 15Min',
        calm(SMALL_DOUBLE_TOP, 0.05, 0.5),
        { drawn: 'double_top' },
        0.5,
        '15Min'
    ),
    scenario(
        'double_top',
        'g intraday',
        'the same double top fails the 1Day 3% floor',
        calm(SMALL_DOUBLE_TOP, 0.05, 0.5),
        { notDrawn: 'double_top' },
        0.5
    ),
    scenario(
        'double_top',
        'c near-miss',
        'height 2.3 at price 20: under the 2.5-ATR floor (3% of price would allow 0.6)',
        calm(lowPriceDoubleTop(17.9, 20.05)),
        { notDrawn: 'double_top' }
    ),
    scenario(
        'double_top',
        'c near-miss',
        'height 2.7 at price 20 clears the 2.5-ATR floor',
        calm(lowPriceDoubleTop(17.45, 20.05)),
        { drawn: 'double_top' }
    ),
    scenario(
        'double_top',
        'c near-miss',
        'peaks 0.7 apart at price 20: within 1 ATR but over 3% of price',
        calm(lowPriceDoubleTop(17.2, 20.7)),
        { notDrawn: 'double_top' }
    ),
    scenario(
        'double_top',
        'c near-miss',
        'peaks 0.45 apart at price 20 match (under 3% of price)',
        calm(lowPriceDoubleTop(17.2, 20.45)),
        { drawn: 'double_top' }
    ),
    scenario(
        'double_top',
        'g intraday',
        '5Min, ATR 0.1: height 0.46 is under 0.5% of price',
        calm(
            [
                [0, 99.4],
                [10, 100],
                [16, 99.55],
                [26, 100.02],
                [30, 99.8],
                [32, 99.82],
            ],
            0.01,
            0.1
        ),
        { notDrawn: 'double_top' },
        0.1,
        '5Min'
    ),
    scenario(
        'double_top',
        'g intraday',
        '5Min, ATR 0.1: height 0.66 clears 0.5% of price',
        calm(
            [
                [0, 99.4],
                [10, 100],
                [16, 99.35],
                [26, 100.02],
                [30, 99.8],
                [32, 99.82],
            ],
            0.01,
            0.1
        ),
        { drawn: 'double_top' },
        0.1,
        '5Min'
    ),
    scenario(
        'double_top',
        'c near-miss',
        'recency: 20 bars after the last peak, still drawn',
        extend(doubleTop, quietCloses(8)),
        { drawn: 'double_top' }
    ),
    scenario(
        'double_top',
        'c near-miss',
        'recency: 21 bars after the last peak, too old',
        extend(doubleTop, quietCloses(9)),
        { notDrawn: 'double_top' }
    ),
];

const tripleTop = calm(TRIPLE_TOP);
const tripleScenarios: Scenario[] = [
    scenario(
        'triple_top',
        'a textbook',
        'peaks 110 / 110.3 / 109.8 over troughs 103 / 103.5',
        tripleTop,
        {
            drawn: 'triple_top',
            direction: 'down',
            levels: { breakout: 102.9, invalidation: 110.4 },
            only: ['triple_top'],
        }
    ),
    scenario(
        'triple_top',
        'c near-miss',
        'first peak 1.8 higher (extremes do not match): the last two make a double top',
        calm(TRIPLE_TOP.map(([i, p]): Anchor => [i, i === 20 ? 111.8 : p])),
        { notDrawn: 'triple_top', instead: ['double_top'] }
    ),
    scenario(
        'triple_top',
        'b pierce',
        'third peak still forming (provisional)',
        calm([...TRIPLE_TOP.slice(0, 5), [51, 109.9]]),
        { notDrawn: 'triple_top' }
    ),
    scenario(
        'triple_top',
        'e failure',
        'close over the highest peak fails it',
        extend(tripleTop, [108, 109, 110, 110.9]),
        { notDrawn: 'triple_top' }
    ),
    scenario(
        'triple_top',
        'e breakout',
        'close under the neckline reads broken',
        extend(tripleTop, [106, 105, 104, 103, 102.4]),
        { drawn: 'triple_top', status: 'broken' }
    ),
];

const bullFlag = calm(BULL_FLAG, 0.05);
const flagScenarios: Scenario[] = [
    scenario(
        'bull_flag',
        'a textbook',
        '10-bar pole 98 → 108, 12-bar flat flag 106.5 ↔ 108',
        bullFlag,
        {
            drawn: 'bull_flag',
            direction: 'up',
            levels: { breakout: 108.05, invalidation: 106.45, target: 118.1 },
            only: ['bull_flag'],
        }
    ),
    scenario(
        'bull_flag',
        'c near-miss',
        '36-bar box after the pole (too long for a flag)',
        calm([...POLE, ...flagLegs(18, 18, 106.5, 108)], 0.05),
        { notDrawn: 'bull_flag' }
    ),
    scenario(
        'bull_flag',
        'c near-miss',
        'flag gives back 55% of the pole',
        calm([...POLE, ...flagLegs(18, 4, 102.5, 104, 5)], 0.05),
        { notDrawn: 'bull_flag' }
    ),
    scenario(
        'bull_flag',
        'c near-miss',
        'pole takes 25 bars',
        calm(
            [[0, 103], [8, 98], [33, 108], ...flagLegs(33, 6, 106.5, 108)],
            0.05
        ),
        { notDrawn: 'bull_flag' }
    ),
    scenario(
        'bull_flag',
        'c near-miss',
        'flag climbs with the pole (+0.25/bar)',
        calm(
            [
                ...POLE,
                ...flagLegs(18, 6, 106.5, 108).map(([i, p]): Anchor => [
                    i,
                    p + 0.25 * (i - 18),
                ]),
            ],
            0.05
        ),
        { notDrawn: 'bull_flag' }
    ),
    scenario(
        'bull_flag',
        'b pierce',
        'a straight pullback leg after the pole is not a flag',
        calm([...POLE, [24, 103]], 0.05),
        { notDrawn: 'bull_flag' }
    ),
    scenario(
        'bull_flag',
        'e breakout',
        'close over the upper channel reads broken',
        extend(bullFlag, [107.4, 108.5], 0.05),
        { drawn: 'bull_flag', status: 'broken' }
    ),
    scenario(
        'bull_flag',
        'e breakout',
        'the breakout rally runs 23 bars past the pole top without reaching the target: still drawn, broken (age counts to the flag end)',
        extend(
            bullFlag,
            Array.from({ length: 11 }, (_, k) => 107.4 + 0.5 * k),
            0.05
        ),
        { drawn: 'bull_flag', status: 'broken' }
    ),
    scenario(
        'bull_flag',
        'e failure',
        'close under the flag low fails it',
        extend(bullFlag, [107, 105.9], 0.05),
        { notDrawn: 'bull_flag' }
    ),
    scenario(
        'bull_flag',
        'c near-miss',
        'a box of bars that each span the whole channel: every bar touches both lines',
        SPANNING_BOX,
        { notDrawn: 'bull_flag', instead: [] }
    ),
];

const pennant = calm(PENNANT, 0.05);
const pennantScenarios: Scenario[] = [
    scenario(
        'pennant',
        'a textbook',
        'pole, then highs falling and lows rising to a point',
        pennant,
        { drawn: 'pennant', direction: 'up', only: ['pennant'] }
    ),
    scenario(
        'pennant',
        'a textbook',
        'down pole: a bearish pennant breaks down',
        calm(mirrorAnchors(PENNANT, MIRROR_PIVOT), 0.05),
        { drawn: 'pennant', direction: 'down' }
    ),
    scenario(
        'pennant',
        'c near-miss',
        'swings widen after the pole (megaphone)',
        calm(
            [
                ...POLE,
                [21, 106.5],
                [24, 107.4],
                [27, 105.5],
                [30, 108],
                [33, 104.8],
                [35, 106],
            ],
            0.05
        ),
        { notDrawn: 'pennant' }
    ),
    scenario(
        'pennant',
        'e failure',
        'close under the pennant low fails it',
        extend(pennant, [106, 105.1], 0.05),
        { notDrawn: 'pennant' }
    ),
    scenario(
        'pennant',
        'b pierce',
        'one wick 0.5 over the upper line: it becomes a swing and the channel is re-fit over it (never crossed)',
        patchBar(pennant, 26, { high: 108 }),
        { drawn: 'pennant' }
    ),
    scenario(
        'pennant',
        'e breakout',
        'close over the upper line reads broken',
        extend(pennant, [107.4], 0.05),
        { drawn: 'pennant', status: 'broken' }
    ),
];

const htf = calm(HIGH_TIGHT_FLAG, 0.3);
const htfScenarios: Scenario[] = [
    scenario(
        'high_tight_flag',
        'a textbook',
        '+100% in 25 bars, 12.5% pullback',
        htf,
        {
            drawn: 'high_tight_flag',
            direction: 'up',
            levels: { breakout: 40.2, invalidation: 34.8, target: 60.5 },
            only: ['high_tight_flag'],
        }
    ),
    scenario(
        'high_tight_flag',
        'c near-miss',
        'pole only +60%',
        calm(
            HIGH_TIGHT_FLAG.map(([i, p]): Anchor => [
                i,
                i === 45 ? 32 : i === 52 ? 29.5 : i === 58 ? 30.5 : p,
            ]),
            0.3
        ),
        { notDrawn: 'high_tight_flag' }
    ),
    scenario(
        'high_tight_flag',
        'c near-miss',
        'flag gives back 28%',
        calm([...HIGH_TIGHT_FLAG.slice(0, 4), [58, 28.8], [61, 31]], 0.3),
        { notDrawn: 'high_tight_flag' }
    ),
    scenario(
        'high_tight_flag',
        'b pierce',
        'top not confirmed (pullback under 1.5 ATR)',
        calm([...HIGH_TIGHT_FLAG.slice(0, 4), [52, 39.4], [54, 39.6]], 0.3),
        { notDrawn: 'high_tight_flag' }
    ),
    scenario(
        'high_tight_flag',
        'e failure',
        'close under the flag low fails it',
        extend(htf, [37.2, 36.4, 35.6, 34.8, 34.3], 0.3),
        { notDrawn: 'high_tight_flag' }
    ),
    scenario(
        'high_tight_flag',
        'e breakout',
        'close over the pole top reads broken',
        extend(htf, [38.8, 39.6, 40.4, 40.9], 0.3),
        { drawn: 'high_tight_flag', status: 'broken' }
    ),
];

const cup = calm(CUP_AND_HANDLE);
const cupScenarios: Scenario[] = [
    scenario(
        'cup_and_handle',
        'e failure',
        'a rally through the 119.6 rim to 121, then back under it to 117.5: still drawn, printed as a failed breakout (2026-10-18)',
        calm([...CUP_AND_HANDLE, [93, 121], [97, 117.5]], 0.05),
        { drawn: 'cup_and_handle', status: 'failed breakout' }
    ),
    scenario(
        'cup_and_handle',
        'a textbook',
        'rims 120 / 119.5, U base to 100, handle to 115',
        cup,
        {
            drawn: 'cup_and_handle',
            direction: 'up',
            levels: { breakout: 119.6, invalidation: 114.9, target: 139.3 },
            only: ['cup_and_handle'],
        }
    ),
    scenario(
        'cup_and_handle',
        'c near-miss',
        'handle low 108, under the cup midpoint',
        calm([...CUP_AND_HANDLE.slice(0, 12), [87, 108], [90, 111], [92, 110]]),
        { notDrawn: 'cup_and_handle' }
    ),
    scenario(
        'cup_and_handle',
        'c near-miss',
        'V-shaped cup',
        calm([
            [0, 110],
            [10, 120],
            [43, 100],
            [77, 119.5],
            [83, 115],
            [87, 118],
            [89, 117],
        ]),
        { notDrawn: 'cup_and_handle' }
    ),
    scenario(
        'cup_and_handle',
        'c near-miss',
        'right rim 8% under the left (smooth base, no other rim)',
        calm([
            ...ROUNDING_BOTTOM.slice(0, 10),
            [78, 110.2],
            [84, 107],
            [88, 109],
            [90, 108.6],
        ]),
        { notDrawn: 'cup_and_handle' }
    ),
    scenario(
        'cup_and_handle',
        'c near-miss',
        'right rim 6% under the left on a 12.6-deep base: not a cup (the rims differ by over a quarter of the depth)',
        calm([
            ...ROUNDING_BOTTOM.slice(0, 10),
            [78, 112.6],
            [84, 108.6],
            [88, 111],
            [90, 110.5],
        ]),
        { notDrawn: 'cup_and_handle' }
    ),
    scenario(
        'cup_and_handle',
        'b pierce',
        'right rim 5.8% under the left on a 33-deep base: a cup (rims within 7% and within a quarter of the depth)',
        calm(DEEP_CUP, 0.3, 2),
        { drawn: 'cup_and_handle' },
        2
    ),
    scenario(
        'cup_and_handle',
        'c near-miss',
        'handle 26 bars long',
        calm([
            ...CUP_AND_HANDLE.slice(0, 12),
            [83, 115],
            [90, 118],
            [97, 115.5],
            [103, 117],
        ]),
        { notDrawn: 'cup_and_handle' }
    ),
    scenario(
        'cup_and_handle',
        'e breakout',
        'close over the right rim reads broken',
        extend(cup, [118.2, 119.3, 120.4]),
        { drawn: 'cup_and_handle', status: 'broken' }
    ),
    scenario(
        'cup_and_handle',
        'e failure',
        'close under the handle low fails it',
        extend(cup, [116, 115.2, 114.5]),
        { notDrawn: 'cup_and_handle' }
    ),
    scenario(
        'cup_and_handle',
        'f arbitration',
        'the base is also a rounding bottom: only the cup is drawn',
        cup,
        { drawn: 'cup_and_handle', only: ['cup_and_handle'] }
    ),
    scenario(
        'cup_and_handle',
        'b pierce',
        'one bar inside the cup spikes 1 over the rims: not a cup (an interior bar above the rims)',
        // The spike bar's own low is the running low, so it confirms no
        // swing of its own; it stays inside the cup and pokes 1.2 ATR over
        // the lower rim. (The old zigzag made it a swing high and low at
        // once and re-read the cup from it.)
        patchBar(cup, 40, { high: 121.2 }),
        { notDrawn: 'cup_and_handle' }
    ),
];

const roundingBottom = calm(ROUNDING_BOTTOM);
const roundingScenarios: Scenario[] = [
    scenario(
        'rounding_bottom',
        'a textbook',
        'parabolic U rim to rim, a sharp pullback confirms the right rim',
        roundingBottom,
        {
            drawn: 'rounding_bottom',
            direction: 'up',
            levels: { breakout: 120.1, invalidation: 99.9 },
            only: ['rounding_bottom'],
        }
    ),
    scenario(
        'rounding_bottom',
        'c near-miss',
        'V bottom (straight sides) — the U check',
        calm([
            [0, 114],
            [6, 120],
            [46, 100],
            [86, 119.5],
            [89, 116.5],
        ]),
        // Two equal highs around a deep trough still make a double top.
        { notDrawn: 'rounding_bottom', instead: ['double_top'] }
    ),
    scenario(
        'rounding_bottom',
        'c near-miss',
        'W base (two lows, hump to 112): poor quadratic fit',
        calm([
            [0, 114],
            [6, 120],
            [26, 100],
            [46, 112],
            [66, 100],
            [86, 119.5],
            [89, 116.5],
        ]),
        // The two lows (bars 26, 66) would make a double bottom, but its
        // last trough is 23 bars old: past the recency window.
        { notDrawn: 'rounding_bottom', instead: [] }
    ),
    scenario(
        'rounding_bottom',
        'c near-miss',
        'lopsided base: deep early low, then a slow climb — not a rounded U',
        calm([
            [0, 114],
            [6, 120],
            [24, 100],
            [46, 105],
            [66, 111],
            [86, 119.5],
            [89, 116.5],
        ]),
        { notDrawn: 'rounding_bottom' }
    ),
    scenario(
        'rounding_bottom',
        'e failure',
        'close under the bottom fails it',
        extend(
            roundingBottom,
            Array.from({ length: 17 }, (_, k) => 115.5 - k)
        ),
        { notDrawn: 'rounding_bottom' }
    ),
    scenario(
        'rounding_bottom',
        'b pierce',
        'one bar inside the base pokes 1 over the rims',
        patchBar(roundingBottom, 46, { high: 121.2 }),
        { notDrawn: 'rounding_bottom' }
    ),
    scenario(
        'rounding_bottom',
        'e breakout',
        'the rise confirms the pullback low (a handle), so the base is drawn as a cup & handle, and its breakout reads broken',
        extend(roundingBottom, [117.5, 118.5, 119.5, 120.5]),
        {
            drawn: 'cup_and_handle',
            status: 'broken',
            only: ['cup_and_handle'],
        }
    ),
    scenario(
        'rounding_bottom',
        'c near-miss',
        'J-shaped base (fitted vertex at ~38% of the span, but the low 9 bars after the left rim): the extreme-bar middle-half check',
        calm(J_BASE),
        { notDrawn: 'rounding_bottom' }
    ),
    scenario(
        'rounding_bottom',
        'c near-miss',
        'recency: 25 bars after the right rim of a 51-bar base (half its span), still drawn',
        extend(calm(SMALL_ROUNDING), Array(23).fill(109.9)),
        { drawn: 'rounding_bottom' }
    ),
    scenario(
        'rounding_bottom',
        'c near-miss',
        'recency: 26 bars after the right rim, too old',
        extend(calm(SMALL_ROUNDING), Array(24).fill(109.9)),
        { notDrawn: 'rounding_bottom' }
    ),
];

const MIRRORED_SOURCES = new Set<ChartPatternId>([
    'ascending_triangle',
    'ascending_wedge',
    'ascending_channel',
    'double_top',
    'triple_top',
    'head_and_shoulders',
    'bull_flag',
    'rounding_bottom',
]);

const base: Scenario[] = [
    ...triangleScenarios,
    ...symmetricalScenarios,
    ...rectangleScenarios,
    ...channelScenarios,
    ...wedgeScenarios,
    ...broadeningScenarios,
    ...hsScenarios,
    ...doubleScenarios,
    ...tripleScenarios,
    ...flagScenarios,
    ...pennantScenarios,
    ...htfScenarios,
    ...cupScenarios,
    ...roundingScenarios,
];

/** Every scenario, with each mirrorable family's cases also run on the mirrored series. */
export const SCENARIOS: readonly Scenario[] = [
    ...base,
    ...base
        .filter(
            s =>
                MIRRORED_SOURCES.has(s.pattern) &&
                // The IONQ chart is one real chart, not a family template.
                !s.name.startsWith('IONQ') &&
                // Price-share rows depend on the price level the mirror moves.
                !s.name.includes('at price 20') &&
                // A cup has no mirrored id; the dome case is listed below.
                !('drawn' in s.expect && s.expect.drawn === 'cup_and_handle')
        )
        .map(mirrored),
    // Mirror of the rounding-bottom breakout: with no inverted cup, the dome
    // stays a rounding top and its breakdown reads broken.
    mirrored(
        scenario(
            'rounding_bottom',
            'e breakout',
            'close under the lip reads broken',
            extend(roundingBottom, [117.5, 118.5, 119.5, 120.5]),
            { drawn: 'rounding_bottom', status: 'broken' }
        )
    ),
];

/** A series whose final leg is extended for the provisional-invariance check (spec §2.1). */
export interface StabilityCase {
    pattern: ChartPatternId;
    bars: Bar[];
}

const stability = (pattern: ChartPatternId, bars: Bar[]): StabilityCase[] =>
    MIRRORED_SOURCES.has(pattern)
        ? [
              { pattern, bars },
              {
                  pattern: mirrorId(pattern),
                  bars: mirrored(
                      scenario(pattern, 'a textbook', '', bars, {
                          drawn: pattern,
                      })
                  ).bars,
              },
          ]
        : [{ pattern, bars }];

/**
 * Every family drawn from confirmed pivots. Flags and pennants are left out
 * on purpose: their channel is fitted on the flag's own bars (§3.4), so a
 * longer flag is a different channel by design.
 */
export const STABILITY_CASES: readonly StabilityCase[] = [
    ...stability('ascending_triangle', ascTriangle),
    ...stability('symmetrical_triangle', symTriangle),
    ...stability('rectangle', rectangle),
    ...stability('ascending_channel', ascChannel),
    ...stability('ascending_wedge', ascWedge),
    ...stability('broadening_formation', broadening),
    ...stability('head_and_shoulders', hs),
    ...stability('double_top', doubleTop),
    ...stability('triple_top', tripleTop),
    ...stability('high_tight_flag', htf),
    ...stability('cup_and_handle', cup),
    ...stability('rounding_bottom', roundingBottom),
];
