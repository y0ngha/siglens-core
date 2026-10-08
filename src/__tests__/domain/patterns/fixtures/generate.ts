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
// A textbook ascending triangle (spec 2026-10-07): flat resistance at 120
// touched three times, support rising through 100 -> 106 -> 111, then a
// pullback to 115 that confirms the third resistance touch and stays inside
// the triangle. The series opens with a decline into the first support low
// so that low is the first zigzag pivot (the seed extreme is never emitted)
// — no earlier high sits among the pre-screener's last 8 pivots to tilt its
// regression of the highs. Every structural point is a confirmed pivot, and
// the pattern is neither failed nor fulfilled at the last bar.
const ascendingTriangle = buildBars(108, [
    { to: 100, bars: 8 }, // support touch 1
    { to: 120, bars: 10 }, // resistance touch 1
    { to: 106, bars: 8 }, // support touch 2
    { to: 120, bars: 8 }, // resistance touch 2
    { to: 111, bars: 8 }, // support touch 3
    { to: 120, bars: 8 }, // resistance touch 3
    { to: 115, bars: 5 }, // pullback (confirms touch 3, stays inside)
    { to: 116, bars: 3 }, // tail
]);

// ─── bull_flag ───────────────────────────────────────────────────────────────
// A textbook bull flag (spec 2026-10-07): a confirmed swing low at 98, a
// 10-bar pole to 118 (20 ATR), then an 18-bar flag oscillating 116 <-> 118
// in a flat channel — nine 2-bar legs, so the flag's own swings are pivots
// the pre-screener's 8-pivot consolidation window can see (each leg clears
// PIVOT_REVERSAL_ATR_MULT). The flag is too short and too low for a
// rectangle or a double top/bottom to qualify alongside it. The earlier
// fixture's 36-bar sideways box after the pole was a rectangle, not a flag.
// Quieter noise than the other fixtures: on a 2-point channel the default
// ±0.15 wobble alone tilts the fitted edges into a pennant.
const bullFlagLegs: Segment[] = Array.from({ length: 9 }, (_, i) =>
    i % 2 === 0 ? { to: 116, bars: 2 } : { to: 118, bars: 2 }
);
const bullFlag = buildBars(
    100,
    [
        { to: 104, bars: 6 },
        { to: 98, bars: 6 }, // pole base (confirmed swing low)
        { to: 118, bars: 10 }, // pole
        ...bullFlagLegs,
    ],
    { noiseAmp: 0.02 }
);

// ─── cup_and_handle ──────────────────────────────────────────────────────────
// A textbook cup & handle (spec 2026-10-07 §3.6): rims at 120 and 119.5
// (confirmed swing highs 64 bars apart, within 5%), a rounded base whose
// swings bottom at 100 and spend a good share of the cup in its lower third
// (a U, not a V), then a 6-bar handle pulling back to 115 — in the cup's
// upper half — and recovering to 117. The base's intermediate swings are
// pivots, so the pre-screener's quadratic fit over the cup's low pivots
// still recalls it.
const cupAndHandle = buildBars(110, [
    { to: 120, bars: 10 }, // left rim
    { to: 112, bars: 8 },
    { to: 114, bars: 4 },
    { to: 104, bars: 8 },
    { to: 107, bars: 4 },
    { to: 100, bars: 8 }, // cup bottom
    { to: 104, bars: 6 },
    { to: 102, bars: 6 },
    { to: 110, bars: 8 },
    { to: 108, bars: 4 },
    { to: 119.5, bars: 8 }, // right rim
    { to: 115, bars: 6 }, // handle low
    { to: 118, bars: 4 },
    { to: 117, bars: 2 },
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
