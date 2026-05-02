import { describe, it, expect } from 'vitest';
import { normalizeOverallAnalysisResponse } from '@/domain/analysis/normalizeOverall';

const validPayload = {
    headlineKo: '기술적 강세와 양호한 펀더멘탈이 복합 상승을 지지합니다.',
    technicalBulletsKo: ['RSI 상승 다이버전스', '50일 이평선 돌파'],
    fundamentalBulletsKo: ['EPS 성장 지속', '부채비율 안정'],
    newsBulletsKo: ['어닝 서프라이즈 연속', 'CEO 신뢰도 상승'],
    threeAxisConclusionKo: '세 가지 축 모두 긍정적 신호를 보내고 있습니다.',
    scenarios: [
        {
            name: 'bullish',
            triggerConditionKo: '저항선 돌파 시',
            priceRangeKo: '200~220달러',
        },
        {
            name: 'bearish',
            triggerConditionKo: '지지선 이탈 시',
            priceRangeKo: '160~170달러',
        },
    ],
    riskFactorsKo: ['금리 인상 위험', '규제 리스크'],
};

describe('normalizeOverallAnalysisResponse 함수는', () => {
    describe('완전하고 유효한 JSON이 주어졌을 때', () => {
        it('모든 필드를 올바르게 파싱하여 반환한다', () => {
            const result = normalizeOverallAnalysisResponse(
                JSON.stringify(validPayload)
            );

            expect(result.headlineKo).toBe(
                '기술적 강세와 양호한 펀더멘탈이 복합 상승을 지지합니다.'
            );
            expect(result.technicalBulletsKo).toEqual(['RSI 상승 다이버전스', '50일 이평선 돌파']);
            expect(result.fundamentalBulletsKo).toEqual(['EPS 성장 지속', '부채비율 안정']);
            expect(result.newsBulletsKo).toEqual(['어닝 서프라이즈 연속', 'CEO 신뢰도 상승']);
            expect(result.threeAxisConclusionKo).toBe(
                '세 가지 축 모두 긍정적 신호를 보내고 있습니다.'
            );
            expect(result.scenarios).toHaveLength(2);
            expect(result.scenarios[0]).toEqual({
                name: 'bullish',
                triggerConditionKo: '저항선 돌파 시',
                priceRangeKo: '200~220달러',
            });
            expect(result.riskFactorsKo).toEqual(['금리 인상 위험', '규제 리스크']);
        });
    });

    describe('마크다운 펜스로 감싸진 JSON이 주어졌을 때', () => {
        it('```json ... ``` 펜스를 제거하고 올바르게 파싱한다', () => {
            const fenced = `\`\`\`json\n${JSON.stringify(validPayload)}\n\`\`\``;
            const result = normalizeOverallAnalysisResponse(fenced);
            expect(result.headlineKo).toBe(
                '기술적 강세와 양호한 펀더멘탈이 복합 상승을 지지합니다.'
            );
        });

        it('``` ... ``` 펜스(타입 없음)를 제거하고 올바르게 파싱한다', () => {
            const fenced = `\`\`\`\n${JSON.stringify(validPayload)}\n\`\`\``;
            const result = normalizeOverallAnalysisResponse(fenced);
            expect(result.headlineKo).toBeTruthy();
        });
    });

    describe('필수 필드가 누락된 JSON이 주어졌을 때', () => {
        it('headlineKo가 없으면 에러를 던진다', () => {
            const { headlineKo: _, ...rest } = validPayload;
            expect(() =>
                normalizeOverallAnalysisResponse(JSON.stringify(rest))
            ).toThrow();
        });

        it('technicalBulletsKo가 없으면 에러를 던진다', () => {
            const { technicalBulletsKo: _, ...rest } = validPayload;
            expect(() =>
                normalizeOverallAnalysisResponse(JSON.stringify(rest))
            ).toThrow();
        });

        it('fundamentalBulletsKo가 없으면 에러를 던진다', () => {
            const { fundamentalBulletsKo: _, ...rest } = validPayload;
            expect(() =>
                normalizeOverallAnalysisResponse(JSON.stringify(rest))
            ).toThrow();
        });

        it('newsBulletsKo가 없으면 에러를 던진다', () => {
            const { newsBulletsKo: _, ...rest } = validPayload;
            expect(() =>
                normalizeOverallAnalysisResponse(JSON.stringify(rest))
            ).toThrow();
        });

        it('threeAxisConclusionKo가 없으면 에러를 던진다', () => {
            const { threeAxisConclusionKo: _, ...rest } = validPayload;
            expect(() =>
                normalizeOverallAnalysisResponse(JSON.stringify(rest))
            ).toThrow();
        });

        it('scenarios가 없으면 에러를 던진다', () => {
            const { scenarios: _, ...rest } = validPayload;
            expect(() =>
                normalizeOverallAnalysisResponse(JSON.stringify(rest))
            ).toThrow();
        });

        it('riskFactorsKo가 없으면 에러를 던진다', () => {
            const { riskFactorsKo: _, ...rest } = validPayload;
            expect(() =>
                normalizeOverallAnalysisResponse(JSON.stringify(rest))
            ).toThrow();
        });
    });

    describe('잘못된 enum 값이 주어졌을 때', () => {
        it('scenario name이 유효하지 않으면 에러를 던진다', () => {
            const invalid = {
                ...validPayload,
                scenarios: [
                    {
                        name: 'very_bullish',
                        triggerConditionKo: '조건',
                        priceRangeKo: '범위',
                    },
                ],
            };
            expect(() =>
                normalizeOverallAnalysisResponse(JSON.stringify(invalid))
            ).toThrow();
        });
    });

    describe('유효하지 않은 JSON 문자열이 주어졌을 때', () => {
        it('파싱 불가능한 문자열이면 에러를 던진다', () => {
            expect(() =>
                normalizeOverallAnalysisResponse('not valid json')
            ).toThrow();
        });
    });
});
