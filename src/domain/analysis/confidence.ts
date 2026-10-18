import { UNMATCHED_SKILL_CONFIDENCE_WEIGHT } from '@/domain/indicators/constants';
import type {
    AnalysisDataAsOf,
    AnalysisResponse,
    CandlePatternSummary,
    ChartDisplayType,
    PatternResult,
    PatternSummary,
    RawAnalysisResponse,
    Skill,
    SkillChartDisplay,
    StrategyOverlayKind,
    StrategyResult,
} from '@/domain/types';
import {
    asArray,
    asNumber,
    asObject,
    asOptionalEnum,
    asString,
    compact,
} from '@/domain/analysis/normalizePrimitives';

import {
    normalizeActionRecommendation,
    normalizeCandlePatternSummary,
    normalizeChartOverlay,
    normalizeIndicatorGuideResult,
    normalizeKeyLevels,
    normalizePatternSummary,
    normalizePriceTargets,
    normalizeRiskLevel,
    normalizeStrategyResult,
    normalizeTrend,
    normalizeTrendline,
} from '@/domain/analysis/normalize';
import { extractJsonFromLlmResponse } from '@/domain/analysis/promptFormat';
import {
    OVERLAY_ID_PREFIX,
    STRATEGY_OVERLAY_KINDS,
    overlayKindOfId,
} from '@/domain/overlays/constants';

/**
 * @internal
 * The Korean fallback summary emitted when the worker returns an empty or
 * malformed payload. Exported so callers can detect whether the result is a
 * real LLM response or a synthesised default.
 */
export const EMPTY_ANALYSIS_FALLBACK_SUMMARY =
    'AI로부터 분석 결과를 받지 못했습니다. 재분석을 시도해 주세요.';

/**
 * @internal
 * Returns `true` when `result` was synthesised from an empty or malformed
 * worker payload — i.e. every array field is empty (including nested support /
 * resistance levels and bullish / bearish price targets) and the summary is the
 * Korean fallback string. Can be used by callers to skip side effects (e.g.
 * cache writes) so a subsequent retry can succeed.
 *
 * @param result - A normalized {@link AnalysisResponse}.
 * @returns `true` when the result is a fallback shape with no analytical content.
 */
export function isFallbackAnalysis(result: AnalysisResponse): boolean {
    return (
        result.summary === EMPTY_ANALYSIS_FALLBACK_SUMMARY &&
        result.indicatorResults.length === 0 &&
        result.patternSummaries.length === 0 &&
        result.strategyResults.length === 0 &&
        result.candlePatterns.length === 0 &&
        result.trendlines.length === 0 &&
        result.keyLevels.support.length === 0 &&
        result.keyLevels.resistance.length === 0 &&
        (result.priceTargets.bullish?.targets.length ?? 0) === 0 &&
        (result.priceTargets.bearish?.targets.length ?? 0) === 0
    );
}

/**
 * Skill-lookup key: case-insensitive, with whitespace and `-`/`_` separators
 * dropped — so the model's '상승 쐐기', 'ascending wedge' and
 * 'fibonacci-retracement' meet '상승쐐기', 'ascending_wedge' and
 * 'fibonacci_retracement'. Nothing fuzzier: no substring or edit-distance
 * guessing.
 */
function skillKey(name: string): string {
    return name.toLowerCase().replace(/[\s_-]+/g, '');
}

interface SkillLookup {
    byName: Map<string, Skill>;
    byPattern: Map<string, Skill>;
    /** `type: 'strategy'` skills only, keyed like `byName`. */
    strategyByName: Map<string, Skill>;
    strategies: readonly Skill[];
}

function buildSkillLookup(skills: Skill[]): SkillLookup {
    const strategies = skills.filter(s => s.type === 'strategy');
    return {
        byName: new Map(skills.map(s => [skillKey(s.name), s])),
        byPattern: new Map(
            skills.flatMap(s => (s.pattern ? [[skillKey(s.pattern), s]] : []))
        ),
        strategyByName: new Map(strategies.map(s => [skillKey(s.name), s])),
        strategies,
    };
}

/** The first of `names` that matches a skill by name, then by `pattern`. */
function findSkill(
    lookup: SkillLookup,
    ...names: readonly string[]
): Skill | undefined {
    return names
        .map(skillKey)
        .map(key => lookup.byName.get(key) ?? lookup.byPattern.get(key))
        .find(skill => skill !== undefined);
}

