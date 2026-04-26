import { afterEach, describe, expect, it } from 'vitest';
import { readFmpConfig, tryReadFmpConfig } from '@/infrastructure/fmp/config';

describe('readFmpConfig', () => {
    afterEach(() => {
        delete process.env.FMP_API_KEY;
    });

    it('FMP_API_KEY가 없으면 에러를 던진다', () => {
        expect(() => readFmpConfig()).toThrow('FMP_API_KEY must be set');
    });

    it('FMP_API_KEY가 설정되면 apiKey를 반환한다', () => {
        process.env.FMP_API_KEY = 'fmp-key';
        expect(readFmpConfig()).toEqual({ apiKey: 'fmp-key' });
    });
});

describe('tryReadFmpConfig', () => {
    afterEach(() => {
        delete process.env.FMP_API_KEY;
    });

    it('FMP_API_KEY가 없으면 null을 반환한다', () => {
        expect(tryReadFmpConfig()).toBeNull();
    });

    it('FMP_API_KEY가 설정되면 apiKey를 반환한다', () => {
        process.env.FMP_API_KEY = 'fmp-key';
        expect(tryReadFmpConfig()).toEqual({ apiKey: 'fmp-key' });
    });
});
