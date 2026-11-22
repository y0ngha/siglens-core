import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchBarsWithIndicators } from '@/application/market/barsApi';
import { standardDailyWindow } from '@/domain/analysis/standardDailyWindow';
import {
    DEFAULT_TIMEFRAME,
    FEAR_GREED_LOOKBACK_DAYS,
    TIMEFRAME_BARS_LIMIT,
    TIMEFRAME_LOOKBACK_DAYS,
} from '@/domain/constants/market';
import {
    BOLLINGER_DEFAULT_PERIOD,
    DMI_DEFAULT_PERIOD,
    EMA_DEFAULT_PERIODS,
    MA_DEFAULT_PERIODS,
    MACD_SLOW_PERIOD,
    RSI_DEFAULT_PERIOD,
} from '@/domain/indicators/constants';
import type { MarketDataProvider } from '@/domain/ports/marketDataProvider';

const mockGetBars = vi.fn();
const fakeProvider: MarketDataProvider = {
    getBars: mockGetBars,
    getQuote: vi.fn().mockResolvedValue(null),
};

const mockBar = {
    time: 1705312200,
    open: 100,
    high: 105,
    low: 99,
    close: 103,
    volume: 1000000,
};

/**
 * `1Day` re-cuts the standard window from the fetched long history, so a test
 * bar must fall inside "now − TIMEFRAME_LOOKBACK_DAYS". Pin "now" to the day
 * after `mockBar` instead of the wall clock.
 */
const NEAR_MOCK_BAR = new Date((mockBar.time + 86_400) * 1000);

