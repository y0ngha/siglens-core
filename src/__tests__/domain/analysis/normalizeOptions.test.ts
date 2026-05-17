import { describe, it, expect } from 'vitest';
import { normalizeOptionsAnalysisResponse } from '@/domain/analysis/normalizeOptions';

describe('normalizeOptionsAnalysisResponse', () => {
    const now = new Date('2026-05-14T12:00:00Z');

    it('passes through a fully-formed valid response', () => {
        const raw = {
            summary: '시장은 상승 편향',
            perExpiration: [
                {
                    expirationDate: '2026-05-22',
                    commentary: '단기 OI 두텁다',
                    tone: 'bullish',
                },
            ],
            signals: [{ kind: 'bullish', message: '콜 OI 급증' }],
            analyzedAt: '2026-05-14T11:55:00Z',
        };
        const result = normalizeOptionsAnalysisResponse(raw, now);
        expect(result.summary).toBe('시장은 상승 편향');
        expect(result.perExpiration).toHaveLength(1);
        expect(result.signals).toHaveLength(1);
        expect(result.analyzedAt).toBe('2026-05-14T11:55:00Z');
    });

    it('falls back to FALLBACK_SUMMARY when summary missing', () => {
        const result = normalizeOptionsAnalysisResponse({}, now);
        expect(result.summary.length).toBeGreaterThan(0);
        expect(result.summary).toContain('가져올 수 없');
    });

    it('returns empty perExpiration when not an array', () => {
        const result = normalizeOptionsAnalysisResponse(
            { perExpiration: 'invalid' },
            now
        );
        expect(result.perExpiration).toEqual([]);
    });

    it('drops perExpiration items missing expirationDate', () => {
        const raw = {
            perExpiration: [
                { commentary: 'good', tone: 'bullish' }, // no expirationDate
                {
                    expirationDate: '2026-05-22',
                    commentary: 'ok',
                    tone: 'neutral',
                },
            ],
        };
        const result = normalizeOptionsAnalysisResponse(raw, now);
        expect(result.perExpiration).toHaveLength(1);
    });

    it('falls back commentary to FALLBACK_COMMENTARY when missing', () => {
        const raw = {
            perExpiration: [{ expirationDate: '2026-05-22', tone: 'neutral' }],
        };
        const result = normalizeOptionsAnalysisResponse(raw, now);
        expect(result.perExpiration[0].commentary.length).toBeGreaterThan(0);
    });

    it('coerces invalid tone to neutral', () => {
        const raw = {
            perExpiration: [
                {
                    expirationDate: '2026-05-22',
                    commentary: 'x',
                    tone: 'super-bullish',
                },
            ],
        };
        const result = normalizeOptionsAnalysisResponse(raw, now);
        expect(result.perExpiration[0].tone).toBe('neutral');
    });

    it('drops signals missing message', () => {
        const raw = {
            signals: [
                { kind: 'bullish' }, // no message
                { kind: 'bullish', message: 'good' },
            ],
        };
        const result = normalizeOptionsAnalysisResponse(raw, now);
        expect(result.signals).toHaveLength(1);
    });

    it('coerces invalid signal kind to neutral', () => {
        const raw = {
            signals: [{ kind: 'unknown', message: 'x' }],
        };
        const result = normalizeOptionsAnalysisResponse(raw, now);
        expect(result.signals[0].kind).toBe('neutral');
    });

    it('uses now.toISOString() when analyzedAt missing or invalid', () => {
        const result = normalizeOptionsAnalysisResponse({}, now);
        expect(result.analyzedAt).toBe(now.toISOString());
    });

    it('handles null and non-object inputs safely', () => {
        expect(() => normalizeOptionsAnalysisResponse(null, now)).not.toThrow();
        expect(() =>
            normalizeOptionsAnalysisResponse(undefined, now)
        ).not.toThrow();
        expect(() =>
            normalizeOptionsAnalysisResponse('string', now)
        ).not.toThrow();
        expect(() => normalizeOptionsAnalysisResponse(123, now)).not.toThrow();
    });

    it('parses LLM markdown-fenced JSON string', () => {
        const raw = '```json\n{"summary":"테스트"}\n```';
        const result = normalizeOptionsAnalysisResponse(raw, now);
        expect(result.summary).toBe('테스트');
    });

    it('is idempotent — passing already-normalized result through again is a no-op', () => {
        const raw = {
            summary: '콜 옵션 OI가 높아 강세 포지셔닝이 확인됩니다.',
            perExpiration: [
                {
                    expirationDate: '2026-06-20',
                    commentary: '이 만기에서 콜 비중이 높습니다.',
                    tone: 'bullish',
                },
            ],
            signals: [
                { kind: 'bullish', message: 'Put/Call 비율이 낮아 강세 신호.' },
            ],
            analyzedAt: '2026-05-14T10:00:00.000Z',
        };
        const first = normalizeOptionsAnalysisResponse(raw, now);
        const second = normalizeOptionsAnalysisResponse(first, now);

        expect(second.summary).toBe(first.summary);
        expect(second.perExpiration).toEqual(first.perExpiration);
        expect(second.signals).toEqual(first.signals);
        // analyzedAt is a valid ISO on the first pass, so it must be
        // preserved verbatim on the second.
        expect(second.analyzedAt).toBe(first.analyzedAt);
    });
});
