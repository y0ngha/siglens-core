import { describe, expect, it } from 'vitest';
import { HORIZON_WINDOWS_BY_TIMEFRAME } from '@/domain/analysis/marketReferenceConstants';
import type { Timeframe } from '@/domain/types';

describe('marketReferenceConstants', () => {
    it('defines short<medium<long windows for every timeframe', () => {
        const tfs: Timeframe[] = [
            '5Min',
            '15Min',
            '30Min',
            '1Hour',
            '4Hour',
            '1Day',
        ];
        for (const tf of tfs) {
            const w = HORIZON_WINDOWS_BY_TIMEFRAME[tf];
            expect(w.short).toBeLessThan(w.medium);
            expect(w.medium).toBeLessThan(w.long);
        }
    });
});
