import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@/application/analysis/callAnalysisAi');
vi.mock('@/infrastructure/cache/redis');

import { runMarketNewsDigest } from '@/application/news/runMarketNewsDigest';
import { callAnalysisAi } from '@/application/analysis/callAnalysisAi';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import { NEWS_CACHE_TTL_SECONDS } from '@/infrastructure/cache/config';
import { DEEPSEEK_V4_1_FLASH_MODEL } from '@/application/chat/constants';
import type { EnrichedNewsItem, TierModel } from '@/domain/types';

const mockCallAnalysisAi = callAnalysisAi as Mock;
const mockCreateCacheProvider = createCacheProvider as Mock;

const mockCacheGet = vi.fn();
const mockCacheSet = vi.fn();
const mockCacheProvider = {
    get: mockCacheGet,
    set: mockCacheSet,
    delete: vi.fn(),
};

const ITEM: EnrichedNewsItem = {
    id: 'digest-001',
    symbol: '__NEWS_CRYPTO__',
    source: 'CoinWire',
    url: 'https://example.com/btc',
    publishedAt: '2026-06-15T12:00:00Z',
    titleEn: 'BTC ETF inflows surge',
    bodyEn: null,
    card: {
        titleKo: 'BTC ETF 유입 급증',
        bodyKo: null,
        summaryKo: '유입 급증',
        sentiment: 'bullish',
        category: 'macro',
        priceImpact: 'high',
    },
};

const mockRawResult = {
    currentDriverKo: '시장 전반 상승 모멘텀.',
    keyEventsKo: ['BTC ETF 유입 급증'],
    upcomingEventsKo: [],
    overallSentiment: 'bullish' as const,
};

function baseArgs() {
    return {
        category: 'crypto' as const,
        categoryLabel: '미국 암호화폐',
        modelId: 'gemini-3.6-flash' as const,
        news: [ITEM],
    };
}

