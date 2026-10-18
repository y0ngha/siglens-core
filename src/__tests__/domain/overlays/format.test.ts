import { describe, expect, it } from 'vitest';
import { formatOverlayPoint } from '@/domain/overlays/format';

describe('formatOverlayPoint', () => {
    it('daily prints date only', () => {
        expect(
            formatOverlayPoint(
                { time: 1767571200, price: 101.2 },
                { timeframe: '1Day', quoting: { dp: 2, krxTick: null } }
            )
        ).toBe('2026-01-05 101.20');
    });
    it('intraday prints UTC time', () => {
        expect(
            formatOverlayPoint(
                { time: 1767571200 + 3600 * 14, price: 5 },
                { timeframe: '1Hour', quoting: { dp: 1, krxTick: null } }
            )
        ).toMatch(/^2026-01-05 14:00 UTC 5\.0$/);
    });
});
