import type { Bar, Timeframe } from '@/domain/types';

/**
 * A chart fixture as stored under `fixtures/charts/`: one `[time, open,
 * high, low, close]` row per bar. Real charts are anonymized — prices scaled
 * by a fixed factor and times shifted by whole weeks to a 2001 origin (bar
 * spacing, weekday and session time kept) — which leaves every pattern rule
 * unchanged: each threshold is a share of ATR or of price.
 */
export interface ChartFixtureFile {
    timeframe: string;
    bars: number[][];
    /** Pinned ATR, for a fuzzed series the sweep ran at a fixed ATR. */
    atr?: number;
    /** Bar counts of the two consecutive replays an oscillation fixture compares. */
    nA?: number;
    nB?: number;
}

export interface ChartFixture {
    timeframe: Timeframe;
    bars: Bar[];
    atr?: number;
    nA?: number;
    nB?: number;
}

/** Rows → `Bar`s (volume is unused by the pattern code and stored as 0). */
export function chartFixture(file: ChartFixtureFile): ChartFixture {
    return {
        ...file,
        // The fixtures are written with the timeframes the sweep used.
        timeframe: file.timeframe as Timeframe,
        bars: file.bars.map(([time, open, high, low, close]) => ({
            time,
            open,
            high,
            low,
            close,
            volume: 0,
        })),
    };
}
