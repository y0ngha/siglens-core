import { describe, expect, it } from 'vitest';
import { computeForwardReturns } from '@/domain/outcomes/computeForwardReturns';
import {
    BASELINE_MIN_SAMPLES,
    OUTCOME_HORIZON_BARS,
} from '@/domain/outcomes/constants';
import { flat, makeWindow } from '../../helpers/outcomeWindows';

/** `count` closes growing 1% per step ending at `last`. */
function geometric(count: number, last: number): number[] {
    return Array.from(
        { length: count },
        (_, i) => last / 1.01 ** (count - 1 - i)
    );
}

describe('computeForwardReturns', () => {
    it('returns one entry per horizon in order', () => {
        const labels = computeForwardReturns(makeWindow());
        expect(labels.map(label => label.h)).toEqual([...OUTCOME_HORIZON_BARS]);
    });

    it('measures each horizon from the reference price to the close that many bars on', () => {
        const forward = Array.from({ length: 20 }, (_, i) => flat(101 + i));
        const labels = computeForwardReturns(makeWindow({ forward }));
        [1, 5, 10, 20].forEach((expected, i) =>
            expect(labels[i].returnPct).toBeCloseTo(expected, 9)
        );
    });

    it('reports a falling price as a negative return', () => {
        const labels = computeForwardReturns(
            makeWindow({
                forward: Array.from({ length: 20 }, () => flat(90)),
            })
        );
        labels.forEach(label => expect(label.returnPct).toBeCloseTo(-10, 9));
    });

    it('reports a baseline of zero for a symbol that never moved', () => {
        const labels = computeForwardReturns(makeWindow());
        expect(labels.map(label => label.baselinePct)).toEqual([0, 0, 0, 0]);
    });

    it('counts every start with the horizon inside the closes as a baseline sample', () => {
        const labels = computeForwardReturns(makeWindow());
        // 60 pre closes + 20 forward closes = 80 closes.
        expect(labels.map(label => label.baselineN)).toEqual([79, 75, 70, 60]);
    });

    it('averages the same-horizon return over the whole series', () => {
        const refPrice = 150;
        const preCloses = geometric(60, refPrice);
        const forward = Array.from({ length: 20 }, (_, i) =>
            flat(refPrice * 1.01 ** (i + 1))
        );
        const labels = computeForwardReturns(
            makeWindow({ referencePrice: refPrice, preCloses, forward })
        );
        // Every h-bar return of a constant-growth series is the same number.
        labels.forEach(label => {
            const expected = (1.01 ** label.h - 1) * 100;
            expect(label.returnPct).toBeCloseTo(expected, 9);
            expect(label.baselinePct).toBeCloseTo(expected, 9);
        });
    });

    it('averages unequal returns rather than taking one of them', () => {
        // Closes 100, 100, ..., then a single jump: only the starts whose h-window spans
        // the jump see it, so the mean is the jump divided by the sample count.
        const preCloses = Array.from({ length: 30 }, () => 100);
        const forward = Array.from({ length: 20 }, () => flat(110));
        const labels = computeForwardReturns(
            makeWindow({ preCloses, forward })
        );
        const h1 = labels[0];
        // 49 one-bar returns, exactly one of which (anchor -> first forward close) is +10%.
        expect(h1.baselineN).toBe(49);
        expect(h1.baselinePct).toBeCloseTo(10 / 49, 12);
    });

    it('withholds the baseline below the minimum sample count but still reports its size', () => {
        const preCloses = Array.from({ length: 5 }, () => 100);
        const labels = computeForwardReturns(makeWindow({ preCloses }));
        // 25 closes: h=1 has 24 starts, h=5 has 20, h=10 has 15, h=20 has 5.
        expect(labels.map(label => label.baselineN)).toEqual([24, 20, 15, 5]);
        expect(labels.map(label => label.baselinePct === null)).toEqual([
            false,
            false,
            true,
            true,
        ]);
        expect(BASELINE_MIN_SAMPLES).toBe(20);
    });

    it('reports a horizon the window does not reach as null, never zero', () => {
        const window = makeWindow();
        const short = { ...window, forward: window.forward.slice(0, 6) };
        const labels = computeForwardReturns(short);
        expect(labels.map(label => label.returnPct)).toEqual([
            0,
            0,
            null,
            null,
        ]);
    });

    it('reports no baseline samples when the horizon is longer than the closes', () => {
        const window = makeWindow({ preCloses: [100] });
        const tiny = { ...window, forward: window.forward.slice(0, 3) };
        const labels = computeForwardReturns(tiny);
        expect(labels.map(label => label.baselineN)).toEqual([3, 0, 0, 0]);
        expect(labels.map(label => label.baselinePct)).toEqual([
            null,
            null,
            null,
            null,
        ]);
    });
});
