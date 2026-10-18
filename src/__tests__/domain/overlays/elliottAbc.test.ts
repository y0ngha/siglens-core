import { describe, expect, it } from 'vitest';
import { buildAbcCandidates } from '@/domain/overlays/elliottAbc';
import { FMT, pivotsAt } from '@/__tests__/domain/overlays/elliottTestHelpers';

describe('buildAbcCandidates', () => {
    it('names the type, the direction and a right-edge C in progress', () => {
        const done = pivotsAt([110, 100, 105, 88, 95]);
        const [first] = buildAbcCandidates(done.pivots, done.bars, FMT);
        expect(first.structure).toBe('abc');
        expect(first.candidate.id).toBe('ew:down:0:abc');
        expect(first.candidate.promptLine).toMatch(
            /^A–B–C zigzag, A down; complete; 0 /
        );
        expect(first.candidate.labels.map(l => l.text)).toEqual([
            'A',
            'B',
            'C',
        ]);
        const forming = pivotsAt([110, 100, 105, 97]);
        expect(
            buildAbcCandidates(forming.pivots, forming.bars, FMT)[0].candidate
                .promptLine
        ).toContain('; C in progress; ');
    });

    it('states and draws C targets while C forms; a zigzag keeps its invalidation', () => {
        const { pivots, bars } = pivotsAt([110, 100, 105, 97]);
        const [abc] = buildAbcCandidates(pivots, bars, FMT);
        // C at 100% / 161.8% of A (10) from B (105); a zigzag's B may not pass 110.
        expect(abc.candidate.promptLine).toContain(
            '; C target 100% 95.00, 161.8% 88.82; invalidation 110.00; score '
        );
        expect(
            abc.candidate.levels.map(l => [
                l.label,
                Number(l.price.toFixed(2)),
                l.fromTime,
            ])
        ).toEqual([
            ['target 100%', 95, 0],
            ['target 161.8%', 88.82, 0],
            ['invalidation', 110, 0],
        ]);
    });

    it('a done C draws nothing; its prompt line states only the C-end invalidation, and the spent check reads it all', () => {
        // C ended at 88 and a later pivot (95) followed it: the count is
        // finished history. The 100% / 161.8% projections are where C could
        // have ended, and only a move past C's end (88, down with A) says C
        // was not done.
        const { pivots, bars } = pivotsAt([110, 100, 105, 88, 95]);
        const [abc] = buildAbcCandidates(pivots, bars, FMT);
        expect(abc.candidate.promptLine).not.toContain('C target');
        expect(abc.candidate.promptLine).toContain(
            ', C 1970-01-01 88.00; invalidation 88.00; score '
        );
        expect(abc.candidate.levels).toEqual([]);
        expect(abc.levels.map(l => [l.label, l.price, l.breach])).toEqual([
            ['target 100%', 95, 'down'],
            ['target 161.8%', expect.closeTo(88.82, 10), 'down'],
            ['invalidation', 88, 'down'],
        ]);
    });

    it("sets the breach directions while C forms: targets with A, a zigzag's invalidation against it", () => {
        const { pivots, bars } = pivotsAt([110, 100, 105, 97]);
        expect(
            buildAbcCandidates(pivots, bars, FMT)[0].levels.map(l => [
                l.label,
                l.breach,
            ])
        ).toEqual([
            ['target 100%', 'down'],
            ['target 161.8%', 'down'],
            ['invalidation', 'up'],
        ]);
    });

    it('a done C with a rising A is invalidated above C, with A', () => {
        // A 90 → 100 (up), B 95, C 112, then 105 follows: C is done.
        const { pivots, bars } = pivotsAt([90, 100, 95, 112, 105]);
        expect(buildAbcCandidates(pivots, bars, FMT)[0].levels.at(-1)).toEqual({
            label: 'invalidation',
            price: 112,
            breach: 'up',
        });
    });

    it('a done flat gets the same C-end invalidation (a forming flat has none)', () => {
        const done = pivotsAt([110, 100, 112, 97, 101]);
        expect(
            buildAbcCandidates(done.pivots, done.bars, FMT)[0].levels.at(-1)
        ).toEqual({ label: 'invalidation', price: 97, breach: 'down' });
        const forming = pivotsAt([110, 100, 112, 97]);
        expect(
            buildAbcCandidates(forming.pivots, forming.bars, FMT)[0].levels.map(
                l => l.label
            )
        ).toEqual(['target 100%', 'target 161.8%']);
    });

    it("draws levels at the prompt's precision; the spent check keeps the exact price", () => {
        const { pivots, bars } = pivotsAt([110, 100, 105, 97]);
        const [abc] = buildAbcCandidates(pivots, bars, { ...FMT, priceDp: 1 });
        // 161.8% of A (10) from B (105) = 88.82 → printed and drawn as 88.8.
        expect(abc.candidate.promptLine).toContain('161.8% 88.8;');
        expect(abc.candidate.levels[1].price).toBe(88.8);
        expect(abc.levels[1].price).toBeCloseTo(88.82, 10);
    });

    it('does not draw a projection at or below zero, while the prompt line still states it', () => {
        // A (20 down) from B (25): 161.8% = 25 − 32.36 < 0.
        const { pivots, bars } = pivotsAt([30, 10, 25, 5]);
        const [abc] = buildAbcCandidates(pivots, bars, FMT);
        expect(abc.candidate.promptLine).toContain('161.8% -7.36');
        expect(
            abc.candidate.levels.some(l => l.label === 'target 161.8%')
        ).toBe(false);
    });

    it('a flat has C targets but no invalidation (its B may pass A’s start)', () => {
        const { pivots, bars } = pivotsAt([110, 100, 112, 97]);
        const line = buildAbcCandidates(pivots, bars, FMT)[0].candidate
            .promptLine;
        expect(line).toMatch(/^A–B–C expanded flat, A down; C in progress; /);
        expect(line).toContain('; C target 100% 102.00, 161.8% 95.82; score ');
    });

    it('offers nothing for an unclassifiable shape', () => {
        const { pivots, bars } = pivotsAt([110, 100, 108.5, 96]);
        expect(buildAbcCandidates(pivots, bars, FMT)).toEqual([]);
    });
});
