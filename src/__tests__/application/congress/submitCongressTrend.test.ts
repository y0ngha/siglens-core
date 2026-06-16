import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';
import type { CongressTrade } from '@/domain/types';
import type { CongressTradesProvider } from '@/domain/ports/congressTradesProvider';
import { normalizeCongressTrendResponse } from '@/domain/analysis/normalizeCongressTrend';
import { CONGRESS_SYSTEM_PROMPT } from '@/domain/analysis/systemPrompt';
import { DEFAULT_TIER } from '@/domain/tier';

vi.mock('@/infrastructure/cache/redis');
vi.mock('@/infrastructure/jobs/queue');
vi.mock('@/application/background');
vi.mock('@/infrastructure/skills/loader');

import { submitCongressTrend } from '@/application/congress/submitCongressTrend';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import { analysisSeed } from '@/infrastructure/hash/analysisInput';
import { setJobMeta } from '@/infrastructure/jobs/queue';
import { fireAndForget } from '@/application/background';
import { loadSkillsCached } from '@/infrastructure/skills/loader';

const mockCreateCacheProvider = createCacheProvider as Mock;
const mockSetJobMeta = setJobMeta as Mock;
const mockFireAndForget = fireAndForget as Mock;
const mockLoadSkillsCached = loadSkillsCached as Mock;

const mockCacheGet = vi.fn();
const mockCacheSet = vi.fn();
const mockCacheProvider = {
    get: mockCacheGet,
    set: mockCacheSet,
    delete: vi.fn(),
};

const mockFetch = vi.fn();

/** One senate trade row — enough to make the normalized trades non-empty. */
const senateRow = {
    firstName: 'Jane',
    lastName: 'Doe',
    office: 'Jane Doe',
    district: 'CA',
    owner: 'self',
    type: 'Purchase',
    amount: '$1,001 - $15,000',
    assetType: 'Stock',
    assetDescription: 'Apple Inc',
    transactionDate: '2026-05-01',
    disclosureDate: '2026-05-20',
    link: 'https://example.test/1',
    capitalGainsOver200USD: 'false',
};

const mockGetTrades = vi.fn();
const mockDataProvider: CongressTradesProvider = {
    getTrades: mockGetTrades,
};

/** Build a typed trade fixture to assert against (mirrors normalizeCongressTrades output). */
function makeTrade(): CongressTrade[] {
    return [
        {
            chamber: 'senate',
            firstName: 'Jane',
            lastName: 'Doe',
            office: 'Jane Doe',
            district: 'CA',
            owner: 'self',
            side: 'buy',
            rawType: 'Purchase',
            amount: { min: 1001, max: 15000, label: '$1,001 - $15,000' },
            assetType: 'Stock',
            assetDescription: 'Apple Inc',
            transactionDate: '2026-05-01',
            disclosureDate: '2026-05-20',
            link: 'https://example.test/1',
            capitalGainsOver200USD: false,
        },
    ];
}

const mockCachedResult = {
    summaryKo: '캐시된 의회 거래 동향입니다.',
    notableMembersKo: ['Jane Doe 상원의원'],
    riskNoteKo: '공시 지연 주의.',
    overallSentiment: 'bullish' as const,
};

