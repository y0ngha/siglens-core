import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@/infrastructure/cache/redis');
vi.mock('@/infrastructure/jobs/queue');

import {
    ECONOMIC_EVENT_PROMPT_TEMPLATE_VERSION,
    ECONOMIC_EVENT_CACHE_TTL,
} from '@/infrastructure/cache/config';
import { SECONDS_PER_DAY } from '@/domain/constants/time';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import { setJobMeta } from '@/infrastructure/jobs/queue';
import { submitEconomicEventAnalysis } from '@/application/economy/submitEconomicEventAnalysis';
import type { EconomicEventAnalysisInput } from '@/domain/economy/types';

const mockCreateCacheProvider = createCacheProvider as Mock;
const mockSetJobMeta = setJobMeta as Mock;

const mockCacheGet = vi.fn();
const mockCacheProvider = {
    get: mockCacheGet,
    set: vi.fn(),
    delete: vi.fn(),
};

const BASE_INPUT: EconomicEventAnalysisInput = {
    event: 'CPI MoM',
    impact: 'High',
    actual: 0.2,
    estimate: 0.3,
    previous: 0.4,
    unit: '%',
};

/**
 * Extract the cache key that `submitEconomicEventAnalysis` derives at runtime
 * — the key passed to `cache.get()` on the first call — and return it.
 *
 * This pins assertions to the PRODUCTION serialization path so any drift in
 * `hashEconomicEventInput`'s field list or ordering will surface here.
 */
async function getCacheKeyForInput(
    input: EconomicEventAnalysisInput
): Promise<string> {
    mockCacheGet.mockResolvedValueOnce(null);
    await submitEconomicEventAnalysis(input);
    return mockCacheGet.mock.calls[
        mockCacheGet.mock.calls.length - 1
    ][0] as string;
}

describe('buildEconomicEventCacheKey (production path)', () => {
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

    it('올바른 키 형식 반환 (v1:analysis:economic-event:<hash>:p1)', async () => {
        const key = await getCacheKeyForInput(BASE_INPUT);
        expect(key).toMatch(/^v1:analysis:economic-event:[0-9a-f]{16}:p1$/);
    });

    it('동일 입력 → 동일 캐시 키(결정적)', async () => {
        const keyA = await getCacheKeyForInput(BASE_INPUT);
        const keyB = await getCacheKeyForInput(BASE_INPUT);
        expect(keyA).toBe(keyB);
    });

    it('프롬프트 버전 상수가 키에 포함', async () => {
        const key = await getCacheKeyForInput(BASE_INPUT);
        expect(key).toContain(ECONOMIC_EVENT_PROMPT_TEMPLATE_VERSION);
    });

    it('actual 값이 다르면 키도 달라짐', async () => {
        const keyA = await getCacheKeyForInput(BASE_INPUT);
        const keyB = await getCacheKeyForInput({ ...BASE_INPUT, actual: 0.5 });
        expect(keyA).not.toBe(keyB);
    });

    it('이벤트 이름이 다르면 키도 달라짐', async () => {
        const keyA = await getCacheKeyForInput(BASE_INPUT);
        const keyB = await getCacheKeyForInput({
            ...BASE_INPUT,
            event: 'PPI MoM',
        });
        expect(keyA).not.toBe(keyB);
    });

    it('actual=null 이어도 결정적 해시를 가진 키 반환', async () => {
        const key = await getCacheKeyForInput({ ...BASE_INPUT, actual: null });
        expect(key).toMatch(/^v1:analysis:economic-event:[0-9a-f]{16}:p1$/);
    });

    it('ECONOMIC_EVENT_CACHE_TTL이 양수(24h = SECONDS_PER_DAY)', () => {
        expect(ECONOMIC_EVENT_CACHE_TTL).toBeGreaterThan(0);
        expect(ECONOMIC_EVENT_CACHE_TTL).toBe(SECONDS_PER_DAY);
    });
});
