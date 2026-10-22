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
import { DEEPSEEK_V4_1_FLASH_MODEL } from '@/application/chat/constants';
import type { Skill, TierModel } from '@/domain/types';

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

    describe('options.cache 주입', () => {
        const injectedGet = vi.fn();
        const injectedSet = vi.fn();
        const injectedCache = {
            get: injectedGet,
            set: injectedSet,
            delete: vi.fn(),
        };

        beforeEach(() => {
            injectedGet.mockReset();
            injectedSet.mockReset();
            injectedGet.mockResolvedValue(null);
            injectedSet.mockResolvedValue(undefined);
        });

        it('주입한 캐시에서 읽고, env 캐시는 만들지도 읽지도 않는다', async () => {
            injectedGet.mockResolvedValueOnce(mockCachedResult);

            const result = await runCongressTrend({
                ...BASE_OPTIONS,
                cache: injectedCache,
            });

            expect(result.status).toBe('cached');
            expect(injectedGet).toHaveBeenCalledTimes(1);
            expect(mockCreateCacheProvider).not.toHaveBeenCalled();
            expect(mockCacheGet).not.toHaveBeenCalled();
            expect(mockCallAnalysisAi).not.toHaveBeenCalled();
        });

        it('cache: null 이면 env 캐시로 폴백하지 않고 캐시 없이 실행한다', async () => {
            const result = await runCongressTrend({
                ...BASE_OPTIONS,
                cache: null,
            });

            expect(result.status).toBe('done');
            expect(mockCreateCacheProvider).not.toHaveBeenCalled();
            expect(mockCacheGet).not.toHaveBeenCalled();
            expect(mockCacheSet).not.toHaveBeenCalled();
            expect(mockCallAnalysisAi).toHaveBeenCalledTimes(1);
        });
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

    describe('캐시 우회·장애 내성', () => {
        it('force=true이면 캐시를 읽지 않고 provider·LLM을 태운 뒤 결과를 다시 쓴다', async () => {
            mockCacheGet.mockResolvedValue(mockCachedResult);

            const result = await runCongressTrend({
                ...BASE_OPTIONS,
                force: true,
            });

            expect(result.status).toBe('done');
            expect(mockCacheGet).not.toHaveBeenCalled();
            expect(mockGetTrades).toHaveBeenCalledTimes(2);
            expect(mockCallAnalysisAi).toHaveBeenCalledTimes(1);
            expect(mockCacheSet).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({ summaryKo: mockRawResult.summaryKo }),
                CONGRESS_CACHE_TTL_SECONDS
            );
        });

        it('캐시 프로바이더가 없으면(null) 캐시 없이 LLM 결과를 반환한다', async () => {
            mockCreateCacheProvider.mockReturnValue(null);

            const result = await runCongressTrend(BASE_OPTIONS);

            expect(result.status).toBe('done');
            expect(mockCallAnalysisAi).toHaveBeenCalledTimes(1);
            expect(mockCacheGet).not.toHaveBeenCalled();
            expect(mockCacheSet).not.toHaveBeenCalled();
        });

        it('캐시 읽기가 실패하면 로그를 남기고 provider·LLM 경로로 진행한다', async () => {
            const errorSpy = vi
                .spyOn(console, 'error')
                .mockImplementation(() => {});
            mockCacheGet.mockRejectedValueOnce(new Error('redis down'));

            const result = await runCongressTrend(BASE_OPTIONS);

            expect(result.status).toBe('done');
            expect(mockCallAnalysisAi).toHaveBeenCalledTimes(1);
            expect(errorSpy).toHaveBeenCalledWith(
                '[RunCongressTrend] Cache read failed:',
                expect.any(Error)
            );
            errorSpy.mockRestore();
        });

        it('캐시 쓰기가 실패해도 응답은 done이고 오류는 로그로만 남는다', async () => {
            const errorSpy = vi
                .spyOn(console, 'error')
                .mockImplementation(() => {});
            mockCacheSet.mockRejectedValueOnce(new Error('redis write down'));

            const result = await runCongressTrend(BASE_OPTIONS);

            expect(result.status).toBe('done');
            await vi.waitFor(() =>
                expect(errorSpy).toHaveBeenCalledWith(
                    '[RunCongressTrend] Cache write failed:',
                    expect.any(Error)
                )
            );
            errorSpy.mockRestore();
        });
    });

    describe('모델 해석', () => {
        it('MODEL_SPECS에 없는 폐기 모델 문자열은 DeepSeek 기본 모델로 호출한다', async () => {
            const result = await runCongressTrend({
                ...BASE_OPTIONS,
                modelId: 'gemini-2.5-flash' as unknown as TierModel,
            });

            expect(result.status).toBe('done');
            expect(mockCallAnalysisAi).toHaveBeenCalledWith(
                expect.objectContaining({ model: DEEPSEEK_V4_1_FLASH_MODEL })
            );
        });

        it('userApiKey와 tier를 LLM 호출에 그대로 전달한다', async () => {
            await runCongressTrend({
                ...BASE_OPTIONS,
                tier: 'member',
                userApiKey: 'usr-key',
            });

            expect(mockCallAnalysisAi).toHaveBeenCalledWith(
                expect.objectContaining({
                    model: 'gemini-3.6-flash',
                    tier: 'member',
                    userApiKey: 'usr-key',
                })
            );
        });
    });

    describe('빈 분석 결과', () => {
        it('스키마와 다른 응답은 빈 결과로 정규화해 경고하되 캐시는 기록한다', async () => {
            const warnSpy = vi
                .spyOn(console, 'warn')
                .mockImplementation(() => {});
            mockCallAnalysisAi.mockResolvedValueOnce(
                JSON.stringify({ unexpected: 'shape' })
            );

            const result = await runCongressTrend(BASE_OPTIONS);

            expect(result.status).toBe('done');
            if (result.status === 'done') {
                expect(result.result.summaryKo).toBe('');
                expect(result.result.notableMembersKo).toEqual([]);
            }
            expect(warnSpy).toHaveBeenCalledWith(
                '[RunCongressTrend] Empty congress trend analysis',
                { symbol: 'AAPL' }
            );
            expect(mockCacheSet).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({ summaryKo: '' }),
                CONGRESS_CACHE_TTL_SECONDS
            );
            warnSpy.mockRestore();
        });

        it('요약 없이 주요 의원만 있어도 부분 결과로 보고 경고하지 않는다', async () => {
            const warnSpy = vi
                .spyOn(console, 'warn')
                .mockImplementation(() => {});
            mockCallAnalysisAi.mockResolvedValueOnce(
                JSON.stringify({ ...mockRawResult, summaryKo: '' })
            );

            const result = await runCongressTrend(BASE_OPTIONS);

            expect(result.status).toBe('done');
            expect(warnSpy).not.toHaveBeenCalled();
            warnSpy.mockRestore();
        });
    });
});
