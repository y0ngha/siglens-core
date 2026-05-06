import { describe, it, expect } from 'vitest';
import { buildChatPrompt } from '@/domain/chat/buildChatPrompt';
import type {
    AnalysisResponse,
    CurrentAnalysisContext,
    FundamentalAnalysisResponse,
    NewsAnalysisResponse,
    OverallAnalysisResponse,
} from '@/domain/types';

const MINIMAL_ANALYSIS: AnalysisResponse = {
    summary: 'AAPL is trending upward.',
    trend: 'bullish',
    riskLevel: 'medium',
    indicatorResults: [],
    keyLevels: { support: [], resistance: [] },
    priceTargets: {
        bullish: { targets: [], condition: '' },
        bearish: { targets: [], condition: '' },
    },
    patternSummaries: [],
    strategyResults: [],
    candlePatterns: [],
    trendlines: [],
};

describe('buildChatPrompt 함수는', () => {
    describe('systemPrompt를', () => {
        it('심볼과 타임프레임을 포함한다', () => {
            const result = buildChatPrompt(
                'AAPL',
                '1Day',
                MINIMAL_ANALYSIS,
                [],
                '지금 사도 돼?'
            );
            expect(result.systemPrompt).toContain('AAPL');
            expect(result.systemPrompt).toContain('1Day');
        });

        it('분석 요약을 포함한다', () => {
            const result = buildChatPrompt(
                'AAPL',
                '1Day',
                MINIMAL_ANALYSIS,
                [],
                '지금 사도 돼?'
            );
            expect(result.systemPrompt).toContain('AAPL is trending upward.');
        });

        it('actionRecommendation이 있으면 systemPrompt에 포함한다', () => {
            const analysis: AnalysisResponse = {
                ...MINIMAL_ANALYSIS,
                actionRecommendation: {
                    entryRecommendation: 'wait',
                    positionAnalysis: '현재 과매수 구간',
                    entry: '182 이하 진입 고려',
                    exit: '190 도달 시 일부 매도',
                    riskReward: '1:2',
                },
            };
            const result = buildChatPrompt(
                'AAPL',
                '1Day',
                analysis,
                [],
                '진입 전략?'
            );
            expect(result.systemPrompt).toContain('182 이하 진입 고려');
        });

        it('keyLevels가 있으면 지지/저항 가격을 포함한다', () => {
            const analysis: AnalysisResponse = {
                ...MINIMAL_ANALYSIS,
                keyLevels: {
                    resistance: [{ price: 195.5, reason: 'Previous high' }],
                    support: [{ price: 180.0, reason: 'Moving average' }],
                    poc: { price: 188.25, reason: 'Volume profile POC' },
                },
            };
            const result = buildChatPrompt(
                'AAPL',
                '1Day',
                analysis,
                [],
                '질문'
            );
            expect(result.systemPrompt).toContain('195.50');
            expect(result.systemPrompt).toContain('180.00');
            expect(result.systemPrompt).toContain('188.25');
            expect(result.systemPrompt).toContain('Volume profile POC');
        });

        it('제공되지 않은 데이터는 추측하지 않도록 지시한다', () => {
            const result = buildChatPrompt(
                'AAPL',
                '1Day',
                MINIMAL_ANALYSIS,
                [],
                '질문'
            );

            expect(result.systemPrompt).toContain(
                'not present in the provided analysis data'
            );
            expect(result.systemPrompt).toContain('- POC: None detected');
        });

        it('indicatorResults가 있으면 시그널을 포함한다', () => {
            const analysis: AnalysisResponse = {
                ...MINIMAL_ANALYSIS,
                indicatorResults: [
                    {
                        indicatorName: 'RSI',
                        signals: [
                            {
                                type: 'skill',
                                trend: 'bearish',
                                description: 'Overbought at 75',
                            },
                        ],
                    },
                ],
            };
            const result = buildChatPrompt(
                'AAPL',
                '1Day',
                analysis,
                [],
                '질문'
            );
            expect(result.systemPrompt).toContain('RSI');
            expect(result.systemPrompt).toContain('Overbought at 75');
        });

        it('priceTargets가 있으면 가격 목표를 포함한다', () => {
            const analysis: AnalysisResponse = {
                ...MINIMAL_ANALYSIS,
                priceTargets: {
                    bullish: {
                        targets: [{ price: 200.0, basis: 'Breakout target' }],
                        condition: 'Above 195',
                    },
                    bearish: { targets: [], condition: '' },
                },
            };
            const result = buildChatPrompt(
                'AAPL',
                '1Day',
                analysis,
                [],
                '질문'
            );
            expect(result.systemPrompt).toContain('200.00');
            expect(result.systemPrompt).toContain('Breakout target');
        });

        it('priceTargets.bullish가 null이면 "None"을 포함한다', () => {
            const analysis: AnalysisResponse = {
                ...MINIMAL_ANALYSIS,
                priceTargets: {
                    bullish: null,
                    bearish: null,
                },
            };
            const result = buildChatPrompt('AAPL', '1Day', analysis, [], '?');
            expect(result.systemPrompt).toContain('Bullish scenario: None');
            expect(result.systemPrompt).toContain('Bearish scenario: None');
        });

        it('detected: true 패턴이 있으면 skillName과 trend를 포함한다', () => {
            const analysis: AnalysisResponse = {
                ...MINIMAL_ANALYSIS,
                patternSummaries: [
                    {
                        id: 'p1',
                        patternName: 'Head and Shoulders',
                        skillName: 'Head and Shoulders',
                        detected: true,
                        trend: 'bearish',
                        summary: '하락 반전 패턴',
                        confidenceWeight: 0.8,
                    },
                ],
            };
            const result = buildChatPrompt('AAPL', '1Day', analysis, [], '?');
            expect(result.systemPrompt).toContain(
                'Head and Shoulders (bearish)'
            );
        });

        it('strategyResults가 있으면 전략별 요약을 포함한다', () => {
            const analysis: AnalysisResponse = {
                ...MINIMAL_ANALYSIS,
                strategyResults: [
                    {
                        id: 's1',
                        strategyName: '다이버전스 전략',
                        trend: 'bullish',
                        summary:
                            '**감지된 다이버전스**: Regular Bullish\n\n**매매 신호**: 매수 관점 대기',
                        confidenceWeight: 0.78,
                    },
                ],
            };
            const result = buildChatPrompt('AAPL', '1Day', analysis, [], '?');
            expect(result.systemPrompt).toContain('Strategy Results:');
            expect(result.systemPrompt).toContain(
                '### 다이버전스 전략 (bullish)'
            );
            expect(result.systemPrompt).toContain('Regular Bullish');
        });

        it('답변을 읽기 좋은 마크다운 문단으로 구성하도록 지시한다', () => {
            const result = buildChatPrompt(
                'AAPL',
                '1Day',
                MINIMAL_ANALYSIS,
                [],
                '?'
            );
            expect(result.systemPrompt).toContain(
                'format it with readable markdown'
            );
            expect(result.systemPrompt).toContain(
                'use short paragraphs separated by blank lines'
            );
        });

        it('분석과 연결된 가격대 후속 질문을 허용하도록 지시한다', () => {
            const result = buildChatPrompt(
                'PLTR',
                '1Day',
                MINIMAL_ANALYSIS,
                [],
                '138까지 내려가면 어떻게해?'
            );
            expect(result.systemPrompt).toContain(
                'You MAY answer follow-up questions when they are clearly connected to this analysis'
            );
            expect(result.systemPrompt).toContain(
                'a price level, support/resistance, target, stop, trend, risk, signal, pattern, indicator, or scenario mentioned in the analysis'
            );
        });

        it('이전 답변에서 나온 개념 확장 질문을 허용하도록 지시한다', () => {
            const history = [
                {
                    role: 'model' as const,
                    content: '추세가 바뀌려면 더 강한 신호가 필요해 보여요.',
                },
            ];
            const result = buildChatPrompt(
                'PLTR',
                '1Day',
                MINIMAL_ANALYSIS,
                history,
                '강한 신호는 어떻게 포착해?'
            );
            expect(result.systemPrompt).toContain(
                'a concept that appeared in your previous answer in this conversation'
            );
            expect(result.systemPrompt).toContain(
                'Do not refuse a question only because the exact wording is absent from the report'
            );
        });

        it('분석 맥락 설명을 위한 일반 기술적 분석 지식 활용을 허용한다', () => {
            const result = buildChatPrompt(
                'PLTR',
                '1Day',
                MINIMAL_ANALYSIS,
                [],
                '추세 전환 신호는 보통 어떻게 확인해?'
            );
            expect(result.systemPrompt).toContain(
                'general technical-analysis knowledge needed to explain what the analysis means or how to monitor a related signal'
            );
            expect(result.systemPrompt).toContain(
                "clearly connect it back to PLTR's provided analysis"
            );
        });

        it('무관한 종목과 개인 포트폴리오 조언은 계속 거절하도록 지시한다', () => {
            const result = buildChatPrompt(
                'PLTR',
                '1Day',
                MINIMAL_ANALYSIS,
                [],
                'TSLA랑 내 포트폴리오는 어떻게 할까?'
            );
            expect(result.systemPrompt).toContain(
                'other stocks, unrelated macro topics, personal portfolio advice'
            );
            expect(result.systemPrompt).toContain(
                '이 분석 결과와 관련된 질문만 답변할 수 있어요.'
            );
        });
    });

    describe('messages를', () => {
        it('히스토리 없이 사용자 메시지 하나만 포함한다', () => {
            const result = buildChatPrompt(
                'AAPL',
                '1Day',
                MINIMAL_ANALYSIS,
                [],
                '지금 사도 돼?'
            );
            expect(result.messages).toHaveLength(1);
            expect(result.messages[0].role).toBe('user');
            expect(result.messages[0].content).toBe('지금 사도 돼?');
        });

        it('히스토리가 있으면 히스토리 뒤에 새 메시지를 추가한다', () => {
            const history = [
                { role: 'user' as const, content: '언제 팔아?' },
                {
                    role: 'model' as const,
                    content: 'RSI가 70 넘으면 고려하세요.',
                },
            ];
            const result = buildChatPrompt(
                'AAPL',
                '1Day',
                MINIMAL_ANALYSIS,
                history,
                '더 쉽게 설명해줘'
            );
            expect(result.messages).toHaveLength(3);
            expect(result.messages[0].content).toBe('언제 팔아?');
            expect(result.messages[1].content).toBe(
                'RSI가 70 넘으면 고려하세요.'
            );
            expect(result.messages[2].content).toBe('더 쉽게 설명해줘');
        });
    });
});

