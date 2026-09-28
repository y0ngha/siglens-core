import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@/application/analysis/callAnalysisAi');
vi.mock('@/infrastructure/cache/redis');
vi.mock('@/infrastructure/skills/loader');
// Passthrough spy (review round 1 finding 2): keeps the REAL sampling
// behavior (so every other test's skill selection is unaffected) while
// recording the exact `seedParts` array `runNewsAnalysis` builds — the only
// way to assert on that array's content, since it never appears in any
// return value or side effect.
vi.mock('@/infrastructure/skills/sampling', async () => {
    const actual = await vi.importActual<
        typeof import('@/infrastructure/skills/sampling')
    >('@/infrastructure/skills/sampling');
    return {
        ...actual,
        createSkillSamplingPlan: vi.fn(actual.createSkillSamplingPlan),
    };
});

import { runNewsAnalysis } from '@/application/news/runNewsAnalysis';
import { callAnalysisAi } from '@/application/analysis/callAnalysisAi';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import { NEWS_CACHE_TTL_SECONDS } from '@/infrastructure/cache/config';
import { loadSkillsCached } from '@/infrastructure/skills/loader';
import { createSkillSamplingPlan } from '@/infrastructure/skills/sampling';
import { TEST_TIER_CONFIG } from '@/__tests__/helpers/testTierConfig';
import type {
    EarningsCalendarItem,
    EconomicCalendarEvent,
    EnrichedNewsItem,
    Skill,
    TierConfig,
    TierModel,
} from '@/domain/types';

const mockCallAnalysisAi = callAnalysisAi as Mock;
const mockCreateCacheProvider = createCacheProvider as Mock;
const mockLoadSkillsCached = loadSkillsCached as Mock;
const mockCreateSkillSamplingPlan = createSkillSamplingPlan as Mock;

/**
 * Finds this call's `seedParts` (3rd positional arg) by content — never by
 * a fixed `mock.calls` index, which can silently pick up a stale call left
 * over from another invocation in the same test.
 */
function findSeedParts(symbol: string): readonly string[] {
    const call = mockCreateSkillSamplingPlan.mock.calls.find(c =>
        (c[2] as readonly string[]).includes(symbol)
    );
    if (call === undefined) {
        throw new Error(
            `No createSkillSamplingPlan call found for symbol ${symbol}`
        );
    }
    return call[2] as readonly string[];
}

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

/** 스키마에 맞는 정상 응답 — 정규화 후에도 값이 그대로 보존된다. */
const mockValidAnalysis = {
    currentDriverKo: '신제품 발표가 주가 흐름을 주도한다.',
    keyEventsKo: ['애플 신제품 발표'],
    upcomingEventsKo: ['7월 실적 발표'],
    overallSentiment: 'bullish' as const,
};

