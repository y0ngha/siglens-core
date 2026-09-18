import { describe, it, expect } from 'vitest';
import { buildOverallAnalysisPrompt as buildOverallAnalysisPromptRaw } from '@/domain/analysis/overallPrompt';
import type {
    AnalysisResponse,
    Bar,
    FearGreedSnapshot,
    FinancialsScorecard,
    FundamentalAnalysisResponse,
    NewsAnalysisResponse,
    OptionsAnalysisResponse,
    PriorAnalysis,
    Timeframe,
} from '@/domain/types';

// `buildOverallAnalysisPrompt` now returns `{ stable, dynamic }` (spec §3.4
// assembly split) — this file's call sites predate the split and assert
// against the single legacy combined string (`stable + '\n\n' + dynamic`,
// exactly the string dispatch still sends as the `prompt` fallback field).
const buildOverallAnalysisPrompt = (
    ...args: Parameters<typeof buildOverallAnalysisPromptRaw>
): string => {
    const { stable, dynamic } = buildOverallAnalysisPromptRaw(...args);
    return `${stable}\n\n${dynamic}`;
};

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

    it('states the computed-figures rule and allows simple prose arithmetic (2026-09-19)', () => {
        const prompt = buildOverallAnalysisPrompt(
            TEST_SYMBOL,
            TEST_COMPANY_NAME,
            MOCK_TECHNICAL,
            MOCK_FUNDAMENTAL,
            MOCK_NEWS,
            '1Day' as Timeframe
        );
        expect(prompt).toContain(
            'Computed figures in the axis sections (distances from the snapshot price, the composite, scorecard grades) must be quoted as given, never recomputed.'
        );
        expect(prompt).toContain(
            'In prose you may do simple arithmetic from numbers that appear in this prompt'
        );
        expect(prompt).toContain(
            'Scenario price ranges still come only from provided levels and targets.'
        );
    });

    it('축 출처 라벨 지침과 갈등 보존 few-shot 예시를 포함한다 (C5-3 + C6)', () => {
        const prompt = buildOverallAnalysisPrompt(
            TEST_SYMBOL,
            TEST_COMPANY_NAME,
            MOCK_TECHNICAL,
            MOCK_FUNDAMENTAL,
            MOCK_NEWS,
            '1Day' as Timeframe
        );

        // C6 — source-attribution guidance line
        expect(prompt).toContain('attribute each claim to its source axis');
        expect(prompt).toContain('기술적 분석에 따르면');
        expect(prompt).toContain('펀더멘털 분석에서는');
        expect(prompt).toContain('뉴스 분석에서는');
        expect(prompt).toContain('옵션 시장에서는');
        // C5-3 — conflict-preservation few-shot
        expect(prompt).toContain(
            '## Few-Shot — conflict preservation + axis attribution'
        );
        expect(prompt).toContain('preserve the conflict explicitly');
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

    describe('crypto assetClass branch', () => {
        it('crypto + fundamental=null: emits crypto role line, crypto fundamental hint, and never calls formatFundamental', () => {
            const prompt = buildOverallAnalysisPrompt(
                'BTC',
                'Bitcoin',
                MOCK_TECHNICAL,
                null, // fundamental intentionally absent for crypto
                MOCK_NEWS,
                '1Day' as Timeframe,
                undefined,
                undefined,
                undefined,
                undefined,
                'crypto'
            );

            // Crypto role line — "available-axis" framing, not "four-axis"
            expect(prompt).toContain('senior markets analyst');
            expect(prompt).toContain('available-axis data');
            // The equity role line must NOT appear
            expect(prompt).not.toContain('senior equity analyst');
            expect(prompt).not.toContain('four-axis data');

            // assetContext crypto line
            expect(prompt).toContain(
                'This is a cryptocurrency (24/7 market, no earnings/fundamentals/options).'
            );

            // axisDataLabel in Data Boundary section — crypto uses 'available-axis'
            expect(prompt).toContain(
                'Use only the provided available-axis data as evidence'
            );

            // Crypto fundamental section hint: English text for crypto asset class
            expect(prompt).toContain(
                'This asset is a cryptocurrency and is not subject to corporate fundamental analysis.'
            );
            expect(prompt).toContain(
                'Keep fundamentalBulletsKo as an empty array.'
            );

            // formatFundamental output must NOT appear — equity fundamental strings would
            // only come from formatFundamental(MOCK_FUNDAMENTAL), which is never called here.
            // Use strings unique to formatFundamental (overallConclusionKo, riskFactorsKo):
            expect(prompt).not.toContain('펀더멘털 관점에서 테슬라는');
            // Conclusion (KO) line is emitted by formatFundamental only:
            expect(prompt).not.toContain(
                'Conclusion (KO): 펀더멘털 관점에서 테슬라는'
            );
            // Risk factor unique to MOCK_FUNDAMENTAL.riskFactorsKo:
            expect(prompt).not.toContain('Risk Factors: 경쟁 심화');
        });

        it('equity (explicit) + non-null fundamental: emits equity role line and formatted fundamental section', () => {
            const prompt = buildOverallAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                MOCK_TECHNICAL,
                MOCK_FUNDAMENTAL,
                MOCK_NEWS,
                '1Day' as Timeframe,
                undefined,
                undefined,
                undefined,
                undefined,
                'equity'
            );

            // Equity role line
            expect(prompt).toContain('senior equity analyst');
            expect(prompt).toContain(
                'integrating technical, fundamental, news, and options analysis'
            );
            // Equity four-axis framing
            expect(prompt).toContain('four-axis data');
            expect(prompt).toContain(
                'Use only the provided four-axis data as evidence'
            );

            // assetContext equity line
            expect(prompt).toContain('This is a publicly traded U.S. equity.');

            // Formatted fundamental section content from MOCK_FUNDAMENTAL
            expect(prompt).toContain('## Axis 2 — Fundamental Analysis');
            expect(prompt).toContain('펀더멘털 관점에서 테슬라는');
            expect(prompt).toContain('경쟁 심화');
            expect(prompt).toContain('Overall Sentiment: bearish');

            // Crypto hint must NOT appear
            expect(prompt).not.toContain(
                'This asset is a cryptocurrency and is not subject to corporate fundamental analysis.'
            );
            expect(prompt).not.toContain('available-axis data');
        });

        it('equity + null fundamental: emits neutral fallback (no crypto wording, no formatFundamental output)', () => {
            // Defensive branch: equity asset with fundamental=null (impossible in
            // normal flow but must not emit crypto-specific wording).
            const prompt = buildOverallAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                MOCK_TECHNICAL,
                null, // equity + null fundamental (defensive fallback)
                MOCK_NEWS,
                '1Day' as Timeframe,
                undefined,
                undefined,
                undefined,
                undefined,
                'equity'
            );

            // The neutral fallback text must appear
            expect(prompt).toContain('## Axis 2 — Fundamental Analysis');
            expect(prompt).toContain('(No fundamental data)');

            // Crypto wording must NOT appear — equity+null must NOT emit crypto hint
            expect(prompt).not.toContain(
                'This asset is a cryptocurrency and is not subject to corporate fundamental analysis.'
            );
            expect(prompt).not.toContain(
                'Keep fundamentalBulletsKo as an empty array.'
            );

            // formatFundamental output must NOT appear (fundamental is null)
            expect(prompt).not.toContain('펀더멘털 관점에서 테슬라는');

            // Equity framing still used
            expect(prompt).toContain('This is a publicly traded U.S. equity.');
        });
    });

    describe('financials axis integration', () => {
        const MOCK_SCORECARD: FinancialsScorecard = {
            growth: {
                score: 82,
                grade: 'B',
                signals: [
                    {
                        type: 'revenue_accel',
                        direction: 'positive',
                        labelKo: '매출 성장 가속',
                    },
                ],
                metrics: [],
            },
            quality: {
                score: 90,
                grade: 'A',
                signals: [
                    {
                        type: 'margin_expansion',
                        direction: 'positive',
                        labelKo: '영업이익률 개선',
                    },
                ],
                metrics: [],
            },
            solvency: {
                score: 60,
                grade: 'C',
                signals: [],
                metrics: [],
            },
            cash: {
                score: 75,
                grade: 'B',
                signals: [
                    {
                        type: 'fcf_solid',
                        direction: 'positive',
                        labelKo: '잉여현금흐름 흑자',
                    },
                ],
                metrics: [],
            },
            composite: {
                score: 77,
                grade: 'B',
                summaryKo: '수익성 우수(A), 안정성 주의(C)',
            },
        };

        it('renders financialsBulletsKo schema field even without a scorecard', () => {
            const prompt = buildOverallAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                MOCK_TECHNICAL,
                MOCK_FUNDAMENTAL,
                MOCK_NEWS,
                '1Day' as Timeframe
            );

            expect(prompt).toContain('financialsBulletsKo');
        });

        it('embeds composite grade + axis grades + signals when a scorecard is provided', () => {
            const prompt = buildOverallAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                MOCK_TECHNICAL,
                MOCK_FUNDAMENTAL,
                MOCK_NEWS,
                '1Day' as Timeframe,
                undefined,
                null,
                false,
                MOCK_SCORECARD
            );

            expect(prompt).toContain('## Financials Scorecard');
            // Composite grade + score + summary line.
            expect(prompt).toContain('B (77/100)');
            expect(prompt).toContain('수익성 우수(A), 안정성 주의(C)');
            // Per-axis grades.
            expect(prompt).toContain('성장성: B');
            expect(prompt).toContain('수익성·질: A');
            expect(prompt).toContain('안정성: C');
            expect(prompt).toContain('현금창출력: B');
            // Signal labels merged across axes.
            expect(prompt).toContain('매출 성장 가속');
            expect(prompt).toContain('영업이익률 개선');
            expect(prompt).toContain('잉여현금흐름 흑자');
            // Schema field still listed.
            expect(prompt).toContain('financialsBulletsKo');
        });

        it('renders the 데이터 없음 hint when scorecard is null and still lists financialsBulletsKo', () => {
            const prompt = buildOverallAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                MOCK_TECHNICAL,
                MOCK_FUNDAMENTAL,
                MOCK_NEWS,
                '1Day' as Timeframe,
                undefined,
                null,
                false,
                null
            );

            expect(prompt).toContain('## Financials Scorecard');
            expect(prompt).toContain('[재무 스코어카드] 데이터 없음');
            expect(prompt).toContain('financialsBulletsKo는 빈 배열로 둘 것');
            // No analytical content from a non-null scorecard should leak in.
            expect(prompt).not.toContain('수익성 우수(A), 안정성 주의(C)');
            // Schema field still listed.
            expect(prompt).toContain('financialsBulletsKo');
        });

        it('treats an omitted financials arg the same as null (데이터 없음 hint)', () => {
            const prompt = buildOverallAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                MOCK_TECHNICAL,
                MOCK_FUNDAMENTAL,
                MOCK_NEWS,
                '1Day' as Timeframe,
                undefined,
                null,
                false
                // financials omitted → falls back to the 데이터 없음 hint.
            );

            expect(prompt).toContain('[재무 스코어카드] 데이터 없음');
        });

        it('renders 시그널: 없음 when no axis carries signals', () => {
            const noSignals: FinancialsScorecard = {
                ...MOCK_SCORECARD,
                growth: { ...MOCK_SCORECARD.growth, signals: [] },
                quality: { ...MOCK_SCORECARD.quality, signals: [] },
                cash: { ...MOCK_SCORECARD.cash, signals: [] },
            };
            const prompt = buildOverallAnalysisPrompt(
                TEST_SYMBOL,
                TEST_COMPANY_NAME,
                MOCK_TECHNICAL,
                MOCK_FUNDAMENTAL,
                MOCK_NEWS,
                '1Day' as Timeframe,
                undefined,
                null,
                false,
                noSignals
            );

            expect(prompt).toContain('시그널: 없음');
        });
    });
});

