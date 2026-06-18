import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@/infrastructure/cache/redis');
vi.mock('@/infrastructure/jobs/queue');

import { submitMacroBriefing } from '@/application/economy/submitMacroBriefing';
import { BRIEFING_MODEL_ID } from '@/infrastructure/cache/config';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import { ISO_DATE_HOUR_PREFIX_LENGTH } from '@/domain/constants/format';
import { analysisSeed } from '@/infrastructure/hash/analysisInput';
import { setJobMeta } from '@/infrastructure/jobs/queue';
import type { EconomySnapshot } from '@/domain/types';

const mockCreateCacheProvider = createCacheProvider as Mock;
const mockSetJobMeta = setJobMeta as Mock;

const mockCacheGet = vi.fn();
const mockCacheSet = vi.fn();
const mockCacheProvider = {
    get: mockCacheGet,
    set: mockCacheSet,
    delete: vi.fn(),
};
const mockFetch = vi.fn();

const SNAP: EconomySnapshot = {
    indicators: [
        {
            name: 'federalFunds',
            latest: { date: '2026-05-01', value: 3.63 },
            previous: { date: '2026-04-01', value: 3.58 },
            trend: [],
        },
    ],
    treasury: { date: '2026-06-15', year2: 4.07, year10: 4.47 },
    calendar: [],
};