describe('fetchBarsWithIndicators 함수는', () => {
    beforeEach(() => {
        mockGetBars.mockReset();
    });

    describe('정상 응답일 때', () => {
        it('bars와 indicators를 포함한 BarsData를 반환한다', async () => {
            mockGetBars.mockResolvedValueOnce([mockBar]);

            const result = await fetchBarsWithIndicators(
                fakeProvider,
                'AAPL',
                DEFAULT_TIMEFRAME,
                undefined,
                NEAR_MOCK_BAR
            );

            expect(result.bars).toHaveLength(1);
            expect(result.bars[0]).toEqual(mockBar);
            expect(Array.isArray(result.indicators.rsi)).toBe(true);
            expect(Array.isArray(result.indicators.macd)).toBe(true);
            expect(Array.isArray(result.indicators.bollinger)).toBe(true);
            expect(Array.isArray(result.indicators.dmi)).toBe(true);
            expect(Array.isArray(result.indicators.vwap)).toBe(true);
            expect(typeof result.indicators.ma).toBe('object');
            expect(
                MA_DEFAULT_PERIODS.every(period =>
                    Object.prototype.hasOwnProperty.call(
                        result.indicators.ma,
                        String(period)
                    )
                )
            ).toBe(true);
            MA_DEFAULT_PERIODS.forEach(period => {
                expect(Array.isArray(result.indicators.ma[period])).toBe(true);
            });
            expect(typeof result.indicators.ema).toBe('object');
            expect(
                EMA_DEFAULT_PERIODS.every(period =>
                    Object.prototype.hasOwnProperty.call(
                        result.indicators.ema,
                        String(period)
                    )
                )
            ).toBe(true);
            EMA_DEFAULT_PERIODS.forEach(period => {
                expect(Array.isArray(result.indicators.ema[period])).toBe(true);
            });
        });

        it('bar가 1개일 때 기간 기반 인디케이터의 첫 번째 값은 null이다', async () => {
            mockGetBars.mockResolvedValueOnce([mockBar]);

            const result = await fetchBarsWithIndicators(
                fakeProvider,
                'AAPL',
                DEFAULT_TIMEFRAME,
                undefined,
                NEAR_MOCK_BAR
            );

            expect(result.indicators.rsi[0]).toBeNull();
            expect(result.indicators.macd[0].macd).toBeNull();
            expect(result.indicators.bollinger[0].upper).toBeNull();
            expect(result.indicators.dmi[0].diPlus).toBeNull();
            expect(
                MA_DEFAULT_PERIODS.every(
                    period => result.indicators.ma[period]?.[0] === null
                )
            ).toBe(true);
            expect(
                EMA_DEFAULT_PERIODS.every(
                    period => result.indicators.ema[period]?.[0] === null
                )
            ).toBe(true);
        });

        it('bars가 RSI_DEFAULT_PERIOD - 1개일 때 모든 rsi 값은 null이다', async () => {
            const shortBars = Array.from(
                { length: RSI_DEFAULT_PERIOD - 1 },
                (_, i) => ({ ...mockBar, time: mockBar.time + i * 60 })
            );
            mockGetBars.mockResolvedValueOnce(shortBars);

            const result = await fetchBarsWithIndicators(
                fakeProvider,
                'AAPL',
                DEFAULT_TIMEFRAME,
                undefined,
                NEAR_MOCK_BAR
            );

            expect(result.indicators.rsi.every(v => v === null)).toBe(true);
        });

        it('bars가 MACD_SLOW_PERIOD - 1개일 때 모든 macd.macd 값은 null이다', async () => {
            const shortBars = Array.from(
                { length: MACD_SLOW_PERIOD - 1 },
                (_, i) => ({ ...mockBar, time: mockBar.time + i * 60 })
            );
            mockGetBars.mockResolvedValueOnce(shortBars);

            const result = await fetchBarsWithIndicators(
                fakeProvider,
                'AAPL',
                DEFAULT_TIMEFRAME,
                undefined,
                NEAR_MOCK_BAR
            );

            expect(result.indicators.macd.every(v => v.macd === null)).toBe(
                true
            );
        });

        it('bars가 BOLLINGER_DEFAULT_PERIOD - 1개일 때 모든 bollinger.upper 값은 null이다', async () => {
            const shortBars = Array.from(
                { length: BOLLINGER_DEFAULT_PERIOD - 1 },
                (_, i) => ({ ...mockBar, time: mockBar.time + i * 60 })
            );
            mockGetBars.mockResolvedValueOnce(shortBars);

            const result = await fetchBarsWithIndicators(
                fakeProvider,
                'AAPL',
                DEFAULT_TIMEFRAME,
                undefined,
                NEAR_MOCK_BAR
            );

            expect(
                result.indicators.bollinger.every(v => v.upper === null)
            ).toBe(true);
        });

        it('bars가 DMI_DEFAULT_PERIOD - 1개일 때 모든 dmi.diPlus 값은 null이다', async () => {
            const shortBars = Array.from(
                { length: DMI_DEFAULT_PERIOD - 1 },
                (_, i) => ({ ...mockBar, time: mockBar.time + i * 60 })
            );
            mockGetBars.mockResolvedValueOnce(shortBars);

            const result = await fetchBarsWithIndicators(
                fakeProvider,
                'AAPL',
                DEFAULT_TIMEFRAME,
                undefined,
                NEAR_MOCK_BAR
            );

            expect(result.indicators.dmi.every(v => v.diPlus === null)).toBe(
                true
            );
        });

        it('symbol, timeframe, limit, from 파라미터를 getBars에 전달한다', async () => {
            mockGetBars.mockResolvedValueOnce([]);

            const fixedNow = new Date('2025-01-15T00:00:00.000Z');
            // `1Day` asks the provider once for the longer Fear & Greed window.
            const lookbackDays = FEAR_GREED_LOOKBACK_DAYS;
            const expectedFromDate = new Date(fixedNow);
            expectedFromDate.setUTCDate(
                expectedFromDate.getUTCDate() - lookbackDays
            );
            const expectedFrom =
                expectedFromDate.toISOString().substring(0, 10) + 'T00:00:00Z';

            await fetchBarsWithIndicators(
                fakeProvider,
                'TSLA',
                DEFAULT_TIMEFRAME,
                undefined,
                fixedNow
            );

            expect(mockGetBars).toHaveBeenCalledWith(
                expect.objectContaining({
                    symbol: 'TSLA',
                    timeframe: DEFAULT_TIMEFRAME,
                    limit: TIMEFRAME_BARS_LIMIT[DEFAULT_TIMEFRAME],
                    from: expectedFrom,
                })
            );
        });

        it('fmpSymbol이 주어지면 getBars에 fmpSymbol을 전달한다', async () => {
            mockGetBars.mockResolvedValueOnce([]);

            await fetchBarsWithIndicators(
                fakeProvider,
                'SPX',
                DEFAULT_TIMEFRAME,
                '^SPX',
                NEAR_MOCK_BAR
            );

            expect(mockGetBars).toHaveBeenCalledWith(
                expect.objectContaining({ symbol: '^SPX' })
            );
        });
    });

    describe('getBars가 에러를 던질 때', () => {
        it('에러를 전파한다', async () => {
            mockGetBars.mockRejectedValueOnce(
                new Error('Failed to fetch bars')
            );

            await expect(
                fetchBarsWithIndicators(
                    fakeProvider,
                    'AAPL',
                    DEFAULT_TIMEFRAME,
                    undefined,
                    NEAR_MOCK_BAR
                )
            ).rejects.toThrow('Failed to fetch bars');
        });
    });
});

