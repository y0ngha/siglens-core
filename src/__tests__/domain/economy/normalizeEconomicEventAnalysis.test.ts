import { describe, it, expect } from 'vitest';
import { normalizeEconomicEventAnalysis } from '@/domain/economy/normalizeEconomicEventAnalysis';

describe('normalizeEconomicEventAnalysis', () => {
    it('정상 객체를 그대로 타입화', () => {
        const out = normalizeEconomicEventAnalysis({
            sentiment: 'bullish',
            summaryKo: 'CPI가 예상치를 하회했습니다.',
            interpretationKo: '금리 인하 기대가 높아집니다.',
        });
        expect(out.sentiment).toBe('bullish');
        expect(out.summaryKo).toBe('CPI가 예상치를 하회했습니다.');
        expect(out.interpretationKo).toBe('금리 인하 기대가 높아집니다.');
    });

    it('bearish sentiment 정상 처리', () => {
        const out = normalizeEconomicEventAnalysis({
            sentiment: 'bearish',
            summaryKo: '예상보다 높은 인플레이션이 발표됐습니다.',
            interpretationKo: '긴축 압력이 높아집니다.',
        });
        expect(out.sentiment).toBe('bearish');
    });

    it('neutral sentiment 정상 처리', () => {
        const out = normalizeEconomicEventAnalysis({
            sentiment: 'neutral',
            summaryKo: '인라인 결과입니다.',
            interpretationKo: '혼조세입니다.',
        });
        expect(out.sentiment).toBe('neutral');
    });

    it('유효하지 않은 sentiment이면 neutral 폴백', () => {
        const out = normalizeEconomicEventAnalysis({
            sentiment: 'extremely_bullish',
            summaryKo: 'x',
            interpretationKo: 'y',
        });
        expect(out.sentiment).toBe('neutral');
    });

    it('sentiment 없으면 neutral 폴백', () => {
        const out = normalizeEconomicEventAnalysis({ summaryKo: 'x' });
        expect(out.sentiment).toBe('neutral');
    });

    it('summaryKo 결측이면 빈 문자열', () => {
        const out = normalizeEconomicEventAnalysis({ sentiment: 'bullish' });
        expect(out.summaryKo).toBe('');
    });

    it('interpretationKo 결측이면 빈 문자열', () => {
        const out = normalizeEconomicEventAnalysis({
            sentiment: 'bullish',
            summaryKo: 'x',
        });
        expect(out.interpretationKo).toBe('');
    });

    it('null 입력이면 기본 객체 반환', () => {
        expect(normalizeEconomicEventAnalysis(null)).toEqual({
            sentiment: 'neutral',
            summaryKo: '',
            interpretationKo: '',
        });
    });

    it('undefined 입력이면 기본 객체 반환', () => {
        expect(normalizeEconomicEventAnalysis(undefined)).toEqual({
            sentiment: 'neutral',
            summaryKo: '',
            interpretationKo: '',
        });
    });

    it('빈 객체이면 기본 객체 반환', () => {
        expect(normalizeEconomicEventAnalysis({})).toEqual({
            sentiment: 'neutral',
            summaryKo: '',
            interpretationKo: '',
        });
    });

    it('배열 입력이면 기본 객체 반환', () => {
        expect(normalizeEconomicEventAnalysis([])).toEqual({
            sentiment: 'neutral',
            summaryKo: '',
            interpretationKo: '',
        });
    });

    it('숫자 입력이면 기본 객체 반환', () => {
        expect(normalizeEconomicEventAnalysis(42)).toEqual({
            sentiment: 'neutral',
            summaryKo: '',
            interpretationKo: '',
        });
    });

    it('JSON 문자열 (LLM raw response) 파싱 — fence 없음', () => {
        const raw = JSON.stringify({
            sentiment: 'bullish',
            summaryKo: '발표 요약',
            interpretationKo: '시장 해석',
        });
        const out = normalizeEconomicEventAnalysis(raw);
        expect(out.sentiment).toBe('bullish');
        expect(out.summaryKo).toBe('발표 요약');
        expect(out.interpretationKo).toBe('시장 해석');
    });

    it('JSON 문자열 (LLM raw response) 파싱 — ```json fence 제거', () => {
        const raw =
            '```json\n{"sentiment":"bearish","summaryKo":"s","interpretationKo":"i"}\n```';
        const out = normalizeEconomicEventAnalysis(raw);
        expect(out.sentiment).toBe('bearish');
        expect(out.summaryKo).toBe('s');
        expect(out.interpretationKo).toBe('i');
    });

    it('summaryKo가 비문자열이면 빈 문자열로 coerce', () => {
        const out = normalizeEconomicEventAnalysis({
            sentiment: 'neutral',
            summaryKo: 123,
        });
        expect(out.summaryKo).toBe('');
    });

    it('interpretationKo가 비문자열이면 빈 문자열로 coerce', () => {
        const out = normalizeEconomicEventAnalysis({
            sentiment: 'neutral',
            interpretationKo: true,
        });
        expect(out.interpretationKo).toBe('');
    });
});
