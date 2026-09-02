import { describe, it, expect } from 'vitest';
import {
    PRIOR_ANALYSIS_LIMIT,
    PRIOR_ANALYSIS_SLACK,
    selectPriorAnalyses,
    type PriorAnalysis,
} from '@/domain/analysis/priorAnalysis';
import type { Bar } from '@/domain/types';

const WINDOW_BARS = PRIOR_ANALYSIS_LIMIT * PRIOR_ANALYSIS_SLACK; // 21

/** Bars sorted oldest-first, `intervalSeconds` apart, starting at `startTime` (Unix seconds). */
function makeBars(
    count: number,
    startTime = 1_700_000_000,
    intervalSeconds = 300
): Bar[] {
    return Array.from({ length: count }, (_, i) => ({
        time: startTime + i * intervalSeconds,
        open: 100,
        high: 101,
        low: 99,
        close: 100,
        volume: 1000,
    }));
}

function analysis(
    generatedAt: Date,
    overrides: Partial<PriorAnalysis> = {}
): PriorAnalysis {
    return {
        generatedAt,
        trend: 'bullish',
        riskLevel: 'medium',
        ...overrides,
    };
}

describe('selectPriorAnalyses', () => {
    it('returns [] when bars is empty, regardless of candidates', () => {
        const result = selectPriorAnalyses(
            [analysis(new Date('2024-01-01T00:00:00Z'))],
            []
        );
        expect(result).toEqual([]);
    });

    it('returns [] when candidates is empty', () => {
        expect(selectPriorAnalyses([], makeBars(30))).toEqual([]);
    });

    it('21-bar anchor: keeps an entry exactly at the anchor bar, drops one bar older', () => {
        const bars = makeBars(25); // anchor = bars[25 - 21] = bars[4]
        const anchorTime = bars[4].time;
        const oneBarOlderTime = bars[3].time;

        const atAnchor = analysis(new Date(anchorTime * 1000));
        const oneBarOlder = analysis(new Date(oneBarOlderTime * 1000));

        const result = selectPriorAnalyses([atAnchor, oneBarOlder], bars);

        expect(result).toEqual([atAnchor]);
    });

    it('short bars: falls back to bars[0] as the anchor when bars.length < windowBars', () => {
        const bars = makeBars(5); // 5 < 21, anchor = bars[0]
        const atFirstBar = analysis(new Date(bars[0].time * 1000));
        const beforeFirstBar = analysis(new Date((bars[0].time - 1) * 1000));

        const result = selectPriorAnalyses([atFirstBar, beforeFirstBar], bars);

        expect(result).toEqual([atFirstBar]);
    });

    it('dedups multiple rows landing on the same bar, keeping the newest', () => {
        const bars = makeBars(25);
        const bar = bars[10]; // well inside the window
        const oldest = analysis(new Date((bar.time + 10) * 1000), {
            riskLevel: 'low',
        });
        const middle = analysis(new Date((bar.time + 50) * 1000), {
            riskLevel: 'medium',
        });
        const newest = analysis(new Date((bar.time + 100) * 1000), {
            riskLevel: 'high',
        });

        const result = selectPriorAnalyses([oldest, newest, middle], bars);

        expect(result).toEqual([newest]);
    });

    it('tie-break: on an exact generatedAt tie, keeps whichever came first in the input array', () => {
        const bars = makeBars(25);
        const tieTime = new Date((bars[10].time + 10) * 1000);
        const first = analysis(tieTime, { riskLevel: 'low' });
        const second = analysis(tieTime, { riskLevel: 'high' });

        const result = selectPriorAnalyses([first, second], bars);

        expect(result).toEqual([first]);
    });

    it('does not use locale/model-like fields as a tiebreaker (order in the input array only)', () => {
        // Same generatedAt, same bar, differ only in a field other than generatedAt.
        // Reversing input order must flip which one survives — proving the pick is
        // driven purely by array position, not by any field value.
        const bars = makeBars(25);
        const tieTime = new Date((bars[10].time + 10) * 1000);
        const a = analysis(tieTime, { trend: 'bullish' });
        const b = analysis(tieTime, { trend: 'bearish' });

        expect(selectPriorAnalyses([a, b], bars)).toEqual([a]);
        expect(selectPriorAnalyses([b, a], bars)).toEqual([b]);
    });

    it('limits to PRIOR_ANALYSIS_LIMIT (7) entries', () => {
        const bars = makeBars(100); // anchor = bars[100 - 21] = bars[79]
        const candidates = Array.from({ length: 10 }, (_, i) =>
            analysis(new Date(bars[79 + i].time * 1000))
        );

        const result = selectPriorAnalyses(candidates, bars);

        expect(result).toHaveLength(PRIOR_ANALYSIS_LIMIT);
    });

    it('sorts results newest-first and keeps the newest 7 when more groups qualify', () => {
        const bars = makeBars(100);
        const candidates = Array.from({ length: 10 }, (_, i) =>
            analysis(new Date(bars[79 + i].time * 1000))
        );

        const result = selectPriorAnalyses(candidates, bars);

        const expectedTimes = candidates
            .slice(3) // drop the 3 oldest groups (indices 0-2), keep newest 7
            .map(a => a.generatedAt.getTime())
            .toSorted((a, b) => b - a);
        expect(result.map(a => a.generatedAt.getTime())).toEqual(expectedTimes);
    });

    it('does not mix Bar.time (seconds) with generatedAt.getTime() (milliseconds)', () => {
        // Bar.time is Unix SECONDS; PriorAnalysis.generatedAt is a Date (millisecond epoch).
        // Using bars[0].time directly as a millisecond cutoff — without the *1000
        // conversion — silently shifts the anchor 1000x earlier, so an entry that should
        // be dropped (999_999ms before the real anchor) reads as "kept" under the bug.
        const bars = makeBars(WINDOW_BARS, 1000, 1); // bars[0].time = 1000 (seconds)
        const anchorMs = bars[0].time * 1000; // correct anchor: 1_000_000 ms

        const justBeforeAnchor = analysis(new Date(anchorMs - 1)); // 999_999ms — must drop
        const atAnchor = analysis(new Date(anchorMs)); // exactly anchor — must keep

        const result = selectPriorAnalyses([justBeforeAnchor, atAnchor], bars);

        expect(result).toEqual([atAnchor]);
    });

    it('accepts optional entryPrices/stopLoss/takeProfitPrices fields', () => {
        const bars = makeBars(25);
        const withPlan = analysis(new Date(bars[10].time * 1000), {
            entryPrices: [100, 105],
            stopLoss: 95,
            takeProfitPrices: [110, 120],
        });

        const result = selectPriorAnalyses([withPlan], bars);

        expect(result).toEqual([withPlan]);
    });
});