/** free 티어 일일 분석 1회로 제한하고 한도 체크를 켠 설정. */
const LIMITED_TIER_CONFIG: TierConfig = {
    ...TEST_TIER_CONFIG,
    limits: {
        ...TEST_TIER_CONFIG.limits,
        analysisPerDay: { free: 1, member: 1, pro: Infinity },
    },
    featureFlags: { enableTierRestrictions: true },
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

    describe('BYOK 게이트', () => {
        it('비-pro 티어가 BYOK 모델을 키 없이 요청하면 key_error를 반환하고 아무것도 로드하지 않는다', async () => {
            const result = await runNewsAnalysis({
                ...baseArgs(),
                modelId: 'gemini-3.1-pro-preview',
                tier: 'member',
                tierConfig: TEST_TIER_CONFIG,
            });

            expect(result).toEqual({
                status: 'key_error',
                code: 'user_api_key_required',
                error: expect.any(String),
                modelId: 'gemini-3.1-pro-preview',
                tier: 'member',
            });
            expect(mockLoadSkillsCached).not.toHaveBeenCalled();
            expect(mockCacheGet).not.toHaveBeenCalled();
            expect(mockCallAnalysisAi).not.toHaveBeenCalled();
        });

        it('BYOK 모델이라도 userApiKey가 있으면 통과하고 키를 LLM 호출에 전달한다', async () => {
            const result = await runNewsAnalysis({
                ...baseArgs(),
                modelId: 'gemini-3.1-pro-preview',
                tier: 'member',
                tierConfig: TEST_TIER_CONFIG,
                userApiKey: 'usr-key',
            });

            expect(result.status).toBe('done');
            expect(mockCallAnalysisAi).toHaveBeenCalledWith(
                expect.objectContaining({
                    model: 'gemini-3.1-pro-preview',
                    userApiKey: 'usr-key',
                })
            );
        });
    });

    describe('일일 사용량 한도', () => {
        const NOW = new Date('2026-05-02T03:00:00Z');

        function makeUsage(analysisCountToday: number) {
            return {
                usageRepository: {
                    getUsageToday: vi.fn().mockResolvedValue({
                        analysis: analysisCountToday,
                        chatbot: 0,
                    }),
                    recordUsage: vi.fn().mockResolvedValue(undefined),
                },
                clientIp: '10.0.0.1',
            };
        }

        it('한도를 초과하면 usage_limit_exceeded를 반환하고 캐시·LLM·사용량 기록을 모두 건너뛴다', async () => {
            const usage = makeUsage(1);

            const result = await runNewsAnalysis({
                ...baseArgs(),
                tier: 'free',
                tierConfig: LIMITED_TIER_CONFIG,
                usage,
                now: NOW,
            });

            expect(result).toEqual({
                status: 'error',
                code: 'usage_limit_exceeded',
                error: expect.objectContaining({
                    code: 'analysis_limit_exceeded',
                    feature: 'analysisPerDay',
                    tier: 'free',
                }),
            });
            expect(usage.usageRepository.getUsageToday).toHaveBeenCalledWith(
                expect.any(String),
                NOW
            );
            expect(mockCacheGet).not.toHaveBeenCalled();
            expect(mockCallAnalysisAi).not.toHaveBeenCalled();
            expect(usage.usageRepository.recordUsage).not.toHaveBeenCalled();
        });

        it('한도 이내면 분석을 진행하고 LLM 완료 후 사용량을 1회 기록한다', async () => {
            const usage = makeUsage(0);

            const result = await runNewsAnalysis({
                ...baseArgs(),
                tier: 'free',
                tierConfig: LIMITED_TIER_CONFIG,
                usage,
                now: NOW,
            });

            expect(result.status).toBe('done');
            expect(usage.usageRepository.recordUsage).toHaveBeenCalledTimes(1);
            expect(usage.usageRepository.recordUsage).toHaveBeenCalledWith({
                userId: null,
                ipAddress: '10.0.0.1',
                actionType: 'analysis',
                modelUsed: mockModelId,
                occurredAt: NOW,
            });
        });

        it('tier를 생략하면 한도 조회 없이 진행하되 사용량은 기록한다', async () => {
            const usage = makeUsage(99);

            const result = await runNewsAnalysis({
                ...baseArgs(),
                tierConfig: LIMITED_TIER_CONFIG,
                usage,
            });

            expect(result.status).toBe('done');
            expect(usage.usageRepository.getUsageToday).not.toHaveBeenCalled();
            expect(usage.usageRepository.recordUsage).toHaveBeenCalledTimes(1);
        });

        it('캐시 히트도 사용량 1회로 기록한다', async () => {
            mockCacheGet.mockResolvedValueOnce(mockValidAnalysis);
            const usage = makeUsage(0);

            const result = await runNewsAnalysis({
                ...baseArgs(),
                tier: 'free',
                tierConfig: LIMITED_TIER_CONFIG,
                usage,
                now: NOW,
            });

            expect(result.status).toBe('cached');
            expect(mockCallAnalysisAi).not.toHaveBeenCalled();
            expect(usage.usageRepository.recordUsage).toHaveBeenCalledTimes(1);
        });
    });

    describe('캐시 우회·장애 내성', () => {
        it('force=true이면 캐시를 읽지 않고 LLM을 태운 뒤 결과를 다시 쓴다', async () => {
            mockCacheGet.mockResolvedValue(mockValidAnalysis);

            const result = await runNewsAnalysis({
                ...baseArgs(),
                force: true,
            });

            expect(result.status).toBe('done');
            expect(mockCacheGet).not.toHaveBeenCalled();
            expect(mockCallAnalysisAi).toHaveBeenCalledTimes(1);
            expect(mockCacheSet).toHaveBeenCalledTimes(1);
        });

        it('캐시 프로바이더가 없으면(null) 캐시 없이 LLM 결과를 반환한다', async () => {
            mockCreateCacheProvider.mockReturnValue(null);

            const result = await runNewsAnalysis(baseArgs());

            expect(result.status).toBe('done');
            expect(mockCallAnalysisAi).toHaveBeenCalledTimes(1);
            expect(mockCacheGet).not.toHaveBeenCalled();
            expect(mockCacheSet).not.toHaveBeenCalled();
        });

        it('캐시 읽기가 실패하면 로그를 남기고 LLM 경로로 진행한다', async () => {
            const errorSpy = vi
                .spyOn(console, 'error')
                .mockImplementation(() => {});
            mockCacheGet.mockRejectedValueOnce(new Error('redis down'));

            const result = await runNewsAnalysis(baseArgs());

            expect(result.status).toBe('done');
            expect(mockCallAnalysisAi).toHaveBeenCalledTimes(1);
            expect(errorSpy).toHaveBeenCalledWith(
                '[RunNewsAnalysis] Cache read failed:',
                expect.any(Error)
            );
            errorSpy.mockRestore();
        });

        it('캐시 쓰기가 실패해도 응답은 done이고 오류는 로그로만 남는다', async () => {
            const errorSpy = vi
                .spyOn(console, 'error')
                .mockImplementation(() => {});
            mockCacheSet.mockRejectedValueOnce(new Error('redis write down'));

            const result = await runNewsAnalysis(baseArgs());

            expect(result.status).toBe('done');
            await vi.waitFor(() =>
                expect(errorSpy).toHaveBeenCalledWith(
                    '[RunNewsAnalysis] Cache write failed:',
                    expect.any(Error)
                )
            );
            errorSpy.mockRestore();
        });
    });

    describe('LLM 응답 정규화', () => {
        it('정상 응답은 정규화해 반환·캐시하고 빈 결과 경고를 남기지 않는다', async () => {
            const warnSpy = vi
                .spyOn(console, 'warn')
                .mockImplementation(() => {});
            mockCallAnalysisAi.mockResolvedValueOnce(
                JSON.stringify(mockValidAnalysis)
            );

            const result = await runNewsAnalysis(baseArgs());

            expect(result).toEqual({
                status: 'done',
                result: mockValidAnalysis,
            });
            expect(mockCacheSet).toHaveBeenCalledWith(
                expect.any(String),
                mockValidAnalysis,
                NEWS_CACHE_TTL_SECONDS
            );
            expect(warnSpy).not.toHaveBeenCalled();
            warnSpy.mockRestore();
        });

        it('스키마와 다른 JSON 응답은 빈 결과로 정규화하고 경고를 남긴다', async () => {
            const warnSpy = vi
                .spyOn(console, 'warn')
                .mockImplementation(() => {});
            mockCallAnalysisAi.mockResolvedValueOnce(
                JSON.stringify({ unexpected: 'shape' })
            );

            const result = await runNewsAnalysis(baseArgs());

            expect(result.status).toBe('done');
            if (result.status === 'done') {
                expect(result.result.currentDriverKo).toBe('');
                expect(result.result.keyEventsKo).toEqual([]);
            }
            expect(warnSpy).toHaveBeenCalledWith(
                expect.stringContaining('Empty news analysis'),
                { symbol: 'AAPL' }
            );
            warnSpy.mockRestore();
        });
    });

    describe('macro calendar (spec 2026-09-28)', () => {
        function makeMacroEvent(
            overrides: Partial<EconomicCalendarEvent> = {}
        ): EconomicCalendarEvent {
            return {
                date: '2026-07-30 12:00:00',
                event: 'CPI MoM',
                impact: 'High',
                actual: null,
                estimate: 0.3,
                previous: 0.2,
                unit: '%',
                ...overrides,
            };
        }

        it('전달되면 LLM 프롬프트에 Macro Calendar 섹션이 렌더된다', async () => {
            await runNewsAnalysis({
                ...baseArgs(),
                macroCalendar: [makeMacroEvent()],
            });

            const call = mockCallAnalysisAi.mock.calls.at(-1)![0] as {
                prompt: string;
            };
            expect(call.prompt).toContain(
                '## Macro Calendar (scheduled economic releases — source data)'
            );
            expect(call.prompt).toContain('CPI MoM');
        });

        it('macroCalendar 생략 시 캐시 키가 정확히 고정된 값이다 (review round 1 finding 2)', async () => {
            // sha256('free|news-001|2026-07-25|[]').slice(0,16) — re-derived
            // independently (see PR review notes) and confirmed against the
            // current (post-macro-calendar-feature, macro-omitted) code
            // path, not merely trusted from the reviewer's number.
            await runNewsAnalysis(baseArgs());

            expect(mockCacheGet).toHaveBeenCalledWith(
                'v1:analysis:news:AAPL:gemini-3.6-flash:p7:719732b6711a0154'
            );
        });

        it('macroCalendar 생략 시 seedParts가 이 옵션이 생기기 전 목록과 정확히 같다', async () => {
            await runNewsAnalysis(baseArgs());

            expect(findSeedParts('AAPL')).toEqual([
                'news',
                'AAPL',
                mockModelId,
                'reasoning-off',
                'free',
                'news-ids',
                'news-001',
                'earnings-dates',
                '2026-07-25',
            ]);
        });

        it('macroCalendar가 있으면 seedParts에 macro-calendar 지문이 추가된다', async () => {
            await runNewsAnalysis({
                ...baseArgs(),
                macroCalendar: [makeMacroEvent()],
            });

            expect(findSeedParts('AAPL')).toEqual([
                'news',
                'AAPL',
                mockModelId,
                'reasoning-off',
                'free',
                'news-ids',
                'news-001',
                'earnings-dates',
                '2026-07-25',
                'macro-calendar',
                JSON.stringify([
                    '2026-07-30 12:00:00',
                    'CPI MoM',
                    'High',
                    null,
                    0.3,
                    0.2,
                    '%',
                ]),
            ]);
        });

        it('생략과 명시적 빈 배열은 동일한 캐시 키를 쓴다 (바이트 동일성)', async () => {
            await runNewsAnalysis(baseArgs());
            const omittedKey = mockCacheGet.mock.calls.at(-1)![0] as string;

            mockCacheGet.mockClear();
            await runNewsAnalysis({ ...baseArgs(), macroCalendar: [] });
            const explicitEmptyKey = mockCacheGet.mock.calls.at(
                -1
            )![0] as string;

            expect(explicitEmptyKey).toBe(omittedKey);
        });

        it('macroCalendar가 있으면 없을 때와 다른 캐시 키를 쓴다', async () => {
            await runNewsAnalysis(baseArgs());
            const withoutMacroKey = mockCacheGet.mock.calls.at(
                -1
            )![0] as string;

            mockCacheGet.mockClear();
            await runNewsAnalysis({
                ...baseArgs(),
                macroCalendar: [makeMacroEvent()],
            });
            const withMacroKey = mockCacheGet.mock.calls.at(-1)![0] as string;

            expect(withMacroKey).not.toBe(withoutMacroKey);
        });

        it('같은 이벤트라도 actual이 채워지면 캐시 키가 달라진다 (재분석 트리거)', async () => {
            await runNewsAnalysis({
                ...baseArgs(),
                macroCalendar: [makeMacroEvent({ actual: null })],
            });
            const beforeReleaseKey = mockCacheGet.mock.calls.at(
                -1
            )![0] as string;

            mockCacheGet.mockClear();
            await runNewsAnalysis({
                ...baseArgs(),
                macroCalendar: [makeMacroEvent({ actual: 0.3 })],
            });
            const afterReleaseKey = mockCacheGet.mock.calls.at(
                -1
            )![0] as string;

            expect(afterReleaseKey).not.toBe(beforeReleaseKey);
        });
    });
});