describe('submitCongressTrend 함수는', () => {
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
        mockFetch.mockResolvedValue(new Response('{}', { status: 200 }));
        mockFireAndForget.mockImplementation(() => undefined);
        mockLoadSkillsCached.mockResolvedValue({
            skills: [],
            skillsDegraded: false,
        });

        // Default: senate returns one row, house returns none → 1 trade total.
        mockGetTrades.mockImplementation((_symbol: string, chamber: string) =>
            Promise.resolve(chamber === 'senate' ? [senateRow] : [])
        );
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        process.env = originalEnv;
    });

    describe('캐시 히트일 때', () => {
        it('cached 상태와 함께 결과를 반환하고 provider를 호출하지 않는다', async () => {
            mockCacheGet.mockResolvedValueOnce(mockCachedResult);

            const result = await submitCongressTrend({
                symbol: 'AAPL',
                modelId: 'gemini-2.5-flash',
                dataProvider: mockDataProvider,
            });

            expect(result.status).toBe('cached');
            if (result.status === 'cached') {
                expect(result.result).toEqual(
                    normalizeCongressTrendResponse(mockCachedResult)
                );
            }
            expect(mockSetJobMeta).not.toHaveBeenCalled();
            expect(mockFetch).not.toHaveBeenCalled();
            expect(mockDataProvider.getTrades).not.toHaveBeenCalled();
        });

        it('summaryKo가 비어 있으면 캐시 미스로 처리하고 provider를 호출한다', async () => {
            mockCacheGet.mockResolvedValueOnce({
                summaryKo: '',
                notableMembersKo: [],
                riskNoteKo: '',
                overallSentiment: 'neutral',
            });

            const result = await submitCongressTrend({
                symbol: 'AAPL',
                modelId: 'gemini-2.5-flash',
                dataProvider: mockDataProvider,
            });

            expect(result.status).toBe('submitted');
            expect(mockDataProvider.getTrades).toHaveBeenCalled();
        });

        it('force=true이면 캐시를 우회한다', async () => {
            mockCacheGet.mockReset();
            mockCacheGet.mockResolvedValue(mockCachedResult);

            const result = await submitCongressTrend({
                symbol: 'AAPL',
                modelId: 'gemini-2.5-flash',
                dataProvider: mockDataProvider,
                force: true,
            });

            expect(result.status).toBe('submitted');
            expect(mockCacheGet).not.toHaveBeenCalled();
            expect(mockDataProvider.getTrades).toHaveBeenCalled();
        });

        it('캐시 읽기가 실패하면 catch에서 흡수하고 submit 경로로 진행한다', async () => {
            mockCacheGet.mockRejectedValueOnce(new Error('redis down'));

            const result = await submitCongressTrend({
                symbol: 'AAPL',
                modelId: 'gemini-2.5-flash',
                dataProvider: mockDataProvider,
            });

            expect(result.status).toBe('submitted');
            expect(mockDataProvider.getTrades).toHaveBeenCalled();
        });
    });

    describe('캐시 미스 + 거래가 있을 때', () => {
        beforeEach(() => {
            mockCacheGet.mockResolvedValueOnce(null);
        });

        it('senate/house provider를 병렬 호출하고 submitted + jobId를 반환하며 워커에 POST 1회', async () => {
            const result = await submitCongressTrend({
                symbol: 'AAPL',
                modelId: 'gemini-2.5-flash',
                dataProvider: mockDataProvider,
            });

            expect(result.status).toBe('submitted');
            if (result.status === 'submitted') {
                expect(typeof result.jobId).toBe('string');
                expect(result.jobId.length).toBeGreaterThan(0);
            }
            expect(mockDataProvider.getTrades).toHaveBeenCalledWith(
                'AAPL',
                'senate',
                50
            );
            expect(mockDataProvider.getTrades).toHaveBeenCalledWith(
                'AAPL',
                'house',
                50
            );
            expect(mockSetJobMeta).toHaveBeenCalled();
            expect(mockFireAndForget).toHaveBeenCalledTimes(1);
            expect(mockFetch).toHaveBeenCalledTimes(1);
        });

        it('limit을 명시하면 provider에 그대로 전달한다', async () => {
            await submitCongressTrend({
                symbol: 'AAPL',
                modelId: 'gemini-2.5-flash',
                dataProvider: mockDataProvider,
                limit: 25,
            });

            expect(mockDataProvider.getTrades).toHaveBeenCalledWith(
                'AAPL',
                'senate',
                25
            );
        });

        it('워커에 jobId, modelId, cacheKey를 포함한 메타를 등록한다', async () => {
            await submitCongressTrend({
                symbol: 'AAPL',
                modelId: 'gemini-2.5-flash',
                dataProvider: mockDataProvider,
            });

            expect(mockSetJobMeta).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    symbol: 'AAPL',
                    modelId: 'gemini-2.5-flash',
                    cacheKey: expect.any(String),
                })
            );
        });

        it('워커 body에 analysisType=congress, system, responseSchema, seed, DEFAULT_TIER를 포함한다', async () => {
            await submitCongressTrend({
                symbol: 'AAPL',
                modelId: 'gemini-2.5-flash',
                dataProvider: mockDataProvider,
            });

            const body = JSON.parse(
                mockFetch.mock.calls[0][1].body as string
            ) as Record<string, unknown>;
            expect(body.analysisType).toBe('congress');
            expect(body.system).toBe(CONGRESS_SYSTEM_PROMPT);
            expect(body.seed).toBe(analysisSeed(body.prompt as string));
            expect(body.responseSchema).toBeDefined();
            expect(body.tier).toBe(DEFAULT_TIER);
        });

        it('정규화된 trades가 프롬프트에 반영된다 (sanity: 의원명 포함)', async () => {
            // The fixture row should survive normalize → prompt; assert the
            // member office string appears, proving normalizeCongressTrades ran.
            const expectedTrade = makeTrade()[0];
            await submitCongressTrend({
                symbol: 'AAPL',
                modelId: 'gemini-2.5-flash',
                dataProvider: mockDataProvider,
            });

            const body = JSON.parse(
                mockFetch.mock.calls[0][1].body as string
            ) as Record<string, unknown>;
            expect(body.prompt).toContain(expectedTrade.office);
        });

        it('provider가 throw하면 fetch_failed error를 반환한다', async () => {
            mockGetTrades.mockRejectedValueOnce(new Error('FMP API error'));

            const result = await submitCongressTrend({
                symbol: 'AAPL',
                modelId: 'gemini-2.5-flash',
                dataProvider: mockDataProvider,
            });

            expect(result.status).toBe('error');
            if (result.status === 'error') {
                expect(result.code).toBe('fetch_failed');
            }
            expect(mockSetJobMeta).not.toHaveBeenCalled();
            expect(mockFireAndForget).not.toHaveBeenCalled();
        });
    });

    describe('거래가 0건일 때', () => {
        it('no_trades를 반환하고 잡을 등록하지 않으며 워커를 호출하지 않는다', async () => {
            mockCacheGet.mockResolvedValueOnce(null);
            mockGetTrades.mockResolvedValue([]);

            const result = await submitCongressTrend({
                symbol: 'NONE',
                modelId: 'gemini-2.5-flash',
                dataProvider: mockDataProvider,
            });

            expect(result).toEqual({ status: 'no_trades' });
            // Fetch happened (both chambers) but no job/worker dispatch.
            expect(mockDataProvider.getTrades).toHaveBeenCalledTimes(2);
            expect(mockSetJobMeta).not.toHaveBeenCalled();
            expect(mockFireAndForget).not.toHaveBeenCalled();
            expect(mockFetch).not.toHaveBeenCalled();
        });
    });

    describe('skipEnqueueIfMiss 옵션이 true일 때', () => {
        beforeEach(() => {
            mockCacheGet.mockReset();
        });

        it('캐시 미스이면 fetch/워커 없이 miss_no_trigger를 반환한다', async () => {
            mockCacheGet.mockResolvedValue(null);

            const result = await submitCongressTrend({
                symbol: 'AAPL',
                modelId: 'gemini-2.5-flash',
                dataProvider: mockDataProvider,
                skipEnqueueIfMiss: true,
            });

            expect(result).toEqual({ status: 'miss_no_trigger' });
            expect(mockDataProvider.getTrades).not.toHaveBeenCalled();
            expect(mockSetJobMeta).not.toHaveBeenCalled();
            expect(mockFetch).not.toHaveBeenCalled();
        });

        it('캐시 히트면 평소처럼 cached 결과를 반환한다', async () => {
            mockCacheGet.mockResolvedValue(mockCachedResult);

            const result = await submitCongressTrend({
                symbol: 'AAPL',
                modelId: 'gemini-2.5-flash',
                dataProvider: mockDataProvider,
                skipEnqueueIfMiss: true,
            });

            expect(result.status).toBe('cached');
            expect(mockFetch).not.toHaveBeenCalled();
        });
    });
});
