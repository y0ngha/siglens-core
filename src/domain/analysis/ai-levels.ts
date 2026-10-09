import {
    buildPlanCheck,
    nearestTargetAbove,
} from '@/domain/analysis/planCheck';
import { computePatternTargets } from '@/domain/analysis/patternTargets';
import {
    formatNullableNumber,
    formatPrice,
} from '@/domain/analysis/promptFormat';
import {
    DEFAULT_ANALYSIS_LOCALE,
    type AnalysisLocale,
} from '@/domain/analysis/outputLocale';
import type {
    ActionRecommendation,
    AnalysisResponse,
    CurrencyCode,
    KeyPrice,
    PatternResult,
    ReconciledActionLevels,
    ReconcileResult,
    ResolvedLevel,
} from '@/domain/types';

/** AI SL/TP 검증 + ATR 기반 fallback resolver. AI 원본 필드를 수정하지 않고 reconciledLevels에 보정값을 병기한다. */

/**
 * @internal ATR 배수 상한 SL 가드.
 * ATR 배수 한도 — entryPrice - ATR*5 보다 더 낮은 SL은 비현실적으로 간주한다.
 */
export const SL_MAX_ATR_MULTIPLIER = 5;

/**
 * @internal ATR 배수 상한 TP 가드.
 * ATR 배수 한도 — entryPrice + ATR*10 보다 더 높은 TP는 비현실적으로 간주한다.
 */
export const TP_MAX_ATR_MULTIPLIER = 10;

/**
 * @internal Fallback SL ATR 배수.
 * Fallback SL 배수 — entryPrice - ATR*1.5.
 */
export const SL_FALLBACK_ATR_MULTIPLIER = 1.5;

/**
 * @internal Fallback TP ATR 배수.
 * Fallback TP 배수 — entryPrice + ATR*2.0 (risk:reward ≈ 1:1.33).
 */
export const TP_FALLBACK_ATR_MULTIPLIER = 2.0;

function isFinitePositive(n: number | undefined): n is number {
    return typeof n === 'number' && Number.isFinite(n) && n > 0;
}

function hasUsableAtr(atr: number | undefined): atr is number {
    return isFinitePositive(atr);
}

/**
 * @internal Validates a bullish stop-loss level.
 * SL이 bullish 포지션에서 유효한지 검증한다 (양수·entry 미만·ATR 배수 범위 내).
 */
export function isValidBullishStopLoss(
    sl: number | undefined,
    entryPrice: number,
    atr: number | undefined
): boolean {
    if (!isFinitePositive(sl)) return false;
    if (sl >= entryPrice) return false;
    if (hasUsableAtr(atr)) {
        const minSl = entryPrice - atr * SL_MAX_ATR_MULTIPLIER;
        if (sl < minSl) return false;
    }
    return true;
}

/**
 * @internal Validates a bullish take-profit level.
 * TP가 bullish 포지션에서 유효한지 검증한다 (entry 초과·ATR 배수 범위 내).
 */
export function isValidBullishTakeProfit(
    tp: number | undefined,
    entryPrice: number,
    atr: number | undefined
): boolean {
    if (!isFinitePositive(tp)) return false;
    if (tp <= entryPrice) return false;
    if (hasUsableAtr(atr)) {
        const maxTp = entryPrice + atr * TP_MAX_ATR_MULTIPLIER;
        if (tp > maxTp) return false;
    }
    return true;
}

/** @internal Derives an ATR-based fallback stop-loss. */
export function deriveFallbackStopLoss(
    entryPrice: number,
    atr: number | undefined
): number | undefined {
    if (!hasUsableAtr(atr)) return undefined;
    return entryPrice - atr * SL_FALLBACK_ATR_MULTIPLIER;
}

/** @internal Derives an ATR-based fallback take-profit. */
export function deriveFallbackTakeProfit(
    entryPrice: number,
    atr: number | undefined
): number | undefined {
    if (!hasUsableAtr(atr)) return undefined;
    return entryPrice + atr * TP_FALLBACK_ATR_MULTIPLIER;
}

