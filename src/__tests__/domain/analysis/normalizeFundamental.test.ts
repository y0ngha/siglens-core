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
            expect(result.riskFactorsKo).toEqual(['금리 상승 위험', '환율 변동 위험']);
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

    describe('필수 필드가 누락된 JSON이 주어졌을 때', () => {
        it('overallConclusionKo가 없으면 에러를 던진다', () => {
            const { overallConclusionKo: _, ...rest } = validPayload;
            expect(() =>
                normalizeFundamentalAnalysisResponse(JSON.stringify(rest))
            ).toThrow();
        });

        it('categoryAssessments가 없으면 에러를 던진다', () => {
            const { categoryAssessments: _, ...rest } = validPayload;
            expect(() =>
                normalizeFundamentalAnalysisResponse(JSON.stringify(rest))
            ).toThrow();
        });

        it('riskFactorsKo가 없으면 에러를 던진다', () => {
            const { riskFactorsKo: _, ...rest } = validPayload;
            expect(() =>
                normalizeFundamentalAnalysisResponse(JSON.stringify(rest))
            ).toThrow();
        });

        it('overallSentiment가 없으면 에러를 던진다', () => {
            const { overallSentiment: _, ...rest } = validPayload;
            expect(() =>
                normalizeFundamentalAnalysisResponse(JSON.stringify(rest))
            ).toThrow();
        });
    });

    describe('잘못된 enum 값이 주어졌을 때', () => {
        it('overallSentiment가 유효하지 않으면 에러를 던진다', () => {
            const invalid = { ...validPayload, overallSentiment: 'very_bullish' };
            expect(() =>
                normalizeFundamentalAnalysisResponse(JSON.stringify(invalid))
            ).toThrow();
        });

        it('categoryAssessment의 sentiment가 유효하지 않으면 에러를 던진다', () => {
            const invalid = {
                ...validPayload,
                categoryAssessments: [
                    { ...validPayload.categoryAssessments[0], sentiment: 'unknown' },
                ],
            };
            expect(() =>
                normalizeFundamentalAnalysisResponse(JSON.stringify(invalid))
            ).toThrow();
        });

        it('categoryAssessment의 category가 유효하지 않으면 에러를 던진다', () => {
            const invalid = {
                ...validPayload,
                categoryAssessments: [
                    { ...validPayload.categoryAssessments[0], category: 'invalid_cat' },
                ],
            };
            expect(() =>
                normalizeFundamentalAnalysisResponse(JSON.stringify(invalid))
            ).toThrow();
        });
    });

    describe('유효하지 않은 JSON 문자열이 주어졌을 때', () => {
        it('파싱 불가능한 문자열이면 에러를 던진다', () => {
            expect(() =>
                normalizeFundamentalAnalysisResponse('not valid json')
            ).toThrow();
        });
    });
});
