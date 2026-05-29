import { describe, it, expect } from 'vitest';
import { buildOverallAnalysisPrompt } from '@/domain/analysis/overallPrompt';
import type {
    AnalysisResponse,
    FearGreedSnapshot,
    FundamentalAnalysisResponse,
    NewsAnalysisResponse,
    OptionsAnalysisResponse,
    Timeframe,
} from '@/domain/types';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const TEST_SYMBOL = 'TSLA';
const TEST_COMPANY_NAME = 'Tesla, Inc.';

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
        bullish: {
            targets: [{ price: 210.0, basis: 'Break above resistance' }],
            condition: '200 돌파 시',
        },
        bearish: {
            targets: [{ price: 160.0, basis: 'Break below support' }],
            condition: '170 하향 이탈 시',
        },
    },
    patternSummaries: [],
    strategyResults: [],
    candlePatterns: [],
    trendlines: [],
};

const MOCK_FUNDAMENTAL: FundamentalAnalysisResponse = {
    overallConclusionKo:
        '펀더멘털 관점에서 테슬라는 고평가 구간에 위치하며 성장 둔화가 감지됩니다.',
    categoryAssessments: [
        {
            category: 'valuation',
            sentiment: 'bearish',
            rationaleKo: 'PER이 업종 평균 대비 높습니다.',
        },
        {
            category: 'profitability',
            sentiment: 'neutral',
            rationaleKo: '마진 압박이 지속되고 있습니다.',
        },
        {
            category: 'growth',
            sentiment: 'bearish',
            rationaleKo: '매출 성장이 둔화되었습니다.',
        },
        {
            category: 'health',
            sentiment: 'neutral',
            rationaleKo: '유동성은 양호합니다.',
        },
        {
            category: 'futureDirection',
            sentiment: 'bearish',
            rationaleKo: '애널리스트 목표주가가 하향 조정됐습니다.',
        },
    ],
    riskFactorsKo: ['경쟁 심화', '금리 인상 영향'],
    overallSentiment: 'bearish',
};

