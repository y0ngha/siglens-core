import { describe, it, expect } from 'vitest';
import { extractPivots } from '@/domain/patterns/pivots';
import {
    classifyDoubleTripleTop,
    classifyDoubleTripleBottom,
    classifyHeadAndShoulders,
    classifyInverseHeadAndShoulders,
    classifyTrendlinePatterns,
    classifyFlagsAndPennants,
    classifyCurvaturePatterns,
} from '@/domain/patterns/classifiers';
import {
    makeAlternatingPivotBars,
    makeBars,
    makeHLBars,
} from '@/__tests__/domain/patterns/helpers';

const ATR = 1;

describe('classifyDoubleTripleTop / classifyDoubleTripleBottom', () => {
    it('double_top: 두 고점이 근접하고 그 사이에 저점이 있으면 감지한다', () => {
        const bars = makeBars([10, 15, 11, 15.2, 11]);
        const pivots = extractPivots(bars, ATR);

        const candidates = classifyDoubleTripleTop(pivots, bars, ATR);

        expect(candidates).toEqual([
            { id: 'double_top', startIndex: 1, endIndex: 3 },
        ]);
    });

    it('triple_top: 세 고점이 pairwise 근접하고 저점이 교대로 있으면 triple과 double을 모두 방출한다', () => {
        const bars = makeBars([10, 15, 11, 15.2, 11, 15.1, 11]);
        const pivots = extractPivots(bars, ATR);

        const candidates = classifyDoubleTripleTop(pivots, bars, ATR);

        expect(candidates).toEqual([
            { id: 'triple_top', startIndex: 1, endIndex: 5 },
            { id: 'double_top', startIndex: 3, endIndex: 5 },
        ]);
        for (const c of candidates) {
            expect(c.startIndex).toBeLessThan(c.endIndex);
            expect(c.endIndex).toBeLessThanOrEqual(bars.length - 1);
        }
    });

    it('고점이 하나뿐이면 감지하지 않는다', () => {
        const bars = makeBars([10, 15, 11]);
        const pivots = extractPivots(bars, ATR);
        expect(pivots.filter(p => p.kind === 'high')).toHaveLength(1);

        expect(classifyDoubleTripleTop(pivots, bars, ATR)).toEqual([]);
    });

    it('고점 차이가 정확히 EXTREME_MATCH_ATR_MULT * atr 이면 감지한다 (느슨한 경계)', () => {
        // Highs at 15.05 and 16.05 — exactly 1.0 apart, matching
        // EXTREME_MATCH_ATR_MULT(1.0) * atr(1). The boundary is inclusive
        // (loose interpretation), so this must still detect.
        const bars = makeBars([10, 15, 11, 16, 11]);
        const pivots = extractPivots(bars, ATR);
        const highs = pivots.filter(p => p.kind === 'high');
        expect(highs).toHaveLength(2);
        expect(Math.abs(highs[0].price - highs[1].price)).toBe(1);

        const candidates = classifyDoubleTripleTop(pivots, bars, ATR);

        expect(candidates).toEqual([
            { id: 'double_top', startIndex: 1, endIndex: 3 },
        ]);
    });

    it('double_bottom: 두 저점이 근접하고 그 사이에 고점이 있으면 감지한다', () => {
        const bars = makeBars([10, 5, 9, 4, 9]);
        const pivots = extractPivots(bars, ATR);

        const candidates = classifyDoubleTripleBottom(pivots, bars, ATR);

        expect(candidates).toEqual([
            { id: 'double_bottom', startIndex: 1, endIndex: 3 },
        ]);
    });

    it('atr가 0 이하이면 감지하지 않는다', () => {
        const bars = makeBars([10, 15, 11, 15.2, 11]);
        const pivots = extractPivots(bars, ATR);
        expect(classifyDoubleTripleTop(pivots, bars, 0)).toEqual([]);
        expect(classifyDoubleTripleTop(pivots, bars, -1)).toEqual([]);
    });
});

