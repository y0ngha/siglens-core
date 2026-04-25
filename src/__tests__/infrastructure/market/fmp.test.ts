import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FmpProvider } from '@/infrastructure/market/fmp';

const mockFetch = vi.fn();

const makeDailyBar = (date: string, close = 150) => ({
    date,
    open: 148,
    high: 152,
    low: 147,
    close,
    volume: 1000000,
});

const makeIntradayBar = (date: string, close = 150) => ({
    date,
    open: 148,
    high: 152,
    low: 147,
    close,
    volume: 500000,
});

const makeQuote = (price = 155, timestamp = 1705312200) => [
    {
        price,
        open: 150,
        dayHigh: 160,
        dayLow: 149,
        volume: 2000000,
        timestamp,
        changePercentage: 3.33,
        name: 'Apple Inc.',
    },
];

describe('FmpProvider', () => {
    beforeEach(() => {
        vi.stubGlobal('fetch', mockFetch);
        mockFetch.mockReset();
        process.env.FMP_API_KEY = 'test-key';
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        delete process.env.FMP_API_KEY;
    });

    describe('constructor', () => {
        it('FMP_API_KEY가 없으면 에러를 던진다', () => {
            delete process.env.FMP_API_KEY;
            expect(() => new FmpProvider()).toThrow('FMP_API_KEY must be set');
        });

        it('FMP_API_KEY가 있으면 정상 생성된다', () => {
            expect(() => new FmpProvider()).not.toThrow();
        });
    });

    describe('getBars (intraday)', () => {
        it('5Min timeframe으로 인트라데이 bars를 반환한다', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => [makeIntradayBar('2024-01-15 09:30:00')],
            });

            const provider = new FmpProvider();
            const bars = await provider.getBars({
                symbol: 'AAPL',
                timeframe: '5Min',
            });

            expect(bars).toHaveLength(1);
            expect(bars[0].close).toBe(150);
        });

        it('인트라데이 응답이 배열이 아니면 빈 배열을 반환한다', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ error: 'invalid' }),
            });

            const provider = new FmpProvider();
            const bars = await provider.getBars({
                symbol: 'AAPL',
                timeframe: '5Min',
            });

            expect(bars).toEqual([]);
        });

        it('API 에러이면 에러를 던진다', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 401,
                statusText: 'Unauthorized',
            });

            const provider = new FmpProvider();
            await expect(
                provider.getBars({ symbol: 'AAPL', timeframe: '5Min' })
            ).rejects.toThrow('FMP API error: 401 Unauthorized');
        });

        it('from 파라미터를 전달하면 URL에 포함된다', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => [],
            });

            const provider = new FmpProvider();
            await provider.getBars({
                symbol: 'AAPL',
                timeframe: '5Min',
                from: '2024-01-01T00:00:00Z',
            });

            const url = mockFetch.mock.calls[0][0] as string;
            expect(url).toContain('from=2024-01-01');
        });

        it('before 파라미터를 전달하면 URL에 to로 포함된다', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => [],
            });

            const provider = new FmpProvider();
            await provider.getBars({
                symbol: 'AAPL',
                timeframe: '5Min',
                before: '2024-01-15T00:00:00Z',
            });

            const url = mockFetch.mock.calls[0][0] as string;
            expect(url).toContain('to=2024-01-15');
        });

        it('DST 적용 기간(summer)의 ET 시간을 UTC로 변환한다', async () => {
            // 2024-06-15 09:30:00 ET (EDT, UTC-4) → 2024-06-15 13:30:00 UTC
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => [makeIntradayBar('2024-06-15 09:30:00')],
            });

            const provider = new FmpProvider();
            const bars = await provider.getBars({
                symbol: 'AAPL',
                timeframe: '5Min',
            });

            // 2024-06-15 13:30:00 UTC in seconds
            const expectedTime = Date.UTC(2024, 5, 15, 13, 30, 0) / 1000;
            expect(bars[0].time).toBe(expectedTime);
        });

        it('DST 비적용 기간(winter)의 ET 시간을 UTC로 변환한다', async () => {
            // 2024-01-15 09:30:00 ET (EST, UTC-5) → 2024-01-15 14:30:00 UTC
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => [makeIntradayBar('2024-01-15 09:30:00')],
            });

            const provider = new FmpProvider();
            const bars = await provider.getBars({
                symbol: 'AAPL',
                timeframe: '5Min',
            });

            // 2024-01-15 14:30:00 UTC in seconds
            const expectedTime = Date.UTC(2024, 0, 15, 14, 30, 0) / 1000;
            expect(bars[0].time).toBe(expectedTime);
        });
    });

    describe('getBars (1Day)', () => {
        it('1Day timeframe으로 daily bars를 반환한다', async () => {
            mockFetch
                .mockResolvedValueOnce({
                    ok: true,
                    json: async () => [makeDailyBar('2024-01-14')],
                })
                .mockResolvedValueOnce({
                    ok: true,
                    json: async () => makeQuote(),
                });

            const provider = new FmpProvider();
            const bars = await provider.getBars({
                symbol: 'AAPL',
                timeframe: '1Day',
            });

            // EOD bar + today quote bar
            expect(bars.length).toBeGreaterThanOrEqual(1);
        });

        it('daily 응답이 배열이 아니면 빈 배열을 반환한다', async () => {
            mockFetch
                .mockResolvedValueOnce({
                    ok: true,
                    json: async () => ({ error: 'invalid' }),
                })
                .mockResolvedValueOnce({
                    ok: true,
                    json: async () => makeQuote(),
                });

            const provider = new FmpProvider();
            const bars = await provider.getBars({
                symbol: 'AAPL',
                timeframe: '1Day',
            });

            expect(bars).toEqual([]);
        });

        it('daily API 에러이면 에러를 던진다', async () => {
            mockFetch
                .mockResolvedValueOnce({
                    ok: false,
                    status: 403,
                    statusText: 'Forbidden',
                })
                .mockResolvedValueOnce({
                    ok: true,
                    json: async () => makeQuote(),
                });

            const provider = new FmpProvider();
            await expect(
                provider.getBars({ symbol: 'AAPL', timeframe: '1Day' })
            ).rejects.toThrow('FMP API error: 403 Forbidden');
        });

        it('before 파라미터가 있으면 today quote를 요청하지 않는다', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => [],
            });

            const provider = new FmpProvider();
            await provider.getBars({
                symbol: 'AAPL',
                timeframe: '1Day',
                before: '2024-01-01T00:00:00Z',
            });

            expect(mockFetch).toHaveBeenCalledTimes(1);
        });

        it('quote fetch 실패해도 EOD 데이터를 반환한다', async () => {
            const consoleSpy = vi
                .spyOn(console, 'warn')
                .mockImplementation(() => {});
            mockFetch
                .mockResolvedValueOnce({
                    ok: true,
                    json: async () => [makeDailyBar('2024-01-14')],
                })
                .mockRejectedValueOnce(new Error('network error'));

            const provider = new FmpProvider();
            const bars = await provider.getBars({
                symbol: 'AAPL',
                timeframe: '1Day',
            });

            expect(bars).toHaveLength(1);
            consoleSpy.mockRestore();
        });

        it('quote의 time이 마지막 EOD bar와 같으면 quote를 추가하지 않는다', async () => {
            // Today's quote timestamp — same date as EOD bar
            const todayTimestamp = Math.floor(
                new Date('2024-01-15T00:00:00').getTime() / 1000
            );
            mockFetch
                .mockResolvedValueOnce({
                    ok: true,
                    json: async () => [makeDailyBar('2024-01-15')],
                })
                .mockResolvedValueOnce({
                    ok: true,
                    json: async () => makeQuote(155, todayTimestamp),
                });

            const provider = new FmpProvider();
            const bars = await provider.getBars({
                symbol: 'AAPL',
                timeframe: '1Day',
            });

            expect(bars).toHaveLength(1);
        });
    });

    describe('getQuote', () => {
        it('정상 응답을 MarketQuote로 변환한다', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => makeQuote(),
            });

            const provider = new FmpProvider();
            const quote = await provider.getQuote('AAPL');

            expect(quote).toBeDefined();
            expect(quote!.symbol).toBe('AAPL');
            expect(quote!.price).toBe(155);
            expect(quote!.name).toBe('Apple Inc.');
        });

        it('API가 ok가 아니면 null을 반환한다', async () => {
            mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });

            const provider = new FmpProvider();
            const quote = await provider.getQuote('AAPL');

            expect(quote).toBeNull();
        });

        it('응답 배열이 비어있으면 null을 반환한다', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => [],
            });

            const provider = new FmpProvider();
            const quote = await provider.getQuote('AAPL');

            expect(quote).toBeNull();
        });

        it('fetch 에러이면 null을 반환한다 (graceful degradation)', async () => {
            const consoleSpy = vi
                .spyOn(console, 'warn')
                .mockImplementation(() => {});
            mockFetch.mockRejectedValueOnce(new Error('network error'));

            const provider = new FmpProvider();
            const quote = await provider.getQuote('AAPL');

            expect(quote).toBeNull();
            consoleSpy.mockRestore();
        });

        it('응답이 배열이 아니면 null을 반환한다', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ error: 'invalid' }),
            });

            const provider = new FmpProvider();
            const quote = await provider.getQuote('AAPL');

            expect(quote).toBeNull();
        });
    });
});
