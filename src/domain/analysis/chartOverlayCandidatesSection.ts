import type { OverlayCandidate, OverlayKind } from '@/domain/types';
import { COMPUTED_SECTIONS_HEADING } from '@/domain/analysis/computedSectionsHeading';

/** @internal Section header — referenced verbatim by the writing rules in prompt.ts. */
export const CHART_OVERLAY_CANDIDATES_SECTION_HEADER =
    '## Chart Overlay Candidates (computed)';

/**
 * @internal Model-facing: says what the lines are, not how they were found —
 * "Logic-computed" invited "계산된 후보가 없어 …" narration (2026-10-08 A/B).
 * How to write about them is `COMPUTED_SECTIONS_RULES` in prompt.ts.
 */
export const CHART_OVERLAY_CANDIDATES_SECTION_INTRO = `Lines, legs and wave counts measured from the bars. When a result item relies on one, copy its id into that item (trendlineIds / strategyResults[].candidateIds). Never invent an id and never write coordinates — the app draws from these ids. Write about them as ${COMPUTED_SECTIONS_HEADING} in ## Analysis Guidelines says.`;

const GROUPS: ReadonlyArray<[Exclude<OverlayKind, 'pattern'>, string]> = [
    ['trendline', '### Trendlines'],
    ['divergence', '### Divergences'],
    ['fibonacci', '### Fibonacci'],
    ['elliott', '### Elliott waves'],
];

/**
 * @internal
 * Renders the non-pattern overlay candidates (patterns carry their id inside
 * `## Chart Pattern Candidates (computed)`). `''` when there are none, so the
 * caller can skip the section entirely.
 */
export function formatChartOverlayCandidatesSection(
    candidates: readonly OverlayCandidate[]
): string {
    const blocks = GROUPS.flatMap(([kind, title]) => {
        const lines = candidates
            .filter(c => c.kind === kind)
            .map(c => `- id: ${c.id} | skill: ${c.skill} | ${c.promptLine}`);
        return lines.length > 0 ? [[title, ...lines].join('\n')] : [];
    });
    if (blocks.length === 0) return '';
    return [
        CHART_OVERLAY_CANDIDATES_SECTION_HEADER,
        CHART_OVERLAY_CANDIDATES_SECTION_INTRO,
        ...blocks,
    ].join('\n');
}
