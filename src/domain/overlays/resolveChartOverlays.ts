import type {
    AnalysisResponse,
    ChartOverlay,
    OverlayCandidate,
    OverlayKind,
    PatternBreakoutDirection,
    PatternResult,
    PatternSummary,
    PatternTargetGeometry,
    ResolvedChartOverlays,
    Skill,
    SkillCategory,
    StrategyOverlayKind,
    StrategyResult,
    Trendline,
} from '@/domain/types';
import { patternSkillStem } from '@/domain/overlays/patternOverlays';
import {
    STRATEGY_KIND_SOURCE_REF,
    STRATEGY_OVERLAY_KINDS,
} from '@/domain/overlays/constants';

const TRENDLINE_SOURCE_REF = 'trendlines';
const MAX_TRENDLINES = 3;
const MAX_ELLIOTT_PER_STRATEGY = 2;

/**
 * How many RESOLVED overlays of a kind one `sourceRef` may draw — counted
 * after validation and dedupe, so an unknown, duplicate or wrong-kind id
 * never pushes a real one out (trendlines share the one `'trendlines'`
 * sourceRef, so theirs is the global cap).
 */
const MAX_PER_SOURCE: Partial<Record<OverlayKind, number>> = {
    elliott: MAX_ELLIOTT_PER_STRATEGY,
    trendline: MAX_TRENDLINES,
};

/** Which candidate kinds each result slot may reference — a known id resolved from the wrong slot is as invalid as an unknown one. */
const PATTERN_SLOT_KINDS: readonly OverlayKind[] = ['pattern'];
const TRENDLINE_SLOT_KINDS: readonly OverlayKind[] = ['trendline'];
const STRATEGY_SLOT_KINDS: readonly OverlayKind[] = STRATEGY_OVERLAY_KINDS;

/**
 * Which kinds one strategy card may reference. A strategy skill draws only
 * its declared `overlayKind` — the chart menu names a strategy drawing after
 * its card, so an Elliott card citing a Fibonacci candidate showed "Elliott
 * wave" over a Fibonacci ladder. A known strategy (`type: 'strategy'` skill)
 * without `overlayKind` draws nothing under its own card, and neither does a
 * name matching no strategy skill exactly (`enrichAnalysisWithConfidence`
 * has already renamed a recognisable one — "Elliott Wave", "피보나치 되돌림" —
 * to its skill's name). Their strategy-kind citations are not lost: they are
 * cross-kind for that card, so {@link homeStrategyRefs} draws them under the
 * card of their kind or under `STRATEGY_KIND_SOURCE_REF`. Only with no
 * strategy skills at all (none passed) is every strategy kind kept under the
 * citing card: there is nothing to check against.
 */
function strategySlotKinds(
    strategyName: string,
    strategyByName: ReadonlyMap<string, Skill>
): readonly OverlayKind[] {
    if (strategyByName.size === 0) return STRATEGY_SLOT_KINDS;
    const kind = strategyByName.get(strategyName)?.overlayKind;
    return kind ? [kind] : [];
}

/**
 * Each kind's home card in the analysis: the first card whose skill declares
 * it (`overlayKind`). A kind no card declares is absent.
 */
function homeCardIds(
    strategyResults: readonly StrategyResult[],
    strategyByName: ReadonlyMap<string, Skill>
): ReadonlyMap<StrategyOverlayKind, string> {
    return new Map(
        STRATEGY_OVERLAY_KINDS.flatMap(kind => {
            const home = strategyResults.find(
                s => strategyByName.get(s.strategyName)?.overlayKind === kind
            );
            return home ? [[kind, home.id] as const] : [];
        })
    );
}

const isStrategyOverlayKind = (
    kind: OverlayKind
): kind is StrategyOverlayKind => STRATEGY_SLOT_KINDS.includes(kind);

