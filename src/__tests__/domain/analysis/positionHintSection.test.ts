import { describe, expect, it } from 'vitest';
import type { PositionBucket } from '@/domain/types';
import { formatPositionHintSection } from '@/domain/analysis/positionHintSection';

describe('formatPositionHintSection', () => {
    const cases: Array<[PositionBucket, string]> = [
        ['deep-profit', '깊은 수익'],
        ['profit', '수익'],
        ['near-breakeven', '본전 부근'],
        ['loss', '손실'],
        ['deep-loss', '깊은 손실'],
    ];

    it.each(cases)(
        'maps %s to the Korean band name "%s"',
        (bucket, koreanLabel) => {
            const out = formatPositionHintSection(bucket);
            expect(out).toContain(koreanLabel);
        }
    );

    it('is qualitative and neutral: never contains a numeric figure', () => {
        for (const [bucket] of cases) {
            const out = formatPositionHintSection(bucket);
            expect(out).not.toMatch(/\d/);
        }
    });

    it('never mentions raw average price, quantity, or an action instruction', () => {
        for (const [bucket] of cases) {
            const out = formatPositionHintSection(bucket);
            expect(out).not.toMatch(/평단|평균단가|수량|매수|매도|손절|익절/);
        }
    });

    it('states the band as reference context (참고), not an instruction to the model', () => {
        const out = formatPositionHintSection('profit');
        expect(out).toContain('참고');
        expect(out).toContain('구간');
    });

    it('returns an empty string for a bucket value outside the PositionBucket union instead of injecting "undefined"', () => {
        // Runtime defensive guard: TypeScript can't catch a bad value crossing
        // a JSON boundary (e.g. a stale/corrupt cache entry or a caller bug),
        // so simulate that with a cast past the type system.
        const invalidBucket = 'unknown-bucket' as unknown as PositionBucket;
        const out = formatPositionHintSection(invalidBucket);
        expect(out).toBe('');
        expect(out).not.toContain('undefined');
    });
});
