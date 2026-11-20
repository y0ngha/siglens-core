import { describe, expect, it } from 'vitest';
import {
    MAX_STORED_ERROR_CHARS,
    redactProviderText,
} from '../../../../scripts/replay/redact';

describe('redactProviderText', () => {
    it('masks sk- style keys', () => {
        const text = redactProviderText(
            'invalid key sk-abcDEF0123456789_xyz for account'
        );
        expect(text).toBe('invalid key [redacted] for account');
    });

    it('masks the value of a Bearer header, case-insensitively', () => {
        expect(
            redactProviderText('sent Authorization: bearer abc.def-ghi_jkl')
        ).not.toContain('abc.def');
        expect(redactProviderText('Bearer abc123')).toBe('[redacted]');
    });

    it('masks a long hex or base64 run but keeps ordinary words and short ids', () => {
        const hex = 'deadbeef'.repeat(5);
        expect(redactProviderText(`key ${hex} end`)).toBe('key [redacted] end');
        expect(redactProviderText('QUJD'.repeat(10))).toBe('[redacted]');
        expect(
            redactProviderText('HTTP 429 rate limit, request id req_12345')
        ).toBe('HTTP 429 rate limit, request id req_12345');
    });

    it('keeps a run of 31 characters and masks one of 32', () => {
        expect(redactProviderText('a'.repeat(31))).toBe('a'.repeat(31));
        expect(redactProviderText('a'.repeat(32))).toBe('[redacted]');
    });

    it('caps the length after masking', () => {
        const long = redactProviderText('word '.repeat(400));
        expect(long.length).toBe(MAX_STORED_ERROR_CHARS + 1);
        expect(long.endsWith('…')).toBe(true);
    });

    it('does not cut text of exactly the cap', () => {
        const exact = 'ab '
            .repeat(MAX_STORED_ERROR_CHARS)
            .slice(0, MAX_STORED_ERROR_CHARS);
        expect(redactProviderText(exact)).toBe(exact);
    });
});