describe('classifyHeadAndShoulders / classifyInverseHeadAndShoulders', () => {
    it('head_and_shoulders: 대칭 어깨 + 머리가 충분히 높으면 감지한다', () => {
        const bars = makeBars([10, 15, 10, 20, 10, 15, 10]);
        const pivots = extractPivots(bars, ATR);
        expect(pivots).toHaveLength(5);

        const candidates = classifyHeadAndShoulders(pivots, bars, ATR);

        expect(candidates).toEqual([
            { id: 'head_and_shoulders', startIndex: 1, endIndex: 5 },
        ]);
    });

    it('inverse_head_and_shoulders: 대칭 어깨 + 머리(저점)가 충분히 깊으면 감지한다', () => {
        const bars = makeBars([20, 15, 20, 10, 20, 15, 20]);
        const pivots = extractPivots(bars, ATR);
        expect(pivots).toHaveLength(5);

        const candidates = classifyInverseHeadAndShoulders(pivots, bars, ATR);

        expect(candidates).toEqual([
            { id: 'inverse_head_and_shoulders', startIndex: 1, endIndex: 5 },
        ]);
    });

    it('피벗이 5개 미만이면 감지하지 않는다', () => {
        const bars = makeBars([10, 15, 10, 20, 10]);
        const pivots = extractPivots(bars, ATR);
        expect(pivots.length).toBeLessThan(5);

        expect(classifyHeadAndShoulders(pivots, bars, ATR)).toEqual([]);
        expect(classifyInverseHeadAndShoulders(pivots, bars, ATR)).toEqual([]);
    });

    it('어깨 차이가 정확히 HS_SHOULDER_TOLERANCE * height 이면 감지한다 (느슨한 경계)', () => {
        // LS=15, head=20, RS=18.5 → |LS-RS|=3.5 == 0.35 * (head-neckline=10).
        const bars = makeHLBars([
            [10, 10], // seed
            [15, 15], // LS candidate high
            [10, 10], // confirms LS@1
            [20, 20], // head candidate high
            [10, 10], // confirms L1@2, head candidate continues
            [18.5, 18.5], // RS candidate high
            [10, 10], // confirms L2@4, then RS@5
        ]);
        const pivots = extractPivots(bars, ATR);
        expect(pivots).toEqual([
            { index: 1, price: 15, kind: 'high' },
            { index: 2, price: 10, kind: 'low' },
            { index: 3, price: 20, kind: 'high' },
            { index: 4, price: 10, kind: 'low' },
            { index: 5, price: 18.5, kind: 'high' },
        ]);

        const candidates = classifyHeadAndShoulders(pivots, bars, ATR);

        expect(candidates).toEqual([
            { id: 'head_and_shoulders', startIndex: 1, endIndex: 5 },
        ]);
    });

    it('head_and_shoulders: atr가 0 이하이면 감지하지 않는다', () => {
        const bars = makeBars([10, 15, 10, 20, 10, 15, 10]);
        const pivots = extractPivots(bars, ATR);
        expect(classifyHeadAndShoulders(pivots, bars, 0)).toEqual([]);
        expect(classifyHeadAndShoulders(pivots, bars, -1)).toEqual([]);
    });

    it('inverse_head_and_shoulders: atr가 0 이하이면 감지하지 않는다', () => {
        const bars = makeBars([20, 15, 20, 10, 20, 15, 20]);
        const pivots = extractPivots(bars, ATR);
        expect(classifyInverseHeadAndShoulders(pivots, bars, 0)).toEqual([]);
        expect(classifyInverseHeadAndShoulders(pivots, bars, -1)).toEqual([]);
    });

    it('head_and_shoulders: 오른쪽 어깨 이후 피벗이 하나 더 생겨도 (-6,-1) 윈도우로 재시도해 감지한다', () => {
        // 6 pivots: [LS=15, m1=10, head=20, m2=10, RS=15, extra=10]. The last-5
        // window ([m1..extra] = low/high/low/high/low) does not start with a
        // peak, so it fails; the classifier falls back to pivots.slice(-6,-1)
        // (the original [LS..RS]), which is a valid head & shoulders.
        const bars = makeAlternatingPivotBars(10, [15, 10, 20, 10, 15, 10], 15);
        const pivots = extractPivots(bars, ATR);
        expect(pivots).toHaveLength(6);

        const lastFive = pivots.slice(-5);
        expect(classifyHeadAndShoulders(lastFive, bars, ATR)).toEqual([]);

        const candidates = classifyHeadAndShoulders(pivots, bars, ATR);

        expect(candidates).toEqual([
            { id: 'head_and_shoulders', startIndex: 1, endIndex: 5 },
        ]);
    });

    it('inverse_head_and_shoulders: 오른쪽 어깨 이후 피벗이 하나 더 생겨도 (-6,-1) 윈도우로 재시도해 감지한다', () => {
        // 6 pivots: [LS=10, m1=15, head=5, m2=15, RS=10, extra=15]. The last-5
        // window ([m1..extra] = high/low/high/low/high) does not start with a
        // peak (low), so it fails; the classifier falls back to
        // pivots.slice(-6,-1) (the original [LS..RS]), which is a valid
        // inverse head & shoulders.
        const bars = makeAlternatingPivotBars(15, [10, 15, 5, 15, 10, 15], 10);
        const pivots = extractPivots(bars, ATR);
        expect(pivots).toHaveLength(6);

        const lastFive = pivots.slice(-5);
        expect(classifyInverseHeadAndShoulders(lastFive, bars, ATR)).toEqual(
            []
        );

        const candidates = classifyInverseHeadAndShoulders(pivots, bars, ATR);

        expect(candidates).toEqual([
            { id: 'inverse_head_and_shoulders', startIndex: 1, endIndex: 5 },
        ]);
    });
});