/**
 * How a strategy name spells out an overlay kind: `contains` anywhere in the
 * {@link skillKey}, or `words` as a whole separator-delimited word ('fib' is
 * too short to trust inside another word). English and Korean spellings seen
 * in production ('Elliott Wave', 'fibonacci-retracement', '피보나치 되돌림').
 */
const STRATEGY_KIND_NAMES: Record<
    StrategyOverlayKind,
    { readonly contains: readonly string[]; readonly words: readonly string[] }
> = {
    elliott: { contains: ['elliott', '엘리어트', '엘리엇'], words: [] },
    fibonacci: { contains: ['fibonacci', '피보나치'], words: ['fib'] },
    divergence: { contains: ['divergence', '다이버전스'], words: [] },
};

/**
 * The strategy skill a model-written `strategyName` stands for: a key match
 * on a `type: 'strategy'` skill's name, else — for a name like 'Elliott Wave'
 * or '피보나치 되돌림' — the one strategy skill declaring the single overlay
 * kind the name spells out ({@link STRATEGY_KIND_NAMES}). `undefined` when
 * the name spells out no kind, several kinds, or a kind several skills
 * declare.
 */
function findStrategySkill(
    lookup: SkillLookup,
    strategyName: string
): Skill | undefined {
    const key = skillKey(strategyName);
    const exact = lookup.strategyByName.get(key);
    if (exact) return exact;
    const words = strategyName.toLowerCase().split(/[\s_-]+/);
    const kinds = STRATEGY_OVERLAY_KINDS.filter(kind => {
        const { contains, words: wholeWords } = STRATEGY_KIND_NAMES[kind];
        return (
            contains.some(token => key.includes(token)) ||
            wholeWords.some(word => words.includes(word))
        );
    });
    if (kinds.length !== 1) return undefined;
    // A name that also spells out another strategy skill in full
    // ('MACD 대순환 분석 (다이버전스 확인)') is that strategy — renaming it to
    // the kind's skill would take its card, weight and drawings.
    if (
        lookup.strategies.some(
            s => s.overlayKind !== kinds[0] && key.includes(skillKey(s.name))
        )
    )
        return undefined;
    // Several cards may land on one skill ('RSI 다이버전스', 'MACD 다이버전스'
    // → '다이버전스 전략'); they stay apart by id suffix (`_0`, `_1`).
    const declaring = lookup.strategies.filter(s => s.overlayKind === kinds[0]);
    return declaring.length === 1 ? declaring[0] : undefined;
}

/**
 * A skill of another declared type (indicator guide, strategy, candlestick,
 * support/resistance) with no `pattern` id. An untyped skill is not counted:
 * its kind is unknown.
 */
const isNonPatternSkill = (skill: Skill): boolean =>
    skill.type !== undefined && skill.type !== 'pattern' && !skill.pattern;

type NormalizedPatternCard = Omit<PatternSummary, 'confidenceWeight' | 'id'>;

/**
 * A pattern card as the UI may show it, or `null` when it is not a chart
 * pattern at all (2026-10-08 A/B: a trendline reported as a card titled
 * "Pattern Index Reference" with candidateId `tl:resistance:…`).
 *
 * - The card's skill (by `skillName`, then `patternName`) is a pattern (or
 *   untyped) skill: kept as is. A wrong-kind id on it is rejected later by
 *   `resolveChartOverlays` (reported in `misplacedIds`, an info log), which leaves it undrawn
 *   and target-free.
 * - Its skill is a known NON-pattern skill (the always-on pattern index, an
 *   indicator guide, a strategy) — repaired when its `patternName` names a
 *   pattern skill (skillName 'Pattern Index Reference', patternName 'Cup and
 *   Handle' → '컵앤핸들'), else when its candidateId is a pattern overlay id
 *   whose pattern has a skill (`pattern:cup_and_handle:…` → that skill's
 *   name). Without either it is dropped — its title would be the other
 *   skill's name and there is no pattern to name it after.
 * - Its skill is unknown (a pattern outside the catalog the model may add)
 *   and its candidateId belongs to another overlay kind (`tl:`, `div:`,
 *   `fib:`, `ew:`): dropped — it describes that drawing, not a pattern.
 *
 * Dropped rather than stripped: a card is only a title, a summary and key
 * prices, and here the title itself is wrong.
 */
