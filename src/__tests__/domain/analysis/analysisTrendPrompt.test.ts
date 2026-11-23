import { describe, expect, it } from 'vitest';
import {
    ANALYSIS_TREND_MIN_BARS,
    computeAnalysisTrend,
} from '@/domain/analysis/analysisTrend';
import {
    DETERMINISTIC_METRICS_HEADER,
    formatDeterministicMetricsSection,
} from '@/domain/analysis/confluenceSection';
import { buildAnalysisPrompt } from '@/domain/analysis/prompt';
import { calculateIndicators } from '@/domain/indicators';
import {
    TREND_EMA_PERIOD,
    TREND_SLOPE_LOOKBACK,
} from '@/domain/signals/constants';
import { chartFixture } from '@/__tests__/domain/patterns/fixtures/chartFixture';
import bounceChart from '@/__tests__/fixtures/charts/trend-bounce-above-ema20.json';
import type {
    AnalysisTrendReading,
    Bar,
    HorizonReference,
    MarketReference,
} from '@/domain/types';

const EMPTY_HORIZON: HorizonReference = {
    window: { bars: 60, fromTime: 1_700_000_000, toTime: 1_700_108_000 },
    levels: { resistance: [], support: [] },
    structure: {
        priceVsMA60: 'above',
        priceVsMA200: 'above',
        emaStack: 'aligned_up',
        swingStructure: 'HH_HL',
        adx: 25,
        efficiencyRatio: 0.4,
        regime: 'trending',
    },
};

/** No reference levels: the risk:reward block reads "not measurable", which this file does not look at. */
const REFERENCE: MarketReference = {
    short: EMPTY_HORIZON,
    medium: EMPTY_HORIZON,
    long: EMPTY_HORIZON,
};

function risingBars(count: number): Bar[] {
    return Array.from({ length: count }, (_, i) => {
        const close = 100 + i * 1.5;
        return {
            time: 1_700_000_000 + i * 86_400,
            open: close - 0.5,
            high: close + 1,
            low: close - 1,
            close,
            volume: 1000,
        };
    });
}

function promptFor(bars: readonly Bar[]) {
    return buildAnalysisPrompt({
        symbol: 'AAPL',
        companyName: 'Apple Inc.',
        bars: [...bars],
        indicators: calculateIndicators([...bars]),
        skills: [],
        timeframe: '1Day',
    });
}

const bearishReading: AnalysisTrendReading = {
    trend: 'bearish',
    slopeAtr: -1.84,
    emaLast: 175.1,
    emaFrom: 182.4,
    close: 171.2,
};

describe('### Trend (computed) block', () => {
    const trendSection = (reading: AnalysisTrendReading | null, count = 120) =>
        formatDeterministicMetricsSection(
            risingBars(count),
            '1Day',
            REFERENCE,
            { dp: 2, krxTick: null },
            [],
            undefined,
            reading
        );

    it('prints the computed fact, its numbers and the rule', () => {
        expect(trendSection(bearishReading)).toContain(
            [
                '### Trend (computed)',
                'Trend: bearish. EMA20 moved -1.84 ATR(14) over the last 20 bars (from 182.40 to 175.10) and the close 171.20 is below EMA20.',
                `Rule: bullish when EMA20 rose by at least 1 ATR(14) over the last 20 bars and the close is above EMA20; bearish when it fell by at least 1 ATR(14) and the close is below EMA20; otherwise neutral. Copy this value into the top-level "trend" field and state this trend in summary, in the response language's own word for it (do not print the English label there). A longer-term picture that differs (for example a close under MA200) is context for the prose, not a different trend.`,
            ].join('\n')
        );
    });

    it('is the first block under the section header and its note', () => {
        const lines = trendSection(bearishReading).split('\n');
        expect(lines[0]).toBe(DETERMINISTIC_METRICS_HEADER);
        expect(lines.indexOf('### Trend (computed)')).toBe(2);
    });

    it('signs a rising slope and words a close above EMA20', () => {
        expect(
            trendSection({
                trend: 'bullish',
                slopeAtr: 1.2,
                emaLast: 110,
                emaFrom: 100,
                close: 112,
            })
        ).toContain(
            'Trend: bullish. EMA20 moved +1.20 ATR(14) over the last 20 bars (from 100.00 to 110.00) and the close 112.00 is above EMA20.'
        );
    });

    it('words a close equal to EMA20 as "equal to"', () => {
        expect(
            trendSection({
                trend: 'neutral',
                slopeAtr: 1.5,
                emaLast: 110,
                emaFrom: 100,
                close: 110,
            })
        ).toContain('and the close 110.00 is equal to EMA20.');
    });

    it('quotes prices at the prompt precision and keeps the slope at 2 decimals', () => {
        expect(
            formatDeterministicMetricsSection(
                risingBars(120),
                '1Day',
                REFERENCE,
                { dp: 4, krxTick: null },
                [],
                undefined,
                {
                    trend: 'neutral',
                    slopeAtr: 0.5,
                    emaLast: 1.23456,
                    emaFrom: 1.2,
                    close: 1.3,
                }
            )
        ).toContain(
            'Trend: neutral. EMA20 moved +0.50 ATR(14) over the last 20 bars (from 1.2000 to 1.2346) and the close 1.3000 is above EMA20.'
        );
    });

    it('says "not measurable" and hands the judgement back when there is no reading', () => {
        const text = trendSection(null, 15);
        expect(text).toContain(
            [
                '### Trend (computed)',
                'Not measurable: the rule needs at least 40 bars (EMA20 20 bars back), a positive ATR(14) and a positive close; received 15 bars. Judge the top-level trend yourself.',
            ].join('\n')
        );
        expect(text).not.toContain('Trend: ');
    });

    it('names the minimum from the constants, not the lookback alone', () => {
        expect(trendSection(null, 30)).toContain(
            `needs at least ${ANALYSIS_TREND_MIN_BARS} bars`
        );
    });

    it("asks for the response language's own word, so a Korean summary does not echo the English label", () => {
        expect(trendSection(bearishReading)).toContain(
            "state this trend in summary, in the response language's own word for it (do not print the English label there)."
        );
    });

    it('prints on every timeframe (no measured claim, so no daily-only gate)', () => {
        expect(
            formatDeterministicMetricsSection(
                risingBars(120),
                '15Min',
                REFERENCE,
                { dp: 2, krxTick: null },
                [],
                undefined,
                bearishReading
            )
        ).toContain('Trend: bearish.');
    });
});