describe('classifyTrendlinePatterns', () => {
    // Each case is [seed, targets (alternating high/low from index 1), closer]
    // — see makeAlternatingPivotBars. Produces exactly 2 highs + 2 lows,
    // classified by the flat/rising/falling table.
    const cases: Array<{
        name: string;
        seed: number;
        targets: number[];
        closer: number;
        expectedId: string;
    }> = [
        {
            name: 'ascending_triangle: 고점 평평 + 저점 상승',
            seed: 10,
            targets: [20, 10, 20, 12],
            closer: 20,
            expectedId: 'ascending_triangle',
        },
        {
            name: 'descending_triangle: 고점 하락 + 저점 평평',
            seed: 10,
            targets: [20, 10, 18, 10],
            closer: 20,
            expectedId: 'descending_triangle',
        },
        {
            name: 'symmetrical_triangle: 고점 하락 + 저점 상승 (수렴)',
            seed: 10,
            targets: [20, 5, 18, 7],
            closer: 20,
            expectedId: 'symmetrical_triangle',
        },
        {
            name: 'ascending_wedge: 둘 다 상승, 저점 기울기가 고점보다 가파름',
            seed: 10,
            targets: [20, 5, 22, 10],
            closer: 25,
            expectedId: 'ascending_wedge',
        },
        {
            name: 'descending_wedge: 둘 다 하락, 고점 기울기가 저점보다 가파름',
            seed: 10,
            targets: [20, 5, 15, 3],
            closer: 20,
            expectedId: 'descending_wedge',
        },
        {
            name: 'rectangle: 고점/저점 모두 평평',
            seed: 10,
            targets: [20, 5, 20, 5],
            closer: 20,
            expectedId: 'rectangle',
        },
    ];

    it.each(cases)('$name', ({ seed, targets, closer, expectedId }) => {
        const bars = makeAlternatingPivotBars(seed, targets, closer);
        const pivots = extractPivots(bars, ATR);
        expect(pivots.filter(p => p.kind === 'high')).toHaveLength(2);
        expect(pivots.filter(p => p.kind === 'low')).toHaveLength(2);

        const candidates = classifyTrendlinePatterns(pivots, bars, ATR);

        expect(candidates).toHaveLength(1);
        expect(candidates[0].id).toBe(expectedId);
        expect(candidates[0].startIndex).toBeLessThan(candidates[0].endIndex);
    });

    it('고점/저점이 둘 다 상승하지만 기울기가 같으면(쐐기 조건 미충족) 감지하지 않는다', () => {
        // sH === sL (both rising by the same rate) matches no row in the
        // table: not a wedge (needs sL > sH), not flat/falling anywhere.
        const bars = makeAlternatingPivotBars(10, [20, 5, 22, 7], 25);
        const pivots = extractPivots(bars, ATR);

        expect(classifyTrendlinePatterns(pivots, bars, ATR)).toEqual([]);
    });

    it('기울기가 정확히 FLAT_SLOPE_ATR_PER_BAR 이면 flat으로 판정한다 (느슨한 경계)', () => {
        // atr=20 makes the normalized slope land bit-exactly on 0.05 (1/20)
        // for both highs and lows — the inclusive boundary of "flat".
        const atr = 20;
        const bars = makeAlternatingPivotBars(0, [100, 0, 102, 2], 100);
        const pivots = extractPivots(bars, atr);

        const candidates = classifyTrendlinePatterns(pivots, bars, atr);

        expect(candidates).toEqual([
            { id: 'rectangle', startIndex: 1, endIndex: 4 },
        ]);
    });

    it('고점 또는 저점이 2개 미만이면 감지하지 않는다', () => {
        const bars = makeBars([10, 15, 10]);
        const pivots = extractPivots(bars, ATR);
        expect(pivots).toHaveLength(1);

        expect(classifyTrendlinePatterns(pivots, bars, ATR)).toEqual([]);
    });

    it('atr가 0 이하이면 감지하지 않는다', () => {
        const bars = makeAlternatingPivotBars(10, [20, 5, 20, 5], 20);
        const pivots = extractPivots(bars, ATR);
        expect(classifyTrendlinePatterns(pivots, bars, 0)).toEqual([]);
    });
});

