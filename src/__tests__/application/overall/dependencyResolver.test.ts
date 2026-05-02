import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

// ── Mock the three submit functions before importing the resolver ──
vi.mock('@/application/market/submitAnalysis');
vi.mock('@/application/fundamental/submitFundamentalAnalysis');
vi.mock('@/application/news/submitNewsAnalysis');

import {
    resolveOverallDependencies,
    type OverallDependencyInputs,
} from '@/application/overall/dependencyResolver';
import { submitAnalysis } from '@/application/market/submitAnalysis';
import { submitFundamentalAnalysis } from '@/application/fundamental/submitFundamentalAnalysis';
import { submitNewsAnalysis } from '@/application/news/submitNewsAnalysis';
import type {
    AnalysisResponse,
    FundamentalAnalysisResponse,
    NewsAnalysisResponse,
} from '@/domain/types';
import { makeEnrichedNewsItem, makeCalendarItem, minimalProvider } from './fixtures';

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
        news: [makeEnrichedNewsItem('n001')],
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
            mockSubmitAnalysis.mockResolvedValue({ status: 'cached', result: cachedTechnical });
            mockSubmitFundamentalAnalysis.mockResolvedValue({ status: 'cached', result: cachedFundamental });
            mockSubmitNewsAnalysis.mockResolvedValue({ status: 'cached', result: cachedNews });

            const state = await resolveOverallDependencies(makeInputs());

            expect(state.kind).toBe('cached');
            if (state.kind === 'cached') {
                expect(state.technical).toEqual(cachedTechnical);
                expect(state.fundamental).toEqual(cachedFundamental);
                expect(state.news).toEqual(cachedNews);
            }
        });

        it('세 submit 함수를 정확히 한 번씩 호출한다', async () => {
            mockSubmitAnalysis.mockResolvedValue({ status: 'cached', result: cachedTechnical });
            mockSubmitFundamentalAnalysis.mockResolvedValue({ status: 'cached', result: cachedFundamental });
            mockSubmitNewsAnalysis.mockResolvedValue({ status: 'cached', result: cachedNews });

            await resolveOverallDependencies(makeInputs());

            expect(mockSubmitAnalysis).toHaveBeenCalledTimes(1);
            expect(mockSubmitFundamentalAnalysis).toHaveBeenCalledTimes(1);
            expect(mockSubmitNewsAnalysis).toHaveBeenCalledTimes(1);
        });
    });

    describe('일부 축이 submitted 일 때', () => {
        it('kind: pending 을 반환하고 submitted 축의 jobId 를 포함한다', async () => {
            mockSubmitAnalysis.mockResolvedValue({ status: 'submitted', jobId: 'tech-job-001' });
            mockSubmitFundamentalAnalysis.mockResolvedValue({ status: 'cached', result: cachedFundamental });
            mockSubmitNewsAnalysis.mockResolvedValue({ status: 'submitted', jobId: 'news-job-001' });

            const state = await resolveOverallDependencies(makeInputs());

            expect(state.kind).toBe('pending');
            if (state.kind === 'pending') {
                expect(state.pendingJobs.technical).toBe('tech-job-001');
                expect(state.pendingJobs.fundamental).toBeUndefined();
                expect(state.pendingJobs.news).toBe('news-job-001');
            }
        });

        it('fundamental 만 submitted 이면 해당 jobId 만 있고 나머지는 undefined 다', async () => {
            mockSubmitAnalysis.mockResolvedValue({ status: 'cached', result: cachedTechnical });
            mockSubmitFundamentalAnalysis.mockResolvedValue({ status: 'submitted', jobId: 'fund-job-007' });
            mockSubmitNewsAnalysis.mockResolvedValue({ status: 'cached', result: cachedNews });

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
            mockSubmitAnalysis.mockResolvedValue({ status: 'submitted', jobId: 'tech-job-111' });
            mockSubmitFundamentalAnalysis.mockResolvedValue({ status: 'submitted', jobId: 'fund-job-222' });
            mockSubmitNewsAnalysis.mockResolvedValue({ status: 'submitted', jobId: 'news-job-333' });

            const state = await resolveOverallDependencies(makeInputs());

            expect(state.kind).toBe('pending');
            if (state.kind === 'pending') {
                expect(state.pendingJobs.technical).toBe('tech-job-111');
                expect(state.pendingJobs.fundamental).toBe('fund-job-222');
                expect(state.pendingJobs.news).toBe('news-job-333');
            }
        });
    });

    describe('technical 에러(tier gate) 일 때', () => {
        it('kind: pending 을 반환하고 technical jobId 는 undefined 다', async () => {
            mockSubmitAnalysis.mockResolvedValue({
                status: 'error',
                error: { code: 'timeframe_not_allowed', message: 'Not allowed', tier: 'free', timeframe: '1Day', allowedTimeframes: [] },
            });
            mockSubmitFundamentalAnalysis.mockResolvedValue({ status: 'cached', result: cachedFundamental });
            mockSubmitNewsAnalysis.mockResolvedValue({ status: 'cached', result: cachedNews });

            const state = await resolveOverallDependencies(makeInputs());

            expect(state.kind).toBe('pending');
            if (state.kind === 'pending') {
                expect(state.pendingJobs.technical).toBeUndefined();
            }
        });
    });

    describe('inputs 전달 확인', () => {
        it('submitAnalysis 에 symbol, timeframe 이 올바르게 전달된다', async () => {
            mockSubmitAnalysis.mockResolvedValue({ status: 'cached', result: cachedTechnical });
            mockSubmitFundamentalAnalysis.mockResolvedValue({ status: 'cached', result: cachedFundamental });
            mockSubmitNewsAnalysis.mockResolvedValue({ status: 'cached', result: cachedNews });

            await resolveOverallDependencies(makeInputs({ symbol: 'TSLA', timeframe: '4Hour' }));

            expect(mockSubmitAnalysis).toHaveBeenCalledWith('TSLA', '4Hour', false, undefined, expect.any(Object));
        });

        it('submitFundamentalAnalysis 에 symbol 과 modelId 가 올바르게 전달된다', async () => {
            mockSubmitAnalysis.mockResolvedValue({ status: 'cached', result: cachedTechnical });
            mockSubmitFundamentalAnalysis.mockResolvedValue({ status: 'cached', result: cachedFundamental });
            mockSubmitNewsAnalysis.mockResolvedValue({ status: 'cached', result: cachedNews });

            await resolveOverallDependencies(makeInputs({ symbol: 'NVDA', modelId: 'claude-sonnet-4-6' }));

            expect(mockSubmitFundamentalAnalysis).toHaveBeenCalledWith(
                expect.objectContaining({ symbol: 'NVDA', modelId: 'claude-sonnet-4-6' })
            );
        });

        it('submitNewsAnalysis 에 news 와 upcomingCalendar 가 올바르게 전달된다', async () => {
            mockSubmitAnalysis.mockResolvedValue({ status: 'cached', result: cachedTechnical });
            mockSubmitFundamentalAnalysis.mockResolvedValue({ status: 'cached', result: cachedFundamental });
            mockSubmitNewsAnalysis.mockResolvedValue({ status: 'cached', result: cachedNews });

            const news = [makeEnrichedNewsItem('x1'), makeEnrichedNewsItem('x2')];
            const upcomingCalendar = [makeCalendarItem('2026-08-01')];

            await resolveOverallDependencies(makeInputs({ news, upcomingCalendar }));

            expect(mockSubmitNewsAnalysis).toHaveBeenCalledWith(
                expect.objectContaining({ news, upcomingCalendar })
            );
        });
    });
});
