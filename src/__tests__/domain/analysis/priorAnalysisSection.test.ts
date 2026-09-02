import { describe, it, expect } from 'vitest';
import {
    PRIOR_ANALYSIS_GUARDRAIL,
    formatPriorAnalysisSection,
} from '@/domain/analysis/priorAnalysisSection';
import type { PriorAnalysis } from '@/domain/analysis/priorAnalysis';
import type { Bar } from '@/domain/types';

/** Bars sorted oldest-first, `intervalSeconds` apart, starting at `startTime` (Unix seconds). */
function makeBars(
    count: number,
    startTime = 1_700_000_000,
    intervalSeconds = 86_400 // 1 day apart, so dates in assertions are readable
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

describe('formatPriorAnalysisSection', () => {
    it('returns "" when selected is empty', () => {
        const bars = makeBars(10);
        expect(formatPriorAnalysisSection([], bars, 'AAPL', '1Day')).toBe('');
    });

    it('returns "" when bars is empty, regardless of selected', () => {
        const selected = [analysis(new Date('2024-01-01T00:00:00Z'))];
        expect(formatPriorAnalysisSection(selected, [], 'AAPL', '1Day')).toBe(
            ''
        );
    });

    it('renders the header with symbol and timeframe label', () => {
        const bars = makeBars(10);
        const entry = analysis(new Date(bars[5].time * 1000));

        const result = formatPriorAnalysisSection(
            [entry],
            bars,
            'AAPL',
            '1Day'
        );

        expect(result).toContain(
            '## Prior Analyses (AAPL · Daily · reference only)'
        );
    });

    it('renders bars-ago count relative to the last bar', () => {
        const bars = makeBars(10); // last index 9
        const entry = analysis(new Date(bars[5].time * 1000)); // anchor index 5

        const result = formatPriorAnalysisSection(
            [entry],
            bars,
            'AAPL',
            '1Day'
        );

        // 9 - 5 = 4 bars ago
        expect(result).toContain('- 4 bars ago');
    });

    it('renders full entry/TP/SL plan, stop breached, first target reached', () => {
        const bars = makeBars(10);
        // Anchor at index 3, close = 100 (reference price).
        // Subsequent bars (index 4..9) all have high 101 / low 99 by default;
        // override one bar to breach the stop and one to reach the target.
        bars[6] = { ...bars[6], low: 90 }; // breaches stopLoss 95
        bars[7] = { ...bars[7], high: 111 }; // reaches first TP 110
        bars[9] = { ...bars[9], close: 105 }; // "now"

        const entry = analysis(new Date(bars[3].time * 1000), {
            entryPrices: [100, 105],
            stopLoss: 95,
            takeProfitPrices: [110, 120],
        });

        const result = formatPriorAnalysisSection(
            [entry],
            bars,
            'AAPL',
            '1Day'
        );

        expect(result).toContain('entry 100.00-105.00');
        expect(result).toContain('TP 110.00/120.00');
        expect(result).toContain('SL 95.00');
        expect(result).toContain('-> since:');
        expect(result).toContain('stop breached');
        expect(result).toContain('target reached');
        expect(result).not.toContain('target not reached');
        expect(result).toContain('high 111.00');
        expect(result).toContain('low 90.00');
        expect(result).toContain('now 105.00');
    });

    it('renders "no entry recommended" when entryPrices/stopLoss/takeProfitPrices are all absent', () => {
        const bars = makeBars(10);
        const entry = analysis(new Date(bars[3].time * 1000), {
            trend: 'neutral',
        });

        const result = formatPriorAnalysisSection(
            [entry],
            bars,
            'AAPL',
            '1Day'
        );

        expect(result).toContain('no entry recommended');
        // No stop/target wording should appear when no plan exists.
        expect(result).not.toContain('stop breached');
        expect(result).not.toContain('stop not breached');
        expect(result).not.toContain('target reached');
        expect(result).not.toContain('target not reached');
    });

    it('stop not breached and target not reached when price never crosses either', () => {
        const bars = makeBars(10); // all bars: high 101 / low 99 / close 100
        const entry = analysis(new Date(bars[3].time * 1000), {
            stopLoss: 50, // far below any bar low -> never breached
            takeProfitPrices: [200], // far above any bar high -> never reached
        });

        const result = formatPriorAnalysisSection(
            [entry],
            bars,
            'AAPL',
            '1Day'
        );

        expect(result).toContain('stop not breached');
        expect(result).toContain('target not reached');
    });

    it('omits the "-> since:" line when the analysis lands on the final bar', () => {
        const bars = makeBars(10);
        const entry = analysis(new Date(bars[9].time * 1000), {
            entryPrices: [100],
            stopLoss: 95,
            takeProfitPrices: [110],
        });

        const result = formatPriorAnalysisSection(
            [entry],
            bars,
            'AAPL',
            '1Day'
        );

        expect(result).not.toContain('-> since:');
        expect(result).toContain('0 bars ago');
    });

    it('renders percentage sign/direction correctly for gains and losses', () => {
        const bars = makeBars(10);
        bars[9] = { ...bars[9], high: 110, low: 90, close: 105 }; // vs reference 100
        const entry = analysis(new Date(bars[3].time * 1000));

        const result = formatPriorAnalysisSection(
            [entry],
            bars,
            'AAPL',
            '1Day'
        );

        expect(result).toContain('+10.00%'); // high vs reference
        expect(result).toContain('-10.00%'); // low vs reference
        expect(result).toContain('+5.00%'); // now vs reference
    });

    it('does not mix Bar.time (seconds) with generatedAt (milliseconds)', () => {
        // Bar.time is Unix SECONDS. If the anchor lookup compared bar.time
        // directly against generatedAt.getTime() (milliseconds) without the
        // *1000 conversion, a generatedAt of 1000 real seconds (1_000_000ms)
        // would be misread as far in the past relative to bar times expressed
        // in raw seconds, and the anchor would resolve to the wrong bar.
        const bars = makeBars(5, 1000, 1); // bars[0].time = 1000s, 1s apart
        const anchorMs = bars[3].time * 1000; // correct anchor: bar index 3

        const entry = analysis(new Date(anchorMs));

        const result = formatPriorAnalysisSection(
            [entry],
            bars,
            'AAPL',
            '1Day'
        );

        // last bar is index 4; anchor index 3 -> 1 bar ago
        expect(result).toContain('- 1 bars ago');
    });

    it('renders multiple entries newest-first as given, one line block per entry', () => {
        const bars = makeBars(30);
        const older = analysis(new Date(bars[5].time * 1000), {
            riskLevel: 'low',
        });
        const newer = analysis(new Date(bars[20].time * 1000), {
            riskLevel: 'high',
        });

        // selectPriorAnalyses returns newest-first; this renderer trusts caller order.
        const result = formatPriorAnalysisSection(
            [newer, older],
            bars,
            'AAPL',
            '1Day'
        );

        const newerPos = result.indexOf('high risk');
        const olderPos = result.indexOf('low risk');
        expect(newerPos).toBeGreaterThan(-1);
        expect(olderPos).toBeGreaterThan(-1);
        expect(newerPos).toBeLessThan(olderPos);
    });

    it('includes the guardrail text exactly once', () => {
        const bars = makeBars(10);
        const entry = analysis(new Date(bars[3].time * 1000));

        const result = formatPriorAnalysisSection(
            [entry],
            bars,
            'AAPL',
            '1Day'
        );

        const occurrences = result.split(PRIOR_ANALYSIS_GUARDRAIL).length - 1;
        expect(occurrences).toBe(1);
    });

    it('uses the timeframe label map for the header across timeframes', () => {
        const bars = makeBars(10);
        const entry = analysis(new Date(bars[3].time * 1000));

        const result = formatPriorAnalysisSection(
            [entry],
            bars,
            'TSLA',
            '5Min'
        );

        expect(result).toContain(
            '## Prior Analyses (TSLA · 5-Minute · reference only)'
        );
    });
});

describe('formatPriorAnalysisSection — non-finite consumer data', () => {
    // The consumer feeds these rows straight from its own database. A corrupt
    // numeric column must never reach the prompt: `NaN.toFixed(2)` is the
    // literal string 'NaN', and — worse — every comparison against NaN is
    // false, so an unguarded NaN stop renders a confident *wrong* verdict
    // ('stop not breached') rather than obvious garbage.

    it('omits the SL fragment when stopLoss is NaN', () => {
        const bars = makeBars(10);
        const entry = analysis(new Date(bars[5].time * 1000), {
            stopLoss: Number.NaN,
        });

        const result = formatPriorAnalysisSection(
            [entry],
            bars,
            'AAPL',
            '1Day'
        );

        expect(result).not.toContain('NaN');
        expect(result).not.toContain('SL ');
    });

    it('never claims "stop not breached" for a NaN stopLoss', () => {
        const bars = makeBars(10);
        const entry = analysis(new Date(bars[5].time * 1000), {
            stopLoss: Number.NaN,
        });

        const result = formatPriorAnalysisSection(
            [entry],
            bars,
            'AAPL',
            '1Day'
        );

        expect(result).not.toContain('stop not breached');
        expect(result).not.toContain('stop breached');
    });

    it('omits the TP fragment when every take-profit target is Infinity', () => {
        const bars = makeBars(10);
        const entry = analysis(new Date(bars[5].time * 1000), {
            takeProfitPrices: [Number.POSITIVE_INFINITY],
        });

        const result = formatPriorAnalysisSection(
            [entry],
            bars,
            'AAPL',
            '1Day'
        );

        expect(result).not.toContain('Infinity');
        expect(result).not.toContain('TP ');
        expect(result).not.toContain('target');
    });

    it('falls back to the first FINITE take-profit target when the leading one is corrupt', () => {
        const bars = makeBars(10);
        const entry = analysis(new Date(bars[5].time * 1000), {
            // bars all have high = 101, so a 50.00 target is reached.
            takeProfitPrices: [Number.NaN, 50],
        });

        const result = formatPriorAnalysisSection(
            [entry],
            bars,
            'AAPL',
            '1Day'
        );

        expect(result).not.toContain('NaN');
        expect(result).toContain('TP 50.00');
        expect(result).toContain('target reached');
    });

    it('drops non-finite entry prices instead of rendering a corrupt range', () => {
        const bars = makeBars(10);
        const entry = analysis(new Date(bars[5].time * 1000), {
            entryPrices: [Number.NaN, 180],
        });

        const result = formatPriorAnalysisSection(
            [entry],
            bars,
            'AAPL',
            '1Day'
        );

        expect(result).not.toContain('NaN');
        expect(result).toContain('entry 180.00');
    });

    it('renders "no entry recommended" when every plan value is non-finite', () => {
        const bars = makeBars(10);
        const entry = analysis(new Date(bars[5].time * 1000), {
            entryPrices: [Number.NaN],
            stopLoss: Number.NaN,
            takeProfitPrices: [Number.NaN],
        });

        const result = formatPriorAnalysisSection(
            [entry],
            bars,
            'AAPL',
            '1Day'
        );

        expect(result).not.toContain('NaN');
        expect(result).toContain('no entry recommended');
    });

    it('reports n/a rather than NaN%/Infinity% when the reference close is 0', () => {
        const bars = makeBars(10);
        // Zero out the anchor bar's close — the reference the outcome
        // percentages are measured from.
        const zeroed = bars.map((b, i) => (i === 5 ? { ...b, close: 0 } : b));
        const entry = analysis(new Date(zeroed[5].time * 1000));

        const result = formatPriorAnalysisSection(
            [entry],
            zeroed,
            'AAPL',
            '1Day'
        );

        expect(result).not.toContain('NaN');
        expect(result).not.toContain('Infinity');
        expect(result).toContain('n/a');
    });
    it('봉에서 나온 high가 NaN이면 since 줄을 통째로 생략한다 (헤더만 남긴다)', () => {
        // `bars` come from the injected MarketDataProvider, which core does not
        // control. Before this guard a single NaN high rendered
        // `-> since: high NaN (n/a), ...` straight into the prompt.
        const bars = makeBars(10);
        const corrupt = bars.map((b, i) =>
            i === 7 ? { ...b, high: Number.NaN } : b
        );
        const entry = analysis(new Date(corrupt[5].time * 1000));

        const result = formatPriorAnalysisSection(
            [entry],
            corrupt,
            'AAPL',
            '1Day'
        );

        expect(result).not.toContain('NaN');
        expect(result).not.toContain('-> since:');
        expect(result).toContain('bars ago');
    });

    it('마지막 봉 close가 Infinity면 since 줄을 생략한다', () => {
        const bars = makeBars(10);
        const corrupt = bars.map((b, i) =>
            i === bars.length - 1
                ? { ...b, close: Number.POSITIVE_INFINITY }
                : b
        );
        const entry = analysis(new Date(corrupt[5].time * 1000));

        const result = formatPriorAnalysisSection(
            [entry],
            corrupt,
            'AAPL',
            '1Day'
        );

        expect(result).not.toContain('Infinity');
        expect(result).not.toContain('-> since:');
    });
});