describe('classifyFlagsAndPennants', () => {
    it('bull_flag: 큰 상승 폴 뒤에 좁고 완만히 눕는 조정이 오면 감지한다', () => {
        // Pole: closes 90 -> 109 over 20 bars (idx 0-19, +19 move, well past
        // FLAG_POLE_MIN_ATR*atr=3). Consolidation: idx19-25 drifts down
        // gently from the peak, channel range=2 (<= FLAG_CHANNEL_MAX_RANGE_ATR).
        const poleCloses = Array.from({ length: 20 }, (_, i) => 90 + i);
        const driftCloses = [107.6, 107.5, 107.4, 107.3, 107.2, 107.1];
        const bars = makeBars([...poleCloses, ...driftCloses]);
        const pivots = extractPivots(bars, ATR, { includeProvisional: true });

        const candidates = classifyFlagsAndPennants(pivots, bars, ATR);

        expect(candidates).toEqual([
            { id: 'bull_flag', startIndex: 19, endIndex: 25 },
        ]);
    });

    it('bear_flag: 큰 하락 폴 뒤에 좁고 완만히 눕는 반등이 오면 감지한다', () => {
        // Mirror of the bull_flag case: pole 109 -> 90, then a gentle
        // up-drift consolidation.
        const poleValues = Array.from({ length: 20 }, (_, i) => 109 - i);
        const driftValues = [91.5, 91.6, 91.7, 91.8, 91.9, 92.0];
        const bars = makeHLBars(
            [...poleValues, ...driftValues].map(v => [v, v])
        );
        const pivots = extractPivots(bars, ATR, { includeProvisional: true });

        const candidates = classifyFlagsAndPennants(pivots, bars, ATR);

        expect(candidates).toEqual([
            { id: 'bear_flag', startIndex: 19, endIndex: 25 },
        ]);
    });

    it('pennant: 폴 뒤 저점이 상승하며 고점이 평평하게 수렴하면 bull_flag와 함께 감지한다 (경계값 range=3)', () => {
        // Pole 90 -> 109 (idx0-19), then a tight high-flat/low-rising
        // consolidation (idx19-22): highs pinned at 109 (flat), lows rising
        // 106 -> 107. Not mutually exclusive with bull_flag by design — the
        // same flat-or-down consolidation also satisfies bull_flag. Channel
        // range is exactly 3 (== FLAG_CHANNEL_MAX_RANGE_ATR * atr), exercising
        // the inclusive boundary.
        const poleValues = Array.from({ length: 20 }, (_, i) => 90 + i);
        const consolidationValues = [106, 109, 107];
        const bars = makeHLBars(
            [...poleValues, ...consolidationValues].map(v => [v, v])
        );
        const pivots = extractPivots(bars, ATR, { includeProvisional: true });

        const candidates = classifyFlagsAndPennants(pivots, bars, ATR);

        expect(candidates).toEqual([
            { id: 'bull_flag', startIndex: 19, endIndex: 22 },
            { id: 'pennant', startIndex: 19, endIndex: 22 },
        ]);
    });

    it('폴 이동이 FLAG_POLE_MIN_ATR * atr 미만이면 감지하지 않는다', () => {
        // Pole only moves 2 (< FLAG_POLE_MIN_ATR(3) * atr(1)).
        const poleValues = Array.from(
            { length: 20 },
            (_, i) => 90 + (2 * i) / 19
        );
        const bars = makeHLBars([...poleValues, 90].map(v => [v, v]));
        const pivots = extractPivots(bars, ATR, { includeProvisional: true });

        expect(classifyFlagsAndPennants(pivots, bars, ATR)).toEqual([]);
    });

    it('atr가 0 이하이면 감지하지 않는다', () => {
        const poleCloses = Array.from({ length: 20 }, (_, i) => 90 + i);
        const driftCloses = [107.6, 107.5, 107.4, 107.3, 107.2, 107.1];
        const bars = makeBars([...poleCloses, ...driftCloses]);
        const pivots = extractPivots(bars, ATR, { includeProvisional: true });

        expect(classifyFlagsAndPennants(pivots, bars, 0)).toEqual([]);
    });
});

