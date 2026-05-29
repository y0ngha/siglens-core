import { describe, it, expect } from 'vitest';
import {
    normalizeNewsAnalysisResponse,
    normalizeNewsCardAnalysis,
} from '@/domain/analysis/normalizeNews';

const validNewsAnalysis = {
    currentDriverKo: '최근 어닝 서프라이즈가 주가를 견인했습니다.',
    keyEventsKo: ['어닝 서프라이즈', 'CEO 교체'],
    upcomingEventsKo: ['다음 분기 실적 발표'],
    overallSentiment: 'bullish',
};

const validNewsCard = {
    titleKo: '애플, 어닝 서프라이즈 기록',
    bodyKo: '애플은 2분기 실적에서 예상치를 크게 웃도는 성과를 보였습니다.',
    summaryKo: '애플 어닝 서프라이즈',
    sentiment: 'bullish',
    category: 'earnings',
    priceImpact: 'high',
};

describe('normalizeNewsAnalysisResponse 함수는', () => {
    describe('완전하고 유효한 JSON이 주어졌을 때', () => {
        it('모든 필드를 올바르게 파싱하여 반환한다', () => {
            const result = normalizeNewsAnalysisResponse(
                JSON.stringify(validNewsAnalysis)
            );

            expect(result.currentDriverKo).toBe(
                '최근 어닝 서프라이즈가 주가를 견인했습니다.'
            );
            expect(result.overallSentiment).toBe('bullish');
            expect(result.keyEventsKo).toEqual(['어닝 서프라이즈', 'CEO 교체']);
            expect(result.upcomingEventsKo).toEqual(['다음 분기 실적 발표']);
        });
    });

    describe('마크다운 펜스로 감싸진 JSON이 주어졌을 때', () => {
        it('```json ... ``` 펜스를 제거하고 올바르게 파싱한다', () => {
            const fenced = `\`\`\`json\n${JSON.stringify(validNewsAnalysis)}\n\`\`\``;
            const result = normalizeNewsAnalysisResponse(fenced);
            expect(result.overallSentiment).toBe('bullish');
            expect(result.currentDriverKo).toBe(
                '최근 어닝 서프라이즈가 주가를 견인했습니다.'
            );
        });

        it('``` ... ``` 펜스(타입 없음)를 제거하고 올바르게 파싱한다', () => {
            const fenced = `\`\`\`\n${JSON.stringify(validNewsAnalysis)}\n\`\`\``;
            const result = normalizeNewsAnalysisResponse(fenced);
            expect(result.overallSentiment).toBe('bullish');
        });
    });

    describe('필드가 누락된 JSON이 주어졌을 때', () => {
        it('누락 필드를 기본값으로 채운다', () => {
            const result = normalizeNewsAnalysisResponse('{}');

            expect(result).toEqual({
                currentDriverKo: '',
                keyEventsKo: [],
                upcomingEventsKo: [],
                overallSentiment: 'neutral',
            });
        });

        it('문자열 배열의 잘못된 자식 값은 제거한다', () => {
            const result = normalizeNewsAnalysisResponse(
                JSON.stringify({
                    keyEventsKo: ['실적 발표', null, 1, ''],
                    upcomingEventsKo: ['FOMC', {}, ''],
                })
            );

            expect(result.keyEventsKo).toEqual(['실적 발표']);
            expect(result.upcomingEventsKo).toEqual(['FOMC']);
        });
    });

    describe('잘못된 enum 값이 주어졌을 때', () => {
        it('overallSentiment가 유효하지 않으면 neutral로 정규화한다', () => {
            const invalid = {
                ...validNewsAnalysis,
                overallSentiment: 'positive',
            };
            expect(
                normalizeNewsAnalysisResponse(JSON.stringify(invalid))
            ).toMatchObject({ overallSentiment: 'neutral' });
        });
    });

    describe('유효하지 않은 JSON 문자열이 주어졌을 때', () => {
        it('파싱 불가능한 문자열이면 에러를 던진다', () => {
            expect(() =>
                normalizeNewsAnalysisResponse('not valid json')
            ).toThrow();
        });
    });

    describe('객체가 아닌 값이 직접 주어졌을 때', () => {
        it('배열을 전달하면 빈 객체로 취급해 모든 기본값을 채운다', () => {
            // 배열은 typeof "object"라 JSON 파싱은 건너뛰지만 asObject가 거부 →
            // `?? {}` fallback 경로를 탄다.
            const result = normalizeNewsAnalysisResponse([1, 2, 3]);
            expect(result).toEqual({
                currentDriverKo: '',
                keyEventsKo: [],
                upcomingEventsKo: [],
                overallSentiment: 'neutral',
            });
        });
    });
});

