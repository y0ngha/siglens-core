import { describe, it, expect } from 'vitest';
import { extractPivots } from '@/domain/patterns/pivots';
import {
    classifyDoubleTripleTop,
    classifyDoubleTripleBottom,
    classifyHeadAndShoulders,
    classifyInverseHeadAndShoulders,
    classifyTrendlinePatterns,
    classifyFlagsAndPennants,
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