// ─── currentAnalysisContext 파라미터 테스트 ───────────────────────────────────

const FUNDAMENTAL_PAYLOAD: FundamentalAnalysisResponse = {
    overallConclusionKo: '재무 구조가 탄탄하고 성장성이 높습니다.',
    categoryAssessments: [],
    riskFactorsKo: [],
    overallSentiment: 'bullish',
};

const NEWS_PAYLOAD: NewsAnalysisResponse = {
    currentDriverKo: '실적 기대감이 주가를 견인하고 있습니다.',
    keyEventsKo: [],
    upcomingEventsKo: [],
    overallSentiment: 'bullish',
};

const OVERALL_PAYLOAD: OverallAnalysisResponse = {
    headlineKo: '3축 종합 분석: 강세 국면 진입 예상',
    technicalBulletsKo: [],
    fundamentalBulletsKo: [],
    newsBulletsKo: [],
    threeAxisConclusionKo: '기술·펀더·뉴스 모두 긍정적입니다.',
    scenarios: [],
    riskFactorsKo: [],
};

describe('buildChatPrompt — currentAnalysisContext', () => {
    it('currentAnalysisContext가 없으면 섹션을 포함하지 않는다', () => {
        const result = buildChatPrompt(
            'AAPL',
            '1Day',
            MINIMAL_ANALYSIS,
            [],
            '질문'
        );
        expect(result.systemPrompt).not.toContain(
            '## Current analysis context'
        );
    });

    it('currentAnalysisContext가 undefined이면 기존 동작과 동일하다 (회귀 테스트)', () => {
        const withContext = buildChatPrompt(
            'AAPL',
            '1Day',
            MINIMAL_ANALYSIS,
            [],
            '질문',
            undefined
        );
        const withoutContext = buildChatPrompt(
            'AAPL',
            '1Day',
            MINIMAL_ANALYSIS,
            [],
            '질문'
        );
        expect(withContext.systemPrompt).toBe(withoutContext.systemPrompt);
        expect(withContext.messages).toEqual(withoutContext.messages);
    });

    it('technical 컨텍스트가 제공되면 기술 분석 섹션을 포함한다', () => {
        const context: CurrentAnalysisContext = {
            kind: 'technical',
            payload: MINIMAL_ANALYSIS,
        };
        const result = buildChatPrompt(
            'AAPL',
            '1Day',
            MINIMAL_ANALYSIS,
            [],
            '질문',
            context
        );
        expect(result.systemPrompt).toContain('## Current analysis context');
        expect(result.systemPrompt).toContain('Kind: technical');
        expect(result.systemPrompt).toContain('Trend: bullish');
        expect(result.systemPrompt).toContain('Risk Level: medium');
        expect(result.systemPrompt).toContain('AAPL is trending upward.');
    });

    it('fundamental 컨텍스트가 제공되면 펀더멘털 분석 섹션을 포함한다', () => {
        const context: CurrentAnalysisContext = {
            kind: 'fundamental',
            payload: FUNDAMENTAL_PAYLOAD,
        };
        const result = buildChatPrompt(
            'AAPL',
            '1Day',
            MINIMAL_ANALYSIS,
            [],
            '질문',
            context
        );
        expect(result.systemPrompt).toContain('## Current analysis context');
        expect(result.systemPrompt).toContain('Kind: fundamental');
        expect(result.systemPrompt).toContain('Overall Sentiment: bullish');
        expect(result.systemPrompt).toContain(
            '재무 구조가 탄탄하고 성장성이 높습니다.'
        );
    });

    it('news 컨텍스트가 제공되면 뉴스 분석 섹션을 포함한다', () => {
        const context: CurrentAnalysisContext = {
            kind: 'news',
            payload: NEWS_PAYLOAD,
        };
        const result = buildChatPrompt(
            'AAPL',
            '1Day',
            MINIMAL_ANALYSIS,
            [],
            '질문',
            context
        );
        expect(result.systemPrompt).toContain('## Current analysis context');
        expect(result.systemPrompt).toContain('Kind: news');
        expect(result.systemPrompt).toContain('Overall Sentiment: bullish');
        expect(result.systemPrompt).toContain(
            '실적 기대감이 주가를 견인하고 있습니다.'
        );
    });

    it('overall 컨텍스트가 제공되면 종합 분석 섹션을 포함한다', () => {
        const context: CurrentAnalysisContext = {
            kind: 'overall',
            payload: OVERALL_PAYLOAD,
        };
        const result = buildChatPrompt(
            'AAPL',
            '1Day',
            MINIMAL_ANALYSIS,
            [],
            '질문',
            context
        );
        expect(result.systemPrompt).toContain('## Current analysis context');
        expect(result.systemPrompt).toContain('Kind: overall');
        expect(result.systemPrompt).toContain(
            '3축 종합 분석: 강세 국면 진입 예상'
        );
        expect(result.systemPrompt).toContain(
            '기술·펀더·뉴스 모두 긍정적입니다.'
        );
    });
});
