import { describe, expect, it } from 'vitest';
import type {
    ElliottLevel,
    ElliottScoredCandidate,
    ElliottStructure,
} from '@/domain/types';
import { buildDiagonalCandidates } from '@/domain/overlays/elliottDiagonal';
import {
    buildElliottCandidates,
    isSpentCount,
    selectElliottCandidates,
} from '@/domain/overlays/elliottCandidates';
import {
    ELLIOTT_CANDIDATE_LIMIT,
    ELLIOTT_PER_STRUCTURE_LIMIT,
} from '@/domain/overlays/constants';
import { makeHLBars } from '@/__tests__/domain/patterns/helpers';
import {
    FMT,
    STEP,
    pivotsAt,
} from '@/__tests__/domain/overlays/elliottTestHelpers';

/**
 * Flat bars at each price — with ATR 1 every move ≥ 1.5 becomes a pivot.
 * `steps[i]` is how many bars the move into `prices[i + 1]` takes (linear).
 */
const ladderSteps = (prices: number[], steps: number[]) =>
    makeHLBars(
        prices.flatMap((v, i) =>
            i === 0
                ? [[v, v] as [number, number]]
                : Array.from({ length: steps[i - 1] }, (_, k) => {
                      const x =
                          prices[i - 1] +
                          ((v - prices[i - 1]) * (k + 1)) / steps[i - 1];
                      return [x, x] as [number, number];
                  })
        )
    );
const ladder = (prices: number[]) =>
    makeHLBars(
        prices.flatMap((v, i) =>
            i === 0
                ? [[v, v] as [number, number]]
                : Array.from({ length: STEP }, (_, k) => {
                      const x =
                          prices[i - 1] +
                          ((v - prices[i - 1]) * (k + 1)) / STEP;
                      return [x, x] as [number, number];
                  })
        )
    );

// Textbook up impulse: 0=100, 1=110, 2=104 (60% retrace), 3=126 (w3 = 2.2×w1),
// 4=120 (27% of w3), 5=131 (w5 = 1.1×w1), then a closing drop to confirm 5.
const TEXTBOOK = [105, 100, 110, 104, 126, 120, 131, 125];

