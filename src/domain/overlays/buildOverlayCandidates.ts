import type { OverlayCandidate, OverlayCandidateInput } from '@/domain/types';
import { buildPatternOverlayCandidates } from '@/domain/overlays/patternOverlays';
import { buildTrendlineCandidates } from '@/domain/overlays/trendlineCandidates';
import { buildDivergenceCandidates } from '@/domain/overlays/divergenceCandidates';
import { buildFibonacciCandidates } from '@/domain/overlays/fibonacciCandidates';
import { buildElliottCandidates } from '@/domain/overlays/elliottCandidates';

/**
 * @internal
 * A segment whose end is not after its start cannot be drawn as a line — drop
 * the whole candidate rather than offer a broken drawing.
 */
export const runsForward = (c: OverlayCandidate): boolean =>
    c.segments.every(s => s.to.time > s.from.time);

const safely = (build: () => OverlayCandidate[]): OverlayCandidate[] => {
    try {
        return build();
    } catch {
        return [];
    }
};

/**
 * @internal
 * Every overlay candidate for one prompt (spec 2026-09-28 §2.1). Each builder
 * is isolated: one throwing never costs the others or the analysis.
 */
export function buildOverlayCandidates(
    input: OverlayCandidateInput
): OverlayCandidate[] {
    const { bars, rsi, patternCandidates, marketReference, fmt } = input;
    const atr = input.atr ?? 0;
    return [
        ...safely(() =>
            buildPatternOverlayCandidates(patternCandidates, bars, atr)
        ),
        ...safely(() => buildTrendlineCandidates(bars, atr, fmt)),
        ...safely(() => buildDivergenceCandidates(bars, rsi, fmt)),
        ...safely(() => buildFibonacciCandidates(marketReference, bars, fmt)),
        ...safely(() => buildElliottCandidates(bars, atr, fmt)),
    ].filter(runsForward);
}