const MOCK_NEWS: NewsAnalysisResponse = {
    currentDriverKo:
        '최근 실적 실망과 수요 우려가 주가 하락을 이끌고 있습니다.',
    keyEventsKo: ['Q1 인도량 예상 하회', 'EU 보조금 축소 발표'],
    upcomingEventsKo: ['2025-07-30 실적 발표 예정'],
    overallSentiment: 'bearish',
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('buildOverallAnalysisPrompt', () => {
    it('produces prompt with intraday timeframe context for 5Min', () => {
        const prompt = buildOverallAnalysisPrompt(
            TEST_SYMBOL,
            TEST_COMPANY_NAME,
            MOCK_TECHNICAL,
            MOCK_FUNDAMENTAL,
            MOCK_NEWS,
            '5Min' as Timeframe
        );

        expect(prompt).toContain('TSLA');
        // 5Min should reference short-term / intraday context
        expect(prompt).toContain('5Min');
        // Timeframe context string for intraday should be present
        expect(prompt).toContain('intraday');
        // Schema fields
        expect(prompt).toContain('headlineKo');
        expect(prompt).toContain('integratedConclusionKo');
        expect(prompt).toContain('scenarios');
        expect(prompt).toContain('riskFactorsKo');
        expect(prompt).toContain('## Data Boundary');
        expect(prompt).toContain('intermediate analysis data');
        expect(prompt).toContain('Do not fabricate new price levels');
        expect(prompt).toContain(
            'Scenario price ranges must come from provided technical key levels or price targets'
        );
    });

    it('produces prompt with positional context for 1Day', () => {
        const prompt = buildOverallAnalysisPrompt(
            TEST_SYMBOL,
            TEST_COMPANY_NAME,
            MOCK_TECHNICAL,
            MOCK_FUNDAMENTAL,
            MOCK_NEWS,
            '1Day' as Timeframe
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
            TEST_COMPANY_NAME,
            MOCK_TECHNICAL,
            MOCK_FUNDAMENTAL,
            MOCK_NEWS,
            '1Hour' as Timeframe
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

    it('includes condensed candle / strategy / trendline summaries when present', () => {
        const technicalWithSignals: AnalysisResponse = {
            ...MOCK_TECHNICAL,
            candlePatterns: [
                {
                    id: 'c1',
                    patternName: 'bullish_engulfing',
                    detected: true,
                    trend: 'bullish',
                    summary: '강세 장악형 패턴 발견',
                },
                {
                    id: 'c2',
                    patternName: 'doji',
                    detected: false,
                    trend: 'neutral',
                    summary: '도지 캔들',
                },
            ],
            strategyResults: [
                {
                    id: 's1',
                    strategyName: 'rsi-divergence',
                    trend: 'bullish',
                    summary: 'RSI 다이버전스 발견',
                    confidenceWeight: 1,
                },
                {
                    id: 's2',
                    strategyName: 'macd-cross',
                    trend: 'bearish',
                    summary: 'MACD 데드크로스',
                    confidenceWeight: 1,
                },
            ],
            trendlines: [
                {
                    direction: 'ascending',
                    start: { time: 1700000000, price: 100 },
                    end: { time: 1700100000, price: 110 },
                },
                {
                    direction: 'ascending',
                    start: { time: 1700200000, price: 105 },
                    end: { time: 1700300000, price: 115 },
                },
                {
                    direction: 'descending',
                    start: { time: 1700400000, price: 120 },
                    end: { time: 1700500000, price: 110 },
                },
            ],
        };

        const prompt = buildOverallAnalysisPrompt(
            TEST_SYMBOL,
            TEST_COMPANY_NAME,
            technicalWithSignals,
            MOCK_FUNDAMENTAL,
            MOCK_NEWS,
            '1Hour' as Timeframe
        );

        expect(prompt).toContain('Candle Patterns');
        expect(prompt).toContain('bullish_engulfing');
        expect(prompt).toContain('Strategy Signals');
        expect(prompt).toContain('Trendlines');
        expect(prompt).toContain('ascending'); // dominant
    });

    it('패턴 요약·미감지 캔들·동수 추세선(mixed)을 올바르게 렌더한다', () => {
        // patternSummaries.length > 0 (line 97), detected 0개일 때
        // candlePatterns[0]을 latest로 사용 (line 110), ascending === descending
        // 일 때 dominant=mixed (line 136) — 세 분기를 한 번에 덮는다.
        const technical: AnalysisResponse = {
            ...MOCK_TECHNICAL,
            patternSummaries: [
                {
                    id: 'p1',
                    patternName: 'head_and_shoulders',
                    skillName: '헤드앤숄더',
                    detected: true,
                    trend: 'bearish',
                    summary: '헤드앤숄더 요약',
                    confidenceWeight: 0.8,
                },
            ],
            candlePatterns: [
                {
                    id: 'c1',
                    patternName: 'doji',
                    detected: false,
                    trend: 'neutral',
                    summary: '도지 캔들',
                },
            ],
            trendlines: [
                {
                    direction: 'ascending',
                    start: { time: 1, price: 100 },
                    end: { time: 2, price: 110 },
                },
                {
                    direction: 'descending',
                    start: { time: 3, price: 120 },
                    end: { time: 4, price: 110 },
                },
            ],
        };

        const prompt = buildOverallAnalysisPrompt(
            TEST_SYMBOL,
            TEST_COMPANY_NAME,
            technical,
            MOCK_FUNDAMENTAL,
            MOCK_NEWS,
            '1Hour' as Timeframe
        );

        expect(prompt).toContain('Chart Patterns: head_and_shoulders');
        expect(prompt).toContain('0/1 detected; latest "doji"');
        expect(prompt).toContain('dominant: mixed');
    });

    it('하락 추세선이 우세하면 dominant: descending으로 렌더한다', () => {
        const technical: AnalysisResponse = {
            ...MOCK_TECHNICAL,
            trendlines: [
                {
                    direction: 'descending',
                    start: { time: 1, price: 120 },
                    end: { time: 2, price: 110 },
                },
                {
                    direction: 'descending',
                    start: { time: 3, price: 110 },
                    end: { time: 4, price: 100 },
                },
            ],
        };

        const prompt = buildOverallAnalysisPrompt(
            TEST_SYMBOL,
            TEST_COMPANY_NAME,
            technical,
            MOCK_FUNDAMENTAL,
            MOCK_NEWS,
            '1Hour' as Timeframe
        );

        expect(prompt).toContain('dominant: descending');
    });

    describe('buildOverallAnalysisPrompt — fearGreed integration', () => {
        it('omits fear-greed section when fearGreed is undefined', () => {
            const prompt = buildOverallAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                MOCK_TECHNICAL,
                MOCK_FUNDAMENTAL,
                MOCK_NEWS,
                '1Day' as Timeframe
            );
            expect(prompt).not.toContain('Fear & Greed Index');
        });

        it('includes fear-greed section when snapshot is provided', () => {
            const fg: FearGreedSnapshot = {
                score: 22,
                label: 'EXTREME_FEAR',
                groups: [
                    { name: 'Flow', score: 28, factors: [] },
                    { name: 'Trend', score: 16, factors: [] },
                ],
                confidence: 'normal',
                sampleSize: 412,
                warning: null,
            };
            const prompt = buildOverallAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                MOCK_TECHNICAL,
                MOCK_FUNDAMENTAL,
                MOCK_NEWS,
                '1Day' as Timeframe,
                fg
            );
            expect(prompt).toContain('Fear & Greed Index');
            expect(prompt).toContain('22');
            expect(prompt).toContain('EXTREME_FEAR');
            expect(prompt).toContain('Flow Group: 28');
            expect(prompt).toContain('Trend Group: 16');
        });

        it('appends warning text when warning is set (CHRONIC_WEAKNESS)', () => {
            const fg: FearGreedSnapshot = {
                score: 78,
                label: 'EXTREME_GREED',
                groups: [
                    { name: 'Flow', score: 80, factors: [] },
                    { name: 'Trend', score: 76, factors: [] },
                ],
                confidence: 'normal',
                sampleSize: 412,
                warning: 'CHRONIC_WEAKNESS',
            };
            const prompt = buildOverallAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                MOCK_TECHNICAL,
                MOCK_FUNDAMENTAL,
                MOCK_NEWS,
                '1Day' as Timeframe,
                fg
            );
            expect(prompt).toContain(
                'This stock is in a long-term bearish cycle. The score represents its relative position within its own distribution.'
            );
        });

        it('appends warning text when warning is set (CHRONIC_STRENGTH)', () => {
            const fg: FearGreedSnapshot = {
                score: 32,
                label: 'FEAR',
                groups: [
                    { name: 'Flow', score: 36, factors: [] },
                    { name: 'Trend', score: 28, factors: [] },
                ],
                confidence: 'normal',
                sampleSize: 412,
                warning: 'CHRONIC_STRENGTH',
            };
            const prompt = buildOverallAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                MOCK_TECHNICAL,
                MOCK_FUNDAMENTAL,
                MOCK_NEWS,
                '1Day' as Timeframe,
                fg
            );
            expect(prompt).toContain(
                'This stock is in a long-term bullish cycle. The score represents its relative position within its own distribution.'
            );
        });
    });

    describe('options axis integration', () => {
        const MOCK_OPTIONS: OptionsAnalysisResponse = {
            summary:
                '풋콜 비율은 균형 상태이며 단기 변동성 프리미엄이 평이합니다.',
            perExpiration: [
                {
                    expirationDate: '2026-06-20',
                    tone: 'neutral',
                    commentary: '주요 외가격 콜 옵션에 거래량 집중.',
                },
            ],
            signals: [
                {
                    kind: 'volatility',
                    message: 'IV가 30일 평균 대비 12% 낮음.',
                },
            ],
            analyzedAt: '2026-05-22T13:30:00Z',
        };

        it('renders optionsBulletsKo + integratedConclusionKo schema fields', () => {
            const prompt = buildOverallAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                MOCK_TECHNICAL,
                MOCK_FUNDAMENTAL,
                MOCK_NEWS,
                '1Day' as Timeframe,
                undefined,
                MOCK_OPTIONS
            );

            expect(prompt).toContain('optionsBulletsKo');
            expect(prompt).toContain('integratedConclusionKo');
            // Old field name must be gone.
            expect(prompt).not.toContain('threeAxisConclusionKo');
            // 4-axis label appears in narrative and rules.
            expect(prompt).toContain('four-axis');
        });

        it('embeds options summary + per-expiration + signals when payload is provided', () => {
            const prompt = buildOverallAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                MOCK_TECHNICAL,
                MOCK_FUNDAMENTAL,
                MOCK_NEWS,
                '1Day' as Timeframe,
                undefined,
                MOCK_OPTIONS
            );

            expect(prompt).toContain('풋콜 비율은 균형 상태이며');
            expect(prompt).toContain('2026-06-20');
            expect(prompt).toContain('주요 외가격 콜 옵션에 거래량 집중');
            expect(prompt).toContain('IV가 30일 평균 대비 12% 낮음');
            expect(prompt).toContain('Axis 4 — Options Analysis');
        });

        it('renders the 옵션 미상장 hint when options is null', () => {
            const prompt = buildOverallAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                MOCK_TECHNICAL,
                MOCK_FUNDAMENTAL,
                MOCK_NEWS,
                '1Day' as Timeframe,
                undefined,
                null
            );

            expect(prompt).toContain(
                '옵션 시장 데이터는 분석에 포함되지 않았습니다'
            );
            expect(prompt).toContain('optionsBulletsKo는 빈 배열로 유지하세요');
            // No analytical content from a non-null options payload should leak in.
            expect(prompt).not.toContain('풋콜 비율은 균형 상태이며');
        });

        it('appends the stale-OI caveat when optionsOiStale=true', () => {
            const prompt = buildOverallAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                MOCK_TECHNICAL,
                MOCK_FUNDAMENTAL,
                MOCK_NEWS,
                '1Day' as Timeframe,
                undefined,
                MOCK_OPTIONS,
                true
            );

            expect(prompt).toContain(
                '미국 옵션 정규 거래 시간 외에 수집된 스냅샷'
            );
            expect(prompt).toContain(
                'Open Interest가 직전 세션 기준일 수 있습니다'
            );
        });

        it('omits the stale-OI caveat when optionsOiStale is false or undefined', () => {
            const prompt = buildOverallAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                MOCK_TECHNICAL,
                MOCK_FUNDAMENTAL,
                MOCK_NEWS,
                '1Day' as Timeframe,
                undefined,
                MOCK_OPTIONS
            );

            expect(prompt).not.toContain(
                '미국 옵션 정규 거래 시간 외에 수집된'
            );
        });

        it('treats an omitted options arg as a graceful options skip (4-axis call without options)', () => {
            const prompt = buildOverallAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                MOCK_TECHNICAL,
                MOCK_FUNDAMENTAL,
                MOCK_NEWS,
                '1Day' as Timeframe
                // options + optionsOiStale omitted → fallback to null/false.
            );

            // When the options arg is omitted, the impl falls back to
            // `options=null`, producing the same "no options data" hint as
            // the explicit-null branch.
            expect(prompt).toContain(
                '옵션 시장 데이터는 분석에 포함되지 않았습니다'
            );
        });

        it('옵션 perExpiration/signals가 빈 배열이면 해당 섹션을 생략한다', () => {
            // perExpiration.length === 0 (line 222) 및 signals.length === 0
            // (line 232) 의 빈 배열 분기를 덮는다.
            const emptyOptions: OptionsAnalysisResponse = {
                summary: '옵션 요약만 존재합니다.',
                perExpiration: [],
                signals: [],
                analyzedAt: '2026-05-22T13:30:00Z',
            };
            const prompt = buildOverallAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                MOCK_TECHNICAL,
                MOCK_FUNDAMENTAL,
                MOCK_NEWS,
                '1Day' as Timeframe,
                undefined,
                emptyOptions
            );

            expect(prompt).toContain('옵션 요약만 존재합니다.');
            expect(prompt).not.toContain('- Per-Expiration:');
            expect(prompt).not.toContain('- Signals:');
        });
    });
});
