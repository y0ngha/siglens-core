import { describe, it, expect } from 'vitest';
import {
    computeRiskLevel,
    RISK_HIGH_MIN_SCORE,
    RISK_MEDIUM_MIN_SCORE,
    scoreRisk,
} from '@/domain/analysis/riskLevel';
import type { Bar, MarketEvent } from '@/domain/types';

const DAY = 86_400;
const START = 1_700_006_400;

/** Rising bars with a fixed high-low range as a fraction of close. */
function series(count: number, rangePct: number, drift = 0.1): Bar[] {
    return Array.from({ length: count }, (_, i) => {
        const close = 100 + i * drift;
        const half = (close * rangePct) / 200;
        return {
            time: START + i * DAY,
            open: close,
            high: close + half,
            low: close - half,
            close,
            volume: 1000,
        };
    });
}

/**
 * 200 bars at 50, then 60 bars falling linearly from 100 to `end` — well above
 * MA200 so only the drawdown (and `rangePct` volatility) can score.
 */
function withDrawdown(end: number, rangePct = 0.2): Bar[] {
    const closes = [
        ...Array.from({ length: 200 }, () => 50),
        ...Array.from({ length: 60 }, (_, i) => 100 - ((100 - end) * i) / 59),
    ];
    return closes.map((close, i) => {
        const half = (close * rangePct) / 200;
        return {
            time: START + i * DAY,
            open: close,
            high: close + half,
            low: close - half,
            close,
            volume: 1000,
        };
    });
}

describe('computeRiskLevel', () => {
    it('is low for a calm uptrend', () => {
        expect(
            computeRiskLevel({ bars: series(260, 1), timeframe: '1Day' })
        ).toBe('low');
    });

    it('volatility steps: ATR% 2.5 -> 1 point, 4 -> 2, 6 -> 3', () => {
        expect(scoreRisk({ bars: series(260, 2.6), timeframe: '1Day' })).toBe(
            1
        );
        expect(scoreRisk({ bars: series(260, 4.1), timeframe: '1Day' })).toBe(
            2
        );
        expect(scoreRisk({ bars: series(260, 6.2), timeframe: '1Day' })).toBe(
            3
        );
    });

    it('score boundaries map to low / medium / high', () => {
        const at = (n: number) => {
            // Build the score from the volatility steps alone.
            const range = [0, 2.6, 4.1, 6.2][n]!;
            return computeRiskLevel({
                bars: series(260, range),
                timeframe: '1Day',
            });
        };
        expect(RISK_MEDIUM_MIN_SCORE).toBe(2);
        expect(RISK_HIGH_MIN_SCORE).toBe(5);
        expect(at(1)).toBe('low');
        expect(at(2)).toBe('medium');
        expect(at(3)).toBe('medium');
        // 3 volatility points + a 20% drawdown (2) reaches high.
        expect(
            computeRiskLevel({
                bars: withDrawdown(79, 6.2),
                timeframe: '1Day',
            })
        ).toBe('high');
    });

    it('a close under MA200 adds risk', () => {
        const falling = series(260, 1, -0.1);
        expect(
            scoreRisk({ bars: falling, timeframe: '1Day' })
        ).toBeGreaterThanOrEqual(1);
    });

    it('ignores the MA200 and event components off the daily chart', () => {
        expect(
            scoreRisk({ bars: series(260, 0.3, -0.1), timeframe: '1Hour' })
        ).toBe(0);
    });

    describe('company events', () => {
        const bars = series(260, 1);
        const lastMs = bars.at(-1)!.time * 1000;
        const lastDay = new Date(lastMs).toISOString().slice(0, 10);
        const event = (over: Partial<MarketEvent> = {}): MarketEvent => ({
            publishedAt: new Date(lastMs + 3_600_000),
            category: 'earnings',
            sentiment: 'bearish',
            impact: 'high',
            ...over,
        });

        it('a real report date adds 2 points; themed earnings news does not', () => {
            expect(
                scoreRisk({
                    bars,
                    timeframe: '1Day',
                    events: [event()],
                    earningsDates: [lastDay],
                })
            ).toBe(2);
            expect(
                scoreRisk({
                    bars,
                    timeframe: '1Day',
                    events: [event()],
                    earningsDates: ['2020-01-01'],
                })
            ).toBe(0);
        });

        it('high-impact guidance counts regardless of dates', () => {
            expect(
                scoreRisk({
                    bars,
                    timeframe: '1Day',
                    events: [event({ category: 'guidance' })],
                    earningsDates: [],
                })
            ).toBe(2);
        });
    });

    describe('drawdown from the 60-bar high close', () => {
        const dd = (end: number) =>
            scoreRisk({ bars: withDrawdown(end), timeframe: '1Day' });

        it('<10% adds 0, >=10% adds 1, >=20% adds 2', () => {
            expect(dd(95)).toBe(0);
            expect(dd(89.5)).toBe(1);
            expect(dd(79)).toBe(2);
        });

        it('is skipped on intraday charts', () => {
            expect(
                scoreRisk({ bars: withDrawdown(79), timeframe: '1Hour' })
            ).toBe(0);
        });
    });

    it('does not read the model stop: the inputs have no such field', () => {
        const input = { bars: series(260, 4.1), timeframe: '1Day' as const };
        // Extra, model-authored data cannot change the level.
        expect(computeRiskLevel({ ...input, stopLoss: 1 } as never)).toBe(
            computeRiskLevel(input)
        );
    });

    it('is deterministic: identical inputs give the same level', () => {
        const input = { bars: series(260, 4.1), timeframe: '1Day' as const };
        expect(computeRiskLevel(input)).toBe(computeRiskLevel({ ...input }));
    });

    it('returns low for empty bars', () => {
        expect(computeRiskLevel({ bars: [], timeframe: '1Day' })).toBe('low');
    });
});
