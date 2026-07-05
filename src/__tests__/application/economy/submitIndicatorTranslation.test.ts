import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@/infrastructure/cache/redis');
vi.mock('@/infrastructure/jobs/queue');

import {
    submitIndicatorTranslation,
    INDICATOR_TRANSLATION_MODEL_ID,
} from '@/application/economy/submitIndicatorTranslation';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import { analysisSeed } from '@/infrastructure/hash/analysisInput';
import { setJobMeta } from '@/infrastructure/jobs/queue';

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

const INDICATOR_NAME = 'Core PCE Price Index YoY';

describe('submitIndicatorTranslation 함수는', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal('fetch', mockFetch);
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
        vi.unstubAllGlobals();
        process.env = originalEnv;
    });

    it('캐시 히트면 cached + nameKo 반환, worker 미호출', async () => {
        // Poll path stores { nameKo } in cache; normalizeIndicatorTranslation extracts it.
        mockCacheGet.mockResolvedValueOnce({
            nameKo: '근원 PCE 물가지수 전년比',
        });

        const result = await submitIndicatorTranslation(INDICATOR_NAME);

        expect(result.status).toBe('cached');
        if (result.status === 'cached') {
            expect(result.nameKo).toBe('근원 PCE 물가지수 전년比');
        }
        expect(mockFetch).not.toHaveBeenCalled();
    });

    it('캐시 히트 — JSON 문자열 캐시값도 normalizeIndicatorTranslation으로 처리', async () => {
        mockCacheGet.mockResolvedValueOnce(
            JSON.stringify({ nameKo: '비농업 고용지수' })
        );

        const result = await submitIndicatorTranslation('Nonfarm Payrolls');

        expect(result.status).toBe('cached');
        if (result.status === 'cached') {
            expect(result.nameKo).toBe('비농업 고용지수');
        }
    });

    it('캐시 미스면 worker /analyze에 model 포함 POST', async () => {
        const result = await submitIndicatorTranslation(INDICATOR_NAME);

        expect(result.status).toBe('submitted');
        expect(mockFetch).toHaveBeenCalledWith(
            'https://worker.test/analyze',
            expect.objectContaining({ method: 'POST' })
        );
        const [, init] = mockFetch.mock.calls[0] as [string, { body: string }];
        const body = JSON.parse(init.body) as Record<string, unknown>;
        expect(body).toMatchObject({
            jobId: expect.any(String),
            model: INDICATOR_TRANSLATION_MODEL_ID,
        });
        expect(body.seed).toBe(analysisSeed(body.prompt as string));
    });

    it('캐시 키는 v1:translation:indicator:<hash>:p1 형식', async () => {
        await submitIndicatorTranslation(INDICATOR_NAME);
        const key = mockCacheGet.mock.calls[0][0] as string;
        expect(key).toMatch(/^v1:translation:indicator:[0-9a-f]{16}:p1$/);
    });

    it('동일 캐시 키를 job meta에 저장(read==write 보장)', async () => {
        await submitIndicatorTranslation(INDICATOR_NAME);
        const readKey = mockCacheGet.mock.calls[0][0] as string;
        expect(mockSetJobMeta).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({ cacheKey: readKey })
        );
    });

    it('이름이 바뀌면 캐시 키도 달라짐', async () => {
        await submitIndicatorTranslation(INDICATOR_NAME);
        const keyA = mockCacheGet.mock.calls[0][0] as string;
        mockCacheGet.mockClear();
        await submitIndicatorTranslation('Unemployment Claims');
        const keyB = mockCacheGet.mock.calls[0][0] as string;
        expect(keyA).not.toBe(keyB);
    });

    it('WORKER_URL 없으면 throw', async () => {
        delete process.env.WORKER_URL;
        await expect(
            submitIndicatorTranslation(INDICATOR_NAME)
        ).rejects.toThrow();
    });

    it('WORKER_SECRET 없으면 throw', async () => {
        delete process.env.WORKER_SECRET;
        await expect(
            submitIndicatorTranslation(INDICATOR_NAME)
        ).rejects.toThrow();
    });

    it('캐시 프로바이더 없으면 조회 건너뛰고 submitted', async () => {
        mockCreateCacheProvider.mockReturnValueOnce(null);
        const result = await submitIndicatorTranslation(INDICATOR_NAME);
        expect(result.status).toBe('submitted');
        expect(mockCacheGet).not.toHaveBeenCalled();
    });

    it('setJobMeta 실패해도 submitted + 에러 로깅', async () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        mockSetJobMeta.mockRejectedValueOnce(new Error('meta fail'));
        const result = await submitIndicatorTranslation(INDICATOR_NAME);
        expect(result.status).toBe('submitted');
        expect(spy).toHaveBeenCalledWith(
            '[IndicatorTranslation/Submit] Failed to store job meta:',
            expect.any(Error)
        );
        spy.mockRestore();
    });

    it('캐시 읽기가 throw해도 로깅 후 worker 제출로 진행', async () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        mockCacheGet.mockRejectedValueOnce(new Error('cache down'));
        const result = await submitIndicatorTranslation(INDICATOR_NAME);
        expect(result.status).toBe('submitted');
        expect(spy).toHaveBeenCalledWith(
            '[IndicatorTranslation/Submit] Cache read failed:',
            expect.any(Error)
        );
        expect(mockFetch).toHaveBeenCalled();
        spy.mockRestore();
    });

    it('worker 요청이 실패해도 submitted (fire-and-forget)', async () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        mockFetch.mockRejectedValueOnce(new Error('network'));
        const result = await submitIndicatorTranslation(INDICATOR_NAME);
        expect(result.status).toBe('submitted');
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(spy).toHaveBeenCalledWith(
            '[IndicatorTranslation/Submit] Worker request failed:',
            expect.any(Error)
        );
        spy.mockRestore();
    });

    it('waitUntil 제공 시 worker promise 등록', async () => {
        const waitUntil = vi.fn();
        await submitIndicatorTranslation(INDICATOR_NAME, { waitUntil });
        expect(waitUntil).toHaveBeenCalledWith(expect.any(Promise));
    });

    it('POST 헤더에 X-Worker-Secret 포함', async () => {
        await submitIndicatorTranslation(INDICATOR_NAME);
        const [, init] = mockFetch.mock.calls[0] as [
            string,
            { headers: Record<string, string> },
        ];
        expect(init.headers['X-Worker-Secret']).toBe('test-secret');
    });

    it('빈 문자열 입력도 정상 submitted', async () => {
        const result = await submitIndicatorTranslation('');
        expect(result.status).toBe('submitted');
    });
});
