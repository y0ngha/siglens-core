import { describe, it, expect } from 'vitest';
import type { PivotPoint } from '@/domain/types';
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
import {
    CHANNEL_PARALLEL_ATR_PER_BAR,
    EXTREME_MATCH_ATR_MULT,
    FLAG_CONSOLIDATION_MAX_BARS,
    HTF_FLAG_MIN_BARS,
    HTF_POLE_MAX_BARS,
} from '@/domain/patterns/constants';
import type { Bar, PatternCandidate } from '@/domain/types';

const ATR = 1;

/**
 * Drops each candidate's `pivots` (spec 2026-09-18 real-data fix —
 * classifiers now additively attach the pivots they matched, consumed by
 * `patternGeometry.ts`) so this file's id/startIndex/endIndex shape
 * assertions don't have to hand-author an exact pivot array per case.
 * `pivots` itself is covered by `patternGeometry.test.ts`.
 */
const stripPivots = (
    candidates: readonly PatternCandidate[]
): Omit<PatternCandidate, 'pivots'>[] =>
    candidates.map(({ pivots: _pivots, ...rest }) => rest);

describe('classifyDoubleTripleTop / classifyDoubleTripleBottom', () => {
    it('double_top: 두 고점이 근접하고 그 사이에 저점이 있으면 감지한다', () => {
        const bars = makeBars([10, 15, 11, 15.2, 11]);
        const pivots = extractPivots(bars, ATR);

        const candidates = classifyDoubleTripleTop(pivots, bars, ATR);

        expect(stripPivots(candidates)).toEqual([
            { id: 'double_top', startIndex: 1, endIndex: 3 },
        ]);
    });

    it('triple_top: 세 고점이 pairwise 근접하고 저점이 교대로 있으면 triple과 double을 모두 방출한다', () => {
        const bars = makeBars([10, 15, 11, 15.2, 11, 15.1, 11]);
        const pivots = extractPivots(bars, ATR);

        const candidates = classifyDoubleTripleTop(pivots, bars, ATR);

        expect(stripPivots(candidates)).toEqual([
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
        expect(Math.abs(highs[0].price - highs[1].price)).toBe(
            EXTREME_MATCH_ATR_MULT * ATR
        );

        const candidates = classifyDoubleTripleTop(pivots, bars, ATR);

        expect(stripPivots(candidates)).toEqual([
            { id: 'double_top', startIndex: 1, endIndex: 3 },
        ]);
    });

    it('double_bottom: 두 저점이 근접하고 그 사이에 고점이 있으면 감지한다', () => {
        const bars = makeBars([10, 5, 9, 4, 9]);
        const pivots = extractPivots(bars, ATR);

        const candidates = classifyDoubleTripleBottom(pivots, bars, ATR);

        expect(stripPivots(candidates)).toEqual([
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

        expect(stripPivots(candidates)).toEqual([
            { id: 'head_and_shoulders', startIndex: 1, endIndex: 5 },
        ]);
    });

    it('inverse_head_and_shoulders: 대칭 어깨 + 머리(저점)가 충분히 깊으면 감지한다', () => {
        const bars = makeBars([20, 15, 20, 10, 20, 15, 20]);
        const pivots = extractPivots(bars, ATR);
        expect(pivots).toHaveLength(5);

        const candidates = classifyInverseHeadAndShoulders(pivots, bars, ATR);

        expect(stripPivots(candidates)).toEqual([
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
        // LS=15, head=20, RS=18.5 → |LS-RS|=3.5 == HS_SHOULDER_TOLERANCE(0.35) * (head-neckline=10).
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

        expect(stripPivots(candidates)).toEqual([
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

        expect(stripPivots(candidates)).toEqual([
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

        expect(stripPivots(candidates)).toEqual([
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
        {
            name: 'ascending_channel: 둘 다 상승, 기울기가 같음(평행)',
            seed: 10,
            targets: [20, 5, 22, 7],
            closer: 25,
            expectedId: 'ascending_channel',
        },
        {
            name: 'descending_channel: 둘 다 하락, 기울기가 같음(평행)',
            seed: 10,
            targets: [20, 5, 18, 3],
            closer: 20,
            expectedId: 'descending_channel',
        },
        {
            name: 'broadening_formation: 고점 상승 + 저점 하락 (확산)',
            seed: 10,
            targets: [20, 5, 22, 3],
            closer: 25,
            expectedId: 'broadening_formation',
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

    it('고점/저점이 둘 다 상승하지만 고점이 더 가파르면(확산) 감지하지 않는다', () => {
        // sH = 2 > sL = 0.5: neither parallel (channel) nor converging
        // (wedge) — no row in the table matches.
        const bars = makeAlternatingPivotBars(10, [20, 5, 24, 6], 25);
        const pivots = extractPivots(bars, ATR);

        expect(classifyTrendlinePatterns(pivots, bars, ATR)).toEqual([]);
    });

    // sH = 1 (highs 20 -> 22) / -1 (highs 20 -> 18); the second low sets
    // sL = sH + offset, landing just inside or just past
    // CHANNEL_PARALLEL_ATR_PER_BAR (0.02) at atr = 1.
    it.each([
        {
            name: '상승: 기울기 차 0.019 (≤ tol) → ascending_channel',
            targets: [20, 5, 22, 7.038],
            closer: 25,
            expectedId: 'ascending_channel',
        },
        {
            name: '상승: 기울기 차 0.021 (> tol) → ascending_wedge',
            targets: [20, 5, 22, 7.042],
            closer: 25,
            expectedId: 'ascending_wedge',
        },
        {
            name: '하락: 기울기 차 0.019 (≤ tol) → descending_channel',
            targets: [20, 5, 18, 3.038],
            closer: 20,
            expectedId: 'descending_channel',
        },
        {
            name: '하락: 기울기 차 0.021 (> tol) → descending_wedge',
            targets: [20, 5, 18, 3.042],
            closer: 20,
            expectedId: 'descending_wedge',
        },
    ])('채널/쐐기 경계 — $name', ({ targets, closer, expectedId }) => {
        expect(CHANNEL_PARALLEL_ATR_PER_BAR).toBe(0.02);
        const bars = makeAlternatingPivotBars(10, targets, closer);
        const pivots = extractPivots(bars, ATR);

        const candidates = classifyTrendlinePatterns(pivots, bars, ATR);

        expect(candidates.map(c => c.id)).toEqual([expectedId]);
    });

    it('기울기가 정확히 FLAT_SLOPE_ATR_PER_BAR 이면 flat으로 판정한다 (느슨한 경계)', () => {
        // atr=20 makes the normalized slope land bit-exactly on
        // FLAT_SLOPE_ATR_PER_BAR(0.05) (1/20) for both highs and lows — the
        // inclusive boundary of "flat".
        const atr = 20;
        const bars = makeAlternatingPivotBars(0, [100, 0, 102, 2], 100);
        const pivots = extractPivots(bars, atr);

        const candidates = classifyTrendlinePatterns(pivots, bars, atr);

        expect(stripPivots(candidates)).toEqual([
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

        expect(stripPivots(candidates)).toEqual([
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

        expect(stripPivots(candidates)).toEqual([
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

        expect(stripPivots(candidates)).toEqual([
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

    it('피벗이 0~1개뿐이면(평탄한 시세) 감지하지 않는다 (pivots.length < 2)', () => {
        // A perfectly flat close series never retraces far enough to
        // establish a swing direction, so extractPivots yields 0 pivots
        // (even with includeProvisional) — buildFlagContext's
        // `pivots.length < 2` guard rejects before touching bars.
        const bars = makeBars(Array.from({ length: 10 }, () => 100));
        const pivots = extractPivots(bars, ATR, { includeProvisional: true });
        expect(pivots).toHaveLength(0);

        expect(classifyFlagsAndPennants(pivots, bars, ATR)).toEqual([]);
    });

    it('consolidation 구간이 FLAG_CONSOLIDATION_MAX_BARS(30)를 초과하면 감지하지 않는다', () => {
        // The last TRENDLINE_PIVOT_WINDOW(8) pivots span index 0 -> 35 (36
        // bars), past FLAG_CONSOLIDATION_MAX_BARS(30) — rejected regardless
        // of pole/channel geometry, which is never reached.
        const pivots: PivotPoint[] = Array.from({ length: 8 }, (_, i) => ({
            index: i * 5,
            price: i % 2 === 0 ? 20 : 10,
            kind: i % 2 === 0 ? 'high' : 'low',
        }));
        const bars = makeBars(Array.from({ length: 40 }, () => 15));

        expect(classifyFlagsAndPennants(pivots, bars, ATR)).toEqual([]);
    });

    it('consolidation이 bar 0 근처에서 시작해 pole을 위한 여유가 없으면 감지하지 않는다 (poleStartIndex >= consolidationStartIndex)', () => {
        // Only 2 pivots, the first at index 0 — consolidationStartIndex is 0,
        // so poleStartIndex (max(0, 0 - FLAG_POLE_LOOKBACK_BARS) = 0) is not
        // strictly before it. There is no room for a preceding pole.
        const pivots: PivotPoint[] = [
            { index: 0, price: 20, kind: 'high' },
            { index: 5, price: 10, kind: 'low' },
        ];
        const bars = makeBars(Array.from({ length: 10 }, () => 15));

        expect(classifyFlagsAndPennants(pivots, bars, ATR)).toEqual([]);
    });

    it('consolidation 채널 높이가 FLAG_CHANNEL_MAX_RANGE_ATR(3) * atr를 초과하면 감지하지 않는다 (경계값 초과, reject 방향)', () => {
        // Same pole as the pennant boundary-pass test (90 -> 109 over 20
        // bars), but the consolidation swings 106 -> 110 -> 106: channel
        // range = 4, past FLAG_CHANNEL_MAX_RANGE_ATR(3) * atr(1) = 3 — the
        // exact boundary is covered by the existing range=3 pass test above,
        // this is the reject side just past it.
        const poleValues = Array.from({ length: 20 }, (_, i) => 90 + i);
        const consolidationValues = [106, 110, 106];
        const bars = makeHLBars(
            [...poleValues, ...consolidationValues].map(v => [v, v])
        );
        const pivots = extractPivots(bars, ATR, { includeProvisional: true });

        expect(classifyFlagsAndPennants(pivots, bars, ATR)).toEqual([]);
    });

    it('pivots가 오름차순 index 불변식을 어기면 consolidationLength < 2 방어 분기에서 거부한다', () => {
        // extractPivots always yields strictly-ascending indices, so this
        // synthetic (descending-index) pivots array is impossible via any
        // real call path — but PivotPoint's type does not enforce ordering,
        // so it is type-valid input to the exported classifyFlagsAndPennants.
        // window = pivots.slice(-8) keeps both entries (window.length === 2,
        // clears the `window.length < 2` guard), but with
        // consolidationStartIndex=5 > consolidationEndIndex=3,
        // consolidationLength = 3 - 5 + 1 = -1, which is specifically the
        // `consolidationLength < 2` half of the guard (not the
        // `> FLAG_CONSOLIDATION_MAX_BARS` half, and not the
        // `consolidationBars.length === 0` guard further down, since this
        // guard returns null before that line is reached).
        const pivots: PivotPoint[] = [
            { index: 5, price: 10, kind: 'high' },
            { index: 3, price: 8, kind: 'low' },
        ];
        const bars = makeBars(Array.from({ length: 10 }, () => 100));

        expect(classifyFlagsAndPennants(pivots, bars, ATR)).toEqual([]);
    });
});

describe('classifyFlagsAndPennants — high_tight_flag', () => {
    /**
     * Pole: `poleBars + 1` point bars (high = low) rising linearly from
     * `base` (index 0) to `peak` (index `poleBars`), then explicit
     * [high, low] flag bars.
     */
    function htfBars(
        base: number,
        peak: number,
        poleBars: number,
        flag: Array<[high: number, low: number]>
    ): Bar[] {
        const pole = Array.from(
            { length: poleBars + 1 },
            (_, i): [number, number] => {
                const price = base + ((peak - base) * i) / poleBars;
                return [price, price];
            }
        );
        return makeHLBars([...pole, ...flag]);
    }

    const classify = (bars: Bar[]) =>
        classifyFlagsAndPennants(
            extractPivots(bars, ATR, { includeProvisional: true }),
            bars,
            ATR
        );
    const ids = (bars: Bar[]) => classify(bars).map(c => c.id);

    it('90%+ 폴 뒤 25% 이내로 조정하는 깃발이면 high_tight_flag를 폴 기저~마지막 봉 구간으로 방출한다', () => {
        const bars = htfBars(100, 200, 20, [
            [195, 185],
            [190, 175],
            [188, 170],
            [185, 172],
        ]);

        expect(classify(bars)).toEqual([
            {
                id: 'high_tight_flag',
                startIndex: 0,
                endIndex: 24,
                pivots: [
                    { index: 0, price: 100, kind: 'low' },
                    { index: 20, price: 200, kind: 'high' },
                ],
            },
        ]);
    });

    it('같은 구간이 bull_flag에도 맞으면 high_tight_flag만 방출한다', () => {
        // Same tight drift as the bull_flag case above, but the pole starts
        // at 50 instead of 90: 50 -> 109 is a 118% run, so the bull_flag this
        // geometry otherwise produces is replaced by high_tight_flag.
        const poleCloses = Array.from(
            { length: 20 },
            (_, i) => 50 + (59 * i) / 19
        );
        const driftCloses = [107.6, 107.5, 107.4, 107.3, 107.2, 107.1];
        const bars = makeBars([...poleCloses, ...driftCloses]);

        expect(ids(bars)).toEqual(['high_tight_flag']);
    });

    it.each([
        { name: '상승률 정확히 90% → 방출', peak: 190, expected: true },
        { name: '상승률 90% 미만 → 미방출', peak: 189.9, expected: false },
    ])('폴 상승률 경계 — $name', ({ peak, expected }) => {
        const bars = htfBars(100, peak, 20, [
            [185, 180],
            [184, 178],
            [186, 181],
        ]);
        expect(ids(bars).includes('high_tight_flag')).toBe(expected);
    });

    it.each([
        { name: '조정 정확히 25% → 방출', flagLow: 150, expected: true },
        { name: '조정 25% 초과 → 미방출', flagLow: 149.9, expected: false },
    ])('깃발 조정 경계 — $name', ({ flagLow, expected }) => {
        const bars = htfBars(100, 200, 20, [
            [195, 180],
            [190, flagLow],
            [192, 170],
        ]);
        expect(ids(bars).includes('high_tight_flag')).toBe(expected);
    });

    it.each([
        {
            name: `폴 ${HTF_POLE_MAX_BARS}봉 → 방출`,
            poleBars: HTF_POLE_MAX_BARS,
            expected: true,
        },
        {
            // The base slides one bar outside the window; the lowest low left
            // inside it (≈102.2) no longer supports a 90% run to 190.
            name: `폴 ${HTF_POLE_MAX_BARS + 1}봉 → 미방출`,
            poleBars: HTF_POLE_MAX_BARS + 1,
            expected: false,
        },
    ])('폴 길이 경계 — $name', ({ poleBars, expected }) => {
        const bars = htfBars(100, 190, poleBars, [
            [185, 180],
            [184, 178],
            [186, 181],
        ]);
        expect(ids(bars).includes('high_tight_flag')).toBe(expected);
    });

    it('폴 기저 저가가 0 이하이면(상승률 계산 불가) 방출하지 않는다', () => {
        const bars = htfBars(0, 200, 20, [
            [195, 185],
            [190, 175],
            [188, 170],
        ]);
        expect(ids(bars)).not.toContain('high_tight_flag');
    });

    it('atr가 0 이하이면 high_tight_flag 조건을 만족해도 방출하지 않는다', () => {
        const bars = htfBars(100, 200, 20, [
            [195, 185],
            [190, 175],
            [188, 170],
        ]);
        const pivots = extractPivots(bars, ATR, { includeProvisional: true });
        expect(classifyFlagsAndPennants(pivots, bars, 0)).toEqual([]);
    });

    it(`고점 뒤 봉이 HTF_FLAG_MIN_BARS(${HTF_FLAG_MIN_BARS})개 미만이면 방출하지 않는다`, () => {
        const bars = htfBars(100, 200, 20, [
            [195, 185],
            [190, 175],
        ]);
        expect(ids(bars)).not.toContain('high_tight_flag');
    });

    it(`고점이 마지막 FLAG_CONSOLIDATION_MAX_BARS(${FLAG_CONSOLIDATION_MAX_BARS})봉 창보다 오래되면(깃발이 너무 길면) 방출하지 않는다`, () => {
        // The real top (200) sits 31 bars before the last bar; the highest
        // bar inside the trailing window (199) has that higher top in its
        // own pole lookback, so it is not a pole top.
        const flag: Array<[number, number]> = Array.from(
            { length: FLAG_CONSOLIDATION_MAX_BARS + 1 },
            (_, i) => (i === 5 ? [199, 185] : [190, 180])
        );
        const bars = htfBars(100, 200, 20, flag);
        expect(ids(bars)).not.toContain('high_tight_flag');
    });
});

describe('classifyCurvaturePatterns', () => {
    it('rounding_bottom: 저점 4개가 U자형(convex)이고 정점이 중앙 절반에 있으면 감지한다', () => {
        // Low pivots at (2,10),(4,4),(6,2),(8,9) — a convex U with its
        // vertex inside the middle half of [2,8] and depth (10-2=8) well
        // past ROUNDING_MIN_DEPTH_ATR_MULT(2) * atr.
        const bars = makeAlternatingPivotBars(
            15,
            [20, 10, 20, 4, 20, 2, 20, 9],
            20
        );
        const pivots = extractPivots(bars, ATR, { includeProvisional: true });
        const lows = pivots.filter(p => p.kind === 'low');
        expect(lows).toHaveLength(4);

        const candidates = classifyCurvaturePatterns(pivots, bars, ATR);

        expect(stripPivots(candidates)).toEqual([
            { id: 'rounding_bottom', startIndex: 2, endIndex: 8 },
        ]);
    });

    it('cup_and_handle: 컵(저점 4개) 뒤에 얕은 되돌림 저점이 하나 더 있으면 cup_and_handle만 감지한다', () => {
        // Same cup as the rounding_bottom case, plus a 5th (provisional)
        // low at 7 — in the cup's upper half: 7 >= cup lows' top (10) −
        // CUP_HANDLE_MAX_DEPTH_RATIO(0.5) * cup depth(8) = 6.
        // Only cup_and_handle should be emitted, not a redundant
        // rounding_bottom.
        const bars = makeHLBars(
            [15, 20, 10, 20, 4, 20, 2, 20, 9, 20, 7].map(v => [v, v])
        );
        const pivots = extractPivots(bars, ATR, { includeProvisional: true });
        const lows = pivots.filter(p => p.kind === 'low');
        expect(lows).toHaveLength(5);

        const candidates = classifyCurvaturePatterns(pivots, bars, ATR);

        expect(stripPivots(candidates)).toEqual([
            { id: 'cup_and_handle', startIndex: 2, endIndex: 10 },
        ]);
    });

    it('컵 깊이가 정확히 ROUNDING_MIN_DEPTH_ATR_MULT * atr 이면 감지한다 (느슨한 경계)', () => {
        // Same U-shape as the textbook case, scaled so rim(4) - bottom(2)
        // = 2 exactly, matching 2 * atr(1).
        const bars = makeAlternatingPivotBars(
            15,
            [20, 4, 20, 2.5, 20, 2, 20, 3.75],
            20
        );
        const pivots = extractPivots(bars, ATR, { includeProvisional: true });

        const candidates = classifyCurvaturePatterns(pivots, bars, ATR);

        expect(stripPivots(candidates)).toEqual([
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

    it('저점 index가 특이(singular) 행렬을 만들면 solve3x3이 null을 반환해 감지하지 않는다', () => {
        // extractPivots always yields strictly-ascending, distinct indices,
        // so duplicate-index lows are impossible via any real call path —
        // but PivotPoint's type does not enforce distinctness, so this is
        // type-valid synthetic input to the exported classifyCurvaturePatterns
        // (same technique as the descending-index defensive test above, for
        // classifyFlagsAndPennants).
        //
        // Only 2 distinct x-values (2 and 8, each repeated) among the 4 lows
        // collapse the quadratic normal-equations matrix's rank to <= 2,
        // making its determinant exactly 0 — this is the singular-matrix
        // guard inside solve3x3 (`Math.abs(determinant) <
        // SINGULAR_MATRIX_DET_EPSILON`), which the collinear-points case
        // above does NOT exercise (collinear points with distinct x still
        // yield a non-singular system; that case instead rejects on
        // `fit.a <= 0`). Here fitQuadratic/fitRoundingBottom must return
        // null from the singular guard itself, not a NaN/Infinity fit.
        const pivots: PivotPoint[] = [
            { index: 2, price: 10, kind: 'low' },
            { index: 2, price: 4, kind: 'low' },
            { index: 8, price: 2, kind: 'low' },
            { index: 8, price: 9, kind: 'low' },
        ];
        const bars = makeBars(Array.from({ length: 10 }, () => 100));

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

    it('정점(vertex)이 구간 중앙 절반 밖(edge-hugging arc)이면 rounding_bottom을 감지하지 않는다', () => {
        // Lows at (2,15.8),(4,9.8),(6,6.2),(8,5) lie exactly on the convex
        // parabola y = 0.3*(x-8)^2 + 5 — a>0, but its vertex sits at x=8, the
        // right EDGE of the [2,8] span, outside the required middle-half
        // window [3.5, 6.5]. Depth (15.8-5=10.8) is well past the minimum,
        // so this rejects on the vertex check specifically, not depth.
        const bars = makeAlternatingPivotBars(
            15,
            [20, 15.8, 20, 9.8, 20, 6.2, 20, 5],
            20
        );
        const pivots = extractPivots(bars, ATR, { includeProvisional: true });
        const lows = pivots.filter(p => p.kind === 'low');
        expect(lows).toHaveLength(4);

        expect(classifyCurvaturePatterns(pivots, bars, ATR)).toEqual([]);
    });

    it('컵 깊이가 ROUNDING_MIN_DEPTH_ATR_MULT * atr 미만이면 rounding_bottom을 감지하지 않는다', () => {
        // Lows at (2,10.45),(4,10.05),(6,10.05),(8,10.45) lie exactly on the
        // shallow convex parabola y = 0.05*(x-5)^2 + 10 — vertex at x=5 sits
        // well inside the middle-half window [3.5, 6.5], but depth
        // (10.45-10.05=0.4) is below ROUNDING_MIN_DEPTH_ATR_MULT(2) *
        // atr(1) = 2. Rejects on the depth check specifically, not vertex.
        const bars = makeAlternatingPivotBars(
            15,
            [20, 10.45, 20, 10.05, 20, 10.05, 20, 10.45],
            20
        );
        const pivots = extractPivots(bars, ATR, { includeProvisional: true });
        const lows = pivots.filter(p => p.kind === 'low');
        expect(lows).toHaveLength(4);

        expect(classifyCurvaturePatterns(pivots, bars, ATR)).toEqual([]);
    });

    it('핸들 저점이 컵의 마지막 저점보다 높아도 컵 상단 절반에 있으면 cup_and_handle이다 (spec 2026-10-07 §3.6 규칙 반전 수정)', () => {
        // Same cup as the textbook rounding_bottom case (lows at
        // (2,10),(4,4),(6,2),(8,9)), plus a 5th low at 15 — ABOVE the cup's
        // right-edge low (9). A real handle forms in the cup's upper half,
        // which usually puts it above the cup's last low; the old rule
        // required it below that low and rejected exactly this shape.
        const bars = makeHLBars(
            [15, 20, 10, 20, 4, 20, 2, 20, 9, 20, 15].map(v => [v, v])
        );
        const pivots = extractPivots(bars, ATR, { includeProvisional: true });
        const lows = pivots.filter(p => p.kind === 'low');
        expect(lows).toHaveLength(5);

        const candidates = classifyCurvaturePatterns(pivots, bars, ATR);

        expect(stripPivots(candidates)).toEqual([
            { id: 'cup_and_handle', startIndex: 2, endIndex: 10 },
        ]);
    });

    it('핸들 저점이 정확히 컵 중간값이면 cup_and_handle이다 (포함 경계)', () => {
        // Cup lows 10, 4, 2, 9: top 10, depth 8 → midpoint 10 − 0.5·8 = 6.
        const bars = makeHLBars(
            [15, 20, 10, 20, 4, 20, 2, 20, 9, 20, 6].map(v => [v, v])
        );
        const pivots = extractPivots(bars, ATR, { includeProvisional: true });

        expect(
            classifyCurvaturePatterns(pivots, bars, ATR).map(c => c.id)
        ).toContain('cup_and_handle');
    });

    it('핸들 저점이 컵 중간값보다 조금이라도 낮으면 cup_and_handle이 아니다', () => {
        const bars = makeHLBars(
            [15, 20, 10, 20, 4, 20, 2, 20, 9, 20, 5.9].map(v => [v, v])
        );
        const pivots = extractPivots(bars, ATR, { includeProvisional: true });

        expect(
            classifyCurvaturePatterns(pivots, bars, ATR).map(c => c.id)
        ).not.toContain('cup_and_handle');
    });

    it('핸들 저점이 컵 중간값(CUP_HANDLE_MAX_DEPTH_RATIO)보다 깊으면 cup_and_handle 대신 rounding_bottom으로 폴백한다', () => {
        // Same cup as the textbook case (cup lows' top 10, depth 8 → midpoint
        // 6), but the 5th low pulls back to 3 — below the midpoint, too deep
        // to be a handle. Falls back to a plain rounding_bottom fit over all
        // 5 lows instead of cup_and_handle.
        const bars = makeHLBars(
            [15, 20, 10, 20, 4, 20, 2, 20, 9, 20, 3].map(v => [v, v])
        );
        const pivots = extractPivots(bars, ATR, { includeProvisional: true });
        const lows = pivots.filter(p => p.kind === 'low');
        expect(lows).toHaveLength(5);

        const candidates = classifyCurvaturePatterns(pivots, bars, ATR);

        expect(stripPivots(candidates)).toEqual([
            { id: 'rounding_bottom', startIndex: 2, endIndex: 10 },
        ]);
    });
});

describe('classifyCurvaturePatterns — rounding_top', () => {
    /** High pivots at x = 1, 3, 5, 7 with the given prices (hand-built). */
    const highs = (prices: number[]): PivotPoint[] =>
        prices.map((price, i) => ({ index: 1 + 2 * i, price, kind: 'high' }));
    const bars = makeBars(Array.from({ length: 10 }, () => 100));

    it('고점 4개가 돔형(concave)이고 정점이 중앙 절반에 있으면 rounding_top을 방출한다', () => {
        // Mirror of the textbook rounding_bottom lows (10, 4, 2, 9) → 20 − y.
        const pivots = highs([10, 16, 18, 11]);

        expect(classifyCurvaturePatterns(pivots, bars, ATR)).toEqual([
            { id: 'rounding_top', startIndex: 1, endIndex: 7, pivots },
        ]);
    });

    it('돔 깊이가 정확히 ROUNDING_MIN_DEPTH_ATR_MULT * atr 이면 방출한다 (느슨한 경계)', () => {
        // Mirror of the rounding_bottom depth-boundary case: peak 18 − rim 16 = 2.
        const pivots = highs([16, 17.5, 18, 16.25]);

        expect(
            stripPivots(classifyCurvaturePatterns(pivots, bars, ATR))
        ).toEqual([{ id: 'rounding_top', startIndex: 1, endIndex: 7 }]);
    });

    it('돔 깊이가 ROUNDING_MIN_DEPTH_ATR_MULT * atr 미만이면 방출하지 않는다', () => {
        const pivots = highs([9.55, 9.95, 9.95, 9.55]);

        expect(classifyCurvaturePatterns(pivots, bars, ATR)).toEqual([]);
    });

    it('고점이 U자형(convex)이면 rounding_top이 아니다', () => {
        const pivots = highs([10, 4, 2, 9]);

        expect(classifyCurvaturePatterns(pivots, bars, ATR)).toEqual([]);
    });

    it('정점이 구간 가장자리에 붙으면(edge-hugging arc) rounding_top이 아니다', () => {
        // Mirror of the edge-vertex rounding_bottom case: vertex at x = 7.
        const pivots = highs([4.2, 10.2, 13.8, 15]);

        expect(classifyCurvaturePatterns(pivots, bars, ATR)).toEqual([]);
    });

    it('저점 U와 고점 돔이 함께 있으면 rounding_bottom과 rounding_top을 독립적으로 모두 방출한다', () => {
        // Lows: the textbook U (10, 4, 2, 9) at x = 2..8; highs: its mirror
        // dome 22 − y (12, 18, 20, 13) at x = 1..7.
        const pivots: PivotPoint[] = [
            { index: 1, price: 12, kind: 'high' },
            { index: 2, price: 10, kind: 'low' },
            { index: 3, price: 18, kind: 'high' },
            { index: 4, price: 4, kind: 'low' },
            { index: 5, price: 20, kind: 'high' },
            { index: 6, price: 2, kind: 'low' },
            { index: 7, price: 13, kind: 'high' },
            { index: 8, price: 9, kind: 'low' },
        ];

        expect(
            stripPivots(classifyCurvaturePatterns(pivots, bars, ATR))
        ).toEqual([
            { id: 'rounding_bottom', startIndex: 2, endIndex: 8 },
            { id: 'rounding_top', startIndex: 1, endIndex: 7 },
        ]);
    });
});
