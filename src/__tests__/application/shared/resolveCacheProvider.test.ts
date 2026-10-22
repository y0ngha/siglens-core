import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@/infrastructure/cache/redis');

import { resolveCacheProvider } from '@/application/shared/resolveCacheProvider';
import { createCacheProvider } from '@/infrastructure/cache/redis';

const mockCreateCacheProvider = createCacheProvider as Mock;

const envCache = { get: vi.fn(), set: vi.fn(), delete: vi.fn() };
const injectedCache = { get: vi.fn(), set: vi.fn(), delete: vi.fn() };

describe('resolveCacheProvider 함수는', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockCreateCacheProvider.mockReturnValue(envCache);
    });

    it('undefined 이면 env 기반 createCacheProvider 결과를 반환한다', () => {
        expect(resolveCacheProvider(undefined)).toBe(envCache);
        expect(mockCreateCacheProvider).toHaveBeenCalledTimes(1);
    });

    it('undefined 이고 env 가 없으면(createCacheProvider → null) null 을 반환한다', () => {
        mockCreateCacheProvider.mockReturnValueOnce(null);

        expect(resolveCacheProvider(undefined)).toBeNull();
    });

    it('주입한 캐시는 그대로 반환하고 createCacheProvider 를 호출하지 않는다', () => {
        expect(resolveCacheProvider(injectedCache)).toBe(injectedCache);
        expect(mockCreateCacheProvider).not.toHaveBeenCalled();
    });

    it('null 은 "캐시 없음"이다 — env 캐시로 폴백하지 않는다', () => {
        expect(resolveCacheProvider(null)).toBeNull();
        expect(mockCreateCacheProvider).not.toHaveBeenCalled();
    });
});
