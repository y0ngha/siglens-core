import { describe, expect, it } from 'vitest';
import { normalizeCongressTrendResponse } from '@/domain/analysis/normalizeCongressTrend';

describe('normalizeCongressTrendResponse', () => {
    it('정상 객체를 통과시킨다', () => {
        const r = normalizeCongressTrendResponse({
            summaryKo: '최근 순매수 우세예요.',
            notableMembersKo: ['Capito 의원 매수'],
            riskNoteKo: '공시 지연 45일 유의.',
            overallSentiment: 'bullish',
        });
        expect(r.summaryKo).toBe('최근 순매수 우세예요.');
        expect(r.notableMembersKo).toEqual(['Capito 의원 매수']);
        expect(r.overallSentiment).toBe('bullish');
    });
    it('markdown fence 감싼 JSON 문자열을 파싱한다', () => {
        const raw =
            '```json\n{"summaryKo":"x","overallSentiment":"bearish"}\n```';
        const r = normalizeCongressTrendResponse(raw);
        expect(r.summaryKo).toBe('x');
        expect(r.overallSentiment).toBe('bearish');
    });
    it('누락 string은 빈 문자열, 누락 array는 []', () => {
        const r = normalizeCongressTrendResponse({});
        expect(r.summaryKo).toBe('');
        expect(r.riskNoteKo).toBe('');
        expect(r.notableMembersKo).toEqual([]);
    });
    it('invalid enum은 neutral로 폴백', () => {
        expect(
            normalizeCongressTrendResponse({ overallSentiment: 'moon' })
                .overallSentiment
        ).toBe('neutral');
    });
    it('notableMembersKo의 비문자열 항목은 드롭', () => {
        const r = normalizeCongressTrendResponse({
            notableMembersKo: ['ok', 3, null, ''],
        });
        expect(r.notableMembersKo).toEqual(['ok']);
    });
    it('비-객체(숫자) 입력은 전부 기본값으로 폴백', () => {
        // LLM이 숫자 같은 비-객체를 반환하면 asObject(42) → null → ?? {} 폴백
        const r = normalizeCongressTrendResponse(42);
        expect(r).toEqual({
            summaryKo: '',
            notableMembersKo: [],
            riskNoteKo: '',
            overallSentiment: 'neutral',
        });
    });
    it('객체가 아닌 JSON 문자열(배열)도 기본값으로 폴백', () => {
        // extractJsonFromLlmResponse('[1,2,3]') → [1,2,3](배열)
        // asObject([1,2,3]) → null(Array.isArray guard) → ?? {} 폴백
        const r = normalizeCongressTrendResponse('[1,2,3]');
        expect(r.summaryKo).toBe('');
        expect(r.notableMembersKo).toEqual([]);
        expect(r.riskNoteKo).toBe('');
        expect(r.overallSentiment).toBe('neutral');
    });
    it('malformed JSON 문자열은 SyntaxError를 throw한다', () => {
        expect(() =>
            normalizeCongressTrendResponse('not valid json {{{')
        ).toThrow(SyntaxError);
    });
});
