import { describe, expect, it } from 'vitest';
import { formatPlainNumber } from '@/domain/plainNumber';

describe('formatPlainNumber', () => {
    it('prints an integer without a decimal point', () => {
        expect(formatPlainNumber(52)).toBe('52');
    });

    it('prints a decimal without padding trailing zeros', () => {
        expect(formatPlainNumber(4.5)).toBe('4.5');
    });

    it('prints a negative value with an ASCII minus', () => {
        expect(formatPlainNumber(-3.09)).toBe('-3.09');
    });

    it('prints negative zero as 0', () => {
        expect(formatPlainNumber(-0)).toBe('0');
    });

    it('prints a value below 1e-6 in plain decimal notation, not exponent form', () => {
        expect(formatPlainNumber(1e-7)).toBe('0.0000001');
    });

    it('prints a negative value below 1e-6 in plain decimal notation', () => {
        expect(formatPlainNumber(-2.5e-7)).toBe('-0.00000025');
    });

    it('prints a value from 1e21 without exponent form or grouping', () => {
        expect(formatPlainNumber(1e21)).toBe('1000000000000000000000');
    });
});
