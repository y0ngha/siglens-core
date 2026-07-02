/**
 * One-off deterministic fixture generator for the chart-pattern screener
 * recall tests. Not part of the test suite (excluded from vitest's
 * `include` glob — only `*.test.ts`/`*.spec.ts` run) and not part of the
 * public API surface; kept committed for reproducibility/documentation of
 * how each fixture's swing geometry was derived.
 *
 * Run with: `npx tsx src/__tests__/domain/patterns/fixtures/generate.ts`
 *
 * The file-write loop only runs when this module is executed directly (see
 * the `require.main === module` guard at the bottom) — importing it (e.g.
 * from `fixtureDrift.test.ts`, which imports `fixtures` to diff against the
 * committed JSON) has no side effects.
 *
 * Builds each fixture as a sequence of linear price "segments" (nominal
 * control points) with small deterministic sinusoidal noise layered on top
 * — large enough swings (>= 2*atr) to confirm zigzag pivots, small enough
 * noise (well under the 1.5*atr reversal threshold) that it never creates
 * spurious pivots mid-segment. No `Math.random()` anywhere, so re-running
 * this script always reproduces byte-identical fixtures.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Bar } from '@/domain/types';

const OUT_DIR = join(__dirname);

interface Segment {
    /** Nominal close price this segment ramps to (linearly) from the previous segment's end. */
    to: number;
    /** Number of bars the ramp spans. */
    bars: number;
}

/**
 * Builds a deterministic OHLCV bar series from a start price and a list of
 * linear ramp segments, with small sinusoidal noise and a fixed high/low
 * spread layered on each bar's nominal close.
 */
function buildBars(
    start: number,
    segments: readonly Segment[],
    opts?: { noiseAmp?: number; spread?: number }
): Bar[] {
    const noiseAmp = opts?.noiseAmp ?? 0.15;
    const spread = opts?.spread ?? 0.12;

    const closes: number[] = [];
    let prev = start;
    for (const { to, bars } of segments) {
        for (let k = 1; k <= bars; k++) {
            const t = k / bars;
            closes.push(prev + (to - prev) * t);
        }
        prev = to;
    }

    return closes.map((nominalClose, i) => {
        const noise = noiseAmp * Math.sin(i * 1.3);
        const close = nominalClose + noise;
        const open =
            i === 0
                ? close
                : closes[i - 1] + noiseAmp * Math.sin((i - 1) * 1.3);
        return {
            time: i,
            open,
            high: close + spread,
            low: close - spread,
            close,
            volume: 1_000_000,
        };
    });
}

// ─── head_and_shoulders ─────────────────────────────────────────────────────
// Two early warmup swings (noise, not part of the pattern) followed by the
// textbook 5-pivot ladder: left shoulder 110, trough 104, head 116, trough
// 105, right shoulder 111 (within HS_SHOULDER_TOLERANCE of the head's
// height), then a dip past the reversal threshold to confirm the right
// shoulder, padded with a flat tail.
const hsTextbook = buildBars(100, [
    { to: 103, bars: 10 },
    { to: 96, bars: 8 },
    { to: 102, bars: 8 },
    { to: 97, bars: 8 },
    { to: 110, bars: 10 }, // left shoulder
    { to: 104, bars: 6 }, // trough 1
    { to: 116, bars: 10 }, // head
    { to: 105, bars: 8 }, // trough 2
    { to: 111, bars: 8 }, // right shoulder
    { to: 108.5, bars: 5 }, // confirm right shoulder
    { to: 108.5, bars: 10 }, // flat tail
]);

// ─── double_top ─────────────────────────────────────────────────────────────
// Warmup swings, then two closely-matched peaks (110, 110.5 — within
// EXTREME_MATCH_ATR_MULT) separated by a trough, dipping to confirm the
// second peak, padded with a flat tail.
const doubleTop = buildBars(100, [
    { to: 90, bars: 10 },
    { to: 100, bars: 8 },
    { to: 92, bars: 8 },
    { to: 110, bars: 10 }, // peak 1
    { to: 103, bars: 6 }, // trough
    { to: 110.5, bars: 8 }, // peak 2
    { to: 106, bars: 5 }, // confirm peak 2
    { to: 106, bars: 10 }, // flat tail
]);