describe('fetchBarsWithIndicators — bars without usable prices', () => {
    beforeEach(() => {
        mockGetBars.mockReset();
    });

    it('drops placeholder bars whose OHLC is zero or non-finite', async () => {
        // Yahoo KRX daily rows like `O:0 H:0 L:0 C:285000 V:0` made Period Low 0
        // and printed `Current vs Low: Infinity%` in the prompt.
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        mockGetBars.mockResolvedValueOnce([
            mockBar,
            { ...mockBar, time: mockBar.time + 60, open: 0, high: 0, low: 0 },
            { ...mockBar, time: mockBar.time + 120, high: Number.NaN },
            { ...mockBar, time: mockBar.time + 180 },
        ]);

        const result = await fetchBarsWithIndicators(
            fakeProvider,
            '005930.KS',
            DEFAULT_TIMEFRAME,
            undefined,
            NEAR_MOCK_BAR
        );

        expect(result.bars.map(b => b.time)).toEqual([
            mockBar.time,
            mockBar.time + 180,
        ]);
        expect(warn).toHaveBeenCalledWith(
            '[barsApi] dropped bars without usable OHLC prices',
            expect.objectContaining({ dropped: 2, kept: 2 })
        );
        warn.mockRestore();
    });

    it('does not warn when every bar is usable', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        mockGetBars.mockResolvedValueOnce([mockBar]);

        await fetchBarsWithIndicators(
            fakeProvider,
            'AAPL',
            DEFAULT_TIMEFRAME,
            undefined,
            NEAR_MOCK_BAR
        );

        expect(warn).not.toHaveBeenCalled();
        warn.mockRestore();
    });
});

describe('fetchBarsWithIndicators — every bar unusable', () => {
    beforeEach(() => {
        mockGetBars.mockReset();
    });

    it('returns empty bars and indicators without throwing', async () => {
        // OTC names came back with all-zero rows; the whole history can drop out.
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        mockGetBars.mockResolvedValueOnce([
            { ...mockBar, open: 0, high: 0, low: 0, close: 0 },
            {
                ...mockBar,
                time: mockBar.time + 60,
                open: 0,
                high: 0,
                low: 0,
                close: 0,
            },
        ]);

        const result = await fetchBarsWithIndicators(
            fakeProvider,
            'OTCX',
            DEFAULT_TIMEFRAME,
            undefined,
            NEAR_MOCK_BAR
        );

        expect(result.bars).toEqual([]);
        expect(result.indicators.rsi).toEqual([]);
        expect(warn).toHaveBeenCalledWith(
            '[barsApi] dropped bars without usable OHLC prices',
            expect.objectContaining({ dropped: 2, kept: 0 })
        );
        warn.mockRestore();
    });
});

/**
 * `1Day` fetches the longer Fear & Greed window once, but `bars`/`indicators`
 * must stay exactly the standard window — charts, indicators and analysis
 * prompts must not change. Only `fearGreedBars` carries the long history.
 */
