import { describe, it, expect, vi, afterEach } from 'vitest';
import {
    parseEnv,
    loadEnvFile,
    requireFmpApiKey,
} from '../../../../scripts/validation/loadEnv';
import { existsSync, readFileSync } from 'node:fs';

vi.mock('node:fs', () => ({
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
}));

const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);

afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
});

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

describe('loadEnvFile', () => {
    it('returns an empty record when the file is absent', () => {
        mockExistsSync.mockReturnValue(false);
        expect(loadEnvFile('/nope/.env.local')).toEqual({});
        expect(mockReadFileSync).not.toHaveBeenCalled();
    });

    it('parses the file contents when present', () => {
        mockExistsSync.mockReturnValue(true);
        mockReadFileSync.mockReturnValue('FMP_API_KEY=xyz\n# comment');
        expect(loadEnvFile('/some/.env.local')).toEqual({ FMP_API_KEY: 'xyz' });
    });
});

describe('requireFmpApiKey', () => {
    it('returns the key from process.env when set (early return)', () => {
        vi.stubEnv('FMP_API_KEY', 'from-env');
        expect(requireFmpApiKey()).toBe('from-env');
        // Early return: the .env.local fallback file is never consulted.
        expect(mockExistsSync).not.toHaveBeenCalled();
    });

    it('throws a descriptive error when no key and no env file are given', () => {
        vi.stubEnv('FMP_API_KEY', '');
        vi.stubEnv('SIGLENS_ENV_FILE', '');
        expect(() => requireFmpApiKey()).toThrow(
            'set FMP_API_KEY or SIGLENS_ENV_FILE'
        );
        expect(mockExistsSync).not.toHaveBeenCalled();
    });

    it('throws naming the file when the env file lacks the key', () => {
        vi.stubEnv('FMP_API_KEY', '');
        mockExistsSync.mockReturnValue(false);
        expect(() => requireFmpApiKey('/some/.env.local')).toThrow(
            'env file /some/.env.local'
        );
    });

    it('reads the explicit env file argument when process.env is empty', () => {
        vi.stubEnv('FMP_API_KEY', '');
        mockExistsSync.mockReturnValue(true);
        mockReadFileSync.mockReturnValue('FMP_API_KEY=from-file');
        expect(requireFmpApiKey('/some/.env.local')).toBe('from-file');
        expect(mockExistsSync).toHaveBeenCalledWith('/some/.env.local');
    });

    it('falls back to SIGLENS_ENV_FILE when no argument is given', () => {
        vi.stubEnv('FMP_API_KEY', '');
        vi.stubEnv('SIGLENS_ENV_FILE', '/env/path/.env.local');
        mockExistsSync.mockReturnValue(true);
        mockReadFileSync.mockReturnValue('FMP_API_KEY=from-env-file');
        expect(requireFmpApiKey()).toBe('from-env-file');
        expect(mockExistsSync).toHaveBeenCalledWith('/env/path/.env.local');
    });
});