/** @internal Resolves the effective bullish stop-loss (AI value or fallback). */
export function resolveBullishStopLoss(
    aiValue: number | undefined,
    entryPrice: number,
    atr: number | undefined
): ResolvedLevel {
    if (isValidBullishStopLoss(aiValue, entryPrice, atr)) {
        return { value: aiValue, source: 'ai' };
    }
    const fallback = deriveFallbackStopLoss(entryPrice, atr);
    if (fallback !== undefined) {
        return { value: fallback, source: 'fallback' };
    }
    return { value: undefined, source: 'missing' };
}

/** @internal Resolves the effective bullish take-profit (AI value or fallback). */
export function resolveBullishTakeProfit(
    aiValue: number | undefined,
    entryPrice: number,
    atr: number | undefined
): ResolvedLevel {
    if (isValidBullishTakeProfit(aiValue, entryPrice, atr)) {
        return { value: aiValue, source: 'ai' };
    }
    const fallback = deriveFallbackTakeProfit(entryPrice, atr);
    if (fallback !== undefined) {
        return { value: fallback, source: 'fallback' };
    }
    return { value: undefined, source: 'missing' };
}

// SL/TP 보정 후 exit · riskReward 텍스트를 AI 재호출 없이 결정론적으로 재생성한다.

const ORDINAL_LABEL = ['1차', '2차', '3차', '4차', '5차'] as const;

function ordinalLabel(index: number): string {
    return ORDINAL_LABEL[index] ?? `${index + 1}차`;
}

/**
 * 가격 한 개를 통화에 맞게 표기한다.
 *
 * 원화는 소수 단위로 호가되지 않으므로 반올림해 정수로 쓰고 `원`을 붙인다.
 * `$121980.70` 같은 표기는 값이 틀린 것과 같다 — 단위가 틀렸고, 존재하지 않는
 * 정밀도를 주장한다. 달러는 $1 이상이면 기존 `$1234.56` 표기와 바이트 동일,
 * $1 미만은 유효숫자 4자리(`$0.08250`)로 표기해 서브달러 자산이 `$0.08`로
 * 뭉개지지 않게 한다.
 */
function formatLevelPrice(price: number, currency: CurrencyCode): string {
    return currency === 'KRW'
        ? `${Math.round(price).toLocaleString('en-US')}원`
        : `$${formatPrice(price)}`;
}

/** 진입가 대비 signed 백분율 문자열 반환 (+3.2% / -1.2% 형식). */
function formatSignedPct(entryPrice: number, price: number): string {
    const pct = ((price - entryPrice) / entryPrice) * 100;
    return pct >= 0 ? `+${pct.toFixed(1)}%` : `${pct.toFixed(1)}%`;
}

/** 유효 TP 배열을 exit 텍스트 TP 파트로 포맷. 빈 배열이면 undefined. */
function buildExitTpPart(
    entryPrice: number,
    validTps: readonly number[],
    currency: CurrencyCode
): string | undefined {
    if (validTps.length === 0) return undefined;
    if (validTps.length === 1) {
        const tp = validTps[0];
        return `목표가 ${formatLevelPrice(tp, currency)} (${formatSignedPct(entryPrice, tp)})에서 익절`;
    }
    const tpParts = validTps.map(
        (tp, idx) =>
            `${ordinalLabel(idx)} 목표 ${formatLevelPrice(tp, currency)} (${formatSignedPct(entryPrice, tp)})`
    );
    return `${tpParts.join(', ')}에서 익절`;
}

/** 유효한 SL을 exit 텍스트 파트로 포맷. 무효값이면 undefined. */
function buildExitSlPart(
    entryPrice: number,
    stopLoss: number | undefined,
    currency: CurrencyCode
): string | undefined {
    if (
        stopLoss === undefined ||
        !Number.isFinite(stopLoss) ||
        stopLoss <= 0 ||
        stopLoss >= entryPrice
    ) {
        return undefined;
    }
    return `손절 ${formatLevelPrice(stopLoss, currency)} (${formatSignedPct(entryPrice, stopLoss)})`;
}