/**
 * Cross-kind strategy ids, re-homed instead of drawn under the citing card.
 *
 * The model often cites a Fibonacci leg from the Elliott card (or a
 * multi-timeframe card). Drawn under the citing card it is mislabelled —
 * the chart menu names a drawing after its card, so "Elliott wave" showed a
 * Fibonacci ladder; dropped, real drawings vanished (replaying 552
 * production analyses on 2026-10-01: 65 of the 264 analyses showing a
 * Fibonacci ladder lost it, and 56 of 74 analyses with an Elliott-cited leg
 * had no Fibonacci card at all). So the id goes to the analysis' own card of
 * that kind when there is one, else to {@link STRATEGY_KIND_SOURCE_REF} —
 * either way the label matches what is drawn.
 *
 * These refs come after every card's own citations, so a card's own ids
 * keep first claim (and an Elliott card's own count stays its primary).
 * A prompt-side fix (ask the model to cite each id on its own kind) was
 * A/B-tested with the real model and shelved: cross-kind citations fell
 * 13 → 2–4 but drawn ladders did not rise, and stricter wordings made the
 * Fibonacci card cite `[]` for its own legs.
 */
function homeStrategyRefs(
    strategyResults: readonly StrategyResult[],
    byId: ReadonlyMap<string, OverlayCandidate>,
    strategyByName: ReadonlyMap<string, Skill>
): { refs: Ref[]; movedKeys: ReadonlySet<string> } {
    if (strategyByName.size === 0) return { refs: [], movedKeys: new Set() };
    const homes = homeCardIds(strategyResults, strategyByName);
    const moved = strategyResults.flatMap(s => {
        const own = strategyByName.get(s.strategyName)?.overlayKind;
        return (s.candidateIds ?? []).flatMap(id => {
            const kind = byId.get(id)?.kind;
            if (
                kind === undefined ||
                kind === own ||
                !isStrategyOverlayKind(kind)
            )
                return [];
            const ref: Ref = {
                id,
                sourceRef: homes.get(kind) ?? STRATEGY_KIND_SOURCE_REF[kind],
                allowedKinds: [kind],
            };
            return [{ ref, key: movedKey(s.id, id) }];
        });
    });
    return {
        refs: moved.map(m => m.ref),
        movedKeys: new Set(moved.map(m => m.key)),
    };
}

/** Identifies one card's citation of one id (`homeStrategyRefs` ↔ `collectRefs`). */
const movedKey = (cardId: string, id: string): string =>
    JSON.stringify([cardId, id]);

type PatternSkill = Skill & { pattern: string };

interface Ref {
    id: string;
    sourceRef: string;
    allowedKinds: readonly OverlayKind[];
    /**
     * The candidate `skill` the card requires — set for a pattern card whose
     * skill is known, so a "cup and handle" card cannot carry a double-top
     * candidate (the menu would label the double top "cup and handle").
     */
    requiredSkill?: string;
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
    patternBySkillName: ReadonlyMap<string, PatternSkill>
): string | undefined {
    const stem = patternCandidateSkill(p, patternBySkillName);
    if (stem === undefined) return undefined;
    const matches = candidates.filter(
        c => c.kind === 'pattern' && c.skill === stem
    );
    return matches.length === 1 ? matches[0]?.id : undefined;
}

/**
 * The candidate `skill` a pattern card stands for, or `undefined` when the
 * card's skill is unknown. Candidate `skill` is the skill file stem
 * ('ascending-wedge'), the skill's `pattern` the ChartPatternId
 * ('ascending_wedge').
 */
function patternCandidateSkill(
    p: PatternSummary,
    patternBySkillName: ReadonlyMap<string, PatternSkill>
): string | undefined {
    const skill = patternSkillOf(p, patternBySkillName);
    return skill === undefined ? undefined : patternSkillStem(skill.pattern);
}

