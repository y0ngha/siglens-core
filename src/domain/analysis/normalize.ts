import type {
    ActionRecommendation,
    AnalysisSignal,
    CandlePatternSummary,
    ChartOverlay,
    EntryRecommendation,
    IndicatorGuideResult,
    KeyLevel,
    KeyLevels,
    KeyPrice,
    PatternTargetGeometry,
    PlanCheck,
    PriceScenario,
    PriceTarget,
    PriceTargets,
    ReconciledActionLevels,
    RawPatternSummary,
    RawStrategyResult,
    RiskLevel,
    SignalStrength,
    Trend,
    Trendline,
    TrendlineDirection,
    TrendlinePoint,
} from '@/domain/types';
import {
    asArray,
    asBoolean,
    asEnum,
    asNumber,
    asNumberOrNull,
    asObject,
    asOptionalEnum,
    asString,
    compact,
} from './normalizePrimitives';

const VALID_TRENDS: readonly Trend[] = ['bullish', 'bearish', 'neutral'];
const VALID_RISK_LEVELS: readonly RiskLevel[] = ['low', 'medium', 'high'];
const VALID_TRENDLINE_DIRECTIONS: readonly TrendlineDirection[] = [
    'ascending',
    'descending',
];
const VALID_SIGNAL_STRENGTHS: readonly SignalStrength[] = [
    'strong',
    'moderate',
    'weak',
];
const VALID_ENTRY_RECOMMENDATIONS: readonly EntryRecommendation[] = [
    'enter',
    'wait',
    'avoid',
];

function normalizeNumberArray(v: unknown): number[] | undefined {
    if (!Array.isArray(v)) return undefined;
    return v.map(asNumber).filter((p): p is number => p !== undefined);
}

// --- enum 래퍼 ---

/** @internal Coerces an unknown value to a Trend enum (defaults to 'neutral'). */
export function normalizeTrend(v: unknown): Trend {
    return asEnum(v, VALID_TRENDS, 'neutral');
}

/** @internal Coerces an unknown value to a RiskLevel enum (defaults to 'medium'). */
export function normalizeRiskLevel(v: unknown): RiskLevel {
    return asEnum(v, VALID_RISK_LEVELS, 'medium');
}

// --- KeyLevel ---

/** @internal Normalizes a single key level. */
export function normalizeKeyLevel(v: unknown): KeyLevel | null {
    const o = asObject(v);
    if (!o) return null;
    const price = asNumber(o.price);
    if (price === undefined) return null;
    return { price, reason: asString(o.reason) };
}

/** @internal Normalizes support/resistance/POC key levels. */
export function normalizeKeyLevels(v: unknown): KeyLevels {
    const o = asObject(v);
    if (!o) return { support: [], resistance: [], poc: undefined };
    return {
        support: compact(asArray(o.support).map(normalizeKeyLevel)),
        resistance: compact(asArray(o.resistance).map(normalizeKeyLevel)),
        poc: normalizeKeyLevel(o.poc) ?? undefined,
    };
}

// --- PriceTargets ---

/** @internal Normalizes a single price target. */
export function normalizePriceTarget(v: unknown): PriceTarget | null {
    const o = asObject(v);
    if (!o) return null;
    const price = asNumber(o.price);
    if (price === undefined) return null;
    return { price, basis: asString(o.basis) };
}

/** @internal Normalizes a price scenario. */
export function normalizePriceScenario(v: unknown): PriceScenario | null {
    const o = asObject(v);
    if (!o) return null;
    return {
        targets: compact(asArray(o.targets).map(normalizePriceTarget)),
        condition: asString(o.condition),
    };
}

/** @internal Normalizes bullish/bearish price targets. */
export function normalizePriceTargets(v: unknown): PriceTargets {
    const o = asObject(v);
    if (!o) return { bullish: null, bearish: null };
    return {
        bullish: normalizePriceScenario(o.bullish),
        bearish: normalizePriceScenario(o.bearish),
    };
}

