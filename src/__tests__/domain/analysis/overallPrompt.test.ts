import { describe, it, expect } from 'vitest';
import { buildOverallAnalysisPrompt } from '@/domain/analysis/overallPrompt';
import type {
    AnalysisResponse,
    FundamentalAnalysisResponse,
    NewsAnalysisResponse,
    Timeframe,
} from '@/domain/types';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const TEST_SYMBOL = 'TSLA';

const MOCK_TECHNICAL: AnalysisResponse = {
    summary: '기술적 분석 요약입니다. RSI 과매도, MACD 하락 추세.',
    trend: 'bearish',
    indicatorResults: [],
    riskLevel: 'high',
    keyLevels: {
        support: [{ price: 170.0, reason: 'Key support at 170' }],
        resistance: [{ price: 200.0, reason: 'Key resistance at 200' }],
    },
    priceTargets: {
        bullish: { targets: [{ price: 210.0, basis: 'Break above resistance' }], condition: '200 돌파 시' },
        bearish: { targets: [{ price: 160.0, basis: 'Break below support' }], condition: '170 하향 이탈 시' },
    },
    patternSummaries: [],
    strategyResults: [],
    candlePatterns: [],
    trendlines: [],
};

const MOCK_FUNDAMENTAL: FundamentalAnalysisResponse = {
    overallConclusionKo: '펀더멘털 관점에서 테슬라는 고평가 구간에 위치하며 성장 둔화가 감지됩니다.',
    categoryAssessments: [
        { category: 'valuation', sentiment: 'bearish', rationaleKo: 'PER이 업종 평균 대비 높습니다.' },
        { category: 'profitability', sentiment: 'neutral', rationaleKo: '마진 압박이 지속되고 있습니다.' },
        { category: 'growth', sentiment: 'bearish', rationaleKo: '매출 성장이 둔화되었습니다.' },
        { category: 'health', sentiment: 'neutral', rationaleKo: '유동성은 양호합니다.' },
        { category: 'futureDirection', sentiment: 'bearish', rationaleKo: '애널리스트 목표주가가 하향 조정됐습니다.' },
    ],
    riskFactorsKo: ['경쟁 심화', '금리 인상 영향'],
    overallSentiment: 'bearish',
};

const MOCK_NEWS: NewsAnalysisResponse = {
    currentDriverKo: '최근 실적 실망과 수요 우려가 주가 하락을 이끌고 있습니다.',
    keyEventsKo: ['Q1 인도량 예상 하회', 'EU 보조금 축소 발표'],
    upcomingEventsKo: ['2025-07-30 실적 발표 예정'],
    overallSentiment: 'bearish',
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('buildOverallAnalysisPrompt', () => {
    it('produces prompt with intraday timeframe context for 5Min', () => {
        const prompt = buildOverallAnalysisPrompt(
            TEST_SYMBOL,
            MOCK_TECHNICAL,
            MOCK_FUNDAMENTAL,
            MOCK_NEWS,
            '5Min' as Timeframe,
        );

        expect(prompt).toContain('TSLA');
        // 5Min should reference short-term / intraday context
        expect(prompt).toContain('5Min');
        // Timeframe context string for intraday should be present
        expect(prompt).toContain('intraday');
        // Schema fields
        expect(prompt).toContain('headlineKo');
        expect(prompt).toContain('threeAxisConclusionKo');
        expect(prompt).toContain('scenarios');
        expect(prompt).toContain('riskFactorsKo');
    });

    it('produces prompt with positional context for 1Day', () => {
        const prompt = buildOverallAnalysisPrompt(
            TEST_SYMBOL,
            MOCK_TECHNICAL,
            MOCK_FUNDAMENTAL,
            MOCK_NEWS,
            '1Day' as Timeframe,
        );

        expect(prompt).toContain('TSLA');
        expect(prompt).toContain('1Day');
        // 1Day should reference positional / swing trading context
        expect(prompt).toContain('positional');
        // Schema fields still present
        expect(prompt).toContain('headlineKo');
        expect(prompt).toContain('technicalBulletsKo');
        expect(prompt).toContain('fundamentalBulletsKo');
        expect(prompt).toContain('newsBulletsKo');
    });

    it('embeds technical, fundamental, and news summary content in the prompt', () => {
        const prompt = buildOverallAnalysisPrompt(
            TEST_SYMBOL,
            MOCK_TECHNICAL,
            MOCK_FUNDAMENTAL,
            MOCK_NEWS,
            '1Hour' as Timeframe,
        );

        // Technical summary content
        expect(prompt).toContain('기술적 분석 요약입니다');
        expect(prompt).toContain('bearish'); // technical trend
        // Fundamental content
        expect(prompt).toContain('펀더멘털 관점에서 테슬라는');
        expect(prompt).toContain('경쟁 심화');
        // News content
        expect(prompt).toContain('최근 실적 실망과 수요 우려');
        expect(prompt).toContain('Q1 인도량 예상 하회');
        expect(prompt).toContain('2025-07-30 실적 발표 예정');
    });
});