/**
 * @internal Builds the bullish exit text from SL/TP.
 * bullish 포지션 SL/TP 기반 exit 텍스트 생성. 유효하지 않은 파트는 생략한다.
 *
 * `currency`는 필수다. 기본값은 이 모듈의 유일한 공개 진입점인
 * {@link postProcessAnalysisWithReconcile}에서 한 번만 정한다 — `locale`이
 * `runAnalysis` 경계에서 한 번만 해소되는 것과 같은 방식이다. 층마다 기본값을
 * 두면 나중에 한 곳만 바뀌었을 때 조용히 갈린다.
 */
export function buildBullishExitText(
    entryPrice: number,
    stopLoss: number | undefined,
    takeProfitPrices: readonly number[] | undefined,
    currency: CurrencyCode
): string {
    const validTps = (takeProfitPrices ?? []).filter(
        (tp): tp is number =>
            typeof tp === 'number' && Number.isFinite(tp) && tp > entryPrice
    );

    const parts = [
        buildExitTpPart(entryPrice, validTps, currency),
        buildExitSlPart(entryPrice, stopLoss, currency),
    ].filter((p): p is string => p !== undefined);

    return parts.length > 0 ? parts.join(', ') + '.' : '';
}

/**
 * @internal Per-locale template for the deterministic risk:reward line. Kept
 * separate from AI prose (which is not re-translated from Korean on the
 * reconcile path — see {@link buildBullishRiskRewardText}'s doc comment):
 * this line is domain-authored, not model output, so it can be localized
 * directly instead of inheriting whatever language the prose happens to be in.
 */
const RISK_REWARD_TEMPLATE: Record<
    AnalysisLocale,
    (slLabel: string, tpLabel: string, ratio: string) => string
> = {
    ko: (sl, tp, ratio) => `손절 ${sl} vs 목표 ${tp} → 위험:보상 = 1:${ratio}`,
    en: (sl, tp, ratio) =>
        `Stop ${sl} vs target ${tp} → risk:reward = 1:${ratio}`,
    ja: (sl, tp, ratio) =>
        `損切り ${sl} vs 目標 ${tp} → リスク・リワード = 1:${ratio}`,
    zh: (sl, tp, ratio) => `止损 ${sl} vs 目标 ${tp} → 风险回报比 = 1:${ratio}`,
};

/**
 * @internal Builds the deterministic bullish risk:reward line.
 * bullish 롱 포지션의 signed 위험:보상 비율 텍스트. SL이 무효하거나 진입가보다 높은
 * 목표가가 하나도 없으면 빈 문자열.
 *
 * 목표가는 배열의 첫 번째 값이 아니라 {@link nearestTargetAbove}가 고른 값을 쓴다 —
 * `riskRewardFrom`이 `planCheck.riskRewardAtEntry`를 계산할 때 쓰는 것과 동일한
 * 헬퍼다. 규칙을 한 곳(`planCheck.ts`)에 두면 이 줄과 `planCheck.riskRewardAtEntry`가
 * 서로 다른 숫자를 보여줄 일이 없다 — 호출자가 넘기는 `takeProfitPrices`가 정렬돼
 * 있는지, entryPrice 이하 값을 걸러냈는지는 이 함수가 신경 쓸 필요가 없다
 * (fix 2026-09-19: 이전엔 `[0]`을 그대로 썼는데, `reconcileBullishActionRecommendation`이
 * SL만 보정하고 TP는 AI 원본을 그대로 넘기는 경로에서 그 원본이 미정렬이면 `[0]`이
 * 가장 가까운 목표가라는 보장이 없었다 — entry 100, TP `[150, 105]`, SL만 보정된
 * 경우가 그 예다).
 *
 * `locale` defaults to `'ko'` so every existing call site (including
 * {@link reconcileBullishActionRecommendation}'s internal use for
 * `reconciledLevels.riskReward`) keeps producing byte-identical Korean text.
 */
