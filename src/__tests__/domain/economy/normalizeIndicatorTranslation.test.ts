import { describe, it, expect } from 'vitest';
import { normalizeIndicatorTranslation } from '@/domain/economy/normalizeIndicatorTranslation';

describe('normalizeIndicatorTranslation', () => {
    it('정상 { nameKo } 객체에서 문자열 반환', () => {
        const result = normalizeIndicatorTranslation({
            nameKo: '근원 PCE 물가지수 전년比',
        });
        expect(result).toBe('근원 PCE 물가지수 전년比');
    });

    it('JSON 문자열 (LLM raw response) 파싱 — fence 없음', () => {
        const raw = JSON.stringify({ nameKo: '비농업 고용지수' });
        expect(normalizeIndicatorTranslation(raw)).toBe('비농업 고용지수');
    });

    it('JSON 문자열 — ```json fence 제거', () => {
        const raw = '```json\n{"nameKo":"신규 실업수당 청구건수"}\n```';
        expect(normalizeIndicatorTranslation(raw)).toBe(
            '신규 실업수당 청구건수'
        );
    });

    it('결과를 trim 처리', () => {
        const result = normalizeIndicatorTranslation({
            nameKo: '  근원 소비자물가지수 전월比  ',
        });
        expect(result).toBe('근원 소비자물가지수 전월比');
    });

    it('null 입력이면 빈 문자열', () => {
        expect(normalizeIndicatorTranslation(null)).toBe('');
    });

    it('undefined 입력이면 빈 문자열', () => {
        expect(normalizeIndicatorTranslation(undefined)).toBe('');
    });

    it('빈 객체이면 빈 문자열', () => {
        expect(normalizeIndicatorTranslation({})).toBe('');
    });

    it('nameKo 가 빈 문자열이면 빈 문자열 반환', () => {
        expect(normalizeIndicatorTranslation({ nameKo: '' })).toBe('');
    });

    it('nameKo 가 숫자(비문자열)이면 빈 문자열', () => {
        expect(normalizeIndicatorTranslation({ nameKo: 123 })).toBe('');
    });

    it('nameKo 가 null이면 빈 문자열', () => {
        expect(normalizeIndicatorTranslation({ nameKo: null })).toBe('');
    });

    it('nameKo 가 배열이면 빈 문자열', () => {
        expect(normalizeIndicatorTranslation({ nameKo: ['x'] })).toBe('');
    });

    it('가비지 문자열(비-JSON)이면 빈 문자열', () => {
        expect(normalizeIndicatorTranslation('not json garbage!!!')).toBe('');
    });

    it('숫자 입력이면 빈 문자열', () => {
        expect(normalizeIndicatorTranslation(42)).toBe('');
    });

    it('배열 입력이면 빈 문자열', () => {
        expect(normalizeIndicatorTranslation(['nameKo', 'x'])).toBe('');
    });

    it('nameKo 가 true(boolean)이면 빈 문자열', () => {
        expect(normalizeIndicatorTranslation({ nameKo: true })).toBe('');
    });

    it('다른 필드만 있는 객체이면 빈 문자열', () => {
        expect(
            normalizeIndicatorTranslation({ name: 'CPI', ko: '소비자물가' })
        ).toBe('');
    });

    it('never throws on any garbage — always returns string', () => {
        const garbage = [
            null,
            undefined,
            42,
            [],
            {},
            'bad json',
            { nameKo: 123 },
        ];
        for (const v of garbage) {
            expect(typeof normalizeIndicatorTranslation(v)).toBe('string');
        }
    });
});