// --- Signals / IndicatorGuideResult ---

/** @internal Normalizes an analysis signal. */
export function normalizeSignal(v: unknown): AnalysisSignal | null {
    const o = asObject(v);
    if (!o) return null;
    // AnalysisSignalType은 현재 'skill' 단일 값으로 고정
    return {
        type: 'skill',
        description: asString(o.description),
        trend: normalizeTrend(o.trend),
        strength: asOptionalEnum(o.strength, VALID_SIGNAL_STRENGTHS),
    };
}

/** @internal Normalizes an indicator-guide result. */
export function normalizeIndicatorGuideResult(
    v: unknown
): IndicatorGuideResult | null {
    const o = asObject(v);
    if (!o) return null;
    const indicatorName = asString(o.indicatorName);
    if (!indicatorName) return null;
    return {
        indicatorName,
        signals: compact(asArray(o.signals).map(normalizeSignal)),
    };
}

// --- Pattern / Strategy / Candle ---

/** @internal Normalizes a key price. */
export function normalizeKeyPrice(v: unknown): KeyPrice | null {
    const o = asObject(v);
    if (!o) return null;
    const price = asNumber(o.price);
    if (price === undefined) return null;
    return { label: asString(o.label), price };
}

/** @internal Normalizes a trendline point. */
export function normalizeTrendlinePoint(v: unknown): TrendlinePoint | null {
    const o = asObject(v);
    if (!o) return null;
    const time = asNumber(o.time);
    const price = asNumber(o.price);
    if (time === undefined || price === undefined) return null;
    return { time, price };
}

const PATTERN_GEOMETRY_DIRECTIONS = ['up', 'down'] as const;

function isFinitePositive(n: number | undefined): n is number {
    return typeof n === 'number' && Number.isFinite(n) && n > 0;
}

/**
 * @internal Normalizes a model-authored pattern-geometry object
 * (`PatternSummary.geometry`, spec 2026-09-18 §A6). Dropped (returns
 * `undefined`) unless every present number is finite and positive, the
 * direction is a valid enum member, AND the geometry is internally
 * consistent with that direction: a `'down'` pattern's extreme must sit
 * ABOVE its breakout (head above neckline), an `'up'` pattern's extreme
 * BELOW its breakout (bottom below rim). An inconsistent pair is not a
 * formatting slip — it means the model transcribed the wrong two numbers,
 * and the height math downstream would silently invert.
 */
export function normalizePatternGeometry(
    v: unknown
): PatternTargetGeometry | undefined {
    const o = asObject(v);
    if (!o) return undefined;

    const breakoutLevel = asNumber(o.breakoutLevel);
    const extremeLevel = asNumber(o.extremeLevel);
    const direction = asOptionalEnum(o.direction, PATTERN_GEOMETRY_DIRECTIONS);
    const invalidationLevel = asNumber(o.invalidationLevel);

    if (
        !isFinitePositive(breakoutLevel) ||
        !isFinitePositive(extremeLevel) ||
        direction === undefined
    ) {
        return undefined;
    }
    // invalidationLevel is optional on the wire, but if the model supplied
    // *something* for it, that something must be a usable price too — a
    // present-but-garbage value is worse than absent (see the module's
    // null-rule convention: 0/negative/non-finite is "unknown", never a
    // real level).
    if (o.invalidationLevel != null && !isFinitePositive(invalidationLevel)) {
        return undefined;
    }

    const consistent =
        direction === 'down'
            ? extremeLevel > breakoutLevel
            : extremeLevel < breakoutLevel;
    if (!consistent) return undefined;

    return {
        breakoutLevel,
        extremeLevel,
        direction,
        ...(invalidationLevel !== undefined ? { invalidationLevel } : {}),
    };
}