export function buildBullishRiskRewardText(
    entryPrice: number,
    stopLoss: number | undefined,
    takeProfitPrices: readonly number[] | undefined,
    locale: AnalysisLocale = DEFAULT_ANALYSIS_LOCALE
): string {
    if (
        stopLoss === undefined ||
        !Number.isFinite(stopLoss) ||
        stopLoss <= 0 ||
        stopLoss >= entryPrice
    )
        return '';

    // Nearest target strictly above entryPrice — see `nearestTargetAbove`'s own doc
    // for the rule. Any target at/below entryPrice is noise (a negative R:R would only
    // confuse the reader), so it is dropped, not just skipped.
    const tp = nearestTargetAbove(entryPrice, takeProfitPrices);
    if (tp === undefined) return '';

    const slPct = ((stopLoss - entryPrice) / entryPrice) * 100;
    const tpPct = ((tp - entryPrice) / entryPrice) * 100;
    const riskAbs = Math.abs(slPct);
    if (riskAbs === 0) return '';

    // `slPct` is always < 0 here (the `stopLoss >= entryPrice` guard above
    // returns '' otherwise) — but a stop only fractionally below entry can
    // still round to `-0.0%` at 1dp. `formatNullableNumber` strips that sign
    // the same way every other delta in this codebase does (spec §0/§B6).
    const slLabel = `${formatNullableNumber(slPct, 1)}%`;
    const tpLabel =
        tpPct >= 0 ? `+${tpPct.toFixed(1)}%` : `${tpPct.toFixed(1)}%`;
    const ratio = (tpPct / riskAbs).toFixed(1);

    const template = RISK_REWARD_TEMPLATE[locale] ?? RISK_REWARD_TEMPLATE.ko;
    return template(slLabel, tpLabel, ratio);
}

/** 보정 경위 문장 생성 (SL·TP 누락·무효 여부 조합 4가지). */
function buildReconcileReason(
    slWas: boolean,
    tpWas: boolean,
    aiSlMissing: boolean,
    aiTpMissing: boolean
): string {
    if (slWas && tpWas) {
        return aiSlMissing && aiTpMissing
            ? 'AI가 손절·목표가를 제시하지 않아 ATR 기반 기본값을 계산했습니다.'
            : 'AI가 제시한 손절·목표가 중 일부가 내부 기준을 벗어나 보정했습니다.';
    }
    if (slWas) {
        return aiSlMissing
            ? 'AI가 손절가를 제시하지 않아 ATR 기반 기본값을 계산했습니다.'
            : 'AI가 제시한 손절가가 내부 기준을 벗어나 보정했습니다.';
    }
    return aiTpMissing
        ? 'AI가 목표가를 제시하지 않아 ATR 기반 기본값을 계산했습니다.'
        : 'AI가 제시한 목표가가 내부 기준을 벗어나 보정했습니다.';
}

/**
 * @internal Applies SL/TP reconciliation to a bullish recommendation.
 * bullish 추천에 SL/TP 보정을 적용한다. AI 원본 필드는 수정하지 않고 reconciledLevels에만 보정값을 병기한다.
 */
