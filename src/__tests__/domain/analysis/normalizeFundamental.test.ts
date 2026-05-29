import { describe, it, expect } from 'vitest';
import { normalizeFundamentalAnalysisResponse } from '@/domain/analysis/normalizeFundamental';

const validPayload = {
    overallConclusionKo: '전반적으로 긍정적입니다.',
    categoryAssessments: [
        {
            category: 'valuation',
            sentiment: 'bullish',
            rationaleKo: '밸류에이션이 합리적입니다.',
        },
        {
            category: 'profitability',
            sentiment: 'neutral',
            rationaleKo: '수익성은 보통 수준입니다.',
        },
    ],
    riskFactorsKo: ['금리 상승 위험', '환율 변동 위험'],
    overallSentiment: 'bullish',
};

describe('normalizeFundamentalAnalysisResponse 함수는', () => {
    describe('완전하고 유효한 JSON이 주어졌을 때', () => {
        it('모든 필드를 올바르게 파싱하여 반환한다', () => {
            const result = normalizeFundamentalAnalysisResponse(
                JSON.stringify(validPayload)
            );

            expect(result.overallConclusionKo).toBe('전반적으로 긍정적입니다.');
            expect(result.overallSentiment).toBe('bullish');
            expect(result.riskFactorsKo).toEqual([
                '금리 상승 위험',
                '환율 변동 위험',
            ]);
            expect(result.categoryAssessments).toHaveLength(2);
            expect(result.categoryAssessments[0]).toEqual({
                category: 'valuation',
                sentiment: 'bullish',
                rationaleKo: '밸류에이션이 합리적입니다.',
            });
        });
    });

    describe('마크다운 펜스로 감싸진 JSON이 주어졌을 때', () => {
        it('```json ... ``` 펜스를 제거하고 올바르게 파싱한다', () => {
            const fenced = `\`\`\`json\n${JSON.stringify(validPayload)}\n\`\`\``;
            const result = normalizeFundamentalAnalysisResponse(fenced);
            expect(result.overallSentiment).toBe('bullish');
            expect(result.overallConclusionKo).toBe('전반적으로 긍정적입니다.');
        });

        it('``` ... ``` 펜스(타입 없음)를 제거하고 올바르게 파싱한다', () => {
            const fenced = `\`\`\`\n${JSON.stringify(validPayload)}\n\`\`\``;
            const result = normalizeFundamentalAnalysisResponse(fenced);
            expect(result.overallSentiment).toBe('bullish');
        });
    });

    describe('필드가 누락된 JSON이 주어졌을 때', () => {
        it('누락 필드를 기본값으로 채운다', () => {
            const result = normalizeFundamentalAnalysisResponse('{}');

            expect(result).toEqual({
                overallConclusionKo: '',
                categoryAssessments: [],
                riskFactorsKo: [],
                overallSentiment: 'neutral',
            });
        });

        it('문자열 배열의 잘못된 자식 값은 제거한다', () => {
            const result = normalizeFundamentalAnalysisResponse(
                JSON.stringify({ riskFactorsKo: ['금리 위험', null, 1, ''] })
            );

            expect(result.riskFactorsKo).toEqual(['금리 위험']);
        });
    });

    describe('잘못된 enum 값이 주어졌을 때', () => {
        it('overallSentiment가 유효하지 않으면 neutral로 정규화한다', () => {
            const invalid = {
                ...validPayload,
                overallSentiment: 'very_bullish',
            };
            expect(
                normalizeFundamentalAnalysisResponse(JSON.stringify(invalid))
            ).toMatchObject({ overallSentiment: 'neutral' });
        });

        it('categoryAssessment의 sentiment가 유효하지 않으면 neutral로 정규화한다', () => {
            const invalid = {
                ...validPayload,
                categoryAssessments: [
                    {
                        ...validPayload.categoryAssessments[0],
                        sentiment: 'unknown',
                    },
                ],
            };
            expect(
                normalizeFundamentalAnalysisResponse(JSON.stringify(invalid))
            ).toMatchObject({
                categoryAssessments: [
                    {
                        category: 'valuation',
                        sentiment: 'neutral',
                        rationaleKo: '밸류에이션이 합리적입니다.',
                    },
                ],
            });
        });

        it('categoryAssessment의 category가 유효하지 않으면 valuation으로 정규화한다', () => {
            const invalid = {
                ...validPayload,
                categoryAssessments: [
                    {
                        ...validPayload.categoryAssessments[0],
                        category: 'invalid_cat',
                    },
                ],
            };
            expect(
                normalizeFundamentalAnalysisResponse(JSON.stringify(invalid))
            ).toMatchObject({
                categoryAssessments: [
                    {
                        category: 'valuation',
                        sentiment: 'bullish',
                        rationaleKo: '밸류에이션이 합리적입니다.',
                    },
                ],
            });
        });

        it('객체가 아닌 categoryAssessment 자식은 제거한다', () => {
            const result = normalizeFundamentalAnalysisResponse(
                JSON.stringify({
                    categoryAssessments: [
                        null,
                        'bad',
                        {
                            category: 'growth',
                            sentiment: 'bullish',
                            rationaleKo: '성장성이 높습니다.',
                        },
                    ],
                })
            );

            expect(result.categoryAssessments).toEqual([
                {
                    category: 'growth',
                    sentiment: 'bullish',
                    rationaleKo: '성장성이 높습니다.',
                },
            ]);
        });
    });

    describe('유효하지 않은 JSON 문자열이 주어졌을 때', () => {
        it('파싱 불가능한 문자열이면 에러를 던진다', () => {
            expect(() =>
                normalizeFundamentalAnalysisResponse('not valid json')
            ).toThrow();
        });
    });

    describe('문자열이 아닌 입력(이미 파싱된 객체/비정상 타입)이 주어졌을 때', () => {
        it('이미 파싱된 객체는 JSON.parse를 건너뛰고 그대로 정규화한다', () => {
            const result = normalizeFundamentalAnalysisResponse(validPayload);
            expect(result.overallSentiment).toBe('bullish');
            expect(result.categoryAssessments).toHaveLength(2);
        });

        it('null/undefined/배열/숫자는 모든 필드를 기본값으로 반환한다', () => {
            const expected = {
                overallConclusionKo: '',
                categoryAssessments: [],
                riskFactorsKo: [],
                overallSentiment: 'neutral',
            };
            expect(normalizeFundamentalAnalysisResponse(null)).toEqual(
                expected
            );
            expect(normalizeFundamentalAnalysisResponse(undefined)).toEqual(
                expected
            );
            expect(normalizeFundamentalAnalysisResponse([1, 2, 3])).toEqual(
                expected
            );
            expect(normalizeFundamentalAnalysisResponse(42)).toEqual(expected);
        });
    });

    describe('공백 문자열 처리', () => {
        it('공백만 있는 risk factor는 길이가 0이 아니므로 트리밍 없이 보존된다', () => {
            // normalizeStringArray filters by `length > 0` without trimming, so a
            // whitespace-only string survives while a truly empty string drops.
            const result = normalizeFundamentalAnalysisResponse(
                JSON.stringify({ riskFactorsKo: ['   ', 'real', ''] })
            );
            expect(result.riskFactorsKo).toEqual(['   ', 'real']);
        });
    });
});
