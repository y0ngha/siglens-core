import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@/infrastructure/cache/redis');

import { peekMacroBriefingCache } from '@/application/economy/peekMacroBriefingCache';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import { ISO_DATE_HOUR_PREFIX_LENGTH } from '@/domain/constants/format';
import type { EconomySnapshot } from '@/domain/types';

const mockCreateCacheProvider = createCacheProvider as Mock;
const mockCacheGet = vi.fn();
const mockCacheProvider = { get: mockCacheGet, set: vi.fn(), delete: vi.fn() };

const SNAP: EconomySnapshot = {
    indicators: [
        {
            name: 'federalFunds',
            latest: { date: '2026-05-01', value: 3.63 },
            previous: null,
            trend: [],
        },
    ],
    treasury: { date: '2026-06-15', year2: 4.07, year10: 4.47 },
    calendar: [],
};

const VALID_CACHED = {
    briefing: {
        summary: '동결 국면이에요',
        highlights: ['고용 견조'],
        regime: 'recovery',
    },
    generatedAt: '2026-06-16T09:00:00.000Z',
};

describe('peekMacroBriefingCache 함수는', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // 함수가 내부에서 new Date()로 dateHour 버킷을 만든다 — MISTAKES Tests #14.
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-16T09:30:00.000Z'));
        mockCreateCacheProvider.mockReturnValue(mockCacheProvider);
        mockCacheGet.mockResolvedValue(null);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('data가 null이면 null (provider 조회 안 함)', async () => {
        const result = await peekMacroBriefingCache(null);
        expect(result).toBeNull();
        expect(mockCreateCacheProvider).not.toHaveBeenCalled();
    });

    it('data가 undefined여도 null (provider 조회 안 함)', async () => {
        const result = await peekMacroBriefingCache(undefined);
        expect(result).toBeNull();
        expect(mockCreateCacheProvider).not.toHaveBeenCalled();
    });

    it('캐시 프로바이더가 없으면 null', async () => {
        mockCreateCacheProvider.mockReturnValueOnce(null);
        const result = await peekMacroBriefingCache(SNAP);
        expect(result).toBeNull();
        expect(mockCacheGet).not.toHaveBeenCalled();
    });

    it('캐시 미스(null)면 null', async () => {
        mockCacheGet.mockResolvedValueOnce(null);
        expect(await peekMacroBriefingCache(SNAP)).toBeNull();
    });

    it('캐시 hit이면 정규화된 briefing 반환', async () => {
        mockCacheGet.mockResolvedValueOnce(VALID_CACHED);
        const result = await peekMacroBriefingCache(SNAP);
        expect(result).not.toBeNull();
        expect(result?.summary).toBe('동결 국면이에요');
        expect(result?.regime).toBe('recovery');
    });

    it('cached.briefing이 null이면 null', async () => {
        mockCacheGet.mockResolvedValueOnce({
            briefing: null,
            generatedAt: 'x',
        });
        expect(await peekMacroBriefingCache(SNAP)).toBeNull();
    });

    it('읽기에서 dateHour 버킷 키(briefing:macro:)로 조회', async () => {
        await peekMacroBriefingCache(SNAP);
        const key = mockCacheGet.mock.calls[0][0] as string;
        const re = new RegExp(
            `^briefing:macro:.{${ISO_DATE_HOUR_PREFIX_LENGTH}}:.+:[0-9a-f]{16}$`
        );
        expect(key).toMatch(re);
        // setSystemTime(09:30Z)이라 09 버킷이 결정적으로 박혀야 한다.
        expect(key).toContain('briefing:macro:2026-06-16T09:');
    });

    it('캐시 읽기가 throw하면 로깅 후 null', async () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        mockCacheGet.mockRejectedValueOnce(new Error('cache down'));
        const result = await peekMacroBriefingCache(SNAP);
        expect(result).toBeNull();
        expect(spy).toHaveBeenCalled();
        spy.mockRestore();
    });
});