describe('buildOverallAnalysisPrompt — Snapshot Price + distance-from-snapshot (spec 2026-09-18 §2.5)', () => {
    const snapshotBars = (close: number): Bar[] => [
        {
            time: 1_700_000_000,
            open: close,
            high: close,
            low: close,
            close,
            volume: 1000,
        },
    ];

    it('omits the Snapshot Price line and distance suffixes when bars is omitted', () => {
        const { dynamic } = buildOverallAnalysisPromptRaw(
            TEST_SYMBOL,
            TEST_COMPANY_NAME,
            MOCK_TECHNICAL,
            MOCK_FUNDAMENTAL,
            MOCK_NEWS,
            '1Day' as Timeframe
        );
        expect(dynamic).not.toContain('- Snapshot Price:');
        expect(dynamic).not.toContain('from snapshot');
    });

    it('renders Snapshot Price from the last bar close, and a signed % suffix on every level/target', () => {
        const { dynamic } = buildOverallAnalysisPromptRaw(
            TEST_SYMBOL,
            TEST_COMPANY_NAME,
            MOCK_TECHNICAL,
            MOCK_FUNDAMENTAL,
            MOCK_NEWS,
            '1Day' as Timeframe,
            undefined,
            null,
            false,
            null,
            'equity',
            'ko',
            snapshotBars(190)
        );
        expect(dynamic).toContain('- Snapshot Price: 190.00');
        // Support 170 vs snapshot 190 -> (170-190)/190*100 = -10.53%
        expect(dynamic).toContain('170.00 (-10.53% from snapshot)');
        // Resistance 200 vs snapshot 190 -> +5.26%
        expect(dynamic).toContain('200.00 (+5.26% from snapshot)');
        // Bullish target 210 vs snapshot 190 -> +10.53%
        expect(dynamic).toContain('210.00 (+10.53% from snapshot)');
        // Bearish target 160 vs snapshot 190 -> -15.79%
        expect(dynamic).toContain('160.00 (-15.79% from snapshot)');
    });

    it('omits the Snapshot Price line when bars is an empty array (zero-length, not just undefined)', () => {
        const { dynamic } = buildOverallAnalysisPromptRaw(
            TEST_SYMBOL,
            TEST_COMPANY_NAME,
            MOCK_TECHNICAL,
            MOCK_FUNDAMENTAL,
            MOCK_NEWS,
            '1Day' as Timeframe,
            undefined,
            null,
            false,
            null,
            'equity',
            'ko',
            []
        );
        expect(dynamic).not.toContain('- Snapshot Price:');
    });

    it('omits the distance suffix (zero base) when the last bar close is 0', () => {
        const { dynamic } = buildOverallAnalysisPromptRaw(
            TEST_SYMBOL,
            TEST_COMPANY_NAME,
            MOCK_TECHNICAL,
            MOCK_FUNDAMENTAL,
            MOCK_NEWS,
            '1Day' as Timeframe,
            undefined,
            null,
            false,
            null,
            'equity',
            'ko',
            snapshotBars(0)
        );
        expect(dynamic).not.toContain('from snapshot');
        expect(dynamic).not.toContain('- Snapshot Price:');
    });

    it('omits the distance suffix (negative base) when the last bar close is negative', () => {
        const { dynamic } = buildOverallAnalysisPromptRaw(
            TEST_SYMBOL,
            TEST_COMPANY_NAME,
            MOCK_TECHNICAL,
            MOCK_FUNDAMENTAL,
            MOCK_NEWS,
            '1Day' as Timeframe,
            undefined,
            null,
            false,
            null,
            'equity',
            'ko',
            snapshotBars(-10)
        );
        expect(dynamic).not.toContain('from snapshot');
    });

    it('omits the distance suffix when the last bar close is NaN', () => {
        const { dynamic } = buildOverallAnalysisPromptRaw(
            TEST_SYMBOL,
            TEST_COMPANY_NAME,
            MOCK_TECHNICAL,
            MOCK_FUNDAMENTAL,
            MOCK_NEWS,
            '1Day' as Timeframe,
            undefined,
            null,
            false,
            null,
            'equity',
            'ko',
            snapshotBars(Number.NaN)
        );
        expect(dynamic).not.toContain('from snapshot');
        expect(dynamic).not.toContain('- Snapshot Price:');
    });
});