describe('submitMacroBriefing 함수는', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal('fetch', mockFetch);
        // 함수가 내부에서 new Date()를 호출해 dateHour 버킷을 만들므로 시간 고정 — MISTAKES Tests #14.
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-16T09:30:00.000Z'));
        process.env = {
            ...originalEnv,
            WORKER_URL: 'https://worker.test',
            WORKER_SECRET: 'test-secret',
        };
        mockCreateCacheProvider.mockReturnValue(mockCacheProvider);
        mockSetJobMeta.mockResolvedValue(undefined);
        mockCacheGet.mockResolvedValue(null);
        mockCacheSet.mockResolvedValue(undefined);
        mockFetch.mockResolvedValue(new Response('{}', { status: 200 }));
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
        process.env = originalEnv;
    });

    it('캐시 envelope에 briefing이 null이면 cache miss로 처리하고 worker submitted (peek와 대칭)', async () => {
        mockCacheGet.mockResolvedValueOnce({
            briefing: null,
            generatedAt: 'x',
        });
        const result = await submitMacroBriefing(SNAP);
        expect(result.status).toBe('submitted');
        expect(mockFetch).toHaveBeenCalled();
    });

    it('캐시 히트면 cached + briefing 반환, worker 미호출', async () => {
        mockCacheGet.mockResolvedValueOnce({
            briefing: { summary: '동결', highlights: [], regime: 'neutral' },
            generatedAt: '2026-06-16T09:00:00.000Z',
        });

        const result = await submitMacroBriefing(SNAP);

        expect(result.status).toBe('cached');
        if (result.status === 'cached') {
            expect(result.briefing.summary).toBe('동결');
            expect(result.generatedAt).toBe('2026-06-16T09:00:00.000Z');
        }
        expect(mockFetch).not.toHaveBeenCalled();
    });

    it('캐시 미스면 worker /briefing에 model 포함 POST', async () => {
        const result = await submitMacroBriefing(SNAP);

        expect(result.status).toBe('submitted');
        expect(mockFetch).toHaveBeenCalledWith(
            'https://worker.test/briefing',
            expect.objectContaining({ method: 'POST' })
        );
        const [, init] = mockFetch.mock.calls[0] as [string, { body: string }];
        const body = JSON.parse(init.body) as Record<string, unknown>;
        expect(body).toMatchObject({
            jobId: expect.any(String),
            model: BRIEFING_MODEL_ID,
        });
        expect(body.seed).toBe(analysisSeed(body.prompt as string));
    });

    it('캐시 키는 briefing:macro:<dateHour>:<model>:<inputHash> 형식', async () => {
        await submitMacroBriefing(SNAP);
        const key = mockCacheGet.mock.calls[0][0] as string;
        const escapedModel = BRIEFING_MODEL_ID.replace(/\./g, '\\.');
        expect(key).toMatch(
            new RegExp(
                `^briefing:macro:.{${ISO_DATE_HOUR_PREFIX_LENGTH}}:${escapedModel}:[0-9a-f]{16}$`
            )
        );
        // dateHour는 vi.setSystemTime(09:30Z)이라 09 버킷이 박혀야 한다(결정성).
        expect(key).toContain('briefing:macro:2026-06-16T09:');
    });

    it('동일 키를 job meta에 저장(read==write 보장)', async () => {
        await submitMacroBriefing(SNAP);
        const readKey = mockCacheGet.mock.calls[0][0] as string;
        expect(mockSetJobMeta).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({ cacheKey: readKey })
        );
    });

    it('입력이 바뀌면 캐시 키도 달라짐', async () => {
        await submitMacroBriefing(SNAP);
        const keyA = mockCacheGet.mock.calls[0][0] as string;
        mockCacheGet.mockClear();
        await submitMacroBriefing({
            ...SNAP,
            indicators: [
                {
                    name: 'federalFunds',
                    latest: { date: '2026-05-01', value: 3.99 },
                    previous: null,
                    trend: [],
                },
            ],
        });
        const keyB = mockCacheGet.mock.calls[0][0] as string;
        expect(keyA).not.toBe(keyB);
    });

    it('WORKER_URL 없으면 throw', async () => {
        delete process.env.WORKER_URL;
        await expect(submitMacroBriefing(SNAP)).rejects.toThrow();
    });

    it('WORKER_SECRET 없으면 throw', async () => {
        delete process.env.WORKER_SECRET;
        await expect(submitMacroBriefing(SNAP)).rejects.toThrow();
    });

    it('캐시 프로바이더 없으면 조회 건너뛰고 submitted', async () => {
        mockCreateCacheProvider.mockReturnValueOnce(null);
        const result = await submitMacroBriefing(SNAP);
        expect(result.status).toBe('submitted');
        expect(mockCacheGet).not.toHaveBeenCalled();
    });

    it('setJobMeta 실패해도 submitted + 에러 로깅', async () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        mockSetJobMeta.mockRejectedValueOnce(new Error('meta fail'));
        const result = await submitMacroBriefing(SNAP);
        expect(result.status).toBe('submitted');
        expect(spy).toHaveBeenCalledWith(
            '[MacroBriefing/Submit] Failed to store job meta:',
            expect.any(Error)
        );
        spy.mockRestore();
    });

    it('캐시 읽기가 throw해도 로깅 후 worker 제출로 진행', async () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        mockCacheGet.mockRejectedValueOnce(new Error('cache down'));
        const result = await submitMacroBriefing(SNAP);
        expect(result.status).toBe('submitted');
        expect(spy).toHaveBeenCalledWith(
            '[MacroBriefing/Submit] Cache read failed:',
            expect.any(Error)
        );
        expect(mockFetch).toHaveBeenCalled();
        spy.mockRestore();
    });

    it('worker 요청이 실패해도 submitted (fire-and-forget)', async () => {
        // fireAndForget의 .catch는 microtask 큐 → setTimeout(0) flush로 비워야 한다.
        // beforeEach의 fake timers는 setTimeout을 가짜화하므로 이 케이스만 real로 복귀.
        vi.useRealTimers();
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        mockFetch.mockRejectedValueOnce(new Error('network'));
        const result = await submitMacroBriefing(SNAP);
        expect(result.status).toBe('submitted');
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(spy).toHaveBeenCalledWith(
            '[MacroBriefing/Submit] Worker request failed:',
            expect.any(Error)
        );
        spy.mockRestore();
    });

    it('waitUntil 제공 시 worker promise 등록', async () => {
        const waitUntil = vi.fn();
        await submitMacroBriefing(SNAP, { waitUntil });
        expect(waitUntil).toHaveBeenCalledWith(expect.any(Promise));
    });
});
