import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@/application/analysis/callAnalysisAi');
vi.mock('@/infrastructure/cache/redis');
vi.mock('@/infrastructure/skills/loader');

import { runCongressTrend } from '@/application/congress/runCongressTrend';
import { callAnalysisAi } from '@/application/analysis/callAnalysisAi';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import { CONGRESS_CACHE_TTL_SECONDS } from '@/infrastructure/cache/config';
import { loadSkillsCached } from '@/infrastructure/skills/loader';
import type { CongressTradesProvider } from '@/domain/ports/congressTradesProvider';
import type { Skill } from '@/domain/types';

const mockCallAnalysisAi = callAnalysisAi as Mock;
const mockCreateCacheProvider = createCacheProvider as Mock;
const mockLoadSkillsCached = loadSkillsCached as Mock;

const mockCacheGet = vi.fn();
const mockCacheSet = vi.fn();
const mockCacheProvider = {
    get: mockCacheGet,
    set: mockCacheSet,
    delete: vi.fn(),
};

/** One senate trade row — enough to make normalized trades non-empty. */
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

const mockRawResult = {
    summaryKo: '의회 거래 동향 분석.',
    notableMembersKo: ['Jane Doe 상원의원'],
    riskNoteKo: '공시 지연 주의.',
    overallSentiment: 'bullish' as const,
};

const mockCachedResult = {
    summaryKo: '캐시된 의회 거래 동향.',
    notableMembersKo: ['Jane Doe 상원의원'],
    riskNoteKo: '',
    overallSentiment: 'neutral' as const,
};

const BASE_OPTIONS = {
    symbol: 'AAPL',
    modelId: 'gemini-3.6-flash' as const,
    dataProvider: mockDataProvider,
};