describe('classifyCurvaturePatterns', () => {
    it('rounding_bottom: 저점 4개가 U자형(convex)이고 정점이 중앙 절반에 있으면 감지한다', () => {
        // Low pivots at (2,10),(4,4),(6,2),(8,9) — a convex U with its
        // vertex inside the middle half of [2,8] and depth (10-2=8) well
        // past ROUNDING_BOTTOM_MIN_DEPTH_ATR_MULT(2) * atr.
        const bars = makeAlternatingPivotBars(
            15,
            [20, 10, 20, 4, 20, 2, 20, 9],
            20
        );
        const pivots = extractPivots(bars, ATR, { includeProvisional: true });
        const lows = pivots.filter(p => p.kind === 'low');
        expect(lows).toHaveLength(4);

        const candidates = classifyCurvaturePatterns(pivots, bars, ATR);

        expect(candidates).toEqual([
            { id: 'rounding_bottom', startIndex: 2, endIndex: 8 },
        ]);
    });

    it('cup_and_handle: 컵(저점 4개) 뒤에 얕은 되돌림 저점이 하나 더 있으면 cup_and_handle만 감지한다', () => {
        // Same cup as the rounding_bottom case, plus a 5th (provisional)
        // low at 7 — a shallow pullback from the cup's right-edge low (9):
        // handleDepth=2 <= CUP_HANDLE_MAX_DEPTH_RATIO(0.5) * cup depth(8)=4.
        // Only cup_and_handle should be emitted, not a redundant
        // rounding_bottom.
        const bars = makeHLBars(
            [15, 20, 10, 20, 4, 20, 2, 20, 9, 20, 7].map(v => [v, v])
        );
        const pivots = extractPivots(bars, ATR, { includeProvisional: true });
        const lows = pivots.filter(p => p.kind === 'low');
        expect(lows).toHaveLength(5);

        const candidates = classifyCurvaturePatterns(pivots, bars, ATR);

        expect(candidates).toEqual([
            { id: 'cup_and_handle', startIndex: 2, endIndex: 10 },
        ]);
    });

    it('컵 깊이가 정확히 ROUNDING_BOTTOM_MIN_DEPTH_ATR_MULT * atr 이면 감지한다 (느슨한 경계)', () => {
        // Same U-shape as the textbook case, scaled so rim(4) - bottom(2)
        // = 2 exactly, matching 2 * atr(1).
        const bars = makeAlternatingPivotBars(
            15,
            [20, 4, 20, 2.5, 20, 2, 20, 3.75],
            20
        );
        const pivots = extractPivots(bars, ATR, { includeProvisional: true });

        const candidates = classifyCurvaturePatterns(pivots, bars, ATR);

        expect(candidates).toEqual([
            { id: 'rounding_bottom', startIndex: 2, endIndex: 8 },
        ]);
    });

    it('저점이 단조 하락(오목/직선)이면 감지하지 않는다', () => {
        // Lows 10 -> 7 -> 4 -> 1: collinear, so the quadratic fit's `a`
        // coefficient is <= 0 (not convex) — no rounding bottom.
        const bars = makeAlternatingPivotBars(
            15,
            [20, 10, 20, 7, 20, 4, 20, 1],
            20
        );
        const pivots = extractPivots(bars, ATR, { includeProvisional: true });

        expect(classifyCurvaturePatterns(pivots, bars, ATR)).toEqual([]);
    });

    it('저점이 4개 미만이면 감지하지 않는다', () => {
        const bars = makeAlternatingPivotBars(15, [20, 10, 20, 4], 20);
        const pivots = extractPivots(bars, ATR, { includeProvisional: true });
        const lows = pivots.filter(p => p.kind === 'low');
        expect(lows.length).toBeLessThan(4);

        expect(classifyCurvaturePatterns(pivots, bars, ATR)).toEqual([]);
    });

    it('atr가 0 이하이면 감지하지 않는다', () => {
        const bars = makeAlternatingPivotBars(
            15,
            [20, 10, 20, 4, 20, 2, 20, 9],
            20
        );
        const pivots = extractPivots(bars, ATR, { includeProvisional: true });

        expect(classifyCurvaturePatterns(pivots, bars, 0)).toEqual([]);
    });
});
