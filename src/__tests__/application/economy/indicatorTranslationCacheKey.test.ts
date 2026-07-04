import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@/infrastructure/cache/redis');
vi.mock('@/infrastructure/jobs/queue');

import {
    INDICATOR_TRANSLATION_PROMPT_TEMPLATE_VERSION,
    INDICATOR_TRANSLATION_CACHE_TTL,
} from '@/infrastructure/cache/config';
import { SECONDS_PER_DAY } from '@/domain/constants/time';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import { setJobMeta } from '@/infrastructure/jobs/queue';
import { submitIndicatorTranslation } from '@/application/economy/submitIndicatorTranslation';

const mockCreateCacheProvider = createCacheProvider as Mock;
const mockSetJobMeta = setJobMeta as Mock;

const mockCacheGet = vi.fn();
const mockCacheProvider = {
    get: mockCacheGet,
    set: vi.fn(),
    delete: vi.fn(),
};

/**
 * Extract the cache key that `submitIndicatorTranslation` derives at runtime
 * — the key passed to `cache.get()` on the first call — and return it.
 *
 * This pins assertions to the PRODUCTION serialization path (hashAnalysisInput
 * + buildIndicatorTranslationCacheKey) so any drift surfaces here.
 */
async function getCacheKeyForName(name: string): Promise<string> {
    mockCacheGet.mockResolvedValueOnce(null);
    await submitIndicatorTranslation(name);
    return mockCacheGet.mock.calls[
        mockCacheGet.mock.calls.length - 1
    ][0] as string;
}

describe('buildIndicatorTranslationCacheKey (production path)', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
        );
        process.env = {
            ...originalEnv,
            WORKER_URL: 'https://worker.test',
            WORKER_SECRET: 'test-secret',
        };
        mockCreateCacheProvider.mockReturnValue(mockCacheProvider);
        mockSetJobMeta.mockResolvedValue(undefined);
        mockCacheGet.mockResolvedValue(null);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        process.env = originalEnv;
    });

    it('올바른 키 형식 반환 (v1:translation:indicator:<hash>:p2)', async () => {
        const key = await getCacheKeyForName('Core PCE Price Index YoY');
        expect(key).toMatch(/^v1:translation:indicator:[0-9a-f]{16}:p2$/);
    });

    it('동일 이름 → 동일 캐시 키(결정적)', async () => {
        const keyA = await getCacheKeyForName('Unemployment Claims');
        const keyB = await getCacheKeyForName('Unemployment Claims');
        expect(keyA).toBe(keyB);
    });

    it('프롬프트 버전 상수가 키에 포함', async () => {
        const key = await getCacheKeyForName('Nonfarm Payrolls');
        expect(key).toContain(INDICATOR_TRANSLATION_PROMPT_TEMPLATE_VERSION);
    });

    it('이름이 달라지면 키도 달라짐', async () => {
        const keyA = await getCacheKeyForName('Unemployment Claims');
        const keyB = await getCacheKeyForName('Core CPI MoM');
        expect(keyA).not.toBe(keyB);
    });

    it('INDICATOR_TRANSLATION_CACHE_TTL이 양수(30d = 2592000s)', () => {
        expect(INDICATOR_TRANSLATION_CACHE_TTL).toBeGreaterThan(0);
        expect(INDICATOR_TRANSLATION_CACHE_TTL).toBe(30 * SECONDS_PER_DAY);
    });
});