describe('buildOverallAnalysisPrompt — prior analyses (Task 4, prior-analysis-context spec)', () => {
    /** Bars sorted oldest-first, 1 day apart, starting at a fixed Unix-seconds base. */
    const makePriorBars = (
        count: number,
        startTime = 1_700_000_000,
        intervalSeconds = 86_400
    ): Bar[] =>
        Array.from({ length: count }, (_, i) => ({
            time: startTime + i * intervalSeconds,
            open: 100,
            high: 101,
            low: 99,
            close: 100,
            volume: 1000,
        }));

    const priorEntry = (
        bars: Bar[],
        barIndex: number,
        overrides?: Partial<PriorAnalysis>
    ): PriorAnalysis => ({
        generatedAt: new Date(bars[barIndex].time * 1000),
        trend: 'bullish',
        riskLevel: 'medium',
        ...overrides,
    });

    // Shared arg prefix through `locale` — identical to every other call site
    // in this file (symbol, companyName, technical, fundamental, news,
    // timeframe, fearGreed, options, optionsOiStale, financials, assetClass,
    // locale). `bars` / `priorAnalyses` are the two NEW trailing params.
    const baseArgs = [
        TEST_SYMBOL,
        TEST_COMPANY_NAME,
        MOCK_TECHNICAL,
        MOCK_FUNDAMENTAL,
        MOCK_NEWS,
        '1Day' as Timeframe,
        undefined,
        null,
        false,
        null,
        'equity' as const,
        'ko' as const,
    ] as const;

    it('omitting both bars and priorAnalyses is byte-identical to the pre-existing 12-arg call', () => {
        const preExisting = buildOverallAnalysisPromptRaw(...baseArgs);
        const explicitlyUndefined = buildOverallAnalysisPromptRaw(
            ...baseArgs,
            undefined,
            undefined
        );
        expect(explicitlyUndefined).toEqual(preExisting);
    });

    it('bars without priorAnalyses renders no "## Prior Analyses" section (but bars alone still drives Snapshot Price, spec §2.5)', () => {
        const bars = makePriorBars(10);
        const withoutHistory = buildOverallAnalysisPromptRaw(...baseArgs);
        const withBarsOnly = buildOverallAnalysisPromptRaw(
            ...baseArgs,
            bars,
            undefined
        );
        expect(withBarsOnly.dynamic).not.toContain('## Prior Analyses');
        // Bars alone (no history) is no longer a no-op: the Snapshot Price
        // line and per-level distance suffixes read straight off `bars`.
        expect(withBarsOnly.dynamic).toContain('- Snapshot Price:');
        expect(withoutHistory.dynamic).not.toContain('- Snapshot Price:');
    });

    it('priorAnalyses without bars renders nothing and stays byte-identical', () => {
        const bars = makePriorBars(10);
        const history = [priorEntry(bars, 3)];
        const withoutHistory = buildOverallAnalysisPromptRaw(...baseArgs);
        const withHistoryOnly = buildOverallAnalysisPromptRaw(
            ...baseArgs,
            undefined,
            history
        );
        expect(withHistoryOnly).toEqual(withoutHistory);
    });

    it('empty bars + empty priorAnalyses renders nothing and stays byte-identical', () => {
        const withoutHistory = buildOverallAnalysisPromptRaw(...baseArgs);
        const withEmptyBoth = buildOverallAnalysisPromptRaw(
            ...baseArgs,
            [],
            []
        );
        expect(withEmptyBoth).toEqual(withoutHistory);
    });

    it('renders the "## Prior Analyses" section into `dynamic` when both bars and history are provided', () => {
        const bars = makePriorBars(10);
        const history = [priorEntry(bars, 3)];
        const { dynamic } = buildOverallAnalysisPromptRaw(
            ...baseArgs,
            bars,
            history
        );
        expect(dynamic).toContain(
            `## Prior Analyses (${TEST_SYMBOL} · Daily · reference only)`
        );
    });

    it('places the section in `dynamic` only — `stable` never carries it (stable is always empty here)', () => {
        const bars = makePriorBars(10);
        const history = [priorEntry(bars, 3)];
        const { stable, dynamic } = buildOverallAnalysisPromptRaw(
            ...baseArgs,
            bars,
            history
        );
        expect(dynamic).toContain('## Prior Analyses');
        expect(stable).toBe('');
    });

    it('appears after the Axis Weighting section (the last per-call context section) and before "## Output Schema"', () => {
        const bars = makePriorBars(10);
        const history = [priorEntry(bars, 3)];
        const { dynamic } = buildOverallAnalysisPromptRaw(
            ...baseArgs,
            bars,
            history
        );
        const axisWeightingIndex = dynamic.indexOf('## Axis Weighting');
        const priorIndex = dynamic.indexOf('## Prior Analyses');
        const schemaIndex = dynamic.indexOf('## Output Schema');
        expect(axisWeightingIndex).toBeGreaterThan(-1);
        expect(priorIndex).toBeGreaterThan(axisWeightingIndex);
        expect(schemaIndex).toBeGreaterThan(priorIndex);
    });

    it('appears after the Fear & Greed section too, when both are present', () => {
        const bars = makePriorBars(10);
        const history = [priorEntry(bars, 3)];
        const fg: FearGreedSnapshot = {
            score: 50,
            label: 'NEUTRAL',
            groups: [
                { name: 'Flow', score: 50, factors: [] },
                { name: 'Trend', score: 50, factors: [] },
            ],
            confidence: 'normal',
            sampleSize: 100,
            warning: null,
        };
        const { dynamic } = buildOverallAnalysisPromptRaw(
            TEST_SYMBOL,
            TEST_COMPANY_NAME,
            MOCK_TECHNICAL,
            MOCK_FUNDAMENTAL,
            MOCK_NEWS,
            '1Day' as Timeframe,
            fg,
            null,
            false,
            null,
            'equity',
            'ko',
            bars,
            history
        );
        const fgIndex = dynamic.indexOf('Fear & Greed Index');
        const priorIndex = dynamic.indexOf('## Prior Analyses');
        expect(fgIndex).toBeGreaterThan(-1);
        expect(priorIndex).toBeGreaterThan(fgIndex);
    });

    it('a history that narrows to nothing (outside the bar window) renders no "## Prior Analyses" section (bars still drive Snapshot Price, spec §2.5)', () => {
        // 10 bars is well inside the always-anchor-to-bars[0] fallback, so to
        // exercise the "narrowed to empty" path, use candidates that all
        // predate every bar entirely.
        const bars = makePriorBars(10);
        const tooOldHistory = [
            priorEntry(bars, 0, {
                generatedAt: new Date((bars[0].time - 10_000) * 1000),
            }),
        ];
        const withoutHistory = buildOverallAnalysisPromptRaw(...baseArgs);
        const withTooOldHistory = buildOverallAnalysisPromptRaw(
            ...baseArgs,
            bars,
            tooOldHistory
        );
        expect(withTooOldHistory.dynamic).not.toContain('## Prior Analyses');
        expect(withTooOldHistory.dynamic).toContain('- Snapshot Price:');
        expect(withoutHistory.dynamic).not.toContain('- Snapshot Price:');
    });
});

