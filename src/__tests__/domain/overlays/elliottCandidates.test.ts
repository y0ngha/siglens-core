import { describe, expect, it } from 'vitest';
import { buildElliottCandidates } from '@/domain/overlays/elliottCandidates';
import { makeHLBars } from '@/__tests__/domain/patterns/helpers';

const FMT = { timeframe: '1Day' as const, priceDp: 2 };
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
/** Bars per wave: pivots sit STEP bars apart (linear in between), so every wave clears EW_MIN_WAVE_BARS and a 0–5 count clears EW_MIN_IMPULSE_SPAN_BARS. */
const STEP = 4;
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
        // n=4: last pivot (a provisional high) is wave 3 forming.
        const wave3 = buildElliottCandidates(
            ladder([105, 100, 110, 104, 108, 107]),
            1,
            FMT
        );
        expect(
            wave3.some(
                c =>
                    c.id.endsWith(':4') &&
                    c.promptLine.includes('wave 3 in progress')
            )
        ).toBe(true);

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

    it('caps at 3 and sorts by score', () => {
        const out = buildElliottCandidates(ladder(TEXTBOOK), 1, FMT);
        expect(out.length).toBeLessThanOrEqual(3);
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
        // 4-pivot partial (wave 3 forming), 2 bars per wave → span 6 < 10.
        const prices = [105, 100, 110, 104, 108, 107];
        expect(
            buildElliottCandidates(
                ladderSteps(prices, [2, 2, 2, 2, 2]),
                1,
                FMT
            ).filter(c => c.id.endsWith(':4'))
        ).toEqual([]);
        // Control: 4-bar waves → span 12 ≥ 10 → accepted.
        expect(
            buildElliottCandidates(
                ladderSteps(prices, [4, 4, 4, 4, 4]),
                1,
                FMT
            ).some(c => c.id.endsWith(':4'))
        ).toBe(true);
    });

    it('[] for atr <= 0 or too few pivots', () => {
        expect(buildElliottCandidates(ladder(TEXTBOOK), 0, FMT)).toEqual([]);
        expect(buildElliottCandidates(ladder([100, 101]), 1, FMT)).toEqual([]);
    });
});
