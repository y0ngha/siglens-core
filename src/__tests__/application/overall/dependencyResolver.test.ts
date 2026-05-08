import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

// ── Mock the three submit functions before importing the resolver ──
vi.mock('@/application/market/submitAnalysis');
vi.mock('@/application/fundamental/submitFundamentalAnalysis');
vi.mock('@/application/news/submitNewsAnalysis');

import { resolveOverallDependencies } from '@/application/overall/dependencyResolver';
import type { OverallDependencyInputs } from '@/application/overall/types';
import { submitAnalysis } from '@/application/market/submitAnalysis';
import { submitFundamentalAnalysis } from '@/application/fundamental/submitFundamentalAnalysis';
import { submitNewsAnalysis } from '@/application/news/submitNewsAnalysis';
import type {
    AnalysisResponse,
    FundamentalAnalysisResponse,
    NewsAnalysisResponse,
} from '@/domain/types';
import {
    makeEnrichedNewsItem,
    makeCalendarItem,
    minimalProvider,
} from './fixtures';

const mockSubmitAnalysis = submitAnalysis as Mock;
const mockSubmitFundamentalAnalysis = submitFundamentalAnalysis as Mock;
const mockSubmitNewsAnalysis = submitNewsAnalysis as Mock;

// ─────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────

const cachedTechnical: AnalysisResponse = {
    trend: 'bullish',
    summary: 'Technical summary',
    riskLevel: 'medium',
    keyLevels: { support: [], resistance: [] },
    priceTargets: { bullish: null, bearish: null },
    indicatorResults: [],
    patternSummaries: [],
    strategyResults: [],
    candlePatterns: [],
    trendlines: [],
};

const cachedFundamental: FundamentalAnalysisResponse = {
    overallConclusionKo: '펀더멘털 캐시 결과',
    categoryAssessments: [],
    riskFactorsKo: [],
    overallSentiment: 'neutral',
};

const cachedNews: NewsAnalysisResponse = {
    currentDriverKo: '뉴스 캐시 결과',
    keyEventsKo: [],
    upcomingEventsKo: [],
    overallSentiment: 'neutral',
};

/** Baseline inputs — all three axes have cached results. */
function makeInputs(
    overrides: Partial<OverallDependencyInputs> = {}
): OverallDependencyInputs {
    return {
        symbol: 'AAPL',
        timeframe: '1Day',
        modelId: 'gemini-2.5-flash',
        fundamentalProvider: minimalProvider,
        newsItems: [makeEnrichedNewsItem('n001')],
        upcomingCalendar: [makeCalendarItem('2026-07-25')],
        technical: {},
        ...overrides,
    };
}

// ─────────────────────────────────────────
// Tests
// ─────────────────────────────────────────

