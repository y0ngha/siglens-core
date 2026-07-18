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

    it('is holder-consistent: leads with an explicit holder opener and makes management the primary frame (not a co-equal holder/new-entry hedge)', () => {
        for (const [bucket, koreanLabel] of cases) {
            const out = formatPositionHintSection(bucket);
            // Explicit holder opener the conclusion/strategy must start from,
            // interpolating this band's label.
            expect(out).toContain(
                `현재 '${koreanLabel}' 구간에 계신 보유자 관점에서`
            );
            // The reader is treated AS the holder throughout — the band's
            // position-management vocabulary is the primary lens.
            expect(out).toContain('보유 포지션 관리');
            expect(out).toContain('가장 중요한 관점');
            // New-entrant commentary is demoted to brief/secondary and must NOT
            // be presented in parallel with the holding perspective.
            expect(out).toContain('보조');
            expect(out).toContain('병렬로 서술하지');
        }
    });

    it('keeps the disclaimer-safe envelope: general-scenario framing, no assumed holding size, user owns the final call', () => {
        const out = formatPositionHintSection('profit');
        // Scenario/perspective framing (not a specific-user command)...
        expect(out).toContain('일반적 시나리오');
        // ...explicitly not assuming a specific holding size/amount...
        expect(out).toContain('가정하지');
        // ...never commanding a specific action to a specific user...
        expect(out).toContain('특정 사용자에게 특정 행동을 지시하지');
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
