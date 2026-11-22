import { describe, expect, it } from 'vitest';
import { standardDailyWindow } from '@/domain/analysis/standardDailyWindow';
import { TIMEFRAME_LOOKBACK_DAYS } from '@/domain/constants/market';
import type { Bar } from '@/domain/types';

const bar = (time: number): Bar => ({
    time,
    open: 10,
    high: 12,
    low: 9,
    close: 11,
    volume: 100,
});

describe('standardDailyWindow', () => {
    const NOW = new Date('2026-10-05T13:45:00.000Z');
    const cutoffSec =
        Date.UTC(2026, 9, 5) / 1000 - TIMEFRAME_LOOKBACK_DAYS['1Day'] * 86_400;

    it('keeps the bar exactly at the 1Day lookback cutoff (UTC midnight) and drops the one before', () => {
        const before = bar(cutoffSec - 86_400);
        const atCutoff = bar(cutoffSec);
        const recent = bar(cutoffSec + 86_400);

        expect(standardDailyWindow([before, atCutoff, recent], NOW)).toEqual([
            atCutoff,
            recent,
        ]);
    });

    it('reads the date of now, not its time of day', () => {
        const midnight = new Date('2026-10-05T00:00:00.000Z');
        const late = new Date('2026-10-05T23:59:59.000Z');
        const bars = [bar(cutoffSec - 1), bar(cutoffSec)];

        expect(standardDailyWindow(bars, midnight)).toEqual(
            standardDailyWindow(bars, late)
        );
    });

    it('returns an empty list for an empty history', () => {
        expect(standardDailyWindow([], NOW)).toEqual([]);
    });
});