describe('resolveOverallDependencies 함수는', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('세 축 모두 캐시 히트일 때', () => {
        it('kind: cached 를 반환하고 세 결과를 포함한다', async () => {
            mockSubmitAnalysis.mockResolvedValue({
                status: 'cached',
                result: cachedTechnical,
            });
            mockSubmitFundamentalAnalysis.mockResolvedValue({
                status: 'cached',
                result: cachedFundamental,
            });
            mockSubmitNewsAnalysis.mockResolvedValue({
                status: 'cached',
                result: cachedNews,
            });

            const state = await resolveOverallDependencies(makeInputs());

            expect(state.kind).toBe('cached');
            if (state.kind === 'cached') {
                expect(state.technical).toEqual(cachedTechnical);
                expect(state.fundamental).toEqual(cachedFundamental);
                expect(state.news).toEqual(cachedNews);
            }
        });

        it('세 submit 함수를 정확히 한 번씩 호출한다', async () => {
            mockSubmitAnalysis.mockResolvedValue({
                status: 'cached',
                result: cachedTechnical,
            });
            mockSubmitFundamentalAnalysis.mockResolvedValue({
                status: 'cached',
                result: cachedFundamental,
            });
            mockSubmitNewsAnalysis.mockResolvedValue({
                status: 'cached',
                result: cachedNews,
            });

            await resolveOverallDependencies(makeInputs());

            expect(mockSubmitAnalysis).toHaveBeenCalledTimes(1);
            expect(mockSubmitFundamentalAnalysis).toHaveBeenCalledTimes(1);
            expect(mockSubmitNewsAnalysis).toHaveBeenCalledTimes(1);
        });
    });

    describe('일부 축이 submitted 일 때', () => {
        it('kind: pending 을 반환하고 submitted 축의 jobId 를 포함한다', async () => {
            mockSubmitAnalysis.mockResolvedValue({
                status: 'submitted',
                jobId: 'tech-job-001',
            });
            mockSubmitFundamentalAnalysis.mockResolvedValue({
                status: 'cached',
                result: cachedFundamental,
            });
            mockSubmitNewsAnalysis.mockResolvedValue({
                status: 'submitted',
                jobId: 'news-job-001',
            });

            const state = await resolveOverallDependencies(makeInputs());

            expect(state.kind).toBe('pending');
            if (state.kind === 'pending') {
                expect(state.pendingJobs.technical).toBe('tech-job-001');
                expect(state.pendingJobs.fundamental).toBeUndefined();
                expect(state.pendingJobs.news).toBe('news-job-001');
            }
        });

        it('fundamental 만 submitted 이면 해당 jobId 만 있고 나머지는 undefined 다', async () => {
            mockSubmitAnalysis.mockResolvedValue({
                status: 'cached',
                result: cachedTechnical,
            });
            mockSubmitFundamentalAnalysis.mockResolvedValue({
                status: 'submitted',
                jobId: 'fund-job-007',
            });
            mockSubmitNewsAnalysis.mockResolvedValue({
                status: 'cached',
                result: cachedNews,
            });

            const state = await resolveOverallDependencies(makeInputs());

            expect(state.kind).toBe('pending');
            if (state.kind === 'pending') {
                expect(state.pendingJobs.technical).toBeUndefined();
                expect(state.pendingJobs.fundamental).toBe('fund-job-007');
                expect(state.pendingJobs.news).toBeUndefined();
            }
        });
    });

    describe('세 축 모두 submitted 일 때', () => {
        it('kind: pending 을 반환하고 모든 jobId 가 존재한다', async () => {
            mockSubmitAnalysis.mockResolvedValue({
                status: 'submitted',
                jobId: 'tech-job-111',
            });
            mockSubmitFundamentalAnalysis.mockResolvedValue({
                status: 'submitted',
                jobId: 'fund-job-222',
            });
            mockSubmitNewsAnalysis.mockResolvedValue({
                status: 'submitted',
                jobId: 'news-job-333',
            });

            const state = await resolveOverallDependencies(makeInputs());

            expect(state.kind).toBe('pending');
            if (state.kind === 'pending') {
                expect(state.pendingJobs.technical).toBe('tech-job-111');
                expect(state.pendingJobs.fundamental).toBe('fund-job-222');
                expect(state.pendingJobs.news).toBe('news-job-333');
            }
        });
    });

    describe('축 에러 처리', () => {
        it('technical key_error 이면 kind: error 를 반환하고 axis: technical 을 포함한다', async () => {
            const keyError = {
                status: 'key_error' as const,
                code: 'user_api_key_required' as const,
                error: 'BYOK required',
                modelId: 'gemini-2.5-pro' as const,
                tier: 'member' as const,
            };
            mockSubmitAnalysis.mockResolvedValue(keyError);
            mockSubmitFundamentalAnalysis.mockResolvedValue({
                status: 'cached',
                result: cachedFundamental,
            });
            mockSubmitNewsAnalysis.mockResolvedValue({
                status: 'cached',
                result: cachedNews,
            });

            const state = await resolveOverallDependencies(makeInputs());

            expect(state.kind).toBe('error');
            if (state.kind === 'error') {
                expect(state.axis).toBe('technical');
                expect(state.error).toEqual(keyError);
            }
        });

        it('fundamental key_error 이면 kind: error 를 반환하고 axis: fundamental 을 포함한다', async () => {
            const keyError = {
                status: 'key_error' as const,
                code: 'user_api_key_required' as const,
                error: 'BYOK required',
                modelId: 'gemini-2.5-pro' as const,
                tier: 'member' as const,
            };
            mockSubmitAnalysis.mockResolvedValue({
                status: 'cached',
                result: cachedTechnical,
            });
            mockSubmitFundamentalAnalysis.mockResolvedValue(keyError);
            mockSubmitNewsAnalysis.mockResolvedValue({
                status: 'cached',
                result: cachedNews,
            });

            const state = await resolveOverallDependencies(makeInputs());

            expect(state.kind).toBe('error');
            if (state.kind === 'error') {
                expect(state.axis).toBe('fundamental');
                expect(state.error).toEqual(keyError);
            }
        });

        it('news key_error 이면 kind: error 를 반환하고 axis: news 를 포함한다', async () => {
            const keyError = {
                status: 'key_error' as const,
                code: 'user_api_key_required' as const,
                error: 'BYOK required',
                modelId: 'gemini-2.5-pro' as const,
                tier: 'member' as const,
            };
            mockSubmitAnalysis.mockResolvedValue({
                status: 'cached',
                result: cachedTechnical,
            });
            mockSubmitFundamentalAnalysis.mockResolvedValue({
                status: 'cached',
                result: cachedFundamental,
            });
            mockSubmitNewsAnalysis.mockResolvedValue(keyError);

            const state = await resolveOverallDependencies(makeInputs());

            expect(state.kind).toBe('error');
            if (state.kind === 'error') {
                expect(state.axis).toBe('news');
                expect(state.error).toEqual(keyError);
            }
        });

        it('technical 에러이면 kind: error 를 반환하고 axis: technical 을 포함한다', async () => {
            const technicalError = {
                code: 'timeframe_not_allowed',
                message: 'Not allowed',
                tier: 'free',
                timeframe: '1Day',
                allowedTimeframes: [],
            };
            const technicalResult = { status: 'error' as const, error: technicalError };
            mockSubmitAnalysis.mockResolvedValue(technicalResult);
            mockSubmitFundamentalAnalysis.mockResolvedValue({
                status: 'cached',
                result: cachedFundamental,
            });
            mockSubmitNewsAnalysis.mockResolvedValue({
                status: 'cached',
                result: cachedNews,
            });

            const state = await resolveOverallDependencies(makeInputs());

            expect(state.kind).toBe('error');
            if (state.kind === 'error') {
                expect(state.axis).toBe('technical');
                // B2: resolver stores the full result object (not just the inner error)
                expect(state.error).toEqual(technicalResult);
            }
        });

        it('fundamental 에러이면 kind: error 를 반환하고 axis: fundamental 을 포함한다', async () => {
            mockSubmitAnalysis.mockResolvedValue({
                status: 'cached',
                result: cachedTechnical,
            });
            mockSubmitFundamentalAnalysis.mockResolvedValue({
                status: 'error',
                code: 'fetch_failed',
                error: 'Profile not found',
            });
            mockSubmitNewsAnalysis.mockResolvedValue({
                status: 'cached',
                result: cachedNews,
            });

            const state = await resolveOverallDependencies(makeInputs());

            expect(state.kind).toBe('error');
            if (state.kind === 'error') {
                expect(state.axis).toBe('fundamental');
            }
        });

        it('news 에러이면 kind: error 를 반환하고 axis: news 를 포함한다', async () => {
            mockSubmitAnalysis.mockResolvedValue({
                status: 'cached',
                result: cachedTechnical,
            });
            mockSubmitFundamentalAnalysis.mockResolvedValue({
                status: 'cached',
                result: cachedFundamental,
            });
            mockSubmitNewsAnalysis.mockResolvedValue({
                status: 'error',
                code: 'no_news',
                error: 'No news to analyze',
            });

            const state = await resolveOverallDependencies(makeInputs());

            expect(state.kind).toBe('error');
            if (state.kind === 'error') {
                expect(state.axis).toBe('news');
            }
        });
    });

    describe('inputs 전달 확인', () => {
        it('submitAnalysis 에 symbol, timeframe 이 올바르게 전달된다', async () => {
            mockSubmitAnalysis.mockResolvedValue({
                status: 'cached',
                result: cachedTechnical,
            });
            mockSubmitFundamentalAnalysis.mockResolvedValue({
                status: 'cached',
                result: cachedFundamental,
            });
            mockSubmitNewsAnalysis.mockResolvedValue({
                status: 'cached',
                result: cachedNews,
            });

            await resolveOverallDependencies(
                makeInputs({ symbol: 'TSLA', timeframe: '4Hour' })
            );

            expect(mockSubmitAnalysis).toHaveBeenCalledWith(
                'TSLA',
                'TSLA',
                '4Hour',
                false,
                undefined,
                expect.any(Object)
            );
        });

        it('technical.userApiKey 가 submitAnalysis 에 전달된다', async () => {
            mockSubmitAnalysis.mockResolvedValue({
                status: 'cached',
                result: cachedTechnical,
            });
            mockSubmitFundamentalAnalysis.mockResolvedValue({
                status: 'cached',
                result: cachedFundamental,
            });
            mockSubmitNewsAnalysis.mockResolvedValue({
                status: 'cached',
                result: cachedNews,
            });

            await resolveOverallDependencies(
                makeInputs({ technical: { userApiKey: 'my-key' } })
            );

            expect(mockSubmitAnalysis).toHaveBeenCalledWith(
                expect.any(String),
                expect.any(String),
                expect.any(String),
                false,
                undefined,
                expect.objectContaining({ userApiKey: 'my-key' })
            );
        });

        it('submitFundamentalAnalysis 에 symbol 과 modelId 가 올바르게 전달된다', async () => {
            mockSubmitAnalysis.mockResolvedValue({
                status: 'cached',
                result: cachedTechnical,
            });
            mockSubmitFundamentalAnalysis.mockResolvedValue({
                status: 'cached',
                result: cachedFundamental,
            });
            mockSubmitNewsAnalysis.mockResolvedValue({
                status: 'cached',
                result: cachedNews,
            });

            await resolveOverallDependencies(
                makeInputs({ symbol: 'NVDA', modelId: 'claude-sonnet-4-6' })
            );

            expect(mockSubmitFundamentalAnalysis).toHaveBeenCalledWith(
                expect.objectContaining({
                    symbol: 'NVDA',
                    modelId: 'claude-sonnet-4-6',
                })
            );
        });

        it('submitNewsAnalysis 에 news 와 upcomingCalendar 가 올바르게 전달된다', async () => {
            mockSubmitAnalysis.mockResolvedValue({
                status: 'cached',
                result: cachedTechnical,
            });
            mockSubmitFundamentalAnalysis.mockResolvedValue({
                status: 'cached',
                result: cachedFundamental,
            });
            mockSubmitNewsAnalysis.mockResolvedValue({
                status: 'cached',
                result: cachedNews,
            });

            const newsItems = [
                makeEnrichedNewsItem('x1'),
                makeEnrichedNewsItem('x2'),
            ];
            const upcomingCalendar = [makeCalendarItem('2026-08-01')];

            await resolveOverallDependencies(
                makeInputs({ symbol: 'NVDA', newsItems, upcomingCalendar })
            );

            expect(mockSubmitNewsAnalysis).toHaveBeenCalledWith(
                expect.objectContaining({
                    news: newsItems,
                    upcomingCalendar,
                    companyName: 'NVDA',
                })
            );
        });

        it('submitNewsAnalysis 에 companyName 이 전달된다 (명시적으로 지정된 경우)', async () => {
            mockSubmitAnalysis.mockResolvedValue({
                status: 'cached',
                result: cachedTechnical,
            });
            mockSubmitFundamentalAnalysis.mockResolvedValue({
                status: 'cached',
                result: cachedFundamental,
            });
            mockSubmitNewsAnalysis.mockResolvedValue({
                status: 'cached',
                result: cachedNews,
            });

            await resolveOverallDependencies(
                makeInputs({
                    symbol: 'NVDA',
                    companyName: 'NVIDIA Corporation',
                })
            );

            expect(mockSubmitNewsAnalysis).toHaveBeenCalledWith(
                expect.objectContaining({ companyName: 'NVIDIA Corporation' })
            );
        });

        it('technical.force 와 technical.fmpSymbol 이 submitAnalysis 의 위치 인자로 전달된다', async () => {
            mockSubmitAnalysis.mockResolvedValue({
                status: 'cached',
                result: cachedTechnical,
            });
            mockSubmitFundamentalAnalysis.mockResolvedValue({
                status: 'cached',
                result: cachedFundamental,
            });
            mockSubmitNewsAnalysis.mockResolvedValue({
                status: 'cached',
                result: cachedNews,
            });

            await resolveOverallDependencies(
                makeInputs({
                    technical: { force: true, fmpSymbol: 'AAPL.US' },
                })
            );

            expect(mockSubmitAnalysis).toHaveBeenCalledWith(
                expect.any(String),
                expect.any(String),
                expect.any(String),
                true,
                'AAPL.US',
                expect.any(Object)
            );
        });

        it('레거시 news (array) + newsOptions 필드도 후방호환으로 처리된다', async () => {
            mockSubmitAnalysis.mockResolvedValue({
                status: 'cached',
                result: cachedTechnical,
            });
            mockSubmitFundamentalAnalysis.mockResolvedValue({
                status: 'cached',
                result: cachedFundamental,
            });
            mockSubmitNewsAnalysis.mockResolvedValue({
                status: 'cached',
                result: cachedNews,
            });

            const legacyNews = [makeEnrichedNewsItem('legacy-1')];
            const legacyNewsOptions = { tier: 'pro' as const };

            // Build inputs without the new `newsItems` field — exercise the
            // legacy `news` (array) + `newsOptions` aliases.
            const baseline = makeInputs();
            const { newsItems: _omit, ...rest } = baseline;
            void _omit;
            const legacyInputs = {
                ...rest,
                news: legacyNews,
                newsOptions: legacyNewsOptions,
            };

            await resolveOverallDependencies(legacyInputs);

            expect(mockSubmitNewsAnalysis).toHaveBeenCalledWith(
                expect.objectContaining({
                    news: legacyNews,
                    tier: 'pro',
                })
            );
        });

        it('신규 newsItems + news (options) 필드가 우선시된다', async () => {
            mockSubmitAnalysis.mockResolvedValue({
                status: 'cached',
                result: cachedTechnical,
            });
            mockSubmitFundamentalAnalysis.mockResolvedValue({
                status: 'cached',
                result: cachedFundamental,
            });
            mockSubmitNewsAnalysis.mockResolvedValue({
                status: 'cached',
                result: cachedNews,
            });

            const newItems = [makeEnrichedNewsItem('new-1')];
            const newNewsOptions = { tier: 'free' as const };

            await resolveOverallDependencies(
                makeInputs({
                    newsItems: newItems,
                    news: newNewsOptions,
                })
            );

            expect(mockSubmitNewsAnalysis).toHaveBeenCalledWith(
                expect.objectContaining({
                    news: newItems,
                    tier: 'free',
                })
            );
        });

        it('technical.force / fmpSymbol 미지정 시 기본 false / undefined 가 전달된다', async () => {
            mockSubmitAnalysis.mockResolvedValue({
                status: 'cached',
                result: cachedTechnical,
            });
            mockSubmitFundamentalAnalysis.mockResolvedValue({
                status: 'cached',
                result: cachedFundamental,
            });
            mockSubmitNewsAnalysis.mockResolvedValue({
                status: 'cached',
                result: cachedNews,
            });

            await resolveOverallDependencies(makeInputs());

            expect(mockSubmitAnalysis).toHaveBeenCalledWith(
                expect.any(String),
                expect.any(String),
                expect.any(String),
                false,
                undefined,
                expect.any(Object)
            );
        });
    });

    describe('dropAxisUsage 옵션은', () => {
        const fakeUsage = {
            usageRepository: {
                recordUsage: vi.fn(),
                getUsageToday: vi.fn(),
            },
            clientIp: '203.0.113.10',
        };

        beforeEach(() => {
            mockSubmitAnalysis.mockResolvedValue({
                status: 'cached',
                result: cachedTechnical,
            });
            mockSubmitFundamentalAnalysis.mockResolvedValue({
                status: 'cached',
                result: cachedFundamental,
            });
            mockSubmitNewsAnalysis.mockResolvedValue({
                status: 'cached',
                result: cachedNews,
            });
        });

        it('true 일 때 세 축 모두 usage 옵션이 제거된 채로 전달된다', async () => {
            await resolveOverallDependencies(
                makeInputs({
                    technical: { usage: fakeUsage },
                    fundamental: { usage: fakeUsage },
                    news: { usage: fakeUsage },
                }),
                { dropAxisUsage: true }
            );

            const technicalOpts = mockSubmitAnalysis.mock.calls[0]?.[5];
            expect(technicalOpts).not.toHaveProperty('usage');

            const fundamentalOpts =
                mockSubmitFundamentalAnalysis.mock.calls[0]?.[0];
            expect(fundamentalOpts).not.toHaveProperty('usage');

            const newsOpts = mockSubmitNewsAnalysis.mock.calls[0]?.[0];
            expect(newsOpts).not.toHaveProperty('usage');
        });

        it('기본값(false)일 때는 usage 가 그대로 각 축으로 전달된다', async () => {
            await resolveOverallDependencies(
                makeInputs({
                    technical: { usage: fakeUsage },
                    fundamental: { usage: fakeUsage },
                    news: { usage: fakeUsage },
                })
            );

            const technicalOpts = mockSubmitAnalysis.mock.calls[0]?.[5];
            expect(technicalOpts).toMatchObject({ usage: fakeUsage });

            const fundamentalOpts =
                mockSubmitFundamentalAnalysis.mock.calls[0]?.[0];
            expect(fundamentalOpts).toMatchObject({ usage: fakeUsage });

            const newsOpts = mockSubmitNewsAnalysis.mock.calls[0]?.[0];
            expect(newsOpts).toMatchObject({ usage: fakeUsage });
        });
    });

    describe('news 입력 누락 가드는', () => {
        it('newsItems 와 news 배열 모두 미제공 시 명시적 에러를 던진다', async () => {
            const inputs = makeInputs();
            // Drop both data shapes: no `newsItems` and no array-form `news`.
            const { newsItems: _drop, ...rest } = inputs;
            const badInputs: OverallDependencyInputs = {
                ...rest,
                // `news` is the options-object branch (not the legacy array),
                // so the resolver cannot recover an items array from either field.
                news: {},
            };

            await expect(resolveOverallDependencies(badInputs)).rejects.toThrow(
                /missing news items/
            );

            // Guard fires before any axis submit is dispatched.
            expect(mockSubmitAnalysis).not.toHaveBeenCalled();
            expect(mockSubmitFundamentalAnalysis).not.toHaveBeenCalled();
            expect(mockSubmitNewsAnalysis).not.toHaveBeenCalled();
        });
    });

    describe('top-level userApiKey / tier 전파는', () => {
        beforeEach(() => {
            mockSubmitAnalysis.mockResolvedValue({
                status: 'cached',
                result: cachedTechnical,
            });
            mockSubmitFundamentalAnalysis.mockResolvedValue({
                status: 'cached',
                result: cachedFundamental,
            });
            mockSubmitNewsAnalysis.mockResolvedValue({
                status: 'cached',
                result: cachedNews,
            });
        });

        it('top-level userApiKey를 axis-level이 없을 때 세 축에 전파한다', async () => {
            const inputs: OverallDependencyInputs = {
                ...makeInputs(),
                userApiKey: 'top-key',
            };

            await resolveOverallDependencies(inputs);

            // technical axis
            const technicalOpts = mockSubmitAnalysis.mock.calls[0]?.[5];
            expect(technicalOpts).toMatchObject({ userApiKey: 'top-key' });

            // fundamental axis
            const fundamentalOpts =
                mockSubmitFundamentalAnalysis.mock.calls[0]?.[0];
            expect(fundamentalOpts).toMatchObject({ userApiKey: 'top-key' });

            // news axis
            const newsOpts = mockSubmitNewsAnalysis.mock.calls[0]?.[0];
            expect(newsOpts).toMatchObject({ userApiKey: 'top-key' });
        });

        it('axis-level userApiKey가 top-level을 덮어쓴다', async () => {
            const inputs: OverallDependencyInputs = {
                ...makeInputs({
                    technical: { userApiKey: 'axis-key' },
                    fundamental: { userApiKey: 'axis-fund-key' },
                }),
                userApiKey: 'top-key',
            };

            await resolveOverallDependencies(inputs);

            // technical: axis-key wins
            const technicalOpts = mockSubmitAnalysis.mock.calls[0]?.[5];
            expect(technicalOpts).toMatchObject({ userApiKey: 'axis-key' });

            // fundamental: axis-fund-key wins
            const fundamentalOpts =
                mockSubmitFundamentalAnalysis.mock.calls[0]?.[0];
            expect(fundamentalOpts).toMatchObject({
                userApiKey: 'axis-fund-key',
            });

            // news: no axis-level → falls back to top-key
            const newsOpts = mockSubmitNewsAnalysis.mock.calls[0]?.[0];
            expect(newsOpts).toMatchObject({ userApiKey: 'top-key' });
        });

        it('top-level tier를 fundamental / news 축에 전파한다', async () => {
            const inputs: OverallDependencyInputs = {
                ...makeInputs(),
                tier: 'pro',
            };

            await resolveOverallDependencies(inputs);

            const fundamentalOpts =
                mockSubmitFundamentalAnalysis.mock.calls[0]?.[0];
            expect(fundamentalOpts).toMatchObject({ tier: 'pro' });

            const newsOpts = mockSubmitNewsAnalysis.mock.calls[0]?.[0];
            expect(newsOpts).toMatchObject({ tier: 'pro' });
        });

        it('top-level tier 미지정 시 DEFAULT_TIER(free)를 fundamental / news에 전달한다', async () => {
            await resolveOverallDependencies(makeInputs());

            const fundamentalOpts =
                mockSubmitFundamentalAnalysis.mock.calls[0]?.[0];
            expect(fundamentalOpts).toMatchObject({ tier: 'free' });

            const newsOpts = mockSubmitNewsAnalysis.mock.calls[0]?.[0];
            expect(newsOpts).toMatchObject({ tier: 'free' });
        });

        it('axis-level tier가 top-level tier를 덮어쓴다', async () => {
            const inputs: OverallDependencyInputs = {
                ...makeInputs({
                    fundamental: { tier: 'member' as const },
                }),
                tier: 'pro',
            };

            await resolveOverallDependencies(inputs);

            // fundamental: axis-level member wins over top-level pro
            const fundamentalOpts =
                mockSubmitFundamentalAnalysis.mock.calls[0]?.[0];
            expect(fundamentalOpts).toMatchObject({ tier: 'member' });

            // news: no axis-level → top-level pro propagates
            const newsOpts = mockSubmitNewsAnalysis.mock.calls[0]?.[0];
            expect(newsOpts).toMatchObject({ tier: 'pro' });
        });

        it('top-level tier가 technical tierContext로 전파된다 (tierContext 미지정 시)', async () => {
            const inputs: OverallDependencyInputs = {
                ...makeInputs({ technical: {} }),
                tier: 'member',
            };

            await resolveOverallDependencies(inputs);

            const technicalOpts = mockSubmitAnalysis.mock.calls[0]?.[5];
            expect(technicalOpts).toMatchObject({
                tierContext: { userId: null, tier: 'member' },
            });
        });

        it('technical에 tierContext가 지정되면 top-level tier를 무시한다', async () => {
            const inputs: OverallDependencyInputs = {
                ...makeInputs({
                    technical: {
                        tierContext: { userId: 'user-1', tier: 'pro' as const },
                    },
                }),
                tier: 'free',
            };

            await resolveOverallDependencies(inputs);

            const technicalOpts = mockSubmitAnalysis.mock.calls[0]?.[5];
            expect(technicalOpts).toMatchObject({
                tierContext: { userId: 'user-1', tier: 'pro' },
            });
        });
    });
});
