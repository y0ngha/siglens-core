/**
 * Deterministic fixture generator for the A/B prompt-quality harness. Produces the 6 technical (`tech-*.json`) fixtures consumed by
 * `buildPrompts.ts`. Modeled directly on
 * `src/__tests__/domain/patterns/fixtures/generate.ts`: linear-ramp/
 * oscillation "segments" with small deterministic sinusoidal noise layered
 * on top — NO `Math.random()` anywhere, so re-running this script always
 * reproduces byte-identical fixtures (frozen, reviewable-diff fixtures).
 *
 * News fixtures (`news-*.json`) are hand-authored prose and are NOT
 * generated here — see `news-earnings.json` / `news-macro.json` directly.
 *
 * Run with: `npx tsx scripts/ab-harness/fixtures/generate.ts`
 *
 * The file-write loop only runs when this module is executed directly (see
 * the `require.main === module` guard at the bottom — `import.meta.main` is
 * NOT reliably set under `tsx`, so this repo's existing fixture generators
 * use the CJS-compatible check instead; see
 * `src/__tests__/domain/patterns/fixtures/generate.ts`) — nothing else in
 * the harness imports this module, so there is no accidental side-effect
 * import path.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Bar, Timeframe } from '@/domain/types';

const OUT_DIR = __dirname;
const DAY_SECONDS = 86_400;
// Fixed anchor end-timestamp (2026-06-29T00:00:00Z) so every fixture's bar
// `time` values are byte-identical on every regeneration — arbitrary, not
// tied to "today".
const END_TIME = Date.UTC(2026, 5, 29, 0, 0, 0) / 1000;

interface Segment {
    /** Nominal close price this segment ramps to (linearly) from the previous segment's end. */
    to: number;
    /** Number of bars the ramp spans. */
    bars: number;
}

interface BuildOptions {
    noiseAmp?: number;
    spread?: number;
    baseVolume?: number;
    volumeNoiseAmp?: number; // fraction of baseVolume
}

/** Expand a segment ladder into per-bar nominal (noise-free) close prices. */
function closesFromSegments(
    start: number,
    segments: readonly Segment[]
): number[] {
    const closes: number[] = [];
    let prev = start;
    for (const { to, bars } of segments) {
        for (let k = 1; k <= bars; k++) {
            const t = k / bars;
            closes.push(prev + (to - prev) * t);
        }
        prev = to;
    }
    return closes;
}

/** Superposed sine oscillation around `center` — used for range/whipsaw fixtures instead of a segment ladder. */
function closesFromOscillation(
    center: number,
    waves: readonly { amplitude: number; cycles: number; phase?: number }[],
    totalBars: number
): number[] {
    return Array.from({ length: totalBars }, (_, i) => {
        const t = i / totalBars;
        return (
            center +
            waves.reduce(
                (sum, w) =>
                    sum +
                    w.amplitude *
                        Math.sin(t * w.cycles * 2 * Math.PI + (w.phase ?? 0)),
                0
            )
        );
    });
}

/** Build deterministic OHLCV bars from a nominal (noise-free) close-price series. */
function barsFromCloses(
    nominalCloses: readonly number[],
    opts: BuildOptions = {}
): Bar[] {
    const noiseAmp = opts.noiseAmp ?? 0.15;
    const spread = opts.spread ?? 0.12;
    const baseVolume = opts.baseVolume ?? 5_000_000;
    const volumeNoiseAmp = opts.volumeNoiseAmp ?? 0.25;

    const total = nominalCloses.length;
    const startTime = END_TIME - (total - 1) * DAY_SECONDS;
    const noiseAt = (i: number) => noiseAmp * Math.sin(i * 1.3);

    return nominalCloses.map((nominalClose, i) => {
        const close = nominalClose + noiseAt(i);
        const prevNominal = i === 0 ? nominalCloses[0] : nominalCloses[i - 1];
        const open = i === 0 ? close : prevNominal + noiseAt(i - 1);
        const volume = Math.round(
            baseVolume * (1 + volumeNoiseAmp * Math.sin(i * 0.7 + 0.4))
        );
        return {
            time: startTime + i * DAY_SECONDS,
            open,
            high: Math.max(open, close) + spread,
            low: Math.min(open, close) - spread,
            close,
            volume: Math.max(volume, 1),
        };
    });
}

function barsFromSegments(
    start: number,
    segments: readonly Segment[],
    opts: BuildOptions = {}
): Bar[] {
    return barsFromCloses(closesFromSegments(start, segments), opts);
}

// ─── tech-trend: clean uptrend (AAPL) ───────────────────────────────────────
// Two shallow pullbacks break up an otherwise steady 150 -> 260 climb so it
// reads as a real chart rather than a straight line; net direction is
// unambiguous over the full 220-bar window.
const techTrendBars = barsFromSegments(150, [
    { to: 165, bars: 40 },
    { to: 158, bars: 15 },
    { to: 190, bars: 45 },
    { to: 180, bars: 15 },
    { to: 225, bars: 50 },
    { to: 210, bars: 15 },
    { to: 260, bars: 40 },
]);

// ─── tech-range: sideways chop (MSFT) ───────────────────────────────────────
// Pure oscillation around a fixed center — 5 full cycles over 210 bars, no
// net drift. `atr`-scale amplitude keeps it a genuine range, not a slow
// trend disguised as noise.
const techRangeBars = barsFromCloses(
    closesFromOscillation(105, [{ amplitude: 9, cycles: 5 }], 210),
    { noiseAmp: 0.3, spread: 0.2, baseVolume: 4_000_000 }
);