describe('runMarketNewsDigest', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockCreateCacheProvider.mockReturnValue(mockCacheProvider);
        mockCacheGet.mockResolvedValue(null);
        mockCacheSet.mockResolvedValue(undefined);
        mockCallAnalysisAi.mockResolvedValue(JSON.stringify(mockRawResult));
    });

    describe('no_news 가드', () => {
        it('뉴스가 없으면 LLM 전에 no_news를 반환한다', async () => {
            const result = await runMarketNewsDigest({
                ...baseArgs(),
                news: [],
            });

            expect(result.status).toBe('no_news');
            expect(mockCallAnalysisAi).not.toHaveBeenCalled();
        });
    });

    describe('cache hit', () => {
        it('cache hit → callAnalysisAi NOT called, returns {status:"cached"}', async () => {
            mockCacheGet.mockResolvedValueOnce(mockRawResult);

            const result = await runMarketNewsDigest(baseArgs());

            expect(result.status).toBe('cached');
            expect(mockCallAnalysisAi).not.toHaveBeenCalled();
        });

        it('force=true이면 캐시를 우회한다', async () => {
            mockCacheGet.mockResolvedValue(mockRawResult);

            const result = await runMarketNewsDigest({
                ...baseArgs(),
                force: true,
            });

            expect(result.status).toBe('done');
            expect(mockCallAnalysisAi).toHaveBeenCalledTimes(1);
        });
    });

    describe('cache miss → LLM', () => {
        it('callAnalysisAi를 1회 호출하고 done을 반환한다', async () => {
            const result = await runMarketNewsDigest(baseArgs());

            expect(mockCallAnalysisAi).toHaveBeenCalledTimes(1);
            expect(result.status).toBe('done');
        });

        it('signal을 callAnalysisAi에 그대로 전달한다', async () => {
            const controller = new AbortController();

            await runMarketNewsDigest({
                ...baseArgs(),
                signal: controller.signal,
            });

            expect(mockCallAnalysisAi).toHaveBeenCalledWith(
                expect.objectContaining({ signal: controller.signal })
            );
        });

        it('providerFallback을 fallbackOnProviderFailure로 전달한다', async () => {
            await runMarketNewsDigest({
                ...baseArgs(),
                providerFallback: true,
            });

            expect(mockCallAnalysisAi).toHaveBeenCalledWith(
                expect.objectContaining({ fallbackOnProviderFailure: true })
            );
        });

        it('reasoning을 callAnalysisAi에 그대로 전달한다', async () => {
            // `true`는 모델 스펙을 오버라이드한다 — 스펙상 non-thinking인
            // deepseek-v4-flash에서도 추론이 켜져야 한다(그래야 추론 티어
            // 모델 값을 치르지 않고 다이제스트 품질을 유지한다).
            await runMarketNewsDigest({ ...baseArgs(), reasoning: true });

            expect(mockCallAnalysisAi).toHaveBeenCalledWith(
                expect.objectContaining({ reasoning: true })
            );
        });

        it('reasoning을 생략하면 undefined로 전달해 모델 스펙 기본값을 보존한다', async () => {
            // `callAnalysisAi`는 `reasoning === undefined`를 "개입 안 함"으로
            // 취급한다. 여기서 false로 강등하면 호출자가 스펙 기본값을 고를
            // 방법이 사라진다.
            await runMarketNewsDigest(baseArgs());

            expect(mockCallAnalysisAi).toHaveBeenCalledWith(
                expect.objectContaining({ reasoning: undefined })
            );
        });

        it('결과를 NEWS_CACHE_TTL_SECONDS로 캐시에 기록한다', async () => {
            await runMarketNewsDigest(baseArgs());

            expect(mockCacheSet).toHaveBeenCalledWith(
                expect.any(String),
                expect.anything(),
                NEWS_CACHE_TTL_SECONDS
            );
        });
    });

    describe('skipEnqueueIfMiss (봇 경로)', () => {
        it('캐시 미스 + skipEnqueueIfMiss → LLM을 태우지 않는다', async () => {
            const result = await runMarketNewsDigest({
                ...baseArgs(),
                skipEnqueueIfMiss: true,
            });

            expect(result.status).toBe('miss_no_trigger');
            expect(mockCallAnalysisAi).not.toHaveBeenCalled();
        });

        it('캐시 히트 + skipEnqueueIfMiss → cached를 반환한다', async () => {
            mockCacheGet.mockResolvedValueOnce(mockRawResult);

            const result = await runMarketNewsDigest({
                ...baseArgs(),
                skipEnqueueIfMiss: true,
            });

            expect(result.status).toBe('cached');
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
                runMarketNewsDigest(baseArgs()),
                runMarketNewsDigest(baseArgs()),
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
            await runMarketNewsDigest(baseArgs());
            const omitted = sentOf();
            mockCallAnalysisAi.mockClear();
            await runMarketNewsDigest({ ...baseArgs(), locale: 'ko' });
            expect(sentOf()).toEqual(omitted);
        });

        it.each(['en', 'ja', 'zh'] as const)(
            '%s: 프롬프트 말미에 출력 언어 리마인더가 붙는다',
            async locale => {
                await runMarketNewsDigest({ ...baseArgs(), locale });
                expect(sentOf().prompt).toContain(
                    'OUTPUT LANGUAGE (FINAL, OVERRIDES EVERYTHING ABOVE)'
                );
            }
        );
    });

    describe('모델 해석', () => {
        it('MODEL_SPECS에 없는 폐기 모델 문자열은 DeepSeek 기본 모델로 호출한다', async () => {
            const result = await runMarketNewsDigest({
                ...baseArgs(),
                modelId: 'gemini-2.5-flash' as unknown as TierModel,
            });

            expect(result.status).toBe('done');
            expect(mockCallAnalysisAi).toHaveBeenCalledWith(
                expect.objectContaining({ model: DEEPSEEK_V4_1_FLASH_MODEL })
            );
        });

        it('활성 모델은 그대로 호출한다', async () => {
            await runMarketNewsDigest(baseArgs());

            expect(mockCallAnalysisAi).toHaveBeenCalledWith(
                expect.objectContaining({ model: 'gemini-3.6-flash' })
            );
        });
    });

    describe('캐시 장애 내성', () => {
        it('캐시 프로바이더가 없으면(null) 캐시 없이 LLM 결과를 반환한다', async () => {
            mockCreateCacheProvider.mockReturnValue(null);

            const result = await runMarketNewsDigest(baseArgs());

            expect(result.status).toBe('done');
            expect(mockCallAnalysisAi).toHaveBeenCalledTimes(1);
            expect(mockCacheGet).not.toHaveBeenCalled();
            expect(mockCacheSet).not.toHaveBeenCalled();
        });

        it('캐시 조회가 실패하면 로그를 남기고 LLM 경로로 진행한다', async () => {
            const errorSpy = vi
                .spyOn(console, 'error')
                .mockImplementation(() => {});
            mockCacheGet.mockRejectedValueOnce(new Error('redis down'));

            const result = await runMarketNewsDigest(baseArgs());

            expect(result.status).toBe('done');
            expect(mockCallAnalysisAi).toHaveBeenCalledTimes(1);
            expect(errorSpy).toHaveBeenCalledWith(
                '[RunMarketNewsDigest]',
                'Cache lookup failed:',
                expect.any(Error)
            );
            errorSpy.mockRestore();
        });

        it('캐시 쓰기가 실패해도 응답은 done이고 오류는 로그로만 남는다', async () => {
            const errorSpy = vi
                .spyOn(console, 'error')
                .mockImplementation(() => {});
            mockCacheSet.mockRejectedValueOnce(new Error('redis write down'));

            const result = await runMarketNewsDigest(baseArgs());

            expect(result.status).toBe('done');
            await vi.waitFor(() =>
                expect(errorSpy).toHaveBeenCalledWith(
                    '[RunMarketNewsDigest]',
                    'Cache write failed:',
                    expect.any(Error)
                )
            );
            errorSpy.mockRestore();
        });
    });

    describe('빈 다이제스트', () => {
        it('스키마와 다른 응답은 빈 결과로 정규화해 경고하되 캐시는 기록한다', async () => {
            const warnSpy = vi
                .spyOn(console, 'warn')
                .mockImplementation(() => {});
            mockCallAnalysisAi.mockResolvedValueOnce(
                JSON.stringify({ unexpected: 'shape' })
            );

            const result = await runMarketNewsDigest(baseArgs());

            expect(result.status).toBe('done');
            if (result.status === 'done') {
                expect(result.result.currentDriverKo).toBe('');
                expect(result.result.keyEventsKo).toEqual([]);
            }
            expect(warnSpy).toHaveBeenCalledWith(
                '[RunMarketNewsDigest]',
                'Empty digest; raw payload likely malformed',
                { category: 'crypto' }
            );
            expect(mockCacheSet).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({ currentDriverKo: '' }),
                NEWS_CACHE_TTL_SECONDS
            );
            warnSpy.mockRestore();
        });

        it('정상 응답은 경고 없이 그대로 반환한다', async () => {
            const warnSpy = vi
                .spyOn(console, 'warn')
                .mockImplementation(() => {});

            const result = await runMarketNewsDigest(baseArgs());

            expect(result).toEqual({ status: 'done', result: mockRawResult });
            expect(warnSpy).not.toHaveBeenCalled();
            warnSpy.mockRestore();
        });
    });
});