/** The pattern skill a card stands for — looked up by `skillName`, then `patternName`. */
function patternSkillOf(
    p: PatternSummary,
    patternBySkillName: ReadonlyMap<string, PatternSkill>
): PatternSkill | undefined {
    return (
        patternBySkillName.get(p.skillName) ??
        patternBySkillName.get(p.patternName)
    );
}

/** Pattern skills keyed by both display name and `pattern` id. */
function buildPatternBySkillName(
    skills: readonly Skill[]
): Map<string, PatternSkill> {
    return new Map(
        skills
            .filter((s): s is PatternSkill => Boolean(s.pattern))
            .flatMap(s => [[s.name, s] as const, [s.pattern, s] as const])
    );
}

function collectRefs(
    analysis: AnalysisResponse,
    trendlineIds: readonly string[],
    candidates: readonly OverlayCandidate[],
    byId: ReadonlyMap<string, OverlayCandidate>,
    patternBySkillName: ReadonlyMap<string, PatternSkill>,
    strategyByName: ReadonlyMap<string, Skill>
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
                      allowedKinds: PATTERN_SLOT_KINDS,
                      requiredSkill: patternCandidateSkill(
                          p,
                          patternBySkillName
                      ),
                  },
              ]
            : [];
    });
    const moved = homeStrategyRefs(
        analysis.strategyResults,
        byId,
        strategyByName
    );
    // A moved id is not also kept as the citing card's own (rejected) ref —
    // it is not unknown, so it must not land in `unknownIds`.
    const isMoved = (cardId: string, id: string) =>
        moved.movedKeys.has(movedKey(cardId, id));
    const strategyRefs = analysis.strategyResults.flatMap(s => {
        const allowedKinds = strategySlotKinds(s.strategyName, strategyByName);
        return (s.candidateIds ?? [])
            .filter(id => !isMoved(s.id, id))
            .map(id => ({ id, sourceRef: s.id, allowedKinds }));
    });
    const trendRefs = trendlineIds.map(id => ({
        id,
        sourceRef: TRENDLINE_SOURCE_REF,
        allowedKinds: TRENDLINE_SLOT_KINDS,
    }));
    return [...patternRefs, ...strategyRefs, ...moved.refs, ...trendRefs];
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
 * {@link fallbackPatternCandidateId}), the pattern-card identity check (see
 * {@link patternCandidateSkill}) and the per-strategy kind check (see
 * {@link strategySlotKinds}); omit it to disable all three.
 */