// ─── tech-highvol: whipsaw (TSLA) ───────────────────────────────────────────
// Two superposed sine waves at different frequencies/amplitudes produce
// large, irregular-looking swings (whipsaw) rather than a clean single-cycle
// range — amplitude is a large fraction of price, well beyond tech-range.
const techHighvolBars = barsFromCloses(
    closesFromOscillation(
        220,
        [
            { amplitude: 55, cycles: 4 },
            { amplitude: 22, cycles: 9, phase: 1.7 },
        ],
        210
    ),
    { noiseAmp: 1.2, spread: 1.0, baseVolume: 9_000_000, volumeNoiseAmp: 0.5 }
);

// ─── tech-lowliq: thin, low-volume drift (small-cap) ────────────────────────
// A near-flat, barely-drifting small-cap price with tiny noise/spread and a
// thin, mostly-flat volume series — the "nothing is happening, nobody is
// trading it" case.
const techLowliqBars = barsFromSegments(
    8.0,
    [
        { to: 8.4, bars: 60 },
        { to: 8.1, bars: 60 },
        { to: 8.6, bars: 50 },
        { to: 8.3, bars: 50 },
    ],
    { noiseAmp: 0.02, spread: 0.015, baseVolume: 45_000, volumeNoiseAmp: 0.15 }
);

// ─── tech-pattern-hs: head-and-shoulders near the end (NVDA) ────────────────
// 180 bars of warmup context (mild oscillating climb to ~140), then a
// textbook 5-pivot H&S ladder: left shoulder 158, trough 148, head 172,
// trough 149 (~neckline), right shoulder 159 (within tolerance of the left
// shoulder), confirmed by a break below the neckline into a flat tail.
const techPatternHsBars = barsFromSegments(100, [
    { to: 110, bars: 30 },
    { to: 102, bars: 20 },
    { to: 118, bars: 30 },
    { to: 108, bars: 20 },
    { to: 130, bars: 30 },
    { to: 122, bars: 20 },
    { to: 140, bars: 30 }, // end of warmup (~180 bars)
    { to: 150, bars: 8 }, // rally into left shoulder
    { to: 158, bars: 10 }, // left shoulder peak
    { to: 148, bars: 6 }, // trough 1 (neckline)
    { to: 172, bars: 10 }, // head peak
    { to: 149, bars: 8 }, // trough 2 (neckline, ~matches trough 1)
    { to: 159, bars: 8 }, // right shoulder peak (close to left shoulder)
    { to: 150, bars: 5 }, // break below neckline (confirmation)
    { to: 150, bars: 5 }, // flat tail
]);

// ─── tech-pattern-doubletop: double top near the end (AMD) ──────────────────
// 180 bars of warmup context (mild oscillating climb to ~100), then two
// closely-matched peaks (120, 120.5) separated by a trough, followed by a
// confirming break below the trough into a flat tail.
const techPatternDoubletopBars = barsFromSegments(80, [
    { to: 92, bars: 30 },
    { to: 85, bars: 20 },
    { to: 96, bars: 30 },
    { to: 88, bars: 20 },
    { to: 100, bars: 30 },
    { to: 94, bars: 20 },
    { to: 100, bars: 30 }, // end of warmup (~180 bars)
    { to: 120, bars: 10 }, // peak 1
    { to: 109, bars: 8 }, // trough
    { to: 120.5, bars: 10 }, // peak 2 (close to peak 1)
    { to: 105, bars: 8 }, // break below trough (confirmation)
    { to: 105, bars: 10 }, // flat tail
]);

interface TechnicalFixture {
    caseId: string;
    symbol: string;
    companyName: string;
    timeframe: Timeframe;
    bars: Bar[];
}

const TIMEFRAME: Timeframe = '1Day';

const fixtures: TechnicalFixture[] = [
    {
        caseId: 'tech-trend',
        symbol: 'AAPL',
        companyName: 'Apple Inc.',
        timeframe: TIMEFRAME,
        bars: techTrendBars,
    },
    {
        caseId: 'tech-range',
        symbol: 'MSFT',
        companyName: 'Microsoft Corporation',
        timeframe: TIMEFRAME,
        bars: techRangeBars,
    },
    {
        caseId: 'tech-highvol',
        symbol: 'TSLA',
        companyName: 'Tesla, Inc.',
        timeframe: TIMEFRAME,
        bars: techHighvolBars,
    },
    {
        caseId: 'tech-lowliq',
        symbol: 'GEVO',
        companyName: 'Gevo, Inc.',
        timeframe: TIMEFRAME,
        bars: techLowliqBars,
    },
    {
        caseId: 'tech-pattern-hs',
        symbol: 'NVDA',
        companyName: 'NVIDIA Corporation',
        timeframe: TIMEFRAME,
        bars: techPatternHsBars,
    },
    {
        caseId: 'tech-pattern-doubletop',
        symbol: 'AMD',
        companyName: 'Advanced Micro Devices, Inc.',
        timeframe: TIMEFRAME,
        bars: techPatternDoubletopBars,
    },
];

if (require.main === module) {
    for (const fixture of fixtures) {
        const file = `${fixture.caseId}.json`;
        const path = join(OUT_DIR, file);
        writeFileSync(path, JSON.stringify(fixture, null, 4) + '\n');
        console.log(`wrote ${path} (${fixture.bars.length} bars)`);
    }
}
