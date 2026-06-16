import { describe, it, expect } from 'vitest';
import { normalizeMacroBriefing } from '@/domain/economy/normalizeMacroBriefing';

describe('normalizeMacroBriefing', () => {
    it('정상 객체를 그대로 타입화', () => {
        const out = normalizeMacroBriefing({
            summary: '금리 동결 국면',
            highlights: ['2s10s 역전 해소', '고용 견조'],
            regime: 'recovery',
        });
        expect(out.summary).toBe('금리 동결 국면');
        expect(out.highlights).toEqual(['2s10s 역전 해소', '고용 견조']);
        expect(out.regime).toBe('recovery');
    });

    it('regime 비정상이면 neutral', () => {
        const out = normalizeMacroBriefing({ summary: 'x', regime: 'bogus' });
        expect(out.regime).toBe('neutral');
    });

    it('highlights 결측/비배열이면 []', () => {
        expect(normalizeMacroBriefing({ summary: 'x' }).highlights).toEqual([]);
        expect(
            normalizeMacroBriefing({ summary: 'x', highlights: 'no' })
                .highlights
        ).toEqual([]);
    });

    it('highlights 내 빈 문자열·비문자열 항목 제거', () => {
        const out = normalizeMacroBriefing({
            summary: 'x',
            highlights: ['ok', '', 3, null],
        });
        expect(out.highlights).toEqual(['ok']);
    });

    it('summary 결측이면 빈 문자열(호출부가 error 처리)', () => {
        expect(normalizeMacroBriefing({}).summary).toBe('');
    });

    it('null/비객체 입력이면 기본 객체', () => {
        expect(normalizeMacroBriefing(null)).toEqual({
            summary: '',
            highlights: [],
            regime: 'neutral',
        });
    });
});
