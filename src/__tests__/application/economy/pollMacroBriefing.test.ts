import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@/infrastructure/jobs/queue');
vi.mock('@/infrastructure/cache/redis');
vi.mock('@/application/background', () => ({
    cleanupInBackground: vi.fn(),
    fireAndForget: vi.fn((promise: Promise<unknown>) => promise),
}));

import { pollMacroBriefing } from '@/application/economy/pollMacroBriefing';
import {
    getJobStatus,
    getJobError,
    getJobMeta,
    getJobResult,
} from '@/infrastructure/jobs/queue';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import { cleanupInBackground } from '@/application/background';

const mockGetJobStatus = getJobStatus as Mock;
const mockGetJobError = getJobError as Mock;
const mockGetJobMeta = getJobMeta as Mock;
const mockGetJobResult = getJobResult as Mock;
const mockCleanupInBackground = cleanupInBackground as Mock;
const mockCreateCacheProvider = createCacheProvider as Mock;

const mockCacheSet = vi.fn();
const mockCacheProvider = { get: vi.fn(), set: mockCacheSet, delete: vi.fn() };

const VALID_RESULT = {
    summary: '금리 동결 국면이에요',
    highlights: ['2s10s 정상화'],
    regime: 'recovery',
};

describe('pollMacroBriefing 함수는', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetJobMeta.mockResolvedValue({
            symbol: 'economy',
            cacheKey: 'briefing:macro:2026-06-16T12:gemini:deadbeefdeadbeef',
        });
        mockCreateCacheProvider.mockReturnValue(mockCacheProvider);
        mockCacheSet.mockResolvedValue(undefined);
    });

    it('status null/processing이면 processing', async () => {
        mockGetJobStatus.mockResolvedValueOnce(null);
        expect((await pollMacroBriefing('j')).status).toBe('processing');
        mockGetJobStatus.mockResolvedValueOnce('processing');
        expect((await pollMacroBriefing('j')).status).toBe('processing');
    });

    it('status error면 error + 메시지 + 잡 cleanup 트리거', async () => {
        mockGetJobStatus.mockResolvedValueOnce('error');
        mockGetJobError.mockResolvedValueOnce('worker failed');
        const r = await pollMacroBriefing('j');
        expect(r.status).toBe('error');
        if (r.status === 'error') expect(r.error).toBe('worker failed');
        expect(mockCleanupInBackground).toHaveBeenCalledWith(
            'j',
            '[MacroBriefing/Poll]',
            undefined
        );
    });

    it('done + 유효 결과면 done + 정규화 briefing + generatedAt + 캐시 set + 잡 cleanup', async () => {
        // 시간 의존(`new Date().toISOString()`)은 vi.useFakeTimers로 고정 — MISTAKES Tests #14.
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-16T12:00:00.000Z'));
        mockGetJobStatus.mockResolvedValueOnce('done');
        mockGetJobResult.mockResolvedValueOnce(VALID_RESULT);
        const r = await pollMacroBriefing('j');
        expect(r.status).toBe('done');
        if (r.status === 'done') {
            expect(r.briefing.summary).toBe('금리 동결 국면이에요');
            expect(r.briefing.regime).toBe('recovery');
            expect(r.generatedAt).toBe('2026-06-16T12:00:00.000Z');
        }
        expect(mockCacheSet).toHaveBeenCalledWith(
            'briefing:macro:2026-06-16T12:gemini:deadbeefdeadbeef',
            expect.objectContaining({
                briefing: expect.any(Object),
                generatedAt: '2026-06-16T12:00:00.000Z',
            }),
            expect.any(Number)
        );
        expect(mockCleanupInBackground).toHaveBeenCalledWith(
            'j',
            '[MacroBriefing/Poll]',
            undefined
        );
        vi.useRealTimers();
    });

    it('done이지만 summary 비면 error', async () => {
        mockGetJobStatus.mockResolvedValueOnce('done');
        mockGetJobResult.mockResolvedValueOnce({
            summary: '',
            regime: 'neutral',
        });
        const r = await pollMacroBriefing('j');
        expect(r.status).toBe('error');
    });

    it('done이지만 result 없으면 error', async () => {
        mockGetJobStatus.mockResolvedValueOnce('done');
        mockGetJobResult.mockResolvedValueOnce(null);
        const r = await pollMacroBriefing('j');
        expect(r.status).toBe('error');
    });

    it('done + 유효 결과지만 캐시 프로바이더가 없으면 캐시 set 건너뜀', async () => {
        mockGetJobStatus.mockResolvedValueOnce('done');
        mockGetJobResult.mockResolvedValueOnce(VALID_RESULT);
        mockCreateCacheProvider.mockReturnValueOnce(null);
        const r = await pollMacroBriefing('j');
        expect(r.status).toBe('done');
        expect(mockCacheSet).not.toHaveBeenCalled();
    });

    it('캐시 set이 throw해도 done — 로깅 후 무시(fire-and-forget)', async () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        mockGetJobStatus.mockResolvedValueOnce('done');
        mockGetJobResult.mockResolvedValueOnce(VALID_RESULT);
        mockCacheSet.mockRejectedValueOnce(new Error('write fail'));
        const r = await pollMacroBriefing('j');
        expect(r.status).toBe('done');
        // fireAndForget의 .catch는 microtask 큐 — 한 틱 양보해 비워준다
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(spy).toHaveBeenCalledWith(
            '[MacroBriefing/Poll] Cache write failed:',
            expect.any(Error)
        );
        spy.mockRestore();
    });

    it('meta cacheKey 없으면 warn + 캐시 set 건너뜀', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        mockGetJobStatus.mockResolvedValueOnce('done');
        mockGetJobResult.mockResolvedValueOnce(VALID_RESULT);
        mockGetJobMeta.mockResolvedValueOnce({ symbol: 'economy' });
        const r = await pollMacroBriefing('j');
        expect(r.status).toBe('done');
        expect(mockCacheSet).not.toHaveBeenCalled();
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });

    it('meta cacheKey가 빈 문자열이어도 캐시 set 건너뜀(blank key 방어)', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        mockGetJobStatus.mockResolvedValueOnce('done');
        mockGetJobResult.mockResolvedValueOnce(VALID_RESULT);
        mockGetJobMeta.mockResolvedValueOnce({
            symbol: 'economy',
            cacheKey: '',
        });
        const r = await pollMacroBriefing('j');
        expect(r.status).toBe('done');
        expect(mockCacheSet).not.toHaveBeenCalled();
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });
});