describe('buildAnalysisPrompt trend', () => {
    it('returns the reading it printed, from one computation', () => {
        const bars = risingBars(120);
        const { dynamic, trend } = promptFor(bars);
        expect(trend).toEqual(
            computeAnalysisTrend(bars, calculateIndicators(bars))
        );
        expect(trend?.trend).toBe('bullish');
        expect(dynamic).toContain(
            '### Trend (computed)\nTrend: bullish. EMA20 moved +'
        );
    });

    it('the printed slope is the value the label was decided on (recompute from the text)', () => {
        const { dynamic, trend } = promptFor(risingBars(120));
        const printed = /EMA20 moved ([+-]\d+\.\d{2}) ATR\(14\)/.exec(dynamic);
        expect(Number(printed?.[1])).toBe(trend?.slopeAtr);
    });

    it.each([
        [TREND_SLOPE_LOOKBACK],
        // More than the lookback, yet EMA20 has no value 20 bars back: the old text said 21 sufficed.
        [30],
        [ANALYSIS_TREND_MIN_BARS - 1],
    ])(
        'with %i bars returns null and prints the not-measurable block',
        count => {
            const { dynamic, trend } = promptFor(risingBars(count));
            expect(trend).toBeNull();
            expect(dynamic).toContain(
                `Not measurable: the rule needs at least ${ANALYSIS_TREND_MIN_BARS} bars (EMA${TREND_EMA_PERIOD} ${TREND_SLOPE_LOOKBACK} bars back), a positive ATR(14) and a positive close; received ${count} bars.`
            );
        }
    );

    it('with exactly the minimum bars is measured and prints the trend, not the not-measurable text', () => {
        const { dynamic, trend } = promptFor(
            risingBars(ANALYSIS_TREND_MIN_BARS)
        );
        expect(trend).not.toBeNull();
        expect(dynamic).toContain('Trend: bullish.');
        expect(dynamic).not.toContain('### Trend (computed)\nNot measurable');
    });

    it('the Summary Writing Checklist asks the model to state the computed trend', () => {
        const { stable, dynamic } = promptFor(risingBars(120));
        expect(`${stable}\n${dynamic}`).toContain(
            'STATE the overall trend direction and strength in plain language. When ## Deterministic Metrics gives a `### Trend (computed)` value, state that trend.'
        );
    });
});

describe('a real chart: a bounce just above EMA20 inside a decline', () => {
    // Anonymized (prices scaled, times shifted) daily chart of a replay-set case on which the
    // model's own `trend` was "bearish". EMA20 fell 1.20 ATR over the 20 bars, but the close
    // sits above EMA20, so the rule does not call a downtrend: the close has to be beyond
    // EMA20 as well.
    const { bars } = chartFixture(bounceChart);
    const reading = computeAnalysisTrend(bars, calculateIndicators(bars));

    it('reads neutral, with the slope past -1 ATR and the close above EMA20', () => {
        expect(reading).not.toBeNull();
        expect(reading?.trend).toBe('neutral');
        expect(reading?.slopeAtr).toBeLessThanOrEqual(-1);
        expect(reading?.close).toBeGreaterThan(reading?.emaLast ?? Infinity);
    });

    it('states that neutral trend in the prompt', () => {
        const { dynamic } = promptFor(bars);
        expect(dynamic).toContain('Trend: neutral. EMA20 moved -1.20 ATR(14)');
        expect(dynamic).toContain('is above EMA20.');
    });
});