describe('buildElliottCandidates', () => {
    it('finds the textbook impulse with labels 1–5', () => {
        const out = buildElliottCandidates(ladder(TEXTBOOK), 1, FMT);
        const best = out[0];
        expect(best.id).toMatch(/^ew:up:\d+:6$/);
        expect(best.labels.map(l => l.text)).toEqual(['1', '2', '3', '4', '5']);
        expect(best.segments).toHaveLength(5);
    });

    it('rule 1: wave 2 below wave 0 invalidates', () => {
        const out = buildElliottCandidates(
            ladder([105, 100, 110, 99, 126, 120, 131, 125]),
            1,
            FMT
        );
        expect(
            out.some(
                c => c.id.endsWith(':6') && c.id.startsWith(`ew:up:${STEP}:`)
            )
        ).toBe(false);
    });

    it('rule 2: wave 3 shortest invalidates (satisfies rules 1 and 3)', () => {
        // wave1 = 100->110 (w0=10), wave2 = 110->104, wave3 = 104->113 (w2=9),
        // wave4 = 113->111 (rule 3 clear: P4=111>P1=110), wave5 = 111->125 (w4=14).
        // w2 < w0 and w2 < w4 -> rule 2 rejects; rule 1 (P2=104>P0=100) and rule 3
        // (P4=111>P1=110) both hold.
        const out = buildElliottCandidates(
            ladder([105, 100, 110, 104, 113, 111, 125, 120]),
            1,
            FMT
        );
        expect(out.filter(c => c.id.endsWith(':6'))).toEqual([]);
    });

    it('rule 2 partial (n=5, wave 5 unformed): wave 3 < wave 1 invalidates', () => {
        const out = buildElliottCandidates(
            ladder([105, 100, 110, 104, 113, 111.2]),
            1,
            FMT
        );
        expect(out.filter(c => c.id.endsWith(':5'))).toEqual([]);
    });

    it('rule 2 partial (n=5, wave 5 unformed): wave 3 > wave 1 is accepted', () => {
        const out = buildElliottCandidates(
            ladder([105, 100, 110, 104, 120, 115]),
            1,
            FMT
        );
        expect(out.some(c => c.id.endsWith(':5'))).toBe(true);
    });

    it('rule 3: wave 4 into wave 1 territory invalidates', () => {
        const out = buildElliottCandidates(
            ladder([105, 100, 110, 104, 126, 109, 131, 125]),
            1,
            FMT
        );
        expect(out.filter(c => c.id.endsWith(':6'))).toEqual([]);
    });

    it('in-progress count ends at the last pivot', () => {
        // 0..3 then still falling into wave 4: last pivot is provisional
        const out = buildElliottCandidates(
            ladder([105, 100, 110, 104, 126, 121]),
            1,
            FMT
        );
        expect(out.some(c => /:(4|5)$/.test(c.id))).toBe(true);
    });

    it('ABC after a complete impulse is attached', () => {
        const out = buildElliottCandidates(
            ladder([...TEXTBOOK.slice(0, -1), 122, 127, 118, 121]),
            1,
            FMT
        );
        const abc = out.find(c => c.id.endsWith(':abc'));
        expect(abc?.labels.map(l => l.text)).toEqual([
            '1',
            '2',
            '3',
            '4',
            '5',
            'A',
            'B',
            'C',
        ]);
    });

    it("ABC rejected when B retraces past wave 5's end", () => {
        // wave 5 ends at 131; B runs to 135, beyond it.
        const out = buildElliottCandidates(
            ladder([...TEXTBOOK.slice(0, -1), 122, 135, 128, 131]),
            1,
            FMT
        );
        expect(out.find(c => c.id.endsWith(':abc'))).toBeUndefined();
    });

    it('promptLine reports the correct in-progress wave', () => {
        // n=4 (wave 3 forming) is any up-down-up swing: no longer counted.
        expect(
            buildElliottCandidates(
                ladder([105, 100, 110, 104, 108, 107]),
                1,
                FMT
            ).some(c => c.id.endsWith(':4'))
        ).toBe(false);

        // n=5: last pivot (a provisional low) is wave 4 forming.
        const wave4 = buildElliottCandidates(
            ladder([105, 100, 110, 104, 120, 115]),
            1,
            FMT
        );
        expect(
            wave4.some(
                c =>
                    c.id.endsWith(':5') &&
                    c.promptLine.includes('wave 4 in progress')
            )
        ).toBe(true);

        // n=6, last pivot is still the provisional right-edge one: wave 5 forming,
        // not "impulse complete".
        const wave5 = buildElliottCandidates(
            ladder([105, 100, 110, 104, 126, 120, 131]),
            1,
            FMT
        );
        expect(
            wave5.some(
                c =>
                    c.id.endsWith(':6') &&
                    c.promptLine.includes('wave 5 in progress')
            )
        ).toBe(true);
    });

    it('caps at ELLIOTT_CANDIDATE_LIMIT and sorts by score', () => {
        const out = buildElliottCandidates(ladder(TEXTBOOK), 1, FMT);
        expect(out.length).toBeLessThanOrEqual(ELLIOTT_CANDIDATE_LIMIT);
        expect(out[0].promptLine).toMatch(/score \d\.\d{2}/);
    });

    it('gap gate: a wave shorter than EW_MIN_WAVE_BARS rejects the count even when the span is long enough', () => {
        // Wave 3 (104 → 126) happens in a single bar; every other move takes 4.
        // Span 0→5 = 4+4+1+4+4 = 17 bars, so only the per-wave gap can reject it.
        const oneBarWave3 = ladderSteps(TEXTBOOK, [4, 4, 4, 1, 4, 4, 4]);
        expect(
            buildElliottCandidates(oneBarWave3, 1, FMT).filter(c =>
                c.id.endsWith(':6')
            )
        ).toEqual([]);
        // Control: the same prices with 4-bar waves pass.
        expect(
            buildElliottCandidates(ladder(TEXTBOOK), 1, FMT).some(c =>
                c.id.endsWith(':6')
            )
        ).toBe(true);
    });

    it('span gate: a count shorter than EW_MIN_IMPULSE_SPAN_BARS is rejected even with 2-bar waves', () => {
        // 5-pivot partial (wave 4 forming), 2 bars per wave → span 8 < 10.
        const prices = [105, 100, 110, 104, 120, 115];
        expect(
            buildElliottCandidates(
                ladderSteps(prices, [2, 2, 2, 2, 2]),
                1,
                FMT
            ).filter(c => c.id.endsWith(':5'))
        ).toEqual([]);
        // Control: 4-bar waves → span 16 ≥ 10 → accepted.
        expect(
            buildElliottCandidates(
                ladderSteps(prices, [4, 4, 4, 4, 4]),
                1,
                FMT
            ).some(c => c.id.endsWith(':5'))
        ).toBe(true);
    });

    it('[] for atr <= 0 or too few pivots', () => {
        expect(buildElliottCandidates(ladder(TEXTBOOK), 0, FMT)).toEqual([]);
        expect(buildElliottCandidates(ladder([100, 101]), 1, FMT)).toEqual([]);
    });

    it('a complete impulse is invalidated by a new extreme past wave 5, and states every wave ratio', () => {
        const line = buildElliottCandidates(ladder(TEXTBOOK), 1, FMT).find(c =>
            /:6$/.test(c.id)
        )?.promptLine;
        expect(line).toContain(
            '; invalidation 131.00; W2 60.0% of W1, W3 220.0% of W1, W4 27.3% of W3, W5 110.0% of W1; score '
        );
    });

    it("draws the invalidation and the attached A–B–C's C targets from the count's first pivot", () => {
        const levels = (prices: number[], suffix: string) =>
            buildElliottCandidates(ladder(prices), 1, FMT)
                .find(c => c.id.endsWith(suffix))
                ?.levels.map(l => [
                    l.label,
                    Number(l.price.toFixed(2)),
                    l.fromTime,
                ]);
        // From wave 0 (bar STEP), across the whole count.
        expect(levels(TEXTBOOK, ':6')).toEqual([['invalidation', 131, STEP]]);
        // C forming at the right edge (118): its targets are still ahead.
        expect(
            levels([...TEXTBOOK.slice(0, -1), 122, 127, 118], ':abc')
        ).toEqual([
            ['invalidation', 131, STEP],
            ['target 100%', 118, STEP],
            ['target 161.8%', 112.44, STEP],
        ]);
        // C done (121 followed it): the count is finished history and draws
        // nothing.
        expect(
            levels([...TEXTBOOK.slice(0, -1), 122, 127, 118, 121], ':abc')
        ).toEqual([]);
    });

    it('a forming wave is left out of the ratios; the invalidation follows the state', () => {
        const line = (prices: number[], n: number) =>
            buildElliottCandidates(ladder(prices), 1, FMT).find(c =>
                c.id.endsWith(`:${n}`)
            )?.promptLine;
        // Wave 4 forming: invalidated at wave 1's end (rule 3).
        expect(line([105, 100, 110, 104, 120, 115], 5)).toContain(
            '; invalidation 110.00; W2 60.0% of W1, W3 160.0% of W1; score '
        );
        // Wave 5 forming: invalidated at wave 4's end.
        expect(line([105, 100, 110, 104, 126, 120, 131], 6)).toContain(
            '; invalidation 120.00; W2 60.0% of W1, W3 220.0% of W1, W4 27.3% of W3; score '
        );
    });

    it('types the attached A–B–C and gives its C targets while C forms; wave 5’s end stays the invalidation', () => {
        const line = (prices: number[]) =>
            buildElliottCandidates(ladder(prices), 1, FMT).find(c =>
                c.id.endsWith(':abc')
            )?.promptLine;
        const forming = line([...TEXTBOOK.slice(0, -1), 122, 127, 118]);
        expect(forming).toContain(
            'impulse complete, A–B–C with C in progress (zigzag);'
        );
        // A = 9 from 131; C at 100% / 161.8% of A from B (127). B may not
        // pass wave 5's end (131) — A's start, a zigzag's invalidation.
        expect(forming).toContain(
            '; invalidation 131.00; W2 60.0% of W1, W3 220.0% of W1, W4 27.3% of W3, W5 110.0% of W1; C target 100% 118.00, 161.8% 112.44; score '
        );
        // C done: its targets are history and leave the prompt line, and the
        // invalidation moves to C's end (118) — past wave 5 is the trend
        // resuming once the correction is over, not a broken count.
        const done = line([...TEXTBOOK.slice(0, -1), 122, 127, 118, 121]);
        expect(done).toContain('impulse complete, A–B–C done (zigzag);');
        expect(done).toContain(
            '; invalidation 118.00; W2 60.0% of W1, W3 220.0% of W1, W4 27.3% of W3, W5 110.0% of W1; score '
        );
    });

    it('a finished A–B–C stops projecting C targets once the price turns back through B (2026-10-18 regression)', () => {
        // Down impulse 372 → 217, A–B–C up to C 275 — short of its 100%
        // projection (285) — then a lower high (272) and a slide to 225,
        // under B (240) yet above wave 5 (217), so nothing is spent. C topped
        // two pivots ago: "C target 100% / 161.8%" above the price would be
        // stale targets of a move that already reversed.
        const out = buildElliottCandidates(
            ladder([
                360, 372, 322, 352, 242, 272, 217, 262, 240, 275, 255, 272, 225,
            ]),
            1,
            FMT
        );
        const abc = out.find(c => /:6:abc$/.test(c.id));
        expect(abc?.labels.map(l => l.text)).toEqual([
            '1',
            '2',
            '3',
            '4',
            '5',
            'A',
            'B',
            'C',
        ]);
        expect(abc?.promptLine).toContain('A–B–C done');
        expect(abc?.promptLine).not.toContain('C target');
        // A finished count draws no line — not wave 5's end (217, under the
        // price: breaking it is the downtrend resuming) nor C's end. The
        // prompt keeps C's end (275) as the invalidation.
        expect(abc?.levels).toEqual([]);
        expect(abc?.promptLine).toContain('; invalidation 275.00; ');
        // No candidate of any structure draws a target above the price.
        const lastClose = 225;
        expect(
            out.flatMap(c =>
                c.levels.filter(
                    l => l.label.startsWith('target') && l.price > lastClose
                )
            )
        ).toEqual([]);
    });

    it('a typed A–B–C whose C is the right-edge pivot says C is in progress', () => {
        const out = buildElliottCandidates(
            ladder([...TEXTBOOK.slice(0, -1), 122, 127, 118]),
            1,
            FMT
        );
        expect(out.find(c => c.id.endsWith(':6:abc'))?.promptLine).toContain(
            'A–B–C with C in progress (zigzag)'
        );
    });

    it('rejects an impulse wave smaller than EW_MIN_WAVE_ATR ATR', () => {
        // Same textbook shape with ATR 3: wave 2 (6) and wave 4 (6) < 7.5.
        expect(
            buildElliottCandidates(ladder(TEXTBOOK), 3, FMT).some(c =>
                /:6$/.test(c.id)
            )
        ).toBe(false);
    });

    it('rejects a wave 3 shorter than wave 1 and a truncated wave 5', () => {
        // w1 14, w3 12, w5 4 (rules hold: wave 5 is the shortest).
        expect(
            buildElliottCandidates(
                ladder([105, 100, 114, 106, 118, 115, 119, 114]),
                1,
                FMT
            ).some(c => c.id.startsWith(`ew:up:${STEP}:6`))
        ).toBe(false);
        // Wave 5 ends at 125, short of wave 3's 126.
        expect(
            buildElliottCandidates(
                ladder([105, 100, 110, 104, 126, 120, 125, 119]),
                1,
                FMT
            ).some(c => c.id.startsWith(`ew:up:${STEP}:6`))
        ).toBe(false);
    });

    it('rejects wave 2 or wave 4 outside its hard retracement band', () => {
        // Wave 2 retraces 90% of wave 1; wave 4 retraces 70% of wave 3.
        for (const prices of [
            [105, 100, 110, 101, 126, 120, 131, 125],
            [105, 100, 110, 104, 126, 110.6, 131, 125],
        ])
            expect(
                buildElliottCandidates(ladder(prices), 1, FMT).some(c =>
                    c.id.startsWith(`ew:up:${STEP}:6`)
                )
            ).toBe(false);
    });

    it('offers nothing of a structure left out of `enabled`', () => {
        expect(
            buildElliottCandidates(ladder(TEXTBOOK), 1, FMT, ['triangle'])
        ).toEqual([]);
    });
});

