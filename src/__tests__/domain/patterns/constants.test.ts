import { describe, expect, it } from 'vitest';
import { TIMEFRAMES } from '@/domain/constants/market';
import { PATTERN_MIN_HEIGHT_PRICE_PCT } from '@/domain/patterns/constants';

describe('PATTERN_MIN_HEIGHT_PRICE_PCT', () => {
    it('has a positive floor for every timeframe', () => {
        TIMEFRAMES.forEach(timeframe => {
            expect(PATTERN_MIN_HEIGHT_PRICE_PCT[timeframe]).toBeGreaterThan(0);
        });
    });

    it('keeps the daily floor and sets the unmeasured weekly one at twice it', () => {
        expect(PATTERN_MIN_HEIGHT_PRICE_PCT['1Day']).toBe(0.03);
        expect(PATTERN_MIN_HEIGHT_PRICE_PCT['1Week']).toBe(0.06);
    });
});
