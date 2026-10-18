import { describe, expect, it } from 'vitest';
import { buildTrendlineCandidates } from '@/domain/overlays/trendlineCandidates';
import { makeHLBars } from '@/__tests__/domain/patterns/helpers';

const FMT = { timeframe: '1Day' as const, quoting: { dp: 2, krxTick: null } };
// Rising lows 100 → 104 → 108 with highs in between; ATR 1, reversal 1.5.
const risingBars = () =>
    makeHLBars([
        [104, 103],
        [101, 100],
        [106, 105],
        [104, 104],
        [110, 109],
        [108, 108],
        [114, 113],
        [111, 111],
        [116, 115],
    ]);

describe('buildTrendlineCandidates', () => {
    it('finds an ascending support through the rising lows', () => {
        const out = buildTrendlineCandidates(risingBars(), 1, FMT);
        const support = out.filter(c => c.id.startsWith('tl:support:'));
        expect(support.length).toBeGreaterThan(0);
        expect(support[0].kind).toBe('trendline');
        expect(support[0].segments[0].role).toBe('support');
        expect(support[0].segments[0].to.time).toBe(8); // extends to last bar
    });

    it('rejects a support line the closes have broken through', () => {
        const bars = [
            ...risingBars(),
            ...makeHLBars([
                [100, 99],
                [99, 98],
                [98, 97],
            ]).map((b, i) => ({ ...b, time: 9 + i })),
        ];
        const out = buildTrendlineCandidates(bars, 1, FMT);
        expect(out.filter(c => c.id.startsWith('tl:support:'))).toEqual([]);
    });

    it('drops flat lines', () => {
        const flat = makeHLBars([
            [102, 101],
            [100, 100],
            [102, 102],
            [100, 100],
            [102, 102],
            [100, 100],
            [102, 102],
        ]);
        expect(
            buildTrendlineCandidates(flat, 1, FMT).filter(c =>
                c.id.startsWith('tl:support:')
            )
        ).toEqual([]);
    });

    it('caps each side and returns [] for atr <= 0', () => {
        expect(buildTrendlineCandidates(risingBars(), 0, FMT)).toEqual([]);
        const out = buildTrendlineCandidates(risingBars(), 1, FMT);
        expect(
            out.filter(c => c.segments[0].role === 'support').length
        ).toBeLessThanOrEqual(3);
    });

    it('prompt line names both anchors and the touch count', () => {
        const [c] = buildTrendlineCandidates(risingBars(), 1, FMT);
        expect(c.promptLine).toMatch(/touches \d+/);
    });

    it('ranks by touch count and the cap keeps the best 3 (dropping a lower-touch valid line)', () => {
        // Lows P0..P6 at indices 1,3,5,7,9,11,13. P0/P1/P5/P6 sit exactly on
        // one ascending line (y = 100 + (x-1)) so any pair among them touches
        // all 4; P2/P3 are far off (their own lines get invalidated by
        // subsequent closes breaking them); P4 sits off the P0-P1 line so
        // pairs through it only pick up 2-3 touches. 10 distinct valid
        // support lines exist; only the top 3 (by touches, tie-broken by the
        // more recent anchor) survive the cap.
        const bars = makeHLBars([
            [105, 104], // seed
            [101, 100], // P0 low=100, idx1
            [110, 109], // peak
            [103, 102], // P1 low=102, idx3 (on line)
            [160, 159], // peak
            [151, 150], // P2 low=150, idx5 (off line)
            [310, 309], // peak
            [301, 300], // P3 low=300, idx7 (off line)
            [320, 319], // peak
            [106, 105], // P4 low=105, idx9 (off line)
            [130, 129], // peak
            [111, 110], // P5 low=110, idx11 (on line)
            [140, 139], // peak
            [113, 112], // P6 low=112, idx13 (on line)
            [150, 149], // closing peak to confirm P6
        ]);
        const out = buildTrendlineCandidates(bars, 1, FMT);
        const support = out.filter(c => c.id.startsWith('tl:support:'));

        expect(support).toHaveLength(3);
        expect(support.map(c => c.id)).toEqual([
            'tl:support:1:13',
            'tl:support:1:11',
            'tl:support:1:3',
        ]);
        // Every kept line touches all 4 on-line pivots.
        for (const c of support) expect(c.promptLine).toMatch(/touches 4/);
        // A real, valid line with fewer touches (3, through P1-P6) exists but
        // loses to the cap because 3 other lines rank higher on touches.
        expect(support.find(c => c.id === 'tl:support:3:13')).toBeUndefined();
    });
});
