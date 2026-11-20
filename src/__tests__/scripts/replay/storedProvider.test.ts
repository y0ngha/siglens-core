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
});
