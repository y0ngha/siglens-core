import { describe, expect, it } from 'vitest';
import { buildElliottCandidates } from '@/domain/overlays/elliottCandidates';
import { ELLIOTT_ENABLED_STRUCTURES } from '@/domain/overlays/constants';
import {
    GATE,
    measureGate,
    structureOf,
} from '../../../../scripts/elliottGate/metrics';

const FMT = { timeframe: '1Day' as const, quoting: { dp: 2, krxTick: null } };

/**
 * The release gate (spec 2026-10-02 §검증) at the full sample size of
 * `scripts/elliottGate/run.ts` — 300 synthetic samples per structure per noise
 * level, 1,000 random walks, same seed — so CI checks the very numbers the
 * gate decision was made on. Every shipped structure, impulse included,
 * must clear it. Smaller runs were too coarse: at 400 walks the
 * triangle's false-positive rate sat one walk under the 5% bar. At 1,000 the
 * enabled structures clear it by 7+ walks (impulse 40, triangle 43,
 * diagonal 30 of 1,000 vs the 50 bar). Deterministic; well under 1 s.
 */
describe('Elliott structure gate (synthetic, full size)', () => {
    const gates = measureGate(
        (bars, atr) => buildElliottCandidates(bars, atr, FMT),
        300,
        1000,
        20261002
    );
    it.each(ELLIOTT_ENABLED_STRUCTURES)(
        '%s clears recall, false-positive and confusion bars',
        s => {
            const g = gates.find(x => x.structure === s);
            expect(g?.recall[0.1]).toBeGreaterThanOrEqual(GATE.recallLowNoise);
            expect(g?.recall[0.25]).toBeGreaterThanOrEqual(
                GATE.recallHighNoise
            );
            expect(g?.falsePositive).toBeLessThanOrEqual(GATE.maxFalsePositive);
            expect(g?.confusion[0.1]).toBeLessThanOrEqual(GATE.maxConfusion);
            expect(g?.confusion[0.25]).toBeLessThanOrEqual(GATE.maxConfusion);
        }
    );
});

describe('structureOf', () => {
    it.each([
        ['ew:up:1714521600:6', 'impulse'],
        ['ew:down:1714521600:4', 'impulse'],
        ['ew:up:1714521600:6:abc', 'impulse'],
        ['ew:up:1714521600:abc', 'abc'],
        ['ew:down:1714521600:tri', 'triangle'],
        ['ew:up:1714521600:diag', 'diagonal'],
        ['ew:up:1714521600:combo', 'combination'],
        ['ew:up:1714521600:combo3', 'combination'],
    ])('%s → %s', (id, structure) => {
        expect(structureOf(id)).toBe(structure);
    });
});
