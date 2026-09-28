import type {
    AnalysisResponse,
    ChartOverlay,
    OverlayCandidate,
    OverlayKind,
    OverlayVariant,
    ResolvedChartOverlays,
    Trendline,
} from '@/domain/types';

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

function collectRefs(
    analysis: AnalysisResponse,
    trendlineIds: readonly string[],
    byId: ReadonlyMap<string, OverlayCandidate>
): Ref[] {
    const patternRefs = analysis.patternSummaries.flatMap(p =>
        p.detected && p.candidateId
            ? [
                  {
                      id: p.candidateId,
                      sourceRef: p.id,
                      variant: 'primary' as const,
                      allowedKinds: PATTERN_SLOT_KINDS,
                  },
              ]
            : []
    );
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

function toTrendline(o: ChartOverlay): Trendline {
    const [s] = o.segments;
    return {
        direction: s.role === 'support' ? 'ascending' : 'descending',
        start: s.from,
        end: s.to,
    };
}

/**
 * @internal
 * Joins the model's candidate ids to the candidates the prompt offered
 * (spec 2026-09-28 §2.5). Pure; an id the prompt never offered is returned in
 * `unknownIds` for logging and otherwise ignored.
 */
export function resolveChartOverlays(
    candidates: readonly OverlayCandidate[],
    analysis: AnalysisResponse,
    trendlineIds: readonly string[]
): ResolvedChartOverlays {
    const byId = new Map(candidates.map(c => [c.id, c]));
    const seen = new Set<string>();
    const unknownIds: string[] = [];
    const chartOverlays: ChartOverlay[] = [];
    for (const ref of collectRefs(analysis, trendlineIds, byId)) {
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
            .map(toTrendline),
        unknownIds,
    };
}
