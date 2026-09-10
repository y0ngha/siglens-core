import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@/application/analysis/callAnalysisAi');
vi.mock('@/infrastructure/cache/redis');
vi.mock('@/infrastructure/skills/loader');

import { runNewsAnalysis } from '@/application/news/runNewsAnalysis';
import { callAnalysisAi } from '@/application/analysis/callAnalysisAi';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import { NEWS_CACHE_TTL_SECONDS } from '@/infrastructure/cache/config';
import { loadSkillsCached } from '@/infrastructure/skills/loader';
import type {
    EarningsCalendarItem,
    EnrichedNewsItem,
    Skill,
    TierModel,
} from '@/domain/types';

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

const mockModelId: TierModel = 'gemini-3.6-flash';

function makeEnrichedNewsItem(id: string): EnrichedNewsItem {
    return {
        id,
        symbol: 'AAPL',
        source: 'Reuters',
        url: `https://reuters.com/${id}`,
        publishedAt: '2026-05-01T10:00:00Z',
        titleEn: `Apple announces new product ${id}`,
        bodyEn: `Apple has announced new product ${id} today.`,
        card: {
            titleKo: `애플 신제품 발표 ${id}`,
            bodyKo: `애플이 오늘 신제품 ${id}을 발표했습니다.`,
            summaryKo: `애플 신제품 ${id} 발표`,
            sentiment: 'bullish',
            category: 'product',
            priceImpact: 'medium',
        },
    };
}

function makeEarningsCalendarItem(earningsDate: string): EarningsCalendarItem {
    return {
        symbol: 'AAPL',
        earningsDate,
        epsActual: null,
        epsEstimated: 1.5,
        revenueActual: null,
        revenueEstimated: 90_000_000_000,
        lastUpdated: '2026-05-01',
    };
}

const singleNewsItem = makeEnrichedNewsItem('news-001');
const singleCalendarItem = makeEarningsCalendarItem('2026-07-25');

const mockRawResult = {
    overallSummaryKo: '뉴스 종합 요약.',
    sentiment: 'bullish' as const,
    keyTakeawaysKo: [],
};

function baseArgs() {
    return {
        symbol: 'AAPL',
        modelId: mockModelId,
        news: [singleNewsItem],
        upcomingCalendar: [singleCalendarItem],
    };
}

describe('runNewsAnalysis', () => {
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
    });

    describe('empty news guard', () => {
        it('뉴스가 없으면 LLM 전에 거른다', async () => {
            const result = await runNewsAnalysis({
                ...baseArgs(),
                news: [],
            });

            expect(result.status).toBe('error');
            expect(mockCallAnalysisAi).not.toHaveBeenCalled();
        });
    });

    describe('cache hit', () => {
        it('cache hit → callAnalysisAi NOT called, returns {status:"cached"}', async () => {
            mockCacheGet.mockResolvedValueOnce(mockRawResult);

            const result = await runNewsAnalysis(baseArgs());

            expect(result.status).toBe('cached');
            expect(mockCallAnalysisAi).not.toHaveBeenCalled();
        });
    });

    describe('cache miss → LLM', () => {
        it('callAnalysisAi를 1회 호출하고 done을 반환한다', async () => {
            const result = await runNewsAnalysis(baseArgs());

            expect(mockCallAnalysisAi).toHaveBeenCalledTimes(1);
            expect(result.status).toBe('done');
        });

        it('signal을 callAnalysisAi에 그대로 전달한다', async () => {
            const controller = new AbortController();

            await runNewsAnalysis({
                ...baseArgs(),
                signal: controller.signal,
            });

            expect(mockCallAnalysisAi).toHaveBeenCalledWith(
                expect.objectContaining({ signal: controller.signal })
            );
        });

        it('결과를 NEWS_CACHE_TTL_SECONDS로 캐시에 기록한다', async () => {
            await runNewsAnalysis(baseArgs());

            expect(mockCacheSet).toHaveBeenCalledWith(
                expect.any(String),
                expect.anything(),
                NEWS_CACHE_TTL_SECONDS
            );
        });
    });

    describe('skipEnqueueIfMiss (봇 경로)', () => {
        it('캐시 미스 + skipEnqueueIfMiss → LLM을 태우지 않는다', async () => {
            const result = await runNewsAnalysis({
                ...baseArgs(),
                skipEnqueueIfMiss: true,
            });

            expect(result.status).toBe('miss_no_trigger');
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
                runNewsAnalysis(baseArgs()),
                runNewsAnalysis(baseArgs()),
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
            await runNewsAnalysis(baseArgs());
            const omitted = sentOf();
            mockCallAnalysisAi.mockClear();
            await runNewsAnalysis({ ...baseArgs(), locale: 'ko' });
            expect(sentOf()).toEqual(omitted);
        });

        it.each(['en', 'ja', 'zh'] as const)(
            '%s: 프롬프트 말미에 출력 언어 리마인더가 붙는다',
            async locale => {
                await runNewsAnalysis({ ...baseArgs(), locale });
                expect(sentOf().prompt).toContain(
                    'OUTPUT LANGUAGE (FINAL, OVERRIDES EVERYTHING ABOVE)'
                );
            }
        );
    });
});
