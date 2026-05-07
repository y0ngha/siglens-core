import { describe, it, expect } from 'vitest';
import {
    enrichAnalysisWithConfidence,
    filterPatterns,
    normalizeCachedAnalysisResponse,
} from '@/domain/analysis/confidence';
import type {
    PatternResult,
    RawAnalysisResponse,
    RawPatternSummary,
    RawStrategyResult,
    Skill,
    SkillChartDisplay,
} from '@/domain/types';
import {
    HIGH_CONFIDENCE_WEIGHT,
    MEDIUM_CONFIDENCE_WEIGHT,
    MIN_CONFIDENCE_WEIGHT,
    UNMATCHED_SKILL_CONFIDENCE_WEIGHT,
} from '@/domain/indicators/constants';

const makeSkillChartDisplay = (
    overrides?: Partial<SkillChartDisplay>
): SkillChartDisplay => ({
    show: false,
    type: 'marker',
    color: '#ef4444',
    label: '테스트 라벨',
    ...overrides,
});

const makeSkill = (overrides?: Partial<Skill>): Skill => ({
    name: '테스트 스킬',
    description: '테스트 설명',
    indicators: [],
    confidenceWeight: HIGH_CONFIDENCE_WEIGHT,
    content: '## 분석 기준\n- 테스트 내용',
    ...overrides,
});

const makePatternSummary = (
    overrides?: Partial<RawPatternSummary>
): RawPatternSummary => ({
    patternName: '테스트 패턴',
    skillName: '테스트 스킬',
    detected: true,
    trend: 'bullish',
    summary: '테스트 요약',
    ...overrides,
});

const makeStrategyResult = (
    overrides?: Partial<RawStrategyResult>
): RawStrategyResult => ({
    strategyName: '테스트 전략',
    trend: 'bullish',
    summary: '테스트 요약',
    ...overrides,
});

const makePatternResult = (
    overrides?: Partial<PatternResult>
): PatternResult => ({
    id: '테스트 패턴_0',
    patternName: '테스트 패턴',
    skillName: '테스트 스킬',
    detected: true,
    trend: 'bullish',
    summary: '테스트 요약',
    confidenceWeight: HIGH_CONFIDENCE_WEIGHT,
    ...overrides,
});

const makeAnalysisResponse = (
    overrides?: Partial<RawAnalysisResponse>
): RawAnalysisResponse => ({
    summary: '테스트 종합 분석',
    trend: 'bullish',
    indicatorResults: [],
    riskLevel: 'low',
    keyLevels: { support: [], resistance: [] },
    priceTargets: {
        bullish: { targets: [], condition: '' },
        bearish: { targets: [], condition: '' },
    },
    patternSummaries: [],
    strategyResults: [],
    candlePatterns: [],
    trendlines: [],
    ...overrides,
});

