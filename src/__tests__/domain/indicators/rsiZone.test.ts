import { describe, expect, it } from 'vitest';
import { rsiZone } from '@/domain/indicators/rsiZone';

describe('rsiZone', () => {
    it.each([
        [70, 'overbought'],
        [69.99, 'neutral'],
        [30, 'oversold'],
        [30.01, 'neutral'],
        [37.5, 'neutral'],
    ] as const)('rsi %s is %s', (rsi, zone) => {
        expect(rsiZone(rsi)).toBe(zone);
    });
});
