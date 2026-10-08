import { describe, expect, it } from 'vitest';
import type { QualifyContext } from '@/domain/patterns/qualify/context';
import { qualifyFlags } from '@/domain/patterns/qualify/flags';
import { makeHLBars } from '@/__tests__/domain/patterns/helpers';

/**
 * The flag bounds in isolation (ATR 1): a pole 96 → 108 over bars 0–10
 * (pivots given directly), then 13 flag bars given as [high, low].
 */
function flagCtx(flag: [number, number][]): QualifyContext {
    const pole = Array.from({ length: 11 }, (_, i): [number, number] => {
        const close = 96 + (12 * i) / 10;
        return [close + 0.1, close - 0.1];
    });
    pole[0] = [96.1, 96];
    pole[10] = [108, 107.6];
    const bars = makeHLBars([...pole, ...flag]);
    return {
        bars,
        pivots: [
            { index: 0, price: 96, kind: 'low' },
            { index: 10, price: 108, kind: 'high' },
        ],
        atr: 1,
        lastIndex: bars.length - 1,
        minHeightPricePct: 0.03,
    };
}

/** Swing highs at flag bars 1, 5, 9 (`hi`), swing lows at 3, 7, 11 (`lo`), mid bars between. */
const zigzag = (
    hi: (k: number) => number,
    lo: (k: number) => number
): [number, number][] =>
    Array.from({ length: 13 }, (_, k): [number, number] => {
        if (k % 4 === 1) return [hi(k), hi(k) - 0.6];
        if (k % 4 === 3) return [lo(k) + 0.6, lo(k)];
        const mid = (hi(k) + lo(k)) / 2;
        return [mid + 0.3, mid - 0.3];
    });

const ids = (flag: [number, number][]): string[] =>
    qualifyFlags(flagCtx(flag)).map(q => q.id);

describe('qualifyFlags — flags bounded by their pole', () => {
    it('a flat flag just under the pole top is a bull flag', () => {
        expect(
            ids(
                zigzag(
                    () => 107.8,
                    () => 106.3
                )
            )
        ).toEqual(['bull_flag']);
    });

    it('flag bars up to 0.45 ATR over the pole top still make a flag', () => {
        expect(
            ids(
                zigzag(
                    () => 108.45,
                    () => 106.95
                )
            )
        ).toEqual(['bull_flag']);
    });

    it('flag bars 0.6 ATR over the pole top (over FLAG_MAX_BEYOND_POLE_ATR) do not', () => {
        expect(
            ids(
                zigzag(
                    () => 108.6,
                    () => 107.1
                )
            )
        ).toEqual([]);
    });

    it('a channel wider than half the pole where it starts is not a flag (FLAG_MAX_START_WIDTH_POLE_SHARE)', () => {
        // Upper 107.9 falling 0.1/bar, lower through 102 / 103.2 / 104.4:
        // 6.8 wide at the first flag bar, over 6 (half the 12 pole), while
        // the deepest low pulls back exactly half the pole.
        expect(
            ids(
                zigzag(
                    k => 107.9 - 0.1 * k,
                    k => 102 + 0.3 * (k - 3)
                )
            )
        ).toEqual([]);
    });

    it('two neighbouring bars on the lower line are one touch (FLAG_MIN_TOUCH_SPACING_BARS)', () => {
        const lows = [
            106.9, 106.8, 106.6, 106.3, 106.3, 106.8, 106.85, 106.9, 106.92,
            106.95, 106.97, 107, 107.05,
        ];
        expect(
            ids(
                lows.map((low, k): [number, number] => [
                    k % 4 === 1 ? 107.8 : 107.2,
                    low,
                ])
            )
        ).toEqual([]);
    });
});

describe('qualifyFlags — a flag stays drawn after its breakout while recent', () => {
    // The base flag (bars 11–23, ending at bar 23: a 23-bar pole-and-flag
    // span, so a recency window of max(20, 11.5) = 20 bars), then a breakout
    // that holds above the channel.
    const breakout = (bars: number): [number, number][] => [
        ...zigzag(
            () => 107.8,
            () => 106.3
        ),
        ...Array.from({ length: bars }, (): [number, number] => [109.6, 108.7]),
    ];

    it('is drawn when its last bar is exactly 20 bars back', () => {
        const q = qualifyFlags(flagCtx(breakout(20)));
        expect(q.map(p => [p.id, p.endIndex])).toEqual([['bull_flag', 23]]);
    });

    it('is dropped one bar later', () => {
        expect(qualifyFlags(flagCtx(breakout(21)))).toEqual([]);
    });
});

describe("qualifyFlags — flag or pennant is read over the channel's touches", () => {
    // Lines narrowing 0.086 per bar from 2 wide. The label is read on the
    // first fit (flag bars 0–8, touches at 1/5 and 3/7): over its touches
    // the channel keeps 0.73 of its width — a flag — while from its first
    // bar to its last it keeps 0.66, a pennant.
    it('reads a bull flag', () => {
        expect(
            ids(
                zigzag(
                    k => 107.9 - 0.043 * k,
                    k => 105.9 + 0.043 * k
                )
            )
        ).toEqual(['bull_flag']);
    });
});