export function reconcileBullishActionRecommendation(
    rec: ActionRecommendation,
    entryPrice: number,
    atr: number | undefined,
    currency: CurrencyCode,
    locale: AnalysisLocale = DEFAULT_ANALYSIS_LOCALE
): ReconcileResult {
    // avoid: AI가 의도적으로 레벨을 비운 것이므로 보정하지 않는다.
    if (rec.entryRecommendation === 'avoid') {
        return { recommendation: rec, wasReconciled: false, changes: [] };
    }

    const slResolved = resolveBullishStopLoss(rec.stopLoss, entryPrice, atr);
    const tpResolved = resolveBullishTakeProfit(
        rec.takeProfitPrices?.[0],
        entryPrice,
        atr
    );

    const slWasReconciled =
        slResolved.source === 'fallback' && slResolved.value !== undefined;
    const tpWasReconciled =
        tpResolved.source === 'fallback' && tpResolved.value !== undefined;

    if (!slWasReconciled && !tpWasReconciled) {
        return { recommendation: rec, wasReconciled: false, changes: [] };
    }

    // tpWasReconciled 게이트로 value가 number임이 런타임 보장되지만 TS가 좁히기를
    // 전파하지 못해, narrowing을 지역 const로 고정해 `!` 단언을 제거한다.
    const tpFallback = tpResolved.value;
    // TP 배열 보정 시 entryPrice 초과 유효값만 유지하고 오름차순 정렬.
    // [0]이 fallback으로 교체됐을 때 기존 [1..]과 순서가 역전되는 경우 방지.
    const reconciledTpArr: readonly number[] | undefined =
        tpWasReconciled && tpFallback !== undefined
            ? [
                  tpFallback,
                  ...(rec.takeProfitPrices?.slice(1) ?? []).filter(
                      tp => Number.isFinite(tp) && tp > entryPrice
                  ),
              ].sort((a, b) => a - b)
            : rec.takeProfitPrices;

    const reconciledSl = slWasReconciled ? slResolved.value : rec.stopLoss;

    const aiSlMissing = rec.stopLoss === undefined;
    const aiTpMissing =
        rec.takeProfitPrices === undefined ||
        rec.takeProfitPrices.length === 0 ||
        rec.takeProfitPrices[0] === undefined;

    const reconciled: ReconciledActionLevels = {
        stopLoss: reconciledSl,
        takeProfitPrices: reconciledTpArr,
        exit: buildBullishExitText(
            entryPrice,
            reconciledSl,
            reconciledTpArr,
            currency
        ),
        riskReward: buildBullishRiskRewardText(
            entryPrice,
            reconciledSl,
            reconciledTpArr,
            locale
        ),
        reason: buildReconcileReason(
            slWasReconciled,
            tpWasReconciled,
            aiSlMissing,
            aiTpMissing
        ),
    };

    const changes: readonly string[] = [
        ...(slWasReconciled
            ? [
                  `stopLoss: ${rec.stopLoss ?? 'null'} → ${formatPrice(reconciled.stopLoss, currency)} (fallback)`,
              ]
            : []),
        ...(tpWasReconciled
            ? [
                  `takeProfitPrices[0]: ${rec.takeProfitPrices?.[0] ?? 'null'} → ${formatPrice(tpResolved.value, currency)} (fallback)`,
              ]
            : []),
    ];

    return {
        recommendation: { ...rec, reconciledLevels: reconciled }, // AI fields UNCHANGED
        wasReconciled: true,
        changes,
    };
}

/**
 * The entry-price reference `postProcessAnalysisWithReconcile`/`buildPlanCheck`
 * use throughout this module: the arithmetic mean of `rec.entryPrices`'
 * finite-positive elements, or `fallback` when there are none. Exported so
 * consumers building their OWN plan check against a live price (e.g.
 * siglens's `sinceAnalysis.planNow`) use the exact same entry reference
 * `planCheck.riskRewardAtEntry` was computed from, instead of re-deriving a
 * second, possibly different one.
 *
 * @param rec - The recommendation whose `entryPrices` to average.
 * @param fallback - Used when `rec.entryPrices` is empty/absent or has no
 *   usable (finite, positive) element — typically the last close.
 * @returns The entry reference, or `undefined` when neither source is usable.
 */
export function planEntryPrice(
    rec: ActionRecommendation,
    fallback: number | null | undefined
): number | undefined {
    const entryPrices = rec.entryPrices;
    if (entryPrices && entryPrices.length > 0) {
        const valid = entryPrices.filter(p => Number.isFinite(p) && p > 0);
        if (valid.length > 0) {
            return valid.reduce((sum, p) => sum + p, 0) / valid.length;
        }
    }
    return fallback ?? undefined;
}

/**
 * @internal
 * Localized `keyPrices` labels for the two pattern-geometry-derived targets
 * (spec 2026-09-18 §A6). Exact-match strings — {@link applyPatternGeometryTarget}
 * filters `keyPrices` by these exact labels before re-appending, so
 * re-running this over an already-processed response is idempotent.
 */
const PATTERN_TARGET_LABELS: Record<
    AnalysisLocale,
    { readonly measured: string; readonly conservative: string }
> = {
    ko: { measured: '측정 목표가', conservative: '보수 목표가(50%)' },
    en: {
        measured: 'Measured target',
        conservative: 'Conservative target (50%)',
    },
    ja: { measured: '測定目標値', conservative: '保守的目標値（50%）' },
    zh: { measured: '测算目标价', conservative: '保守目标价（50%）' },
};