describe('normalizeNewsCardAnalysis 함수는', () => {
    describe('완전하고 유효한 JSON이 주어졌을 때', () => {
        it('모든 필드를 올바르게 파싱하여 반환한다', () => {
            const result = normalizeNewsCardAnalysis(
                JSON.stringify(validNewsCard)
            );

            expect(result.titleKo).toBe('애플, 어닝 서프라이즈 기록');
            expect(result.bodyKo).toBe(
                '애플은 2분기 실적에서 예상치를 크게 웃도는 성과를 보였습니다.'
            );
            expect(result.summaryKo).toBe('애플 어닝 서프라이즈');
            expect(result.sentiment).toBe('bullish');
            expect(result.category).toBe('earnings');
            expect(result.priceImpact).toBe('high');
        });

        it('bodyKo가 null인 경우도 허용한다', () => {
            const withNullBody = { ...validNewsCard, bodyKo: null };
            const result = normalizeNewsCardAnalysis(
                JSON.stringify(withNullBody)
            );
            expect(result.bodyKo).toBeNull();
        });
    });

    describe('마크다운 펜스로 감싸진 JSON이 주어졌을 때', () => {
        it('```json ... ``` 펜스를 제거하고 올바르게 파싱한다', () => {
            const fenced = `\`\`\`json\n${JSON.stringify(validNewsCard)}\n\`\`\``;
            const result = normalizeNewsCardAnalysis(fenced);
            expect(result.sentiment).toBe('bullish');
            expect(result.category).toBe('earnings');
        });
    });

    describe('필드가 누락된 JSON이 주어졌을 때', () => {
        it('누락 필드를 기본값으로 채운다', () => {
            const result = normalizeNewsCardAnalysis('{}');

            expect(result).toEqual({
                titleKo: '',
                bodyKo: null,
                summaryKo: '',
                sentiment: 'neutral',
                category: 'other',
                priceImpact: 'negligible',
            });
        });

        it('bodyKo가 문자열이나 null이 아니면 null로 정규화한다', () => {
            const result = normalizeNewsCardAnalysis(
                JSON.stringify({ bodyKo: { text: '본문' } })
            );

            expect(result.bodyKo).toBeNull();
        });
    });

    describe('잘못된 enum 값이 주어졌을 때', () => {
        it('sentiment가 유효하지 않으면 neutral로 정규화한다', () => {
            const invalid = { ...validNewsCard, sentiment: 'positive' };
            const result = normalizeNewsCardAnalysis(JSON.stringify(invalid));
            expect(result.sentiment).toBe('neutral');
        });

        it('category가 유효하지 않으면 other로 정규화한다', () => {
            const invalid = { ...validNewsCard, category: 'sports' };
            const result = normalizeNewsCardAnalysis(JSON.stringify(invalid));
            expect(result.category).toBe('other');
        });

        it('priceImpact가 유효하지 않으면 negligible로 정규화한다', () => {
            const invalid = { ...validNewsCard, priceImpact: 'critical' };
            const result = normalizeNewsCardAnalysis(JSON.stringify(invalid));
            expect(result.priceImpact).toBe('negligible');
        });
    });

    describe('유효하지 않은 JSON 문자열이 주어졌을 때', () => {
        it('파싱 불가능한 문자열이면 에러를 던진다', () => {
            expect(() => normalizeNewsCardAnalysis('not valid json')).toThrow();
        });
    });

    describe('객체가 아닌 값이 직접 주어졌을 때', () => {
        it('배열을 전달하면 빈 객체로 취급해 모든 기본값을 채운다', () => {
            const result = normalizeNewsCardAnalysis([1, 2, 3]);
            expect(result).toEqual({
                titleKo: '',
                bodyKo: null,
                summaryKo: '',
                sentiment: 'neutral',
                category: 'other',
                priceImpact: 'negligible',
            });
        });
    });
});