// Contracting up diagonal on two lines: 0-2-4 on L(t) = 100 + 2t, 1-3-5 on
// U(t) = 132 + 0.5t (t in bars from wave 0). Wave 4 (132) dips into wave 1
// (134) — rule 3 broken, rules 1 and 2 kept — and waves shrink 34 > 22 > 10.
const DIAGONAL = [100, 134, 116, 138, 132, 142];
const diagonalIds = (prices: number[], steps?: number[]) =>
    buildElliottCandidates(
        steps ? ladderSteps(prices, steps) : ladder(prices),
        1,
        FMT
    )
        .filter(c => c.id.endsWith(':diag'))
        .map(c => c.id);

describe('buildElliottCandidates — diagonals', () => {
    it('counts a rule-3-only wedge as a contracting diagonal with both boundary lines', () => {
        const out = buildElliottCandidates(
            ladder([104, ...DIAGONAL, 138]),
            1,
            FMT
        );
        const diag = out.find(c => c.id === `ew:up:${STEP}:diag`);
        expect(diag?.labels.map(l => l.text)).toEqual([
            '1',
            '2',
            '3',
            '4',
            '5',
        ]);
        expect(diag?.promptLine).toMatch(
            /^diagonal up \(leading or ending, contracting\); complete; 0 /
        );
        const lines = diag?.segments.filter(s => s.style === 'dashed');
        expect(lines?.map(s => s.role)).toEqual(['boundary_13', 'boundary_24']);
        // Both lines run to wave 5's bar; the 1–3 line meets wave 5 there.
        expect(lines?.[0].to).toEqual({ time: 6 * STEP, price: 142 });
        expect(lines?.[1].to.time).toBe(6 * STEP);
    });

    it('states the contracting cap as invalidation once wave 5 is done, wave 4 while it forms', () => {
        const line = (prices: number[]) =>
            buildElliottCandidates(ladder(prices), 1, FMT).find(c =>
                c.id.endsWith(':diag')
            )?.promptLine;
        // Wave 5 may not outrun wave 3 (22): cap 132 + 22.
        expect(line([104, ...DIAGONAL, 138])).toContain(
            '; invalidation 154.00; W2 52.9% of W1, W3 64.7% of W1, W4 27.3% of W3, W5 29.4% of W1; score '
        );
        expect(line([104, ...DIAGONAL])).toContain(
            '; invalidation 132.00; wave 5 cap 154.00; W2 52.9% of W1, W3 64.7% of W1, W4 27.3% of W3; score '
        );
    });

    it("sets breach directions: wave 4's end against the trend, the cap with it", () => {
        const levels = (prices: number[]) => {
            const { pivots, bars } = pivotsAt(prices);
            return buildDiagonalCandidates(pivots, bars, 1, FMT)[0]?.levels;
        };
        // Wave 5 forming (last pivot is the right edge).
        expect(levels(DIAGONAL)).toEqual([
            { label: 'invalidation', price: 132, breach: 'down' },
            { label: 'wave5_cap', price: 154, breach: 'up' },
        ]);
        // Complete: the cap is the invalidation, passed upward.
        expect(levels([...DIAGONAL, 138])).toEqual([
            { label: 'invalidation', price: 154, breach: 'up' },
        ]);
    });

    it('keeps a complete diagonal whose wave 5 edged past the cap through a normal pullback', () => {
        // Waves 24/14/24/12/24.72: wave 5 runs 3% past wave 3 (within
        // EW_DIAG_WAVE_TOLERANCE), so the cap (146) sits below wave 5's end
        // (146.72). It is passed only upward — the pullback to 141.5 keeps the count.
        const ids = buildElliottCandidates(
            ladder([104, 100, 124, 110, 134, 122, 146.72, 141.5]),
            1,
            FMT
        ).map(c => c.id);
        expect(ids.some(id => id.endsWith(':diag'))).toBe(true);
    });

    it("draws the diagonal's invalidation, and its wave 5 cap while wave 5 forms", () => {
        const levels = (prices: number[]) =>
            buildElliottCandidates(ladder(prices), 1, FMT)
                .find(c => c.id.endsWith(':diag'))
                ?.levels.map(l => [l.label, l.price]);
        expect(levels([104, ...DIAGONAL, 138])).toEqual([
            ['invalidation', 154],
        ]);
        expect(levels([104, ...DIAGONAL])).toEqual([
            ['invalidation', 132],
            ['wave5_cap', 154],
        ]);
    });

    it('is ending after a same-way swing and leading after an opposite one', () => {
        const role = (prefix: number[]) =>
            buildElliottCandidates(
                ladder([...prefix, ...DIAGONAL, 138]),
                1,
                FMT
            )
                .find(c => c.id === `ew:up:${3 * STEP}:diag`)
                ?.promptLine.match(/\((\w+), contracting\)/)?.[1];
        expect(role([94, 90, 104])).toBe('ending');
        expect(role([114, 108, 112])).toBe('leading');
    });

    it('wave 5 forming at the right edge is in progress; a forming wave 4 is not counted', () => {
        const states = (prices: number[]) =>
            buildElliottCandidates(ladder(prices), 1, FMT)
                .filter(c => c.id.endsWith(':diag'))
                .map(c => c.promptLine.split('; ')[1]);
        expect(states([104, ...DIAGONAL])).toEqual(['wave 5 in progress']);
        expect(states([104, ...DIAGONAL.slice(0, 5)])).toEqual([]);
    });

    it('a count that keeps rule 3 is an impulse, not a diagonal', () => {
        expect(diagonalIds([104, 100, 134, 116, 146, 136, 150, 145])).toEqual(
            []
        );
    });

    it('rule 1 still applies: wave 2 below wave 0 rejects', () => {
        expect(diagonalIds([104, 100, 134, 98, 138, 132, 142, 138])).toEqual(
            []
        );
    });

    it('rejects diverging (expanding) wedges', () => {
        expect(diagonalIds([104, 100, 110, 104, 118, 108, 128, 124])).toEqual(
            []
        );
    });

    it('rejects wave 0 far off the 2–4 line', () => {
        expect(diagonalIds([94, 90, 134, 116, 138, 132, 142, 138])).toEqual([]);
    });

    it('rejects a complete wave 5 far past or short of the 1–3 line', () => {
        expect(diagonalIds([104, 100, 134, 116, 138, 132, 149.5, 145])).toEqual(
            []
        );
        expect(diagonalIds([104, 100, 134, 116, 138, 132, 135, 131])).toEqual(
            []
        );
    });

    it('leaves a short forming wave 5 out of the time balance', () => {
        // Waves 1–4 take 8 bars, wave 5 only 2: 2/8 < 1/3. Forming at the
        // right edge it is still counted; complete (a reversal follows) it is not.
        const steps = [8, 8, 8, 8, 8, 2];
        const forming = [104, ...DIAGONAL.slice(0, 5), 137];
        expect(diagonalIds(forming, steps)).toEqual([`ew:up:8:diag`]);
        expect(diagonalIds([...forming, 134], [...steps, 4])).toEqual([]);
    });

    it('rejects waves of very unequal duration', () => {
        // Wave 5 takes 13 bars, the others 4: balance 4/13 < 1/3.
        expect(
            diagonalIds([104, ...DIAGONAL, 138], [4, 4, 4, 4, 4, 13, 4])
        ).toEqual([]);
        expect(
            diagonalIds([104, ...DIAGONAL, 138], [4, 4, 4, 4, 4, 8, 4])
        ).toHaveLength(1);
    });
});