describe('buildOverallAnalysisPrompt — axis weighting', () => {
    it('renders every axis with its weight and basis', () => {
        const prompt = buildOverallAnalysisPrompt(
            TEST_SYMBOL,
            TEST_COMPANY_NAME,
            MOCK_TECHNICAL,
            MOCK_FUNDAMENTAL,
            MOCK_NEWS,
            '1Day' as Timeframe
        );

        expect(prompt).toContain('## Axis Weighting');
        // 종전에는 "roughly equal weight" 같은 산문이 전부였다. 산문 가중치는 diff도
        // 튜닝도 안 되고, 과거 종합이 무엇을 얼마로 쳤는지 기록도 남기지 않는다.
        expect(prompt).toContain(
            '- technical: 25.0 (weight 8) — trend bearish'
        );
        expect(prompt).toContain('- news: 25.0 (weight 6) — sentiment bearish');
        expect(prompt).toContain('Composite (weighted average');
    });

    it('weights the same axes differently by timeframe', () => {
        const args = [
            TEST_SYMBOL,
            TEST_COMPANY_NAME,
            MOCK_TECHNICAL,
            MOCK_FUNDAMENTAL,
            MOCK_NEWS,
        ] as const;

        const intraday = buildOverallAnalysisPrompt(
            ...args,
            '5Min' as Timeframe
        );
        const daily = buildOverallAnalysisPrompt(...args, '1Day' as Timeframe);

        expect(intraday).toContain('(weight 14)');
        expect(daily).toContain('(weight 8)');
        expect(intraday).not.toContain('- technical: 25.0 (weight 8)');
    });

    it('marks a missing axis as abstaining, not as a neutral vote', () => {
        const prompt = buildOverallAnalysisPrompt(
            TEST_SYMBOL,
            TEST_COMPANY_NAME,
            MOCK_TECHNICAL,
            null,
            MOCK_NEWS,
            '1Day' as Timeframe
        );

        expect(prompt).toContain('- fundamental: abstains (weight 0)');
        expect(prompt).toContain('it does NOT vote neutral');
    });

    it('abstains the fundamental axis for crypto even if a report is passed', () => {
        // 암호화폐에 기업 펀더멘털은 정의상 없다. 넘어온 값을 그대로 채점하면 자산
        // 종류와 무관한 이유로 종합이 중앙으로 끌린다.
        const prompt = buildOverallAnalysisPrompt(
            'BTCUSD',
            'Bitcoin',
            MOCK_TECHNICAL,
            MOCK_FUNDAMENTAL,
            MOCK_NEWS,
            '1Day' as Timeframe,
            undefined,
            null,
            false,
            null,
            'crypto'
        );

        expect(prompt).toContain('- fundamental: abstains (weight 0)');
    });

    it('forbids re-deriving the composite and demands conflicts be named', () => {
        const prompt = buildOverallAnalysisPrompt(
            TEST_SYMBOL,
            TEST_COMPANY_NAME,
            MOCK_TECHNICAL,
            MOCK_FUNDAMENTAL,
            MOCK_NEWS,
            '1Day' as Timeframe
        );

        expect(prompt).toContain('Do not recompute it');
        expect(prompt).toContain('name the axis you are overriding');
    });

    it('does not turn the composite into a trade signal', () => {
        // 3값 enum 위의 종합은 이산 분포이고 그 위에서 측정된 매수/매도 문턱이 없다.
        // 문턱을 붙이면 분포가 아니라 직관에서 숫자를 고르는 실수를 반복하게 된다.
        const prompt = buildOverallAnalysisPrompt(
            TEST_SYMBOL,
            TEST_COMPANY_NAME,
            MOCK_TECHNICAL,
            MOCK_FUNDAMENTAL,
            MOCK_NEWS,
            '1Day' as Timeframe
        );

        expect(prompt).toContain('not a trade signal');
        expect(prompt).toContain('do not invent one');
    });
});

