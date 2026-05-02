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

    describe('필수 필드가 누락된 JSON이 주어졌을 때', () => {
        it('currentDriverKo가 없으면 에러를 던진다', () => {
            const { currentDriverKo: _, ...rest } = validNewsAnalysis;
            expect(() =>
                normalizeNewsAnalysisResponse(JSON.stringify(rest))
            ).toThrow();
        });

        it('keyEventsKo가 없으면 에러를 던진다', () => {
            const { keyEventsKo: _, ...rest } = validNewsAnalysis;
            expect(() =>
                normalizeNewsAnalysisResponse(JSON.stringify(rest))
            ).toThrow();
        });

        it('upcomingEventsKo가 없으면 에러를 던진다', () => {
            const { upcomingEventsKo: _, ...rest } = validNewsAnalysis;
            expect(() =>
                normalizeNewsAnalysisResponse(JSON.stringify(rest))
            ).toThrow();
        });

        it('overallSentiment가 없으면 에러를 던진다', () => {
            const { overallSentiment: _, ...rest } = validNewsAnalysis;
            expect(() =>
                normalizeNewsAnalysisResponse(JSON.stringify(rest))
            ).toThrow();
        });
    });

    describe('잘못된 enum 값이 주어졌을 때', () => {
        it('overallSentiment가 유효하지 않으면 에러를 던진다', () => {
            const invalid = {
                ...validNewsAnalysis,
                overallSentiment: 'positive',
            };
            expect(() =>
                normalizeNewsAnalysisResponse(JSON.stringify(invalid))
            ).toThrow();
        });
    });

    describe('유효하지 않은 JSON 문자열이 주어졌을 때', () => {
        it('파싱 불가능한 문자열이면 에러를 던진다', () => {
            expect(() =>
                normalizeNewsAnalysisResponse('not valid json')
            ).toThrow();
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

    describe('필수 필드가 누락된 JSON이 주어졌을 때', () => {
        it('titleKo가 없으면 에러를 던진다', () => {
            const { titleKo: _, ...rest } = validNewsCard;
            expect(() =>
                normalizeNewsCardAnalysis(JSON.stringify(rest))
            ).toThrow();
        });

        it('summaryKo가 없으면 에러를 던진다', () => {
            const { summaryKo: _, ...rest } = validNewsCard;
            expect(() =>
                normalizeNewsCardAnalysis(JSON.stringify(rest))
            ).toThrow();
        });

        it('sentiment가 없으면 에러를 던진다', () => {
            const { sentiment: _, ...rest } = validNewsCard;
            expect(() =>
                normalizeNewsCardAnalysis(JSON.stringify(rest))
            ).toThrow();
        });

        it('category가 없으면 에러를 던진다', () => {
            const { category: _, ...rest } = validNewsCard;
            expect(() =>
                normalizeNewsCardAnalysis(JSON.stringify(rest))
            ).toThrow();
        });
    });

    describe('잘못된 enum 값이 주어졌을 때', () => {
        it('sentiment가 유효하지 않으면 에러를 던진다', () => {
            const invalid = { ...validNewsCard, sentiment: 'positive' };
            expect(() =>
                normalizeNewsCardAnalysis(JSON.stringify(invalid))
            ).toThrow();
        });

        it('category가 유효하지 않으면 에러를 던진다', () => {
            const invalid = { ...validNewsCard, category: 'sports' };
            expect(() =>
                normalizeNewsCardAnalysis(JSON.stringify(invalid))
            ).toThrow();
        });
    });

    describe('유효하지 않은 JSON 문자열이 주어졌을 때', () => {
        it('파싱 불가능한 문자열이면 에러를 던진다', () => {
            expect(() => normalizeNewsCardAnalysis('not valid json')).toThrow();
        });
    });
});