// Contracting triangle, A down: lows 100 → 104 on a rising A–C line, highs
// 116 → 113 on a falling B–D line; E (107.5) stops 0.5 above the A–C line.
const TRIANGLE = [112, 120, 100, 116, 104, 113, 107.5, 111];

describe('buildElliottCandidates — triangles', () => {
    // Shape rules live in elliottTriangle.test.ts; this pins the wiring.
    it('offers the triangle by default and not when the structure is disabled', () => {
        const ids = (enabled?: ElliottStructure[]) =>
            buildElliottCandidates(ladder(TRIANGLE), 1, FMT, enabled).map(
                c => c.id
            );
        expect(ids()).toContain(`ew:down:${STEP}:tri`);
        expect(ids(['impulse']).some(id => id.endsWith(':tri'))).toBe(false);
    });

    it('drops a complete triangle the price already moved past', () => {
        const ids = (after: number[]) =>
            buildElliottCandidates(
                ladder([...TRIANGLE.slice(0, -1), ...after]),
                1,
                FMT
            ).map(c => c.id);
        const tri = `ew:down:${STEP}:tri`;
        // Thrust target 125 (see elliottTriangle.test.ts): 124 has not reached it.
        expect(ids([124])).toContain(tri);
        expect(ids([126])).not.toContain(tri);
        // Invalidation 104 (C's end): 105 holds, 103 breaks it.
        expect(ids([111, 105])).toContain(tri);
        expect(ids([111, 103])).not.toContain(tri);
    });
});