describe('buildOverallAnalysisPrompt — 출력 로케일', () => {
    const build = (locale?: 'ko' | 'en' | 'ja' | 'zh') =>
        buildOverallAnalysisPrompt(
            TEST_SYMBOL,
            TEST_COMPANY_NAME,
            MOCK_TECHNICAL,
            MOCK_FUNDAMENTAL,
            MOCK_NEWS,
            '1Day' as Timeframe,
            undefined,
            null,
            false,
            null,
            'equity',
            locale
        );

    /**
     * 본문 지시뿐 아니라 **스키마 예시**도 `(한국어)`로 언어를 못 박고 있었다.
     * 예시는 모델이 그대로 흉내 내는 자리라 지시문보다 힘이 셀 수 있다.
     */
    it('로케일을 생략하면 ko와 바이트가 같다', () => {
        expect(build()).toBe(build('ko'));
    });

    it.each(['en', 'ja', 'zh'] as const)(
        '%s: 본문 지시와 스키마 예시에 한국어가 남지 않는다',
        locale => {
            const prompt = build(locale);
            expect(prompt).not.toContain('must be written in Korean');
            expect(prompt).not.toContain('(한국어)');
        }
    );

    it('ko: 예전 지시문과 예시가 그대로다', () => {
        expect(build('ko')).toContain('Korean (존댓말)');
        expect(build('ko')).toContain('(한국어)');
    });
});
