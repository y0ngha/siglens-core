import { describe, expect, it } from 'vitest';
import { formatOverlayPoint } from '@/domain/overlays/format';

describe('formatOverlayPoint', () => {
    it('daily prints date only', () => {
        expect(
            formatOverlayPoint(
                { time: 1767571200, price: 101.2 },
                { timeframe: '1Day', priceDp: 2 }
            )
        ).toBe('2026-01-05 101.20');
    });
    it('intraday prints UTC time', () => {
        expect(
            formatOverlayPoint(
                { time: 1767571200 + 3600 * 14, price: 5 },
                { timeframe: '1Hour', priceDp: 1 }
            )
        ).toMatch(/^2026-01-05 14:00 UTC 5\.0$/);
    });
});
