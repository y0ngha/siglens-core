import { describe, expect, it } from 'vitest';
import { buildCombinationCandidates } from '@/domain/overlays/elliottCombination';
import { FMT, pivotsAt } from '@/__tests__/domain/overlays/elliottTestHelpers';

// Double zigzag down: W 130 → 120 → 125 → 115, X up to 121 (40% of W),
// Y 121 → 111 → 116 → 106 (Y = W).
const WXY = [130, 120, 125, 115, 121, 111, 116, 106];
/**
 * Pivots from bar `firstBar` on; the flat bars before (at 100) are the trend
 * the combination corrects: W starts at their extreme, 30 away = 3× W's A.
 */
const combos = (prices: number[], atr = 1, firstBar = 8) => {
    const { pivots, bars } = pivotsAt(
        prices,
        prices.map((_, i) => firstBar + i * 4)
    );
    return buildCombinationCandidates(pivots, bars, atr, FMT).map(
        c => c.candidate
    );
};
const comboFrom0 = (prices: number[]) =>
    combos(prices).find(c => c.id.startsWith('ew:down:8:combo'));

describe('buildCombinationCandidates', () => {
    it('W–X–Y: boundary legs and labels only, both simples typed', () => {
        const c = comboFrom0([...WXY, 110]);
        expect(c?.id).toBe('ew:down:8:combo');
        expect(c?.promptLine).toMatch(
            /^combination W–X–Y \(zigzag \+ zigzag\), W down; complete; 0 /
        );
        expect(c?.labels.map(l => l.text)).toEqual(['W', 'X', 'Y']);
        expect(c?.promptLine).toContain(
            '; W 15.00, X 6.00 (40.0% of W), Y 15.00; score '
        );
        expect(c?.segments.map(s => [s.from.time, s.to.time])).toEqual([
            [8, 20],
            [20, 24],
            [24, 36],
        ]);
    });

    it('W–X–Y–X–Z', () => {
        const c = combos([...WXY, 112, 102, 107, 97, 101]).find(
            x => x.id === 'ew:down:8:combo3'
        );
        expect(c?.labels.map(l => l.text)).toEqual(['W', 'X', 'Y', 'X', 'Z']);
        expect(c?.segments.map(s => s.role)).toEqual([
            'wave_W',
            'wave_X',
            'wave_Y',
            'wave_X2',
            'wave_Z',
        ]);
    });

    it('Y in progress at the right edge skips the lower size bound', () => {
        const c = comboFrom0([...WXY.slice(0, 7), 113]);
        expect(c?.promptLine).toContain('; Y in progress; ');
    });

    it('rejects a start that ends no trend, and legs under EW_MIN_WAVE_ATR ATR', () => {
        // No bars before W: nothing it corrects.
        expect(
            combos([...WXY, 110], 1, 0).find(c => c.id.includes(':combo'))
        ).toBeUndefined();
        // ATR 3: the 5-point B legs fall under 7.5.
        expect(
            combos([...WXY, 110], 3).find(c => c.id.includes(':combo'))
        ).toBeUndefined();
    });

    it('rejects X retracing all of W', () => {
        expect(
            comboFrom0([130, 120, 125, 115, 131, 121, 126, 116, 120])
        ).toBeUndefined();
    });

    it('rejects Y beyond EW_COMBO_Y_TO_W_MAX × W', () => {
        expect(
            comboFrom0([130, 120, 125, 115, 121, 104, 112.5, 95, 99])
        ).toBeUndefined();
    });

    it('rejects a simple that is neither a zigzag nor a flat', () => {
        expect(
            comboFrom0([130, 120, 128.5, 115, 121, 111, 116, 106, 110])
        ).toBeUndefined();
    });
});
