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

    it('is bucket-qualitative: never contains a numeric figure (load-bearing safety guard)', () => {
        for (const [bucket] of cases) {
            const out = formatPositionHintSection(bucket);
            expect(out).not.toMatch(/\d/);
        }
    });

    it('never emits a raw average price, quantity, or amount — only the qualitative band (load-bearing privacy/cache guard)', () => {
        // The band strips price/quantity/amount at the source; the emitted hint
        // must never reintroduce any of them, even though it now DOES use
        // position-management verbs (익절/손절/추가매수/보유) intentionally.
        for (const [bucket] of cases) {
            const out = formatPositionHintSection(bucket);
            expect(out).not.toMatch(/평단|평균단가|수량/);
        }
    });

    it('is instructive and orients the analysis to holder position management (deliberate, product-approved reframing)', () => {
        for (const [bucket] of cases) {
            const out = formatPositionHintSection(bucket);
            // Holder (not fresh-entry) perspective, oriented to managing the
            // position rather than a passive "참고" reference line.
            expect(out).toContain('보유');
            expect(out).toContain('관점');
            expect(out).toContain('구간');
        }
    });

    it('keeps the disclaimer-safe envelope: general-scenario framing, no assumed holding size, user owns the final call', () => {
        const out = formatPositionHintSection('profit');
        // Scenario/perspective framing (not a specific-user command)...
        expect(out).toContain('일반적 시나리오');
        // ...explicitly not assuming a specific holding size/amount...
        expect(out).toContain('가정하지');
        // ...and the final judgment/responsibility stays with the user.
        expect(out).toContain('책임은 사용자');
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