function patternCardOrNull(
    p: NormalizedPatternCard,
    lookup: SkillLookup
): NormalizedPatternCard | null {
    const skill = findSkill(lookup, p.skillName, p.patternName);
    const idKind =
        p.candidateId === undefined
            ? undefined
            : overlayKindOfId(p.candidateId);
    if (skill === undefined)
        return idKind === undefined || idKind === 'pattern' ? p : null;
    if (!isNonPatternSkill(skill)) return p;
    const patternId =
        idKind === 'pattern' && p.candidateId !== undefined
            ? p.candidateId
                  .slice(OVERLAY_ID_PREFIX.pattern.length)
                  .split(':')[0]
            : undefined;
    const named = [p.patternName, patternId]
        .filter((name): name is string => name !== undefined)
        .map(name => findSkill(lookup, name))
        .find(s => s !== undefined && !isNonPatternSkill(s));
    return named === undefined ? null : { ...p, skillName: named.name };
}

/** `${name}_${n}`, where `n` counts earlier occurrences of the same name in `names`. */
function buildUniqueIds(names: readonly string[]): string[] {
    const ids: string[] = [];
    const counter = new Map<string, number>();
    for (const name of names) {
        const count = counter.get(name) ?? 0;
        ids.push(`${name}_${count}`);
        counter.set(name, count + 1);
    }
    return ids;
}

/**
 * @internal Enriches analysis with confidence weights.
 *
 * Normalize a raw worker response and weight each result by skill confidence.
 *
 * Pipeline:
 * 1. Each array field (`patternSummaries`, `strategyResults`,
 *    `candlePatterns`, `indicatorResults`, `trendlines`) is type-validated
 *    via the corresponding `normalize*` helpers; malformed entries are dropped.
 *    A pattern card that is not a chart pattern (another skill's name, or an
 *    unknown name citing another overlay kind's id) is repaired or dropped —
 *    see {@link patternCardOrNull}.
 * 2. Pattern and strategy entries are looked up in the provided skills (by
 *    `name`, falling back to `pattern`; patterns try `skillName`, then
 *    `patternName`) — ignoring case, whitespace and `-`/`_`. The matching
 *    skill's `confidenceWeight` is attached; unmatched entries fall back to
 *    `UNMATCHED_SKILL_CONFIDENCE_WEIGHT`. A matched pattern's `skillName` and
 *    a matched strategy's `strategyName` are rewritten to the skill's `name`
 *    (a strategy also matches through the one overlay kind its name spells
 *    out, e.g. 'Elliott Wave' → the strategy skill declaring `elliott`).
 * 3. Stable per-result IDs are generated by appending an index to each name
 *    so duplicates are uniquely addressable downstream. Pattern and strategy
 *    ids share one counter (both are chart-overlay `sourceRef`s), so the same
 *    name in both lists never yields the same id.
 *
 * @param rawInput - The unvalidated AI response. Typed `unknown` at the
 *   public boundary; cast internally to the worker response shape.
 * @param skills - The skills active when the prompt was built; used for the
 *   confidence-weight lookup.
 * @returns A fully-validated, weight-enriched {@link AnalysisResponse}.
 *
 * @see buildAnalysisPrompt
 */