export function resolveChartOverlays(
    candidates: readonly OverlayCandidate[],
    analysis: AnalysisResponse,
    trendlineIds: readonly string[],
    skills: readonly Skill[] = []
): ResolvedChartOverlays {
    const byId = new Map(candidates.map(c => [c.id, c]));
    const patternBySkillName = buildPatternBySkillName(skills);
    const strategyByName = new Map(
        skills.filter(s => s.type === 'strategy').map(s => [s.name, s])
    );
    const seen = new Set<string>();
    // Resolved overlays per `sourceRef` + kind, for {@link MAX_PER_SOURCE}.
    const drawnPerSource = new Map<string, number>();
    const unknownIds: string[] = [];
    const chartOverlays: ChartOverlay[] = [];
    for (const ref of collectRefs(
        analysis,
        trendlineIds,
        candidates,
        byId,
        patternBySkillName,
        strategyByName
    )) {
        const candidate = byId.get(ref.id);
        // A known id resolved from the wrong slot (e.g. an elliott candidate
        // id used as a patternSummary.candidateId) is treated like an
        // unknown id — the model referenced something that does not belong there.
        if (
            !candidate ||
            !ref.allowedKinds.includes(candidate.kind) ||
            (ref.requiredSkill !== undefined &&
                candidate.skill !== ref.requiredSkill)
        ) {
            unknownIds.push(ref.id);
            continue;
        }
        if (seen.has(ref.id)) continue;
        const capKey = `${ref.sourceRef}:${candidate.kind}`;
        const drawn = drawnPerSource.get(capKey) ?? 0;
        // Over the cap: dropped silently and, like a rejected ref, without
        // consuming the id.
        if (drawn >= (MAX_PER_SOURCE[candidate.kind] ?? Infinity)) continue;
        seen.add(ref.id);
        drawnPerSource.set(capKey, drawn + 1);
        const { promptLine: _promptLine, ...drawable } = candidate;
        chartOverlays.push({
            ...drawable,
            sourceRef: ref.sourceRef,
            // An elliott card's first RESOLVED count is its primary; the
            // next one (index 1 in `candidateIds` once rejects are skipped)
            // is the faded alternate.
            variant:
                candidate.kind === 'elliott' && drawn > 0
                    ? 'alternate'
                    : 'primary',
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

/** Breakout direction a directional pattern skill's category implies; neutral categories imply none. */
const CATEGORY_DIRECTION: Partial<
    Record<SkillCategory, PatternBreakoutDirection>
> = {
    reversal_bullish: 'up',
    continuation_bullish: 'up',
    reversal_bearish: 'down',
    continuation_bearish: 'down',
};

/**
 * @internal
 * Makes each detected pattern card's `geometry` — the input `ai-levels.ts`
 * derives its measured/conservative target `keyPrices` from — agree with what
 * the chart draws for it:
 *
 * - A card that resolved to a pattern overlay (`chartOverlays` from
 *   {@link resolveChartOverlays}, so the same slot, identity and dedupe
 *   checks apply) gets that candidate's printed geometry from
 *   `patternGeometries` in place of whatever the model copied — breakout,
 *   extreme, direction and invalidation alike, so a miscopied number or an
 *   invented direction can no longer put the card's target on the other side
 *   of the drawn breakout line.
 * - A card with no resolved overlay keeps the model's geometry, unless its
 *   direction contradicts the card skill's directional category
 *   (`*_bullish` ⇒ `'up'`, `*_bearish` ⇒ `'down'`) — e.g. a double top with
 *   an `'up'` breakout. That geometry is dropped, so no target is derived
 *   from it.
 *
 * Run it before `postProcessAnalysisWithReconcile`, which derives the targets.
 *
 * @param analysis - The enriched analysis (pattern ids already assigned).
 * @param chartOverlays - {@link resolveChartOverlays}' overlays for `analysis`.
 * @param patternGeometries - Printed geometry per offered pattern overlay id
 *   (`TechnicalAssembledPrompt.patternGeometries`).
 * @param skills - Skills for the category check; omit to skip it.
 * @returns `analysis` with aligned `patternSummaries[].geometry`.
 */
export function alignPatternGeometry(
    analysis: AnalysisResponse,
    chartOverlays: readonly ChartOverlay[],
    patternGeometries: ReadonlyMap<string, PatternTargetGeometry>,
    skills: readonly Skill[] = []
): AnalysisResponse {
    const overlayIdBySource = new Map(
        chartOverlays
            .filter(o => o.kind === 'pattern')
            .map(o => [o.sourceRef, o.id])
    );
    const patternBySkillName = buildPatternBySkillName(skills);
    const align = (p: PatternResult): PatternResult => {
        if (!p.detected) return p;
        const overlayId = overlayIdBySource.get(p.id);
        const drawn =
            overlayId === undefined
                ? undefined
                : patternGeometries.get(overlayId);
        if (drawn) return { ...p, geometry: drawn };
        const category = patternSkillOf(p, patternBySkillName)?.category;
        const implied =
            category === undefined ? undefined : CATEGORY_DIRECTION[category];
        if (!p.geometry || implied === undefined) return p;
        if (p.geometry.direction === implied) return p;
        const { geometry: _contradicting, ...rest } = p;
        return rest;
    };
    return {
        ...analysis,
        patternSummaries: analysis.patternSummaries.map(align),
    };
}
