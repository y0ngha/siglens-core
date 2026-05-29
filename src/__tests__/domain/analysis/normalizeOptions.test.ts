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
            // LLM이 보낸 analyzedAt은 의도적으로 무시되고 서버 `now`가 사용된다.
            analyzedAt: '2026-05-14T11:55:00Z',
        };
        const result = normalizeOptionsAnalysisResponse(raw, now);
        expect(result.summary).toBe('시장은 상승 편향');
        expect(result.perExpiration).toHaveLength(1);
        expect(result.signals).toHaveLength(1);
        expect(result.analyzedAt).toBe(now.toISOString());
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

    // LLM이 프롬프트 예시 문자열("2023-10-27T10:30:00")을 그대로 응답에
    // 넣는 사례가 있어, 서버 `now`만 신뢰한다. 각 입력을 it.each로 펼쳐
    // 실패 시 어떤 입력이 문제였는지 테스트 리포트에서 즉시 식별할 수 있게 한다.
    it.each([
        ['analyzedAt 없는 빈 객체', {}],
        ['유효하지 않은 날짜 문자열', { analyzedAt: 'invalid-date' }],
        [
            'LLM 프롬프트 예시 echo 문자열',
            { analyzedAt: '2023-10-27T10:30:00' },
        ],
        ['미래 날짜', { analyzedAt: '2099-01-01T00:00:00Z' }],
    ] as const)(
        'always uses now.toISOString() for analyzedAt — %s',
        (_label, raw) => {
            const result = normalizeOptionsAnalysisResponse(raw, now);
            expect(result.analyzedAt).toBe(now.toISOString());
        }
    );

    it('handles null and non-object inputs safely', () => {
        // String input that's not valid JSON exercises the parseLlmPayload
        // catch branch (JSON.parse throws → fallback to FALLBACK_SUMMARY).
        const fromString = normalizeOptionsAnalysisResponse('string', now);
        expect(fromString.summary).toContain('가져올 수 없');
        expect(fromString.perExpiration).toEqual([]);
        expect(fromString.signals).toEqual([]);

        // Non-object primitives go through a different fallback path (no
        // parse attempt) but must still resolve to FALLBACK_SUMMARY shape.
        for (const input of [null, undefined, 123]) {
            const result = normalizeOptionsAnalysisResponse(input, now);
            expect(result.summary).toContain('가져올 수 없');
            expect(result.perExpiration).toEqual([]);
            expect(result.signals).toEqual([]);
        }
    });

    it('parses LLM markdown-fenced JSON string', () => {
        const raw = '```json\n{"summary":"테스트"}\n```';
        const result = normalizeOptionsAnalysisResponse(raw, now);
        expect(result.summary).toBe('테스트');
    });

    it('is idempotent for content fields when passed through again', () => {
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
        // analyzedAt은 매 호출마다 `now`로 새로 찍는다 — `now`가 같으면
        // 동일 값으로 수렴해 멱등성이 유지된다.
        expect(second.analyzedAt).toBe(first.analyzedAt);
        expect(first.analyzedAt).toBe(now.toISOString());
    });

    it('drops perExpiration entries that are not objects', () => {
        // Array elements that are primitives/arrays/null make asObject return
        // null → normalizePerExpirationItem returns null and they are compacted.
        const raw = {
            perExpiration: [
                'not-an-object',
                123,
                null,
                ['nested-array'],
                {
                    expirationDate: '2026-05-22',
                    commentary: 'ok',
                    tone: 'neutral',
                },
            ],
        };
        const result = normalizeOptionsAnalysisResponse(raw, now);
        expect(result.perExpiration).toHaveLength(1);
        expect(result.perExpiration[0].expirationDate).toBe('2026-05-22');
    });

    it('drops signals entries that are not objects', () => {
        const raw = {
            signals: [
                'not-an-object',
                123,
                null,
                ['nested-array'],
                { kind: 'bullish', message: 'ok' },
            ],
        };
        const result = normalizeOptionsAnalysisResponse(raw, now);
        expect(result.signals).toHaveLength(1);
        expect(result.signals[0].message).toBe('ok');
    });
});