describe('fetchBarsWithIndicators — 1Day Fear & Greed history', () => {
    const NOW = new Date('2026-10-05T00:00:00.000Z');
    const DAY_SEC = 86_400;
    const nowSec = NOW.getTime() / 1000;
    // One bar every 30 days across five years, oldest-first.
    const longHistory = Array.from({ length: 61 }, (_, i) => ({
        ...mockBar,
        time: nowSec - (60 - i) * 30 * DAY_SEC,
    }));
    const standardCutoffSec = (() => {
        const d = new Date(NOW);
        d.setUTCDate(d.getUTCDate() - TIMEFRAME_LOOKBACK_DAYS['1Day']);
        return (
            Date.parse(d.toISOString().substring(0, 10) + 'T00:00:00Z') / 1000
        );
    })();

    beforeEach(() => {
        mockGetBars.mockReset();
    });

    it('requests the provider once with the Fear & Greed window', async () => {
        mockGetBars.mockResolvedValueOnce(longHistory);

        await fetchBarsWithIndicators(
            fakeProvider,
            'NVDA',
            '1Day',
            undefined,
            NOW
        );

        expect(mockGetBars).toHaveBeenCalledTimes(1);
        const from = new Date(NOW);
        from.setUTCDate(from.getUTCDate() - FEAR_GREED_LOOKBACK_DAYS);
        expect(mockGetBars).toHaveBeenCalledWith(
            expect.objectContaining({
                from: from.toISOString().substring(0, 10) + 'T00:00:00Z',
            })
        );
    });

    it('keeps bars to the standard window and returns the full history as fearGreedBars', async () => {
        mockGetBars.mockResolvedValueOnce(longHistory);

        const result = await fetchBarsWithIndicators(
            fakeProvider,
            'NVDA',
            '1Day',
            undefined,
            NOW
        );

        const expectedBars = longHistory.filter(
            b => b.time >= standardCutoffSec
        );
        expect(result.bars).toEqual(expectedBars);
        expect(result.bars.length).toBeLessThan(longHistory.length);
        expect(result.fearGreedBars).toEqual(longHistory);
        expect(result.indicators.rsi).toHaveLength(expectedBars.length);
    });

    it('computes indicators on the standard window only — same as a standard fetch would', async () => {
        mockGetBars.mockResolvedValueOnce(longHistory);
        const standardOnly = longHistory.filter(
            b => b.time >= standardCutoffSec
        );
        mockGetBars.mockResolvedValueOnce(standardOnly);

        const withHistory = await fetchBarsWithIndicators(
            fakeProvider,
            'NVDA',
            '1Day',
            undefined,
            NOW
        );
        const fromStandard = await fetchBarsWithIndicators(
            fakeProvider,
            'NVDA',
            '1Day',
            undefined,
            NOW
        );

        expect(withHistory.indicators).toEqual(fromStandard.indicators);
    });

    it('keeps a bar exactly at the standard cutoff and drops one a second earlier', async () => {
        // The provider's `from` is inclusive, so the boundary-day bar was kept
        // before the long fetch existed — the re-cut must keep it too.
        const atCutoff = { ...mockBar, time: standardCutoffSec };
        const justBefore = { ...mockBar, time: standardCutoffSec - 1 };
        mockGetBars.mockResolvedValueOnce([justBefore, atCutoff]);

        const result = await fetchBarsWithIndicators(
            fakeProvider,
            'NVDA',
            '1Day',
            undefined,
            NOW
        );

        expect(result.bars).toEqual([atCutoff]);
        expect(result.fearGreedBars).toEqual([justBefore, atCutoff]);
    });

    it('does not attach fearGreedBars to intraday timeframes', async () => {
        mockGetBars.mockResolvedValueOnce([mockBar]);

        const result = await fetchBarsWithIndicators(
            fakeProvider,
            'NVDA',
            '1Hour',
            undefined,
            NEAR_MOCK_BAR
        );

        expect(result.fearGreedBars).toBeUndefined();
        expect(result.bars).toEqual([mockBar]);
    });
});

/**
 * `1Week` is built by core from the daily history the provider already serves for `1Day`,
 * so the provider is never asked for a weekly bar and no extra call is made.
 */
