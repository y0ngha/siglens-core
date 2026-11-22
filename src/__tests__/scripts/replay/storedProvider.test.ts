import { describe, expect, it } from 'vitest';
import { createStoredProvider } from '../../../../scripts/replay/storedProvider';
import { tradingBars } from './replayFixtures';

const bars = tradingBars({ symbol: 'NVDA', startIso: '2024-01-02', count: 30 });
const dateOf = (time: number): string =>
    new Date(time * 1000).toISOString().slice(0, 10);

describe('createStoredProvider', () => {
    it('serves bars up to and including asOf and none after it', async () => {
        const provider = createStoredProvider(bars, '2024-01-19');
        const served = await provider.getBars({
            symbol: 'NVDA',
            timeframe: '1Day',
        });
        expect(served.length).toBeGreaterThan(0);
        expect(dateOf(served[served.length - 1].time)).toBe('2024-01-19');
        expect(served.every(bar => dateOf(bar.time) <= '2024-01-19')).toBe(
            true
        );
    });

    it('serves nothing from after asOf even when asked for a later `from`', async () => {
        const provider = createStoredProvider(bars, '2024-01-19');
        const served = await provider.getBars({
            symbol: 'NVDA',
            timeframe: '1Day',
            from: '2024-01-22T00:00:00Z',
        });
        expect(served).toEqual([]);
    });

    it('cuts by `from` (inclusive) and ignores `limit`, like the production provider', async () => {
        const provider = createStoredProvider(bars, '2024-02-09');
        const served = await provider.getBars({
            symbol: 'NVDA',
            timeframe: '1Day',
            from: '2024-01-10T00:00:00Z',
            limit: 2,
        });
        expect(dateOf(served[0].time)).toBe('2024-01-10');
        expect(served.length).toBeGreaterThan(2);
    });

    it('has no live quote', async () => {
        const provider = createStoredProvider(bars, '2024-01-19');
        expect(await provider.getQuote('NVDA')).toBeNull();
    });

    describe('with a scope', () => {
        const spy = tradingBars({
            symbol: 'SPY',
            startIso: '2024-01-02',
            count: 30,
            close: i => 400 + i,
        });
        const scoped = (
            others: ReadonlyMap<string, readonly (typeof bars)[number][]>
        ) =>
            createStoredProvider(bars, '2024-01-19', {
                symbol: 'NVDA',
                others,
            });

        it('serves a listed benchmark its own bars under the same asOf barrier, ignoring a leading ^', async () => {
            const provider = createStoredProvider(bars, '2024-01-19', {
                symbol: 'NVDA',
                others: new Map([['KS11', spy]]),
            });
            const served = await provider.getBars({
                symbol: '^KS11',
                timeframe: '1Day',
            });
            expect(
                served.every(
                    bar => bar.time <= Date.parse('2024-01-19T00:00:00Z') / 1000
                )
            ).toBe(true);
            expect(served[0].time).toBe(spy[0].time);
            expect(served[0]).not.toEqual(bars[0]);
        });

        it("serves the case's own bars for the case's own symbol", async () => {
            const served = await scoped(new Map([['SPY', spy]])).getBars({
                symbol: 'NVDA',
                timeframe: '1Day',
            });
            expect(served[0]).toEqual(bars[0]);
        });

        it("throws for a symbol that is neither the case's nor a listed one, instead of serving the case's bars under its name", async () => {
            await expect(
                scoped(new Map([['SPY', spy]])).getBars({
                    symbol: 'KS11',
                    timeframe: '1Day',
                })
            ).rejects.toThrow(/no bars for KS11 \(the case is NVDA\)/);
        });
    });
});