describe('buildElliottCandidates — spent counts (breach directions)', () => {
    // ATR 1 → EW_SPENT_SLACK_ATR slack 0.25. Each case places a later bar on
    // both sides of the level, so a flipped breach direction fails one of them.
    const ids = (prices: number[]) =>
        buildElliottCandidates(ladder(prices), 1, FMT).map(c => c.id);
    const prefix = TEXTBOOK.slice(0, 6); // 0..4 = 100, 110, 104, 126, 120

    it('a wave-4-forming count is never spent by the bounce off its provisional low', () => {
        // Wave 4 forming at 118 (provisional); invalidation = wave 1's end
        // (110), passed downward only — the bounce to 119 must keep it.
        expect(ids([...prefix.slice(0, 5), 118, 119])).toContain(
            `ew:up:${STEP}:5`
        );
    });

    it("a wave-5-forming count holds through a shallow pullback above wave 4's end", () => {
        // Wave 5 forming at 122 (provisional); the pullback to 121 stays under
        // 1.5 ATR and above wave 4's end (120) — invalidation is passed only
        // downward, so the bars above 120.25 must not spend it. (A retreat
        // through 120 is ≥ 1.5 ATR and confirms wave 5, making the count complete.)
        expect(ids([...prefix, 122, 121])).toContain(`ew:up:${STEP}:6`);
    });

    it("a done attached A–B–C is spent once price passes C's end in A's direction, not on a touch", () => {
        // C = 118 done (121 followed it); its invalidation is C's end, passed
        // downward (with A) beyond the 0.25 slack.
        const abc = [...TEXTBOOK.slice(0, -1), 122, 127, 118, 121];
        expect(ids([...abc, 119.5])).toContain(`ew:up:${STEP}:6:abc`);
        expect(ids([...abc, 117.6])).not.toContain(`ew:up:${STEP}:6:abc`);
    });

    it('an untyped done attached A–B–C (B at 85% of A) also takes C’s end as its invalidation, and is spent past it', () => {
        // A 131 → 121 (10), B to 129.5 (85%: neither zigzag nor flat), C 118,
        // then 121 follows: C done, no type, so no targets.
        const untyped = [...TEXTBOOK.slice(0, -1), 121, 129.5, 118, 121];
        const line = buildElliottCandidates(ladder(untyped), 1, FMT).find(c =>
            c.id.endsWith(':6:abc')
        )?.promptLine;
        expect(line).toContain('impulse complete, A–B–C done;');
        expect(line).toContain('; invalidation 118.00; ');
        expect(line).not.toContain('C target');
        expect(ids([...untyped, 119.5])).toContain(`ew:up:${STEP}:6:abc`);
        expect(ids([...untyped, 117.5])).not.toContain(`ew:up:${STEP}:6:abc`);
    });

    it('a done attached A–B–C is no longer spent by a new extreme past wave 5 (the trend resuming)', () => {
        // Up impulse to 131, A–B–C down to C 118, then a rally — passing
        // wave 5's end (131) is the uptrend resuming, which the count
        // predicts; it used to be read as the count's invalidation.
        const abc = [...TEXTBOOK.slice(0, -1), 122, 127, 118, 133, 130];
        expect(ids(abc)).toContain(`ew:up:${STEP}:6:abc`);
    });
});