/**
 * @internal
 * Whether `label` is one of the measured/conservative target labels this
 * module appends, in any locale — so a caller can strip targets a card must
 * not carry (an undirected pattern, spec 2026-10-07 §3.2).
 */
export function isPatternTargetLabel(label: string): boolean {
    return Object.values(PATTERN_TARGET_LABELS).some(
        l => l.measured === label || l.conservative === label
    );
}

/**
 * @internal
 * Derives `측정 목표가`/`보수 목표가(50%)` from one pattern's model-authored
 * `geometry` and appends them to its `keyPrices` — never trust a
 * model-computed target string. Any existing entries carrying these exact
 * labels are dropped first, so re-processing (e.g. a cache round-trip) does
 * not duplicate them. Returns `pattern` unchanged when it has no `geometry`
 * OR the pattern is `detected: false` (spec 2026-09-18 — a
 * not-detected entry has no real breakout to project a target from; the
 * schema still allows `geometry` there and a model occasionally fills it).
 */
function applyPatternGeometryTarget(
    pattern: PatternResult,
    locale: AnalysisLocale
): PatternResult {
    const geometry = pattern.geometry;
    if (!geometry || !pattern.detected) return pattern;

    const labels = PATTERN_TARGET_LABELS[locale] ?? PATTERN_TARGET_LABELS.ko;
    const { measuredTarget, conservativeTarget } = computePatternTargets(
        geometry.breakoutLevel,
        geometry.extremeLevel,
        geometry.direction
    );

    const carriedOver = (pattern.keyPrices ?? []).filter(
        kp => kp.label !== labels.measured && kp.label !== labels.conservative
    );
    // A down pattern taller than its breakout level projects a target at or
    // below zero — not a price, so it is not stored as one.
    const isPrice = (n: number): boolean => Number.isFinite(n) && n > 0;
    const keyPrices: KeyPrice[] = [
        ...carriedOver,
        ...(isPrice(measuredTarget)
            ? [{ label: labels.measured, price: measuredTarget }]
            : []),
        ...(isPrice(conservativeTarget)
            ? [{ label: labels.conservative, price: conservativeTarget }]
            : []),
    ];

    return { ...pattern, keyPrices };
}

/**
 * @internal
 * Applies {@link applyPatternGeometryTarget} to every pattern in
 * `patternSummaries`. Returns `response` unchanged (same reference) when no
 * `detected: true` pattern carries `geometry` — preserves the "no-op
 * returns the original object" contract {@link postProcessAnalysisWithReconcile}'s
 * early returns already promise callers (spec 2026-09-18: a
 * `detected: false` pattern with `geometry` alone must not trip this either
 * — {@link applyPatternGeometryTarget} would leave it unchanged anyway, but
 * `.map()` still allocates a new array).
 */
function withPatternGeometryTargets<T extends AnalysisResponse>(
    response: T,
    locale: AnalysisLocale
): T {
    if (!response.patternSummaries.some(p => p.geometry && p.detected))
        return response;
    return {
        ...response,
        patternSummaries: response.patternSummaries.map(p =>
            applyPatternGeometryTarget(p, locale)
        ),
    };
}

/**
 * @internal
 * `reconciledLevels` is core's correction and nothing else writes it — but a
 * model that still returns the field (older schema, a provider that ignores
 * the schema) would have its own numbers shown as a system correction and
 * preferred over the levels its prose cites. Drop it before core decides.
 */
function withoutModelReconciledLevels(
    response: AnalysisResponse
): AnalysisResponse {
    const rec = response.actionRecommendation;
    if (rec?.reconciledLevels === undefined) return response;
    const { reconciledLevels: _modelAuthored, ...rest } = rec;
    return { ...response, actionRecommendation: rest };
}

/**
 * @internal Reconciles AI key levels into the analysis.
 *
 * AnalysisResponse에 reconciledLevels를 병기한다. entryPrice 결정 불가 시 원본 반환.
 */
