import type {
    AnalysisResponse,
    ChartOverlay,
    OverlayCandidate,
    OverlayKind,
    OverlayVariant,
    PatternSummary,
    ResolvedChartOverlays,
    Skill,
    Trendline,
} from '@/domain/types';
import { patternSkillStem } from '@/domain/overlays/patternOverlays';

const TRENDLINE_SOURCE_REF = 'trendlines';
const MAX_TRENDLINES = 3;
const MAX_ELLIOTT_PER_STRATEGY = 2;

/** Which candidate kinds each result slot may reference — a known id resolved from the wrong slot is as invalid as an unknown one. */
const PATTERN_SLOT_KINDS: readonly OverlayKind[] = ['pattern'];
const TRENDLINE_SLOT_KINDS: readonly OverlayKind[] = ['trendline'];
const STRATEGY_SLOT_KINDS: readonly OverlayKind[] = [
    'divergence',
    'fibonacci',
    'elliott',
];

interface Ref {
    id: string;
    sourceRef: string;
    variant: OverlayVariant;
    allowedKinds: readonly OverlayKind[];
}

/**
 * The screener candidate a detected pattern most likely confirms when the model
 * left `candidateId` empty. Models (notably fast/reasoning-light ones) often
 * report a listed pattern as detected but skip copying its id, so the chart
 * showed the pattern card with nothing drawn. Resolved only when the pattern
 * maps to a known skill AND exactly one pattern candidate of that skill exists
 * — with two or more there is no way to tell which one the model meant.
 */
function fallbackPatternCandidateId(
    p: PatternSummary,
    candidates: readonly OverlayCandidate[],
    patternBySkillName: ReadonlyMap<string, string>
): string | undefined {
    const pattern =
        patternBySkillName.get(p.skillName) ??
        patternBySkillName.get(p.patternName);
    if (pattern === undefined) return undefined;
    // Candidate `skill` is the skill file stem ('ascending-wedge'), the skill's
    // `pattern` the ChartPatternId ('ascending_wedge').
    const stem = patternSkillStem(pattern);
    const matches = candidates.filter(
        c => c.kind === 'pattern' && c.skill === stem
    );
    return matches.length === 1 ? matches[0]?.id : undefined;
}

function buildPatternBySkillName(
    skills: readonly Skill[]
): Map<string, string> {
    return new Map(
        skills.flatMap(s =>
            s.pattern
                ? [
                      [s.name, s.pattern] as const,
                      [s.pattern, s.pattern] as const,
                  ]
                : []
        )
    );
}

function collectRefs(
    analysis: AnalysisResponse,
    trendlineIds: readonly string[],
    byId: ReadonlyMap<string, OverlayCandidate>,
    candidates: readonly OverlayCandidate[],
    patternBySkillName: ReadonlyMap<string, string>
): Ref[] {
    const patternRefs = analysis.patternSummaries.flatMap(p => {
        if (!p.detected) return [];
        const id =
            p.candidateId ||
            fallbackPatternCandidateId(p, candidates, patternBySkillName);
        return id
            ? [
                  {
                      id,
                      sourceRef: p.id,
                      variant: 'primary' as const,
                      allowedKinds: PATTERN_SLOT_KINDS,
                  },
              ]
            : [];
    });
    const strategyRefs = analysis.strategyResults.flatMap(s => {
        let elliottSeen = 0;
        return (s.candidateIds ?? []).flatMap(id => {
            if (byId.get(id)?.kind !== 'elliott')
                return [
                    {
                        id,
                        sourceRef: s.id,
                        variant: 'primary' as const,
                        allowedKinds: STRATEGY_SLOT_KINDS,
                    },
                ];
            elliottSeen++;
            if (elliottSeen > MAX_ELLIOTT_PER_STRATEGY) return [];
            return [
                {
                    id,
                    sourceRef: s.id,
                    variant:
                        elliottSeen === 1
                            ? ('primary' as const)
                            : ('alternate' as const),
                    allowedKinds: STRATEGY_SLOT_KINDS,
                },
            ];
        });
    });
    const trendRefs = trendlineIds.slice(0, MAX_TRENDLINES).map(id => ({
        id,
        sourceRef: TRENDLINE_SOURCE_REF,
        variant: 'primary' as const,
        allowedKinds: TRENDLINE_SLOT_KINDS,
    }));
    return [...patternRefs, ...strategyRefs, ...trendRefs];
}

/**
 * A trendline candidate carries exactly one segment (`trendlineCandidates.ts`);
 * an overlay without one — e.g. a malformed cached entry — yields no legacy line.
 */
function toTrendline(o: ChartOverlay): Trendline[] {
    const [s] = o.segments;
    if (!s) return [];
    return [
        {
            direction: s.role === 'support' ? 'ascending' : 'descending',
            start: s.from,
            end: s.to,
        },
    ];
}

/**
 * @internal
 * Joins the model's candidate ids to the candidates the prompt offered
 * (spec 2026-09-28 §2.5). Pure; an id the prompt never offered is returned in
 * `unknownIds` for logging and otherwise ignored. `skills` enables the
 * missing-`candidateId` fallback for detected patterns (see
 * {@link fallbackPatternCandidateId}); omit it to disable the fallback.
 */
export function resolveChartOverlays(
    candidates: readonly OverlayCandidate[],
    analysis: AnalysisResponse,
    trendlineIds: readonly string[],
    skills: readonly Skill[] = []
): ResolvedChartOverlays {
    const byId = new Map(candidates.map(c => [c.id, c]));
    const patternBySkillName = buildPatternBySkillName(skills);
    const seen = new Set<string>();
    const unknownIds: string[] = [];
    const chartOverlays: ChartOverlay[] = [];
    for (const ref of collectRefs(
        analysis,
        trendlineIds,
        byId,
        candidates,
        patternBySkillName
    )) {
        const candidate = byId.get(ref.id);
        // A known id resolved from the wrong slot (e.g. an elliott candidate
        // id used as a patternSummary.candidateId) is treated like an
        // unknown id — the model referenced something that does not belong there.
        if (!candidate || !ref.allowedKinds.includes(candidate.kind)) {
            unknownIds.push(ref.id);
            continue;
        }
        if (seen.has(ref.id)) continue;
        seen.add(ref.id);
        const { promptLine: _promptLine, ...drawable } = candidate;
        chartOverlays.push({
            ...drawable,
            sourceRef: ref.sourceRef,
            variant: ref.variant,
        });
    }
    return {
        chartOverlays,
        trendlines: chartOverlays
            .filter(o => o.kind === 'trendline')
            .flatMap(toTrendline),
        unknownIds,
    };
}