describe('isSpentCount', () => {
    // A count whose last leg falls from B (110) to C (100) at time 2.
    const count = (levels: ElliottScoredCandidate['levels']) => ({
        levels,
        candidate: {
            id: 'ew:test',
            kind: 'elliott' as const,
            skill: 'elliott-wave',
            promptLine: '',
            segments: [],
            levels: [],
            labels: [
                {
                    at: { time: 1, price: 110 },
                    text: 'B',
                    position: 'above' as const,
                },
                {
                    at: { time: 2, price: 100 },
                    text: 'C',
                    position: 'below' as const,
                },
            ],
        },
    });
    const bars = (lows: number[], highs: number[]) =>
        lows.map((low, i) => ({
            time: i + 1,
            open: low,
            high: highs[i],
            low,
            close: low,
            volume: 0,
        }));
    const level = (
        label: ElliottLevel['label'],
        price: number,
        breach: 'up' | 'down'
    ): ElliottLevel => ({
        label,
        price,
        breach,
    });

    it('is spent once a later bar passes the invalidation, not on a touch', () => {
        const c = count([level('invalidation', 120, 'up')]);
        expect(isSpentCount(c, bars([110, 100, 105], [110, 100, 120]), 0)).toBe(
            false
        );
        expect(isSpentCount(c, bars([110, 100, 105], [110, 100, 121]), 0)).toBe(
            true
        );
    });

    it('reads the breach direction from the level, not from where it sits', () => {
        // A cap the last pivot already edged past (a diagonal's wave 5 within
        // tolerance): passed only upward, so a pullback below it is no breach.
        const c = count([level('invalidation', 99, 'up')]);
        expect(isSpentCount(c, bars([110, 100, 90], [110, 100, 99]), 0)).toBe(
            false
        );
        expect(isSpentCount(c, bars([110, 100, 90], [110, 100, 99.5]), 0)).toBe(
            true
        );
    });

    it('is spent once a later bar reaches a target', () => {
        const c = count([level('target 161.8%', 95, 'down')]);
        expect(isSpentCount(c, bars([110, 100, 96], [110, 100, 99]), 0)).toBe(
            false
        );
        expect(isSpentCount(c, bars([110, 100, 95], [110, 100, 99]), 0)).toBe(
            true
        );
    });

    it("skips a target the count's own last pivot already reached", () => {
        // C (100) is already past its 100% projection (105) downward.
        const c = count([level('target 100%', 105, 'down')]);
        expect(isSpentCount(c, bars([110, 100, 101], [110, 100, 106]), 0)).toBe(
            false
        );
    });

    it('gives EW_SPENT_SLACK_ATR of slack: a wick just past an invalidation holds, near a target counts', () => {
        // ATR 4 → 1 point of slack.
        const inv = count([level('invalidation', 120, 'up')]);
        expect(
            isSpentCount(inv, bars([110, 100, 105], [110, 100, 121]), 4)
        ).toBe(false);
        expect(
            isSpentCount(inv, bars([110, 100, 105], [110, 100, 121.5]), 4)
        ).toBe(true);
        const tgt = count([level('target 161.8%', 95, 'down')]);
        expect(isSpentCount(tgt, bars([110, 100, 96], [110, 100, 99]), 4)).toBe(
            true
        );
        expect(
            isSpentCount(tgt, bars([110, 100, 96.5], [110, 100, 99]), 4)
        ).toBe(false);
    });

    it('ignores caps and counts with no bar after the last pivot', () => {
        expect(
            isSpentCount(
                count([level('wave5_cap', 90, 'down')]),
                bars([110, 100, 80], [110, 100, 101]),
                0
            )
        ).toBe(false);
        expect(
            isSpentCount(
                count([level('invalidation', 120, 'up')]),
                bars([110, 100], [110, 100]),
                0
            )
        ).toBe(false);
    });
});

