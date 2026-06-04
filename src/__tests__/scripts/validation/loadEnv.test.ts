import { describe, it, expect } from 'vitest';
import { parseEnv } from '../../../../scripts/validation/loadEnv';

describe('parseEnv', () => {
    it('parses KEY=VALUE lines into a record', () => {
        const env = parseEnv('FMP_API_KEY=abc123\nOTHER=hello');
        expect(env.FMP_API_KEY).toBe('abc123');
        expect(env.OTHER).toBe('hello');
    });

    it('ignores blank lines and # comments (worst case)', () => {
        const env = parseEnv(
            '# comment\n\nFMP_API_KEY=k\n  # indented comment'
        );
        expect(env.FMP_API_KEY).toBe('k');
        expect(Object.keys(env)).toEqual(['FMP_API_KEY']);
    });

    it('strips surrounding single/double quotes and trims', () => {
        expect(parseEnv('A="quoted"').A).toBe('quoted');
        expect(parseEnv("B='quoted'").B).toBe('quoted');
        expect(parseEnv('C = spaced ').C).toBe('spaced');
    });

    it('keeps "=" appearing inside the value', () => {
        expect(parseEnv('URL=https://x?a=b&c=d').URL).toBe('https://x?a=b&c=d');
    });

    it('returns an empty record for empty input (worst case)', () => {
        expect(parseEnv('')).toEqual({});
    });
});