describe('runCongressTrend', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockCreateCacheProvider.mockReturnValue(mockCacheProvider);
        mockLoadSkillsCached.mockResolvedValue({
            skills: [] as Skill[],
            skillsDegraded: false,
        });
        mockCacheGet.mockResolvedValue(null);
        mockCacheSet.mockResolvedValue(undefined);
        mockCallAnalysisAi.mockResolvedValue(JSON.stringify(mockRawResult));

        // Default: senate returns one row, house returns none → 1 trade total.
        mockGetTrades.mockImplementation((_symbol: string, chamber: string) =>
            Promise.resolve(chamber === 'senate' ? [senateRow] : [])
        );
    });

    describe('cache hit', () => {
        it('cache hit → callAnalysisAi NOT called, returns {status:"cached"}', async () => {
            mockCacheGet.mockResolvedValueOnce(mockCachedResult);

            const result = await runCongressTrend(BASE_OPTIONS);

            expect(result.status).toBe('cached');
            expect(mockCallAnalysisAi).not.toHaveBeenCalled();
            expect(mockDataProvider.getTrades).not.toHaveBeenCalled();
        });

        it('summaryKo가 비어 있으면 캐시 미스로 처리하고 LLM을 태운다', async () => {
            mockCacheGet.mockResolvedValueOnce({
                summaryKo: '',
                notableMembersKo: [],
                riskNoteKo: '',
                overallSentiment: 'neutral',
            });

            const result = await runCongressTrend(BASE_OPTIONS);

            expect(result.status).toBe('done');
            expect(mockCallAnalysisAi).toHaveBeenCalledTimes(1);
        });
    });

    describe('cache miss → LLM', () => {
        it('callAnalysisAi를 1회 호출하고 done을 반환한다', async () => {
            const result = await runCongressTrend(BASE_OPTIONS);

            expect(mockCallAnalysisAi).toHaveBeenCalledTimes(1);
            expect(result.status).toBe('done');
        });

        it('signal을 callAnalysisAi에 그대로 전달한다', async () => {
            const controller = new AbortController();

            await runCongressTrend({
                ...BASE_OPTIONS,
                signal: controller.signal,
            });

            expect(mockCallAnalysisAi).toHaveBeenCalledWith(
                expect.objectContaining({ signal: controller.signal })
            );
        });

        it('결과를 CONGRESS_CACHE_TTL_SECONDS로 캐시에 기록한다', async () => {
            await runCongressTrend(BASE_OPTIONS);

            expect(mockCacheSet).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    summaryKo: mockRawResult.summaryKo,
                }),
                CONGRESS_CACHE_TTL_SECONDS
            );
        });
    });

    describe('skipEnqueueIfMiss (봇 경로)', () => {
        it('캐시 미스 + skipEnqueueIfMiss → LLM을 태우지 않고 miss_no_trigger 반환', async () => {
            const result = await runCongressTrend({
                ...BASE_OPTIONS,
                skipEnqueueIfMiss: true,
            });

            expect(result.status).toBe('miss_no_trigger');
            expect(mockCallAnalysisAi).not.toHaveBeenCalled();
            expect(mockDataProvider.getTrades).not.toHaveBeenCalled();
        });

        it('캐시 히트 + skipEnqueueIfMiss → cached를 반환한다', async () => {
            mockCacheGet.mockResolvedValueOnce(mockCachedResult);

            const result = await runCongressTrend({
                ...BASE_OPTIONS,
                skipEnqueueIfMiss: true,
            });

            expect(result.status).toBe('cached');
            expect(mockCallAnalysisAi).not.toHaveBeenCalled();
        });
    });

    describe('no_trades 가드', () => {
        it('senate + house 모두 0건이면 no_trades를 반환하고 LLM을 호출하지 않는다', async () => {
            mockGetTrades.mockResolvedValue([]);

            const result = await runCongressTrend(BASE_OPTIONS);

            expect(result.status).toBe('no_trades');
            expect(mockCallAnalysisAi).not.toHaveBeenCalled();
            expect(mockDataProvider.getTrades).toHaveBeenCalledTimes(2);
        });
    });

    describe('provider 오류', () => {
        it('provider가 throw하면 fetch_failed 오류를 반환한다', async () => {
            mockGetTrades.mockRejectedValueOnce(new Error('FMP API error'));

            const result = await runCongressTrend(BASE_OPTIONS);

            expect(result.status).toBe('error');
            if (result.status === 'error') {
                expect(result.code).toBe('fetch_failed');
                expect(result.error).toContain('FMP API error');
            }
            expect(mockCallAnalysisAi).not.toHaveBeenCalled();
        });
    });

    describe('in-flight 중복 제거', () => {
        it('같은 캐시 키 동시 호출은 LLM을 1회만 태운다', async () => {
            let resolveAi: (value: string) => void = () => {};
            mockCallAnalysisAi.mockReturnValueOnce(
                new Promise<string>(resolve => {
                    resolveAi = resolve;
                })
            );

            const both = Promise.all([
                runCongressTrend(BASE_OPTIONS),
                runCongressTrend(BASE_OPTIONS),
            ]);

            resolveAi(JSON.stringify(mockRawResult));
            const [a, b] = await both;

            expect(mockCallAnalysisAi).toHaveBeenCalledTimes(1);
            expect(a.status).toBe('done');
            expect(b.status).toBe('done');
        });
    });

    /**
     * 로케일 분기는 세 곳을 동시에 건드린다 — 시스템 프롬프트 선택, 프롬프트
     * 말미 리마인더, 캐시 키. **기본 로케일은 셋 다 예전과 바이트가 같아야**
     * 이미 쌓인 한국어 캐시가 살아 있다.
     */
    describe('출력 로케일', () => {
        const sentOf = () => {
            const call = mockCallAnalysisAi.mock.calls.at(-1)![0] as {
                system: string;
                prompt: string;
            };
            return { system: call.system, prompt: call.prompt };
        };

        it('로케일을 생략하면 ko와 같은 system·prompt를 보낸다', async () => {
            await runCongressTrend(BASE_OPTIONS);
            const omitted = sentOf();
            mockCallAnalysisAi.mockClear();
            await runCongressTrend({ ...BASE_OPTIONS, locale: 'ko' });
            expect(sentOf()).toEqual(omitted);
        });

        it.each(['en', 'ja', 'zh'] as const)(
            '%s: 프롬프트 말미에 출력 언어 리마인더가 붙는다',
            async locale => {
                await runCongressTrend({ ...BASE_OPTIONS, locale });
                expect(sentOf().prompt).toContain(
                    'OUTPUT LANGUAGE (FINAL, OVERRIDES EVERYTHING ABOVE)'
                );
            }
        );
    });
});