const scored = (
    structure: ElliottStructure,
    score: number,
    id = `${structure}:${score}`
): ElliottScoredCandidate => ({
    structure,
    score,
    levels: [],
    candidate: {
        id,
        kind: 'elliott',
        skill: 'elliott-wave',
        promptLine: '',
        segments: [],
        levels: [],
        labels: [],
    },
});

describe('selectElliottCandidates', () => {
    it('offers the best of each structure before filling by score', () => {
        const out = selectElliottCandidates([
            ...[0.9, 0.85, 0.8, 0.75, 0.7].map(s => scored('impulse', s)),
            scored('triangle', 0.3),
            scored('diagonal', 0.2),
        ]).map(c => c.id);
        expect(out).toEqual([
            'impulse:0.9',
            'impulse:0.85',
            'impulse:0.8',
            'triangle:0.3',
            'diagonal:0.2',
        ]);
    });

    it(`caps one structure at ELLIOTT_PER_STRUCTURE_LIMIT and the total at ELLIOTT_CANDIDATE_LIMIT`, () => {
        const impulses = selectElliottCandidates(
            [0.9, 0.8, 0.7, 0.6, 0.5].map(s => scored('impulse', s))
        );
        expect(impulses).toHaveLength(ELLIOTT_PER_STRUCTURE_LIMIT);
        const many = selectElliottCandidates(
            (['impulse', 'triangle', 'diagonal'] as const).flatMap(k =>
                [0.9, 0.8, 0.7].map(s => scored(k, s))
            )
        );
        expect(many).toHaveLength(ELLIOTT_CANDIDATE_LIMIT);
    });

    it('a lower-scoring structure keeps its slot even where the per-structure cap would let another fill it', () => {
        // Score order alone would offer the five highest: three impulses and
        // the triangles at 0.7 and 0.65; the priority pass keeps the diagonal.
        const out = selectElliottCandidates([
            ...[0.9, 0.85, 0.8].map(s => scored('impulse', s)),
            ...[0.7, 0.65, 0.6].map(s => scored('triangle', s)),
            scored('diagonal', 0.1),
        ]).map(c => c.id);
        expect(out).toEqual([
            'impulse:0.9',
            'impulse:0.85',
            'impulse:0.8',
            'triangle:0.7',
            'diagonal:0.1',
        ]);
    });

    it('keeps the higher-scoring of two candidates sharing an id', () => {
        const low = scored('impulse', 0.4, 'same');
        const high = scored('impulse', 0.6, 'same');
        const out = selectElliottCandidates([
            { ...low, candidate: { ...low.candidate, promptLine: 'low' } },
            { ...high, candidate: { ...high.candidate, promptLine: 'high' } },
        ]);
        expect(out.map(c => c.promptLine)).toEqual(['high']);
    });

    it('caps a structure at 3 — the pre-2026-10-02 total, so impulse-only output is unchanged', () => {
        expect(ELLIOTT_PER_STRUCTURE_LIMIT).toBe(3);
    });
});
