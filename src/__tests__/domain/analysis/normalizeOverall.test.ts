import { describe, it, expect } from 'vitest';
import { normalizeOverallAnalysisResponse } from '@/domain/analysis/normalizeOverall';

const validPayload = {
    headlineKo: '기술적 강세와 양호한 펀더멘탈이 복합 상승을 지지합니다.',
    technicalBulletsKo: ['RSI 상승 다이버전스', '50일 이평선 돌파'],
    fundamentalBulletsKo: ['EPS 성장 지속', '부채비율 안정'],
    newsBulletsKo: ['어닝 서프라이즈 연속', 'CEO 신뢰도 상승'],
    optionsBulletsKo: ['콜 옵션 매집 우위', '단기 풋콜 비율 균형'],
    integratedConclusionKo: '네 가지 축 모두 긍정적 신호를 보내고 있습니다.',
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
            expect(result.technicalBulletsKo).toEqual([
                'RSI 상승 다이버전스',
                '50일 이평선 돌파',
            ]);
            expect(result.fundamentalBulletsKo).toEqual([
                'EPS 성장 지속',
                '부채비율 안정',
            ]);
            expect(result.newsBulletsKo).toEqual([
                '어닝 서프라이즈 연속',
                'CEO 신뢰도 상승',
            ]);
            expect(result.optionsBulletsKo).toEqual([
                '콜 옵션 매집 우위',
                '단기 풋콜 비율 균형',
            ]);
            expect(result.integratedConclusionKo).toBe(
                '네 가지 축 모두 긍정적 신호를 보내고 있습니다.'
            );
            expect(result.scenarios).toHaveLength(2);
            expect(result.scenarios[0]).toEqual({
                name: 'bullish',
                triggerConditionKo: '저항선 돌파 시',
                priceRangeKo: '200~220달러',
            });
            expect(result.riskFactorsKo).toEqual([
                '금리 인상 위험',
                '규제 리스크',
            ]);
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

    describe('필드가 누락된 JSON이 주어졌을 때', () => {
        it('누락 필드를 기본값으로 채운다', () => {
            const result = normalizeOverallAnalysisResponse('{}');

            expect(result).toEqual({
                headlineKo: '',
                technicalBulletsKo: [],
                fundamentalBulletsKo: [],
                newsBulletsKo: [],
                optionsBulletsKo: [],
                financialsBulletsKo: [],
                integratedConclusionKo: '',
                scenarios: [],
                riskFactorsKo: [],
            });
        });

        it('문자열 배열의 잘못된 자식 값은 제거한다', () => {
            const result = normalizeOverallAnalysisResponse(
                JSON.stringify({
                    technicalBulletsKo: ['RSI 개선', null, 1, ''],
                    fundamentalBulletsKo: ['EPS 성장', {}, ''],
                    newsBulletsKo: ['실적 발표', false, ''],
                    optionsBulletsKo: ['콜 매수 우세', null, 0, ''],
                    riskFactorsKo: ['금리 위험', [], ''],
                })
            );

            expect(result.technicalBulletsKo).toEqual(['RSI 개선']);
            expect(result.fundamentalBulletsKo).toEqual(['EPS 성장']);
            expect(result.newsBulletsKo).toEqual(['실적 발표']);
            expect(result.optionsBulletsKo).toEqual(['콜 매수 우세']);
            expect(result.riskFactorsKo).toEqual(['금리 위험']);
        });
    });

    describe('context.optionsOiStale가 주어졌을 때', () => {
        it('true이면 optionsOiStale: true를 응답에 부착한다', () => {
            const result = normalizeOverallAnalysisResponse(
                JSON.stringify(validPayload),
                { optionsOiStale: true }
            );

            expect(result.optionsOiStale).toBe(true);
        });

        it('false이면 optionsOiStale 필드를 생략한다', () => {
            const result = normalizeOverallAnalysisResponse(
                JSON.stringify(validPayload),
                { optionsOiStale: false }
            );

            expect(result.optionsOiStale).toBeUndefined();
        });

        it('context 미제공이면 optionsOiStale 필드를 생략한다', () => {
            const result = normalizeOverallAnalysisResponse(
                JSON.stringify(validPayload)
            );

            expect(result.optionsOiStale).toBeUndefined();
        });
    });

    // `analyzedAt`은 LLM이 절대 채우지 않는 필드다 — `runOverallAnalysis`가
    // 생성 시점에 한 번 써 넣고, 이 정규화 함수는 캐시에서 읽어온 값을 그대로
    // 통과시키는 역할만 한다.
    describe('analyzedAt (캐시에서 읽어온 값을 그대로 통과)', () => {
        it('입력에 있으면 그대로 통과시킨다', () => {
            const result = normalizeOverallAnalysisResponse({
                ...validPayload,
                analyzedAt: '2026-05-30T00:00:00Z',
            });
            expect(result.analyzedAt).toBe('2026-05-30T00:00:00Z');
        });

        it('입력에 없으면 필드 자체를 생략한다(과거 캐시 항목과의 호환)', () => {
            const result = normalizeOverallAnalysisResponse(validPayload);
            expect(result.analyzedAt).toBeUndefined();
        });

        it('빈 문자열이면 생략한다', () => {
            const result = normalizeOverallAnalysisResponse({
                ...validPayload,
                analyzedAt: '',
            });
            expect(result.analyzedAt).toBeUndefined();
        });

        it('문자열이 아니면(숫자 등) 생략한다', () => {
            const result = normalizeOverallAnalysisResponse({
                ...validPayload,
                analyzedAt: 12345,
            });
            expect(result.analyzedAt).toBeUndefined();
        });

        it('null이면 생략한다', () => {
            const result = normalizeOverallAnalysisResponse({
                ...validPayload,
                analyzedAt: null,
            });
            expect(result.analyzedAt).toBeUndefined();
        });
    });

    describe('잘못된 enum 값이 주어졌을 때', () => {
        it('scenario name이 유효하지 않으면 neutral로 정규화한다', () => {
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
            expect(
                normalizeOverallAnalysisResponse(JSON.stringify(invalid))
            ).toMatchObject({
                scenarios: [
                    {
                        name: 'neutral',
                        triggerConditionKo: '조건',
                        priceRangeKo: '범위',
                    },
                ],
            });
        });

        it('객체가 아닌 scenario 자식은 제거한다', () => {
            const result = normalizeOverallAnalysisResponse(
                JSON.stringify({
                    scenarios: [
                        null,
                        'bad',
                        {
                            name: 'bearish',
                            triggerConditionKo: '지지선 이탈',
                            priceRangeKo: '160~170달러',
                        },
                    ],
                })
            );

            expect(result.scenarios).toEqual([
                {
                    name: 'bearish',
                    triggerConditionKo: '지지선 이탈',
                    priceRangeKo: '160~170달러',
                },
            ]);
        });
    });

    describe('financialsBulletsKo 필드', () => {
        it('defaults financialsBulletsKo to [] when missing', () => {
            expect(
                normalizeOverallAnalysisResponse({}).financialsBulletsKo
            ).toEqual([]);
        });
        it('normalizes financialsBulletsKo string array (filters empty)', () => {
            expect(
                normalizeOverallAnalysisResponse({
                    financialsBulletsKo: ['현금흐름 견조', ''],
                }).financialsBulletsKo
            ).toEqual(['현금흐름 견조']);
        });
    });

    describe('유효하지 않은 JSON 문자열이 주어졌을 때', () => {
        it('파싱 불가능한 문자열이면 에러를 던진다', () => {
            expect(() =>
                normalizeOverallAnalysisResponse('not valid json')
            ).toThrow();
        });
    });

    describe('문자열이 아닌 입력(이미 파싱된 객체/비정상 타입)이 주어졌을 때', () => {
        it('이미 파싱된 객체는 JSON.parse를 건너뛰고 그대로 정규화한다', () => {
            const result = normalizeOverallAnalysisResponse(validPayload);
            expect(result.headlineKo).toBe(validPayload.headlineKo);
            expect(result.scenarios).toHaveLength(2);
        });

        it('null/undefined/배열/숫자는 모든 필드를 기본값으로 반환한다', () => {
            const expected = {
                headlineKo: '',
                technicalBulletsKo: [],
                fundamentalBulletsKo: [],
                newsBulletsKo: [],
                optionsBulletsKo: [],
                financialsBulletsKo: [],
                integratedConclusionKo: '',
                scenarios: [],
                riskFactorsKo: [],
            };
            expect(normalizeOverallAnalysisResponse(null)).toEqual(expected);
            expect(normalizeOverallAnalysisResponse(undefined)).toEqual(
                expected
            );
            expect(normalizeOverallAnalysisResponse([1, 2, 3])).toEqual(
                expected
            );
            expect(normalizeOverallAnalysisResponse(42)).toEqual(expected);
        });

        it('비정상 입력이어도 context.optionsOiStale는 그대로 부착된다', () => {
            const result = normalizeOverallAnalysisResponse(null, {
                optionsOiStale: true,
            });
            expect(result.optionsOiStale).toBe(true);
        });
    });
});

describe('normalizeOverallAnalysisResponse — investorFlowsBulletsKo', () => {
    it('keeps the field absent when the model did not return it', () => {
        const result = normalizeOverallAnalysisResponse(validPayload);
        expect(result).not.toHaveProperty('investorFlowsBulletsKo');
    });

    it('returns the bullets when present, dropping non-strings and empties', () => {
        const result = normalizeOverallAnalysisResponse({
            ...validPayload,
            investorFlowsBulletsKo: [
                '기관 순매수',
                7,
                '',
                '내부자 클러스터 매수',
            ],
        });
        expect(result.investorFlowsBulletsKo).toEqual([
            '기관 순매수',
            '내부자 클러스터 매수',
        ]);
    });

    it('keeps an explicit empty array (integrated, no data) distinct from absence', () => {
        const result = normalizeOverallAnalysisResponse({
            ...validPayload,
            investorFlowsBulletsKo: [],
        });
        expect(result.investorFlowsBulletsKo).toEqual([]);
    });

    it('ignores a non-array value', () => {
        const result = normalizeOverallAnalysisResponse({
            ...validPayload,
            investorFlowsBulletsKo: '수급',
        });
        expect(result).not.toHaveProperty('investorFlowsBulletsKo');
    });
});
