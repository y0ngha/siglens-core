import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@/infrastructure/jobs/queue');
vi.mock('@/infrastructure/cache/redis');
vi.mock('@/application/background', () => ({
    cleanupInBackground: vi.fn(),
    fireAndForget: vi.fn((promise: Promise<unknown>) => promise),
}));

import { pollEconomicEventAnalysis } from '@/application/economy/pollEconomicEventAnalysis';
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
    sentiment: 'bullish',
    summaryKo: 'CPI가 예상치를 하회했습니다.',
    interpretationKo: '금리 인하 기대가 높아집니다.',
};

const META_CACHE_KEY = 'v1:analysis:economic-event:deadbeefdeadbeef:p1';

describe('pollEconomicEventAnalysis 함수는', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetJobMeta.mockResolvedValue({
            symbol: 'economic-event',
            cacheKey: META_CACHE_KEY,
        });
        mockCreateCacheProvider.mockReturnValue(mockCacheProvider);
        mockCacheSet.mockResolvedValue(undefined);
    });

    it('status null/processing이면 processing', async () => {
        mockGetJobStatus.mockResolvedValueOnce(null);
        expect((await pollEconomicEventAnalysis('j')).status).toBe(
            'processing'
        );
        mockGetJobStatus.mockResolvedValueOnce('processing');
        expect((await pollEconomicEventAnalysis('j')).status).toBe(
            'processing'
        );
    });

    it('status error면 error + 메시지 + 잡 cleanup 트리거', async () => {
        mockGetJobStatus.mockResolvedValueOnce('error');
        mockGetJobError.mockResolvedValueOnce('worker failed');
        const r = await pollEconomicEventAnalysis('j');
        expect(r.status).toBe('error');
        if (r.status === 'error') expect(r.error).toBe('worker failed');
        expect(mockCleanupInBackground).toHaveBeenCalledWith(
            'j',
            '[EconomicEventAnalysis/Poll]',
            undefined
        );
    });

    it('status error + getJobError=null이면 Unknown error', async () => {
        mockGetJobStatus.mockResolvedValueOnce('error');
        mockGetJobError.mockResolvedValueOnce(null);
        const r = await pollEconomicEventAnalysis('j');
        expect(r.status).toBe('error');
        if (r.status === 'error') expect(r.error).toBe('Unknown error');
    });

    it('done + 유효 결과면 done + 정규화 result + 캐시 set + 잡 cleanup', async () => {
        mockGetJobStatus.mockResolvedValueOnce('done');
        mockGetJobResult.mockResolvedValueOnce(VALID_RESULT);
        const r = await pollEconomicEventAnalysis('j');
        expect(r.status).toBe('done');
        if (r.status === 'done') {
            expect(r.result.sentiment).toBe('bullish');
            expect(r.result.summaryKo).toBe('CPI가 예상치를 하회했습니다.');
            expect(r.result.interpretationKo).toBe(
                '금리 인하 기대가 높아집니다.'
            );
        }
        expect(mockCacheSet).toHaveBeenCalledWith(
            META_CACHE_KEY,
            expect.objectContaining({
                sentiment: 'bullish',
                summaryKo: 'CPI가 예상치를 하회했습니다.',
            }),
            expect.any(Number)
        );
        expect(mockCleanupInBackground).toHaveBeenCalledWith(
            'j',
            '[EconomicEventAnalysis/Poll]',
            undefined
        );
    });

    it('done이지만 result 없으면 error', async () => {
        mockGetJobStatus.mockResolvedValueOnce('done');
        mockGetJobResult.mockResolvedValueOnce(null);
        const r = await pollEconomicEventAnalysis('j');
        expect(r.status).toBe('error');
        if (r.status === 'error') expect(r.error).toBe('Result not found');
    });

    it('done + 유효 결과지만 캐시 프로바이더가 없으면 캐시 set 건너뜀', async () => {
        mockGetJobStatus.mockResolvedValueOnce('done');
        mockGetJobResult.mockResolvedValueOnce(VALID_RESULT);
        mockCreateCacheProvider.mockReturnValueOnce(null);
        const r = await pollEconomicEventAnalysis('j');
        expect(r.status).toBe('done');
        expect(mockCacheSet).not.toHaveBeenCalled();
    });

    it('캐시 set이 throw해도 done — 로깅 후 무시(fire-and-forget)', async () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        mockGetJobStatus.mockResolvedValueOnce('done');
        mockGetJobResult.mockResolvedValueOnce(VALID_RESULT);
        mockCacheSet.mockRejectedValueOnce(new Error('write fail'));
        const r = await pollEconomicEventAnalysis('j');
        expect(r.status).toBe('done');
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(spy).toHaveBeenCalledWith(
            '[EconomicEventAnalysis/Poll] Cache write failed:',
            expect.any(Error)
        );
        spy.mockRestore();
    });

    it('meta cacheKey 없으면 warn + 캐시 set 건너뜀', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        mockGetJobStatus.mockResolvedValueOnce('done');
        mockGetJobResult.mockResolvedValueOnce(VALID_RESULT);
        mockGetJobMeta.mockResolvedValueOnce({ symbol: 'economic-event' });
        const r = await pollEconomicEventAnalysis('j');
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
            symbol: 'economic-event',
            cacheKey: '',
        });
        const r = await pollEconomicEventAnalysis('j');
        expect(r.status).toBe('done');
        expect(mockCacheSet).not.toHaveBeenCalled();
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });

    it('가비지 result도 normalize 후 done 반환(defensive normalization)', async () => {
        mockGetJobStatus.mockResolvedValueOnce('done');
        mockGetJobResult.mockResolvedValueOnce({ garbage: true });
        const r = await pollEconomicEventAnalysis('j');
        expect(r.status).toBe('done');
        if (r.status === 'done') {
            expect(r.result.sentiment).toBe('neutral');
            expect(r.result.summaryKo).toBe('');
        }
    });

    it('options.waitUntil 제공 시 background 작업에 전달', async () => {
        mockGetJobStatus.mockResolvedValueOnce('done');
        mockGetJobResult.mockResolvedValueOnce(VALID_RESULT);
        const waitUntil = vi.fn();
        await pollEconomicEventAnalysis('j', { waitUntil });
        // cleanupInBackground or fireAndForget가 호출 → waitUntil 등록됨을 간접 확인
        expect(mockCleanupInBackground).toHaveBeenCalledWith(
            'j',
            '[EconomicEventAnalysis/Poll]',
            { waitUntil }
        );
    });
});