describe('confidence', () => {
    describe('filterPatterns', () => {
        it('confidenceWeight가 MIN_CONFIDENCE_WEIGHT 이상인 패턴만 반환한다', () => {
            const patterns = [
                makePatternResult({ confidenceWeight: MIN_CONFIDENCE_WEIGHT }),
                makePatternResult({
                    confidenceWeight: MIN_CONFIDENCE_WEIGHT - 0.1,
                }),
                makePatternResult({ confidenceWeight: HIGH_CONFIDENCE_WEIGHT }),
            ];
            const result = filterPatterns(patterns);
            expect(result).toHaveLength(2);
            expect(
                result.every(p => p.confidenceWeight >= MIN_CONFIDENCE_WEIGHT)
            ).toBe(true);
        });

        it('모든 패턴이 MIN_CONFIDENCE_WEIGHT 미만이면 빈 배열을 반환한다', () => {
            const patterns = [
                makePatternResult({
                    confidenceWeight: MIN_CONFIDENCE_WEIGHT - 0.1,
                }),
                makePatternResult({
                    confidenceWeight: UNMATCHED_SKILL_CONFIDENCE_WEIGHT,
                }),
            ];
            const result = filterPatterns(patterns);
            expect(result).toHaveLength(0);
        });

        it('빈 배열을 입력하면 빈 배열을 반환한다', () => {
            const result = filterPatterns([]);
            expect(result).toHaveLength(0);
        });

        it('모든 패턴이 MIN_CONFIDENCE_WEIGHT를 초과하면 전체가 반환된다', () => {
            const aboveMin = MIN_CONFIDENCE_WEIGHT + 0.1;
            const patterns = [
                makePatternResult({ confidenceWeight: aboveMin }),
                makePatternResult({ confidenceWeight: HIGH_CONFIDENCE_WEIGHT }),
            ];
            const result = filterPatterns(patterns);
            expect(result).toHaveLength(2);
        });
    });

    describe('enrichAnalysisWithConfidence', () => {
        describe('patternSummaries id 부여', () => {
            it('단일 패턴에 id가 부여된다', () => {
                const analysis = makeAnalysisResponse({
                    patternSummaries: [
                        makePatternSummary({
                            patternName: '헤드앤숄더',
                            skillName: '테스트 스킬',
                        }),
                    ],
                });
                const skills = [
                    makeSkill({
                        name: '테스트 스킬',
                        confidenceWeight: HIGH_CONFIDENCE_WEIGHT,
                    }),
                ];
                const result = enrichAnalysisWithConfidence(analysis, skills);
                expect(result.patternSummaries[0].id).toBe('헤드앤숄더_0');
            });

            it('동일한 patternName이 여러 개일 때 고유한 id를 부여한다', () => {
                const analysis = makeAnalysisResponse({
                    patternSummaries: [
                        makePatternSummary({
                            patternName: '헤드앤숄더',
                            skillName: '테스트 스킬',
                        }),
                        makePatternSummary({
                            patternName: '헤드앤숄더',
                            skillName: '테스트 스킬',
                        }),
                    ],
                });
                const skills = [
                    makeSkill({
                        name: '테스트 스킬',
                        confidenceWeight: HIGH_CONFIDENCE_WEIGHT,
                    }),
                ];
                const result = enrichAnalysisWithConfidence(analysis, skills);
                expect(result.patternSummaries[0].id).toBe('헤드앤숄더_0');
                expect(result.patternSummaries[1].id).toBe('헤드앤숄더_1');
            });
        });

        describe('patternSummaries confidenceWeight 채우기', () => {
            it('patternSummaries에 skillName과 일치하는 skill의 confidenceWeight를 채운다', () => {
                const analysis = makeAnalysisResponse({
                    patternSummaries: [
                        makePatternSummary({ skillName: '헤드앤숄더' }),
                    ],
                });
                const skills = [
                    makeSkill({
                        name: '헤드앤숄더',
                        confidenceWeight: HIGH_CONFIDENCE_WEIGHT,
                    }),
                ];
                const result = enrichAnalysisWithConfidence(analysis, skills);
                expect(result.patternSummaries[0].confidenceWeight).toBe(
                    HIGH_CONFIDENCE_WEIGHT
                );
            });

            it('매칭되지 않는 skillName은 confidenceWeight 0으로 처리되어 필터링된다', () => {
                const analysis = makeAnalysisResponse({
                    patternSummaries: [
                        makePatternSummary({ skillName: '존재하지않는스킬' }),
                    ],
                });
                const skills = [
                    makeSkill({
                        name: '다른스킬',
                        confidenceWeight: HIGH_CONFIDENCE_WEIGHT,
                    }),
                ];
                const result = enrichAnalysisWithConfidence(analysis, skills);
                expect(result.patternSummaries).toHaveLength(0);
            });
        });

        describe('patternSummaries renderConfig 채우기', () => {
            it('매칭되는 skill의 display.chart가 있을 때 renderConfig에 채운다', () => {
                const chartDisplay = makeSkillChartDisplay();
                const analysis = makeAnalysisResponse({
                    patternSummaries: [
                        makePatternSummary({ skillName: '헤드앤숄더' }),
                    ],
                });
                const skills = [
                    makeSkill({
                        name: '헤드앤숄더',
                        display: { chart: chartDisplay },
                    }),
                ];
                const result = enrichAnalysisWithConfidence(analysis, skills);
                expect(result.patternSummaries[0].renderConfig).toEqual(
                    chartDisplay
                );
            });

            it('skill에 display 필드가 없을 때 renderConfig는 undefined다', () => {
                const analysis = makeAnalysisResponse({
                    patternSummaries: [
                        makePatternSummary({ skillName: '헤드앤숄더' }),
                    ],
                });
                const skills = [
                    makeSkill({
                        name: '헤드앤숄더',
                        display: undefined,
                    }),
                ];
                const result = enrichAnalysisWithConfidence(analysis, skills);
                expect(result.patternSummaries[0].renderConfig).toBeUndefined();
            });

            it('매칭되는 skill이 없을 때 해당 패턴은 필터링된다', () => {
                const analysis = makeAnalysisResponse({
                    patternSummaries: [
                        makePatternSummary({ skillName: '없는스킬' }),
                    ],
                });
                const result = enrichAnalysisWithConfidence(analysis, []);
                expect(result.patternSummaries).toHaveLength(0);
            });
        });

        describe('strategyResults id 부여', () => {
            it('단일 strategyResult에 id가 부여된다', () => {
                const analysis = makeAnalysisResponse({
                    strategyResults: [
                        makeStrategyResult({ strategyName: 'RSI 다이버전스' }),
                    ],
                });
                const result = enrichAnalysisWithConfidence(analysis, []);
                expect(result.strategyResults[0].id).toBe('RSI 다이버전스_0');
            });

            it('동일한 strategyName이 여러 개일 때 고유한 id를 부여한다', () => {
                const analysis = makeAnalysisResponse({
                    strategyResults: [
                        makeStrategyResult({ strategyName: 'RSI 다이버전스' }),
                        makeStrategyResult({ strategyName: 'RSI 다이버전스' }),
                    ],
                });
                const result = enrichAnalysisWithConfidence(analysis, []);
                expect(result.strategyResults[0].id).toBe('RSI 다이버전스_0');
                expect(result.strategyResults[1].id).toBe('RSI 다이버전스_1');
            });
        });

        describe('strategyResults confidenceWeight 채우기', () => {
            it('strategyResults에 strategyName과 일치하는 skill의 confidenceWeight를 채운다', () => {
                const analysis = makeAnalysisResponse({
                    strategyResults: [
                        makeStrategyResult({ strategyName: 'RSI 다이버전스' }),
                    ],
                });
                const skills = [
                    makeSkill({
                        name: 'RSI 다이버전스',
                        confidenceWeight: MEDIUM_CONFIDENCE_WEIGHT,
                    }),
                ];
                const result = enrichAnalysisWithConfidence(analysis, skills);
                expect(result.strategyResults[0].confidenceWeight).toBe(
                    MEDIUM_CONFIDENCE_WEIGHT
                );
            });

            it('매칭되지 않는 strategyName은 confidenceWeight를 0으로 채운다', () => {
                const analysis = makeAnalysisResponse({
                    strategyResults: [
                        makeStrategyResult({ strategyName: '없는스킬' }),
                    ],
                });
                const skills = [
                    makeSkill({
                        name: '다른스킬',
                        confidenceWeight: HIGH_CONFIDENCE_WEIGHT,
                    }),
                ];
                const result = enrichAnalysisWithConfidence(analysis, skills);
                expect(result.strategyResults[0].confidenceWeight).toBe(
                    UNMATCHED_SKILL_CONFIDENCE_WEIGHT
                );
            });
        });

        describe('skills 빈 배열일 때', () => {
            it('skills가 빈 배열이면 patternSummaries는 모두 필터링된다', () => {
                const analysis = makeAnalysisResponse({
                    patternSummaries: [
                        makePatternSummary({ skillName: '헤드앤숄더' }),
                    ],
                    strategyResults: [
                        makeStrategyResult({ strategyName: 'RSI 다이버전스' }),
                    ],
                });
                const result = enrichAnalysisWithConfidence(analysis, []);
                expect(result.patternSummaries).toHaveLength(0);
            });

            it('skills가 빈 배열이면 strategyResults의 confidenceWeight는 0이다', () => {
                const analysis = makeAnalysisResponse({
                    strategyResults: [
                        makeStrategyResult({ strategyName: 'RSI 다이버전스' }),
                    ],
                });
                const result = enrichAnalysisWithConfidence(analysis, []);
                expect(result.strategyResults[0].confidenceWeight).toBe(
                    UNMATCHED_SKILL_CONFIDENCE_WEIGHT
                );
            });
        });

        describe('candlePatterns id 부여', () => {
            it('candlePatterns에 id가 부여된다', () => {
                const analysis = makeAnalysisResponse({
                    candlePatterns: [
                        {
                            patternName: 'morning_star',
                            detected: true,
                            trend: 'bullish',
                            summary: '샛별형 패턴 감지',
                        },
                    ],
                });
                const result = enrichAnalysisWithConfidence(analysis, []);
                expect(result.candlePatterns[0].id).toBe('morning_star_0');
            });

            it('동일한 patternName이 여러 개일 때 고유한 id를 부여한다', () => {
                const analysis = makeAnalysisResponse({
                    candlePatterns: [
                        {
                            patternName: 'three_inside_up',
                            detected: true,
                            trend: 'bullish',
                            summary: '첫 번째 패턴',
                        },
                        {
                            patternName: 'three_inside_up',
                            detected: true,
                            trend: 'bullish',
                            summary: '두 번째 패턴',
                        },
                    ],
                });
                const result = enrichAnalysisWithConfidence(analysis, []);
                expect(result.candlePatterns[0].id).toBe('three_inside_up_0');
                expect(result.candlePatterns[1].id).toBe('three_inside_up_1');
            });

            it('candlePatterns가 빈 배열일 때 빈 배열을 유지한다', () => {
                const analysis = makeAnalysisResponse({ candlePatterns: [] });
                const result = enrichAnalysisWithConfidence(analysis, []);
                expect(result.candlePatterns).toEqual([]);
            });
        });

        describe('영어 pattern 필드 기반 fallback 매칭', () => {
            it('AI가 영어 pattern 값으로 skillName을 반환해도 올바른 skill이 매칭된다', () => {
                const analysis = makeAnalysisResponse({
                    patternSummaries: [
                        makePatternSummary({ skillName: 'head_and_shoulders' }),
                    ],
                });
                const skills = [
                    makeSkill({
                        name: '헤드앤숄더',
                        pattern: 'head_and_shoulders',
                        confidenceWeight: HIGH_CONFIDENCE_WEIGHT,
                    }),
                ];
                const result = enrichAnalysisWithConfidence(analysis, skills);
                expect(result.patternSummaries[0].confidenceWeight).toBe(
                    HIGH_CONFIDENCE_WEIGHT
                );
            });

            it('영어 pattern 기반 fallback 매칭으로 renderConfig가 올바르게 주입된다', () => {
                const chartDisplay = makeSkillChartDisplay({ show: true });
                const analysis = makeAnalysisResponse({
                    patternSummaries: [
                        makePatternSummary({ skillName: 'head_and_shoulders' }),
                    ],
                });
                const skills = [
                    makeSkill({
                        name: '헤드앤숄더',
                        pattern: 'head_and_shoulders',
                        display: { chart: chartDisplay },
                    }),
                ];
                const result = enrichAnalysisWithConfidence(analysis, skills);
                expect(result.patternSummaries[0].renderConfig).toEqual(
                    chartDisplay
                );
            });
        });

        describe('filterPatterns 적용', () => {
            it('confidenceWeight가 MIN_CONFIDENCE_WEIGHT 미만인 패턴은 결과에서 제외된다', () => {
                const analysis = makeAnalysisResponse({
                    patternSummaries: [
                        makePatternSummary({ skillName: '없는스킬' }),
                        makePatternSummary({ skillName: '헤드앤숄더' }),
                    ],
                });
                const skills = [
                    makeSkill({
                        name: '헤드앤숄더',
                        confidenceWeight: HIGH_CONFIDENCE_WEIGHT,
                    }),
                ];
                const result = enrichAnalysisWithConfidence(analysis, skills);
                expect(
                    result.patternSummaries.every(
                        p => p.confidenceWeight >= MIN_CONFIDENCE_WEIGHT
                    )
                ).toBe(true);
                expect(result.patternSummaries).toHaveLength(1);
                expect(result.patternSummaries[0].skillName).toBe('헤드앤숄더');
            });
        });

        describe('actionRecommendation pass-through', () => {
            it('actionRecommendation이 있으면 enriched 결과에 포함된다', () => {
                const analysis = makeAnalysisResponse({
                    actionRecommendation: {
                        positionAnalysis: '테스트 위치 분석',
                        entry: '테스트 진입',
                        exit: '테스트 청산',
                        riskReward: '테스트 손익비',
                    },
                });
                const result = enrichAnalysisWithConfidence(analysis, []);
                expect(result.actionRecommendation).toBeDefined();
                expect(result.actionRecommendation?.positionAnalysis).toBe(
                    '테스트 위치 분석'
                );
            });

            it('actionRecommendation이 없으면 enriched 결과에도 없다', () => {
                const analysis = makeAnalysisResponse();
                const result = enrichAnalysisWithConfidence(analysis, []);
                expect(result.actionRecommendation).toBeUndefined();
            });
        });

        describe('summary 필드 fallback', () => {
            it('summary가 없으면 안내 메시지를 반환한다', () => {
                const analysis = makeAnalysisResponse({ summary: undefined });
                const result = enrichAnalysisWithConfidence(analysis, []);
                expect(result.summary).toBe(
                    'AI로부터 분석 결과를 받지 못했습니다. 재분석을 시도해 주세요.'
                );
            });

            it('summary가 있으면 그대로 반환한다', () => {
                const analysis = makeAnalysisResponse({
                    summary: '정상 분석 결과',
                });
                const result = enrichAnalysisWithConfidence(analysis, []);
                expect(result.summary).toBe('정상 분석 결과');
            });
        });

        describe('불변성', () => {
            it('원본 analysis 객체를 변경하지 않는다', () => {
                const patternSummary = makePatternSummary({
                    skillName: '헤드앤숄더',
                });
                const analysis = makeAnalysisResponse({
                    patternSummaries: [patternSummary],
                });
                const skills = [
                    makeSkill({
                        name: '헤드앤숄더',
                        confidenceWeight: HIGH_CONFIDENCE_WEIGHT,
                    }),
                ];
                enrichAnalysisWithConfidence(analysis, skills);
                expect(
                    (patternSummary as { confidenceWeight?: number })
                        .confidenceWeight
                ).toBeUndefined();
            });

            it('patternSummaries와 strategyResults 외의 필드는 변경하지 않는다', () => {
                const actionRecommendation = {
                    positionAnalysis: '원본 위치 분석',
                    entry: '원본 진입',
                    exit: '원본 청산',
                    riskReward: '원본 손익비',
                };
                const analysis = makeAnalysisResponse({
                    summary: '원본 요약',
                    trend: 'bearish',
                    riskLevel: 'high',
                    actionRecommendation,
                });
                const result = enrichAnalysisWithConfidence(analysis, []);
                expect(result.summary).toBe('원본 요약');
                expect(result.trend).toBe('bearish');
                expect(result.riskLevel).toBe('high');
                expect(result.actionRecommendation).toEqual(
                    actionRecommendation
                );
            });
        });

        describe('indicatorResults 정규화', () => {
            it('유효한 indicatorResults 항목이 enriched 결과에 포함된다', () => {
                const analysis = makeAnalysisResponse({
                    indicatorResults: [
                        {
                            indicatorName: 'RSI',
                            signals: [
                                {
                                    type: 'skill',
                                    description: '과매수',
                                    trend: 'bearish',
                                    strength: 'strong',
                                },
                            ],
                        },
                    ],
                });
                const result = enrichAnalysisWithConfidence(analysis, []);
                expect(result.indicatorResults).toHaveLength(1);
                expect(result.indicatorResults[0].indicatorName).toBe('RSI');
                expect(result.indicatorResults[0].signals[0].description).toBe(
                    '과매수'
                );
            });

            it('indicatorName이 없는 항목은 탈락시킨다', () => {
                const analysis = makeAnalysisResponse({
                    indicatorResults: [
                        { signals: [] },
                        { indicatorName: 'MACD', signals: [] },
                    ],
                });
                const result = enrichAnalysisWithConfidence(analysis, []);
                expect(result.indicatorResults).toHaveLength(1);
                expect(result.indicatorResults[0].indicatorName).toBe('MACD');
            });
        });

        describe('trendlines 정규화', () => {
            it('유효한 trendline이 enriched 결과에 포함된다', () => {
                const analysis = makeAnalysisResponse({
                    trendlines: [
                        {
                            direction: 'ascending',
                            start: { time: 1, price: 100 },
                            end: { time: 2, price: 200 },
                        },
                    ],
                });
                const result = enrichAnalysisWithConfidence(analysis, []);
                expect(result.trendlines).toHaveLength(1);
                expect(result.trendlines[0].direction).toBe('ascending');
            });

            it('direction이 유효하지 않은 항목은 탈락시킨다', () => {
                const analysis = makeAnalysisResponse({
                    trendlines: [
                        {
                            direction: 'sideways',
                            start: { time: 1, price: 100 },
                            end: { time: 2, price: 200 },
                        },
                        {
                            direction: 'descending',
                            start: { time: 3, price: 300 },
                            end: { time: 4, price: 250 },
                        },
                    ],
                });
                const result = enrichAnalysisWithConfidence(analysis, []);
                expect(result.trendlines).toHaveLength(1);
                expect(result.trendlines[0].direction).toBe('descending');
            });
        });
    }); // enrichAnalysisWithConfidence

    describe('normalizeCachedAnalysisResponse', () => {
        it('캐시된 id, confidenceWeight, renderConfig를 보존하면서 누락 필드를 정규화한다', () => {
            const renderConfig = makeSkillChartDisplay({ color: '#22c55e' });
            const result = normalizeCachedAnalysisResponse({
                patternSummaries: [
                    {
                        id: 'cached-pattern-id',
                        patternName: '캐시 패턴',
                        skillName: '테스트 스킬',
                        detected: true,
                        trend: 'bullish',
                        summary: '캐시 요약',
                        confidenceWeight: 0.91,
                        renderConfig,
                    },
                ],
                strategyResults: [
                    {
                        id: 'cached-strategy-id',
                        strategyName: '캐시 전략',
                        trend: 'invalid',
                        summary: '전략 요약',
                        confidenceWeight: 0.81,
                    },
                ],
                candlePatterns: [
                    {
                        id: 'cached-candle-id',
                        patternName: 'hammer',
                        detected: true,
                        trend: 'bullish',
                        summary: '캔들 요약',
                    },
                ],
                analyzedAt: '2026-05-06T00:00:00.000Z',
            });

            expect(result.summary).toBe(
                'AI로부터 분석 결과를 받지 못했습니다. 재분석을 시도해 주세요.'
            );
            expect(result.patternSummaries[0]).toMatchObject({
                id: 'cached-pattern-id',
                confidenceWeight: 0.91,
                renderConfig,
            });
            expect(result.strategyResults[0]).toMatchObject({
                id: 'cached-strategy-id',
                trend: 'neutral',
                confidenceWeight: 0.81,
            });
            expect(result.candlePatterns[0].id).toBe('cached-candle-id');
            expect(result.analyzedAt).toBe('2026-05-06T00:00:00.000Z');
        });

        it('문자열로 저장된 캐시 JSON도 파싱한 뒤 정규화한다', () => {
            const result = normalizeCachedAnalysisResponse(
                JSON.stringify({
                    summary: '문자열 캐시',
                    trend: 'bullish',
                    patternSummaries: [
                        {
                            id: 'string-pattern-id',
                            patternName: '문자열 패턴',
                            skillName: '테스트 스킬',
                            detected: true,
                            trend: 'bullish',
                            summary: '패턴 요약',
                            confidenceWeight: 0.77,
                        },
                    ],
                    analyzedAt: '2026-05-06T00:00:00.000Z',
                })
            );

            expect(result.summary).toBe('문자열 캐시');
            expect(result.trend).toBe('bullish');
            expect(result.patternSummaries[0]).toMatchObject({
                id: 'string-pattern-id',
                confidenceWeight: 0.77,
            });
            expect(result.analyzedAt).toBe('2026-05-06T00:00:00.000Z');
        });

        it('renderConfig.type이 유효하지 않으면 renderConfig를 undefined로 떨어뜨린다', () => {
            const result = normalizeCachedAnalysisResponse({
                patternSummaries: [
                    {
                        id: 'no-type-pattern',
                        patternName: '타입없는패턴',
                        skillName: '테스트 스킬',
                        detected: true,
                        trend: 'bullish',
                        summary: '요약',
                        confidenceWeight: 0.5,
                        renderConfig: { show: true, color: '#abc' },
                    },
                ],
            });

            expect(result.patternSummaries[0].renderConfig).toBeUndefined();
        });

        it('renderConfig가 객체가 아니면 undefined로 떨어뜨린다', () => {
            const result = normalizeCachedAnalysisResponse({
                patternSummaries: [
                    {
                        id: 'string-render',
                        patternName: '문자열렌더',
                        skillName: '테스트 스킬',
                        detected: true,
                        trend: 'bullish',
                        summary: '요약',
                        confidenceWeight: 0.5,
                        renderConfig: 'not-an-object',
                    },
                ],
            });

            expect(result.patternSummaries[0].renderConfig).toBeUndefined();
        });

        it('renderConfig에 type만 있으면 show/color/label에 기본값을 채운다', () => {
            const result = normalizeCachedAnalysisResponse({
                patternSummaries: [
                    {
                        id: 'type-only-pattern',
                        patternName: '타입만',
                        skillName: '테스트 스킬',
                        detected: true,
                        trend: 'bullish',
                        summary: '요약',
                        confidenceWeight: 0.5,
                        renderConfig: { type: 'line' },
                    },
                ],
            });

            expect(result.patternSummaries[0].renderConfig).toEqual({
                type: 'line',
                show: false,
                color: '',
                label: '',
            });
        });

        it('renderConfig 필드 타입이 잘못되면 해당 필드만 기본값으로 떨어뜨린다', () => {
            const result = normalizeCachedAnalysisResponse({
                patternSummaries: [
                    {
                        id: 'wrong-types-pattern',
                        patternName: '잘못된타입',
                        skillName: '테스트 스킬',
                        detected: true,
                        trend: 'bullish',
                        summary: '요약',
                        confidenceWeight: 0.5,
                        renderConfig: {
                            type: 'marker',
                            show: 'truthy',
                            color: 123,
                            label: null,
                        },
                    },
                ],
            });

            expect(result.patternSummaries[0].renderConfig).toEqual({
                type: 'marker',
                show: false,
                color: '',
                label: '',
            });
        });

        it('캐시 항목의 child 필드가 누락되면 보수적인 기본값으로 채운다', () => {
            const result = normalizeCachedAnalysisResponse({
                actionRecommendation: {
                    positionAnalysis: '현재가 분석',
                    entry: '진입',
                    exit: '청산',
                    riskReward: '1:2',
                    entryRecommendation: 'invalid',
                    entryPrices: [100, 'bad', 101],
                    reconciledLevels: {
                        stopLoss: 95,
                        takeProfitPrices: [110, null, 120],
                        exit: '보정 청산',
                    },
                },
            });

            expect(result.trend).toBe('neutral');
            expect(result.riskLevel).toBe('medium');
            expect(result.actionRecommendation).toMatchObject({
                positionAnalysis: '현재가 분석',
                entryRecommendation: undefined,
                entryPrices: [100, 101],
                reconciledLevels: {
                    stopLoss: 95,
                    takeProfitPrices: [110, 120],
                    exit: '보정 청산',
                    riskReward: '',
                    reason: '',
                },
            });
        });
    });
});