/** @internal Normalizes a chart-pattern summary. */
export function normalizePatternSummary(v: unknown): RawPatternSummary | null {
    const o = asObject(v);
    if (!o) return null;
    const patternName = asString(o.patternName);
    const skillName = asString(o.skillName);
    if (!patternName || !skillName) return null;

    const keyPricesArr = Array.isArray(o.keyPrices)
        ? compact(o.keyPrices.map(normalizeKeyPrice))
        : undefined;

    return {
        patternName,
        skillName,
        detected: asBoolean(o.detected),
        trend: normalizeTrend(o.trend),
        summary: asString(o.summary),
        keyPrices: keyPricesArr,
        ...(typeof o.candidateId === 'string' && o.candidateId !== ''
            ? { candidateId: o.candidateId }
            : {}),
        geometry: normalizePatternGeometry(o.geometry),
    };
}

/** @internal Normalizes a strategy result. */
export function normalizeStrategyResult(v: unknown): RawStrategyResult | null {
    const o = asObject(v);
    if (!o) return null;
    const strategyName = asString(o.strategyName);
    if (!strategyName) return null;
    return {
        strategyName,
        trend: normalizeTrend(o.trend),
        summary: asString(o.summary),
        ...(Array.isArray(o.candidateIds)
            ? { candidateIds: normalizeIdList(o.candidateIds) }
            : {}),
    };
}

type RawCandlePatternSummary = Omit<CandlePatternSummary, 'id'>;

/** @internal Normalizes a candle-pattern summary. */
export function normalizeCandlePatternSummary(
    v: unknown
): RawCandlePatternSummary | null {
    const o = asObject(v);
    if (!o) return null;
    const patternName = asString(o.patternName);
    if (!patternName) return null;
    return {
        patternName,
        detected: asBoolean(o.detected),
        trend: normalizeTrend(o.trend),
        summary: asString(o.summary),
    };
}

// --- Trendline ---

/** @internal Normalizes a trendline. */
export function normalizeTrendline(v: unknown): Trendline | null {
    const o = asObject(v);
    if (!o) return null;
    const direction = asOptionalEnum(o.direction, VALID_TRENDLINE_DIRECTIONS);
    const start = normalizeTrendlinePoint(o.start);
    const end = normalizeTrendlinePoint(o.end);
    if (!direction || !start || !end) return null;
    return { direction, start, end };
}

// --- ActionRecommendation ---

function normalizeReconciledActionLevels(
    raw: unknown
): ReconciledActionLevels | undefined {
    const o = asObject(raw);
    if (!o) return undefined;

    return {
        stopLoss: asNumber(o.stopLoss),
        takeProfitPrices: normalizeNumberArray(o.takeProfitPrices),
        exit: asString(o.exit),
        riskReward: asString(o.riskReward),
        reason: asString(o.reason),
    };
}

/**
 * @internal Normalizes the deterministic plan-vs-price arithmetic
 * `postProcessAnalysisWithReconcile` attaches after the LLM response (see
 * `PlanCheck` in `@/domain/types`). Dropped (returns `undefined`) unless
 * `currentPrice` is a finite positive number — `buildPlanCheck` itself
 * returns `null` in that case, so a `planCheck` without a usable
 * `currentPrice` is corrupt, not merely incomplete.
 */
function normalizePlanCheck(raw: unknown): PlanCheck | undefined {
    const o = asObject(raw);
    if (!o) return undefined;
    const currentPrice = asNumber(o.currentPrice);
    if (!isFinitePositive(currentPrice)) return undefined;

    return {
        currentPrice,
        entryZoneTop: asNumberOrNull(o.entryZoneTop),
        exceedsEntryZone: asBoolean(o.exceedsEntryZone),
        belowStopLoss: asBoolean(o.belowStopLoss),
        riskRewardAtEntry: asNumberOrNull(o.riskRewardAtEntry),
        riskRewardAtCurrent: asNumberOrNull(o.riskRewardAtCurrent),
    };
}

