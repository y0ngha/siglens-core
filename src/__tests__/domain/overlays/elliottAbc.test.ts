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
        // C at 100% / 161.8% of A (10) from B (105); a zigzag's B may not pass 110.
        expect(first.candidate.promptLine).toContain(
            '; C target 100% 95.00, 161.8% 88.82; invalidation 110.00; score '
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

    it('a flat has C targets but no invalidation (its B may pass A’s start)', () => {
        const { pivots, bars } = pivotsAt([110, 100, 112, 97, 101]);
        const line = buildAbcCandidates(pivots, bars, FMT)[0].candidate
            .promptLine;
        expect(line).toMatch(/^A–B–C expanded flat, A down; complete; /);
        expect(line).toContain('; C target 100% 102.00, 161.8% 95.82; score ');
    });

    it('offers nothing for an unclassifiable shape', () => {
        const { pivots, bars } = pivotsAt([110, 100, 108.5, 96]);
        expect(buildAbcCandidates(pivots, bars, FMT)).toEqual([]);
    });
});