export function postProcessAnalysisWithReconcile(
    response: AnalysisResponse,
    fallbackEntryPrice: number | undefined,
    atr: number | undefined,
    /**
     * 이 모듈에서 통화 기본값이 정해지는 **유일한** 지점. 하위 헬퍼들은
     * 값을 요구하기만 한다.
     */
    currency: CurrencyCode = 'USD',
    /**
     * Output locale for the deterministic risk:reward line (spec 2026-09-18
     * §2.3). Defaults to `'ko'` so callers that omit it keep the pre-existing
     * Korean line.
     */
    locale: AnalysisLocale = DEFAULT_ANALYSIS_LOCALE
): AnalysisResponse {
    // Independent of the action-recommendation reconciliation below — applies
    // (or no-ops, preserving identity) regardless of whether `actionRecommendation`
    // exists at all, so it must run before either early return.
    const withTargets = withoutModelReconciledLevels(
        withPatternGeometryTargets(response, locale)
    );

    const rec = withTargets.actionRecommendation;
    if (!rec) return withTargets;

    const entryPrice = planEntryPrice(rec, fallbackEntryPrice);
    if (entryPrice === undefined || !Number.isFinite(entryPrice))
        return withTargets;

    const { recommendation, wasReconciled } =
        reconcileBullishActionRecommendation(
            rec,
            entryPrice,
            atr,
            currency,
            locale
        );

    // Deterministic risk:reward line — only when CORE did not reconcile.
    // `wasReconciled` (not the presence of `reconciledLevels`) is the signal:
    // the reconciled path already wrote its line into
    // `reconciledLevels.riskReward` (see `buildBullishRiskRewardText` inside
    // `reconcileBullishActionRecommendation`), and prepending here too would
    // duplicate it — the UI renders both. Any model-authored
    // `reconciledLevels` was dropped above, so on this path the levels are
    // the AI's top-level fields.
    //
    // Levels come from `recommendation.reconciledLevels` first, falling back
    // to the top-level AI fields — the same precedence `buildPlanCheck` uses
    // below. The target list is passed through unfiltered and unsorted:
    // `buildBullishRiskRewardText` itself picks the nearest target above
    // `entryPrice` (the same rule `riskRewardFrom` uses for
    // `planCheck.riskRewardAtEntry`), which keeps this line and
    // `planCheck.riskRewardAtEntry` from ever disagreeing, on either path.
    const rrStopLoss =
        recommendation.reconciledLevels?.stopLoss ?? recommendation.stopLoss;
    const rrTargets =
        recommendation.reconciledLevels?.takeProfitPrices ??
        recommendation.takeProfitPrices;
    const deterministicRiskReward = wasReconciled
        ? ''
        : buildBullishRiskRewardText(entryPrice, rrStopLoss, rrTargets, locale);
    const recommendationWithRiskReward =
        deterministicRiskReward === ''
            ? recommendation
            : {
                  ...recommendation,
                  riskReward:
                      recommendation.riskReward === ''
                          ? deterministicRiskReward
                          : `${deterministicRiskReward}\n\n${recommendation.riskReward}`,
              };

    // Attached outside the reconcile branch on purpose. `wasReconciled` being
    // `false` no longer means the deterministic risk:reward arithmetic is
    // missing from *healthy* analyses — the block above prepends
    // `deterministicRiskReward` into `riskReward` for that case, while the
    // reconciled case carries its own version in `reconciledLevels.riskReward`.
    // `planCheck` also measures against
    // `fallbackEntryPrice` (the last close) rather than the plan's own entry,
    // which is the comparison neither risk:reward path makes: a take-profit
    // above the recommended entry still passes validation while sitting below
    // the price the reader is actually looking at.
    // `fallbackEntryPrice` (the last close) is passed straight through rather than falling
    // back to `entryPrice`: without a real current price there is nothing to compare the
    // plan against, and substituting the plan's own entry would report "price is exactly
    // where the plan wants it" — a claim the inputs do not support. `buildPlanCheck`
    // returns `null` in that case and the field is simply absent.
    const planCheck = buildPlanCheck(
        recommendation,
        fallbackEntryPrice,
        entryPrice
    );

    return {
        ...withTargets,
        actionRecommendation: planCheck
            ? { ...recommendationWithRiskReward, planCheck }
            : recommendationWithRiskReward,
    };
}