export function enrichAnalysisWithConfidence(
    rawInput: unknown,
    skills: Skill[]
): AnalysisResponse {
    // rawInput is typed `unknown` at the public boundary so consumers do not
    // need to import the internal RawAnalysisResponse shape (which mirrors the
    // external LLM response and would couple consumers to that schema).
    // RawAnalysisResponse only widens the top-level into optional unknowns —
    // every field is still validated by the normalize* helpers below.
    const raw = rawInput as RawAnalysisResponse;
    const lookup = buildSkillLookup(skills);

    // 모든 배열 필드를 타입 검증하며 정규화한다.
    // 잘못된 항목(null 반환)은 탈락시킨다.
    const patternSummaries = compact(
        compact(asArray(raw.patternSummaries).map(normalizePatternSummary)).map(
            p => patternCardOrNull(p, lookup)
        )
    );
    const strategyResults = compact(
        asArray(raw.strategyResults).map(normalizeStrategyResult)
    );
    const candlePatterns = compact(
        asArray(raw.candlePatterns).map(normalizeCandlePatternSummary)
    );
    const indicatorResults = compact(
        asArray(raw.indicatorResults).map(normalizeIndicatorGuideResult)
    );
    const trendlines = compact(asArray(raw.trendlines).map(normalizeTrendline));

    // Pattern and strategy ids share one namespace: both are chart-overlay
    // `sourceRef`s, which consumers key drawings and toggles by. A model
    // naming a strategy like a pattern card ("엘리어트 파동" in both) gets
    // the next index (`엘리어트 파동_1`) instead of a duplicate id. Candle
    // ids are never a `sourceRef` and keep their own counter.
    // A strategy is renamed to its skill's name BEFORE ids are built, so the
    // id, the card label, the confidence weight and overlay resolution
    // (`resolveChartOverlays` looks strategy skills up by exact name) all see
    // the canonical name. A name matching no strategy skill — including a
    // pattern reported as a strategy — is kept as written.
    const canonicalStrategies = strategyResults.map(r => {
        const skill = findStrategySkill(lookup, r.strategyName);
        return {
            ...r,
            strategyName: skill?.name ?? r.strategyName,
            confidenceWeight:
                (skill ?? findSkill(lookup, r.strategyName))
                    ?.confidenceWeight ?? UNMATCHED_SKILL_CONFIDENCE_WEIGHT,
        };
    });
    const cardIds = buildUniqueIds([
        ...patternSummaries.map(p => p.patternName),
        ...canonicalStrategies.map(r => r.strategyName),
    ]);
    const patternSummaryIds = cardIds.slice(0, patternSummaries.length);
    const strategyResultIds = cardIds.slice(patternSummaries.length);
    const candlePatternIds = buildUniqueIds(
        candlePatterns.map(p => p.patternName)
    );

    const enrichedPatterns: PatternResult[] = patternSummaries.map(
        (p: NormalizedPatternCard, index: number): PatternResult => {
            const skill = findSkill(lookup, p.skillName, p.patternName);
            return {
                ...p,
                // The model sometimes echoes the pattern id ('ascending_wedge')
                // as skillName; canonicalise to the skill's display name so the
                // UI can localise it like any other pattern card.
                skillName: skill?.name ?? p.skillName,
                id: patternSummaryIds[index],
                confidenceWeight:
                    skill?.confidenceWeight ??
                    UNMATCHED_SKILL_CONFIDENCE_WEIGHT,
                renderConfig: skill?.display?.chart,
            };
        }
    );

    return {
        summary: asString(raw.summary, EMPTY_ANALYSIS_FALLBACK_SUMMARY),
        trend: normalizeTrend(raw.trend),
        indicatorResults,
        riskLevel: normalizeRiskLevel(raw.riskLevel),
        keyLevels: normalizeKeyLevels(raw.keyLevels),
        priceTargets: normalizePriceTargets(raw.priceTargets),
        trendlines,
        actionRecommendation: normalizeActionRecommendation(
            raw.actionRecommendation
        ),
        patternSummaries: enrichedPatterns,
        strategyResults: canonicalStrategies.map(
            (r, index): StrategyResult => ({
                ...r,
                id: strategyResultIds[index],
            })
        ),
        candlePatterns: candlePatterns.map(
            (
                p: Omit<CandlePatternSummary, 'id'>,
                index: number
            ): CandlePatternSummary => ({
                ...p,
                id: candlePatternIds[index],
            })
        ),
    };
}

const CHART_DISPLAY_TYPES: readonly ChartDisplayType[] = [
    'line',
    'marker',
    'region',
];

/**
 * Safely parse a cached `renderConfig` value into a {@link SkillChartDisplay}.
 *
 * Copies only the four known fields declared by {@link SkillChartDisplay}
 * (`show`, `type`, `color`, `label`) using explicit type guards. Unknown or
 * extra keys are dropped. Returns `undefined` when the value is not an object
 * or when every required field is absent/invalid.
 */
function normalizePatternRenderConfig(
    value: unknown
): SkillChartDisplay | undefined {
    const obj = asObject(value);
    if (!obj) return undefined;

    const type = asOptionalEnum<ChartDisplayType>(
        obj.type,
        CHART_DISPLAY_TYPES
    );
    const color = typeof obj.color === 'string' ? obj.color : undefined;
    const label = typeof obj.label === 'string' ? obj.label : undefined;
    const show = typeof obj.show === 'boolean' ? obj.show : undefined;

    // Require at least `type` to be present and valid; without it the
    // chart renderer cannot determine how to draw the overlay.
    if (type === undefined) return undefined;

    return {
        show: show ?? false,
        type,
        color: color ?? '',
        label: label ?? '',
    };
}