describe('fetchBarsWithIndicators — 1Week from daily bars', () => {
    const NOW = new Date('2026-10-08T00:00:00.000Z');
    const DAY_SEC = 86_400;
    const monday = Date.UTC(2026, 8, 28) / 1000; // 2026-09-28
    const day = (offset: number, close: number) => ({
        time: monday + offset * DAY_SEC,
        open: close - 1,
        high: close + 2,
        low: close - 3,
        close,
        volume: 100 + offset,
    });
    // Mon-Fri of the week of 2026-09-28, then Mon-Wed of the (unfinished) week of 2026-10-05.
    const daily = [
        ...[0, 1, 2, 3, 4].map(i => day(i, 100 + i)),
        ...[7, 8, 9].map(i => day(i, 110 + i)),
    ];

    beforeEach(() => {
        mockGetBars.mockReset();
    });

    it("asks the provider for '1Day' over the Fear & Greed window, once", async () => {
        mockGetBars.mockResolvedValueOnce(daily);

        await fetchBarsWithIndicators(
            fakeProvider,
            'AAPL',
            '1Week',
            'AAPL',
            NOW
        );

        expect(mockGetBars).toHaveBeenCalledTimes(1);
        const from = new Date(NOW);
        from.setUTCDate(from.getUTCDate() - FEAR_GREED_LOOKBACK_DAYS);
        expect(mockGetBars).toHaveBeenCalledWith(
            expect.objectContaining({
                symbol: 'AAPL',
                timeframe: '1Day',
                from: from.toISOString().substring(0, 10) + 'T00:00:00Z',
            })
        );
    });

    it('returns ISO-week bars, weekly indicators and the daily source as fearGreedBars', async () => {
        mockGetBars.mockResolvedValueOnce(daily);

        const result = await fetchBarsWithIndicators(
            fakeProvider,
            'AAPL',
            '1Week',
            undefined,
            NOW
        );

        expect(result.bars).toEqual([
            {
                time: monday,
                open: 99,
                high: 106,
                low: 97,
                close: 104,
                volume: 510,
            },
            {
                time: monday + 7 * DAY_SEC,
                open: 116,
                high: 121,
                low: 114,
                close: 119,
                volume: 324,
            },
        ]);
        expect(result.fearGreedBars).toEqual(daily);
        expect(result.indicators.rsi).toHaveLength(result.bars.length);
    });

    it('skips unusable daily bars before aggregating', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        mockGetBars.mockResolvedValueOnce([
            ...daily,
            { ...day(10, 130), open: 0, high: 0, low: 0 },
        ]);

        const result = await fetchBarsWithIndicators(
            fakeProvider,
            'AAPL',
            '1Week',
            undefined,
            NOW
        );

        expect(result.bars).toHaveLength(2);
        expect(result.bars[1]?.close).toBe(119);
        expect(result.fearGreedBars).toEqual(daily);
        warn.mockRestore();
    });

    it('warns once, with a count, when daily bars are not stamped at UTC midnight', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        mockGetBars.mockResolvedValueOnce(
            daily.map(bar => ({ ...bar, time: bar.time + 15 * 3_600 }))
        );

        await fetchBarsWithIndicators(
            fakeProvider,
            'AAPL',
            '1Week',
            undefined,
            NOW
        );

        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn).toHaveBeenCalledWith(
            '[barsApi] daily bar not at UTC midnight; weekly buckets may shift',
            { symbol: 'AAPL', count: daily.length }
        );
        warn.mockRestore();
    });

    it('does not warn when every daily bar sits at UTC midnight', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        mockGetBars.mockResolvedValueOnce(daily);

        await fetchBarsWithIndicators(
            fakeProvider,
            'AAPL',
            '1Week',
            undefined,
            NOW
        );

        expect(warn).not.toHaveBeenCalled();
        warn.mockRestore();
    });

    it("carries the same daily series a '1Day' fetch does, so the daily risk grade reads one history", async () => {
        const longDaily = Array.from({ length: 800 }, (_, i) => ({
            time: NOW.getTime() / 1000 - (799 - i) * DAY_SEC,
            open: 100 + (i % 7),
            high: 103 + (i % 7),
            low: 98 + (i % 7),
            close: 101 + (i % 7),
            volume: 1000 + i,
        }));
        mockGetBars.mockResolvedValue(longDaily);

        const weekly = await fetchBarsWithIndicators(
            fakeProvider,
            'AAPL',
            '1Week',
            undefined,
            NOW
        );
        const daily = await fetchBarsWithIndicators(
            fakeProvider,
            'AAPL',
            '1Day',
            undefined,
            NOW
        );

        expect(weekly.fearGreedBars).toEqual(daily.fearGreedBars);
        expect(standardDailyWindow(weekly.fearGreedBars ?? [], NOW)).toEqual(
            daily.bars
        );
    });

    it('returns no weekly bars for an empty provider reply', async () => {
        mockGetBars.mockResolvedValueOnce([]);

        const result = await fetchBarsWithIndicators(
            fakeProvider,
            'AAPL',
            '1Week',
            undefined,
            NOW
        );

        expect(result.bars).toEqual([]);
        expect(result.fearGreedBars).toEqual([]);
    });
});
