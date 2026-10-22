import type {
    OverlayCandidate,
    OverlayCandidateBuild,
    OverlayCandidateInput,
    OverlayKind,
} from '@/domain/types';
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

/**
 * @internal
 * Every overlay candidate for one prompt. Each builder
 * is isolated: one throwing never costs the others or the analysis. The
 * domain layer cannot log, so a failed builder's kind is returned in
 * `failedBuilders` for the application layer to report.
 */
export function buildOverlayCandidates(
    input: OverlayCandidateInput
): OverlayCandidateBuild {
    const { bars, rsi, patternCandidates, marketReference, fmt } = input;
    const atr = input.atr ?? 0;
    const builders: ReadonlyArray<[OverlayKind, () => OverlayCandidate[]]> = [
        [
            'pattern',
            () =>
                buildPatternOverlayCandidates(
                    patternCandidates,
                    bars,
                    atr,
                    fmt.quoting
                ),
        ],
        ['trendline', () => buildTrendlineCandidates(bars, atr, fmt)],
        ['divergence', () => buildDivergenceCandidates(bars, rsi, fmt)],
        [
            'fibonacci',
            () => buildFibonacciCandidates(marketReference, bars, fmt),
        ],
        ['elliott', () => buildElliottCandidates(bars, atr, fmt)],
    ];
    const failedBuilders: OverlayKind[] = [];
    const candidates = builders.flatMap(([kind, build]) => {
        try {
            return build();
        } catch {
            failedBuilders.push(kind);
            return [];
        }
    });
    return { candidates: candidates.filter(runsForward), failedBuilders };
}