function normalizeCachedPatternResult(
    item: unknown,
    fallbackId: string
): PatternResult | null {
    const base = normalizePatternSummary(item);
    if (!base) return null;

    const raw = asObject(item);
    const renderConfig = normalizePatternRenderConfig(raw?.renderConfig);

    return {
        ...base,
        id: asString(raw?.id, fallbackId),
        confidenceWeight:
            asNumber(raw?.confidenceWeight) ??
            UNMATCHED_SKILL_CONFIDENCE_WEIGHT,
        renderConfig,
    };
}

function normalizeCachedStrategyResult(
    item: unknown,
    fallbackId: string
): StrategyResult | null {
    const base = normalizeStrategyResult(item);
    if (!base) return null;

    const raw = asObject(item);

    return {
        ...base,
        id: asString(raw?.id, fallbackId),
        confidenceWeight:
            asNumber(raw?.confidenceWeight) ??
            UNMATCHED_SKILL_CONFIDENCE_WEIGHT,
    };
}

function normalizeCachedCandlePattern(
    item: unknown,
    fallbackId: string
): CandlePatternSummary | null {
    const base = normalizeCandlePatternSummary(item);
    if (!base) return null;

    const raw = asObject(item);

    return {
        ...base,
        id: asString(raw?.id, fallbackId),
    };
}

/**
 * Keep a cached `dataAsOf` only when both members are finite numbers — a
 * half-formed value would mislead a consumer comparing it against a session
 * boundary, and absence already means "unknown" to them.
 */
function normalizeDataAsOf(value: unknown): AnalysisDataAsOf | undefined {
    const obj = asObject(value);
    const barTime = asNumber(obj?.barTime);
    const close = asNumber(obj?.close);
    return barTime !== undefined && close !== undefined
        ? { barTime, close }
        : undefined;
}

function parseCachedPayload(raw: unknown): unknown {
    return typeof raw === 'string' ? extractJsonFromLlmResponse(raw) : raw;
}

/**
 * @internal
 * Normalize an already-cached technical analysis response without re-matching
 * it against the current skills list.
 *
 * Cache entries are normally written after `enrichAnalysisWithConfidence`, so
 * they may already contain stable ids, confidence weights, render config, and
 * reconciliation metadata. This path preserves those fields when present while
 * still filling missing top-level and child fields with safe defaults.
 *
 * @param rawInput - Cached analysis payload read from Redis.
 * @returns A fully-normalized {@link AnalysisResponse}.
 */
export function normalizeCachedAnalysisResponse(
    rawInput: unknown
): AnalysisResponse {
    const raw = (asObject(parseCachedPayload(rawInput)) ??
        {}) as RawAnalysisResponse;

    const patternSummaries = compact(
        asArray(raw.patternSummaries).map((item, index) =>
            normalizeCachedPatternResult(item, `pattern_${index}`)
        )
    );
    const strategyResults = compact(
        asArray(raw.strategyResults).map((item, index) =>
            normalizeCachedStrategyResult(item, `strategy_${index}`)
        )
    );
    const candlePatterns = compact(
        asArray(raw.candlePatterns).map((item, index) =>
            normalizeCachedCandlePattern(item, `candle_${index}`)
        )
    );

    const analyzedAt = asString(raw.analyzedAt);
    const dataAsOf = normalizeDataAsOf(raw.dataAsOf);

    return {
        summary: asString(raw.summary, EMPTY_ANALYSIS_FALLBACK_SUMMARY),
        trend: normalizeTrend(raw.trend),
        indicatorResults: compact(
            asArray(raw.indicatorResults).map(normalizeIndicatorGuideResult)
        ),
        riskLevel: normalizeRiskLevel(raw.riskLevel),
        keyLevels: normalizeKeyLevels(raw.keyLevels),
        priceTargets: normalizePriceTargets(raw.priceTargets),
        trendlines: compact(asArray(raw.trendlines).map(normalizeTrendline)),
        chartOverlays: compact(
            asArray(raw.chartOverlays).map(normalizeChartOverlay)
        ),
        actionRecommendation: normalizeActionRecommendation(
            raw.actionRecommendation
        ),
        patternSummaries,
        strategyResults,
        candlePatterns,
        ...(analyzedAt ? { analyzedAt } : {}),
        ...(dataAsOf !== undefined ? { dataAsOf } : {}),
    };
}