// ─── ascending_triangle ─────────────────────────────────────────────────────
// Flat resistance (~120) touched 3x, rising support (100 -> 106 -> 111 ->
// 115). classifyTrendlinePatterns fits the last TRENDLINE_PIVOT_WINDOW
// pivots: highs near-flat, lows rising.
const ascendingTriangle = buildBars(100, [
    { to: 94, bars: 8 },
    { to: 101, bars: 6 },
    { to: 100, bars: 6 }, // low 1 (~100)
    { to: 120, bars: 10 }, // high 1 (resistance)
    { to: 106, bars: 8 }, // low 2 (rising)
    { to: 120.3, bars: 8 }, // high 2 (resistance)
    { to: 111, bars: 8 }, // low 3 (rising)
    { to: 119.8, bars: 8 }, // high 3 (resistance)
    { to: 115, bars: 6 }, // low 4 (rising, provisional)
]);

// ─── bull_flag ───────────────────────────────────────────────────────────────
// A sharp pole rally (100 -> 118, well over FLAG_POLE_MIN_ATR) immediately
// followed by a tight sideways consolidation channel. The consolidation
// needs >= TRENDLINE_PIVOT_WINDOW (8) of its OWN pivots — buildFlagContext
// takes the last 8 pivots verbatim as the consolidation window, so if the
// pole's own peak (or anything before it) were still among the last 8, the
// inferred "consolidation" would stretch all the way back through the pole
// and blow past FLAG_CONSOLIDATION_MAX_BARS. 9 oscillation legs guarantee
// the last 8 pivots are entirely post-pole.
const bullFlagConsolidationLegs: Segment[] = [];
for (let i = 0; i < 9; i++) {
    bullFlagConsolidationLegs.push(
        i % 2 === 0 ? { to: 116.4, bars: 4 } : { to: 118, bars: 4 }
    );
}
const bullFlag = buildBars(100, [
    { to: 96, bars: 8 },
    { to: 101, bars: 6 },
    { to: 100, bars: 6 },
    { to: 118, bars: 14 }, // pole
    ...bullFlagConsolidationLegs,
]);

// ─── cup_and_handle ──────────────────────────────────────────────────────────
// A rounded cup (convex quadratic fit through 4 low pivots: 96 -> 91 -> 87
// (vertex) -> 90) traced entirely by LOW pivots per classifyCurvaturePatterns
// (highs in between are just the alternating zigzag bounces, not part of the
// fit), then a shallow pullback (handle, 88) below the cup's last/right-edge
// low (90) — shallow relative to the cup's own depth (9), so it reads as a
// handle rather than a fresh breakdown.
const cupAndHandle = buildBars(100, [
    { to: 100, bars: 8 }, // lead-in noise (no net move, no spurious pivot)
    { to: 96, bars: 8 }, // cup low 1
    { to: 99, bars: 5 },
    { to: 91, bars: 7 }, // cup low 2
    { to: 95, bars: 5 },
    { to: 87, bars: 7 }, // cup low 3 (vertex)
    { to: 93, bars: 5 },
    { to: 90, bars: 6 }, // cup low 4 (right edge, near-rim recovery)
    { to: 94, bars: 5 },
    { to: 88, bars: 5 }, // handle low
    { to: 88, bars: 10 }, // flat tail
]);

export interface Fixture {
    file: string;
    atr: number;
    bars: Bar[];
}

export const fixtures: Fixture[] = [
    { file: 'hs-textbook.json', atr: 1, bars: hsTextbook },
    { file: 'double-top.json', atr: 1, bars: doubleTop },
    { file: 'ascending-triangle.json', atr: 1, bars: ascendingTriangle },
    { file: 'bull-flag.json', atr: 1, bars: bullFlag },
    { file: 'cup-and-handle.json', atr: 1, bars: cupAndHandle },
];

// Only write fixtures to disk when this file is executed directly (`npx tsx
// .../generate.ts`), not when imported — `fixtureDrift.test.ts` imports
// `fixtures` above to diff against the committed JSON, and importing it must
// be side-effect-free for that to be a meaningful drift check.
if (require.main === module) {
    for (const { file, atr, bars } of fixtures) {
        const path = join(OUT_DIR, file);
        writeFileSync(path, JSON.stringify({ atr, bars }, null, 4) + '\n');
        console.log(`wrote ${path} (${bars.length} bars)`);
    }
}
