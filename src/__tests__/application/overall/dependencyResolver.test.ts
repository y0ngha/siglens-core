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
        it('technical 에러이면 kind: error 를 반환하고 axis: technical 을 포함한다', async () => {
            const technicalError = {
                code: 'timeframe_not_allowed',
                message: 'Not allowed',
                tier: 'free',
                timeframe: '1Day',
                allowedTimeframes: [],
            };
            mockSubmitAnalysis.mockResolvedValue({
                status: 'error',
                error: technicalError,
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

            expect(state.kind).toBe('error');
            if (state.kind === 'error') {
                expect(state.axis).toBe('technical');
                expect(state.error).toEqual(technicalError);
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
                makeInputs({ newsItems, upcomingCalendar })
            );

            expect(mockSubmitNewsAnalysis).toHaveBeenCalledWith(
                expect.objectContaining({
                    news: newsItems,
                    upcomingCalendar,
                })
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
                false,
                undefined,
                expect.any(Object)
            );
        });
    });
});