/** @internal Normalizes an action recommendation. */
export function normalizeActionRecommendation(
    raw: unknown
): ActionRecommendation | undefined {
    const o = asObject(raw);
    if (!o) return undefined;

    const positionAnalysis = asString(o.positionAnalysis);
    const entry = asString(o.entry);
    const exit = asString(o.exit);
    const riskReward = asString(o.riskReward);

    // LLM이 텍스트 설명 없이 숫자 필드만 반환하는 케이스는 프롬프트 구조상 발생하지
    // 않으므로, 텍스트 4개 필드를 추천 존재 여부의 대표 신호로 사용한다.
    // 모두 비어 있으면 숫자 필드가 있더라도 추천 자체가 없는 것으로 간주한다.
    if (!positionAnalysis && !entry && !exit && !riskReward) return undefined;

    const planCheck = normalizePlanCheck(o.planCheck);

    return {
        positionAnalysis,
        entry,
        exit,
        riskReward,
        entryRecommendation: asOptionalEnum(
            o.entryRecommendation,
            VALID_ENTRY_RECOMMENDATIONS
        ),
        entryPrices: normalizeNumberArray(o.entryPrices),
        stopLoss: asNumber(o.stopLoss),
        takeProfitPrices: normalizeNumberArray(o.takeProfitPrices),
        reconciledLevels: normalizeReconciledActionLevels(o.reconciledLevels),
        // `postProcessAnalysisWithReconcile` attaches `planCheck` to the LLM's raw
        // actionRecommendation, but a cache read (`normalizeCachedAnalysisResponse`)
        // re-normalizes that already-post-processed object through this same
        // function — dropping the key here silently strips the field downstream of
        // where it was attached, even though the write path carried it correctly.
        // Raw LLM output never has `planCheck` (it isn't in the response schema),
        // so omitting the key rather than assigning `undefined` keeps that path
        // byte-for-byte identical to before this fix. `reconciledLevels` above
        // keeps its long-standing `key: undefined` form on purpose — switching it
        // here would change a shape existing consumers and fixtures already see,
        // which is out of scope for this read-path fix.
        ...(planCheck !== undefined ? { planCheck } : {}),
    };
}

// --- Chart overlays (spec 2026-09-28) ---

/** @internal A string[] of non-empty strings; anything else → []. */
export function normalizeIdList(v: unknown): string[] {
    return asArray(v).filter(
        (x): x is string => typeof x === 'string' && x !== ''
    );
}

const OVERLAY_KINDS = new Set([
    'pattern',
    'trendline',
    'divergence',
    'fibonacci',
    'elliott',
]);

function isFiniteNumber(v: unknown): v is number {
    return typeof v === 'number' && Number.isFinite(v);
}

function isPoint(v: unknown): boolean {
    const o = asObject(v);
    return !!o && isFiniteNumber(o.time) && isFiniteNumber(o.price);
}

/** @internal Cached `chartOverlays` entry → `ChartOverlay`, or `null` when malformed. */
export function normalizeChartOverlay(v: unknown): ChartOverlay | null {
    const o = asObject(v);
    if (!o || typeof o.id !== 'string' || !OVERLAY_KINDS.has(o.kind as string))
        return null;
    const segments = asArray(o.segments).filter(s => {
        const seg = asObject(s);
        return !!seg && isPoint(seg.from) && isPoint(seg.to);
    });
    const levels = asArray(o.levels).filter(l => {
        const level = asObject(l);
        return (
            !!level &&
            isFiniteNumber(level.price) &&
            isFiniteNumber(level.fromTime)
        );
    });
    if (segments.length === 0 && levels.length === 0) return null;
    return {
        id: o.id,
        kind: o.kind as ChartOverlay['kind'],
        skill: asString(o.skill),
        sourceRef: asString(o.sourceRef),
        variant: o.variant === 'alternate' ? 'alternate' : 'primary',
        segments: segments as ChartOverlay['segments'],
        levels: levels as ChartOverlay['levels'],
        labels: asArray(o.labels).filter(l =>
            isPoint(asObject(l)?.at)
        ) as ChartOverlay['labels'],
    };
}
