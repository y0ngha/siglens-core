import {
    buildPlanCheck,
    effectiveStopLoss,
    entryZoneBottom,
    entryZoneTop,
    nearestTargetAbove,
} from '@/domain/analysis/planCheck';
import { computePatternTargets } from '@/domain/analysis/patternTargets';
import { roundToKrxTick, type KrxTickTable } from '@/domain/analysis/krxTick';
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
 *
 * @deprecated No longer used by reconcile: a target that fails validation is dropped,
 * never replaced by an invented level. Kept only because the consumer's backtest
 * scripts (`siglens/scripts/backtests/generate-backtest.ts` and `flash-lite-ab.ts`)
 * import `resolveBullishTakeProfit`. Remove all three symbols (`resolveBullishTakeProfit`,
 * `deriveFallbackTakeProfit`, `TP_FALLBACK_ATR_MULTIPLIER`) after the consumer bump that
 * drops those imports.
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
 * `entryLow`(진입 구간 하단, 기본값 `entryPrice`)보다도 낮아야 한다 — 구간 중앙값만
 * 기준으로 삼으면 구간 안쪽의 손절이 통과한다.
 */
export function isValidBullishStopLoss(
    sl: number | undefined,
    entryPrice: number,
    atr: number | undefined,
    entryLow: number = entryPrice
): boolean {
    if (!isFinitePositive(sl)) return false;
    // A stop inside the entry zone (at or above its low edge) is not below the
    // entry: price entering the zone at its low would already be stopped out.
    if (sl >= entryPrice || sl >= entryLow) return false;
    if (hasUsableAtr(atr)) {
        const minSl = entryPrice - atr * SL_MAX_ATR_MULTIPLIER;
        if (sl < minSl) return false;
    }
    return true;
}

/**
 * @internal Validates a bullish take-profit level.
 * TP가 bullish 포지션에서 유효한지 검증한다 (entry 초과·ATR 배수 범위 내).
 * `entryHigh`(진입 구간 상단, 기본값 `entryPrice`)보다도 높아야 한다.
 */
export function isValidBullishTakeProfit(
    tp: number | undefined,
    entryPrice: number,
    atr: number | undefined,
    entryHigh: number = entryPrice
): boolean {
    if (!isFinitePositive(tp)) return false;
    if (tp <= entryPrice || tp <= entryHigh) return false;
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

/**
 * @internal Derives an ATR-based fallback take-profit.
 *
 * @deprecated No longer used by reconcile: a target that fails validation is dropped,
 * never replaced by an invented level. Kept only because the consumer's backtest
 * scripts (`siglens/scripts/backtests/generate-backtest.ts` and `flash-lite-ab.ts`)
 * import `resolveBullishTakeProfit`. Remove all three symbols (`resolveBullishTakeProfit`,
 * `deriveFallbackTakeProfit`, `TP_FALLBACK_ATR_MULTIPLIER`) after the consumer bump that
 * drops those imports.
 */
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
    atr: number | undefined,
    entryLow: number = entryPrice
): ResolvedLevel {
    if (isValidBullishStopLoss(aiValue, entryPrice, atr, entryLow)) {
        return { value: aiValue, source: 'ai' };
    }
    // The fallback is measured from the zone's low edge when the mid-based one
    // would land inside the zone (a zone wider than the fallback distance).
    const fromMid = deriveFallbackStopLoss(entryPrice, atr);
    const fallback =
        fromMid !== undefined && fromMid >= entryLow
            ? deriveFallbackStopLoss(entryLow, atr)
            : fromMid;
    if (fallback !== undefined) {
        return { value: fallback, source: 'fallback' };
    }
    return { value: undefined, source: 'missing' };
}

/**
 * @internal Resolves the effective bullish take-profit (AI value or fallback).
 *
 * @deprecated No longer used by reconcile: a target that fails validation is dropped,
 * never replaced by an invented level. Kept only because the consumer's backtest
 * scripts (`siglens/scripts/backtests/generate-backtest.ts` and `flash-lite-ab.ts`)
 * import `resolveBullishTakeProfit`. Remove all three symbols (`resolveBullishTakeProfit`,
 * `deriveFallbackTakeProfit`, `TP_FALLBACK_ATR_MULTIPLIER`) after the consumer bump that
 * drops those imports.
 */
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
 * 원화는 KRX 호가 단위(`krxTick` 표 기준)로 반올림해(`roundToKrxTick`) 쓰고 `원`을 붙인다.
 * `$121980.70` 같은 표기는 값이 틀린 것과 같다 — 단위가 틀렸고, 존재하지 않는
 * 정밀도를 주장한다. 달러는 $1 이상이면 기존 `$1234.56` 표기와 바이트 동일,
 * $1 미만은 유효숫자 4자리(`$0.08250`)로 표기해 서브달러 자산이 `$0.08`로
 * 뭉개지지 않게 한다.
 */
function formatLevelPrice(
    price: number,
    currency: CurrencyCode,
    krxTick: KrxTickTable
): string {
    return currency === 'KRW'
        ? `${roundToKrxTick(price, krxTick).toLocaleString('en-US')}원`
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
    currency: CurrencyCode,
    krxTick: KrxTickTable
): string | undefined {
    if (validTps.length === 0) return undefined;
    if (validTps.length === 1) {
        const tp = validTps[0];
        return `목표가 ${formatLevelPrice(tp, currency, krxTick)} (${formatSignedPct(entryPrice, tp)})에서 익절`;
    }
    const tpParts = validTps.map(
        (tp, idx) =>
            `${ordinalLabel(idx)} 목표 ${formatLevelPrice(tp, currency, krxTick)} (${formatSignedPct(entryPrice, tp)})`
    );
    return `${tpParts.join(', ')}에서 익절`;
}

/** 유효한 SL을 exit 텍스트 파트로 포맷. 무효값이면 undefined. */
function buildExitSlPart(
    entryPrice: number,
    stopLoss: number | undefined,
    currency: CurrencyCode,
    krxTick: KrxTickTable
): string | undefined {
    if (
        stopLoss === undefined ||
        !Number.isFinite(stopLoss) ||
        stopLoss <= 0 ||
        stopLoss >= entryPrice
    ) {
        return undefined;
    }
    return `손절 ${formatLevelPrice(stopLoss, currency, krxTick)} (${formatSignedPct(entryPrice, stopLoss)})`;
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
    currency: CurrencyCode,
    krxTick: KrxTickTable
): string {
    const validTps = (takeProfitPrices ?? []).filter(
        (tp): tp is number =>
            typeof tp === 'number' && Number.isFinite(tp) && tp > entryPrice
    );

    const parts = [
        buildExitTpPart(entryPrice, validTps, currency, krxTick),
        buildExitSlPart(entryPrice, stopLoss, currency, krxTick),
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
    // the same way every other delta in this codebase does.
    const slLabel = `${formatNullableNumber(slPct, 1)}%`;
    const tpLabel =
        tpPct >= 0 ? `+${tpPct.toFixed(1)}%` : `${tpPct.toFixed(1)}%`;
    const ratio = (tpPct / riskAbs).toFixed(1);

    const template = RISK_REWARD_TEMPLATE[locale] ?? RISK_REWARD_TEMPLATE.ko;
    return template(slLabel, tpLabel, ratio);
}

/**
 * 보정 경위 문장 생성 — 손절 보정(AI 값 무효 / 미제시)과 목표가 제외(진입 구간 위가 아님 /
 * 첫 목표가가 ATR 상한 초과)를 각각 정확한 문장으로 잇는다.
 *
 * 목표가는 값을 만들어 채우지 않고 기준을 벗어난 것만 제외하므로, 목표가 쪽 문장은
 * "계산했습니다"가 아니라 "제외했습니다"다.
 */
function buildReconcileReason(parts: {
    slWas: boolean;
    aiSlMissing: boolean;
    slRejected: boolean;
    zoneDropped: boolean;
    capDropped: boolean;
    duplicatesRemoved: boolean;
    reordered: boolean;
}): string {
    const stopPart = parts.slRejected
        ? [
              'AI가 제시한 손절가가 진입 구간 아래가 아니고 대체할 ATR 기준도 없어 제외했습니다. 손절가는 없는 것으로 봅니다.',
          ]
        : !parts.slWas
          ? []
          : parts.aiSlMissing
            ? ['AI가 손절가를 제시하지 않아 ATR 기반 기본값을 계산했습니다.']
            : ['AI가 제시한 손절가가 내부 기준을 벗어나 보정했습니다.'];
    return [
        ...stopPart,
        ...(parts.zoneDropped
            ? ['AI가 제시한 목표가 중 진입 구간 위가 아닌 값은 제외했습니다.']
            : []),
        ...(parts.capDropped
            ? [
                  'AI가 제시한 첫 번째 목표가가 ATR 기준 상한을 넘어 제외했습니다.',
              ]
            : []),
        ...(parts.duplicatesRemoved
            ? ['AI가 제시한 목표가 중 중복된 값은 하나만 남겼습니다.']
            : []),
        ...(parts.reordered
            ? ['AI가 제시한 목표가를 가까운 순서(오름차순)로 정렬했습니다.']
            : []),
    ].join(' ');
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
    locale: AnalysisLocale = DEFAULT_ANALYSIS_LOCALE,
    krxTick: KrxTickTable = 'share'
): ReconcileResult {
    // avoid: AI가 의도적으로 레벨을 비운 것이므로 보정하지 않는다.
    if (rec.entryRecommendation === 'avoid') {
        return { recommendation: rec, wasReconciled: false, changes: [] };
    }

    // A fallback is a computed price, so a KRX listing gets it at its tick —
    // here, not after post-processing, so the plan check and the risk:reward
    // line below read the same level the card shows (`roundAnalysisPrices`).
    const quoted = <T extends { value?: number }>(r: T): T =>
        currency === 'KRW' && r.value !== undefined
            ? { ...r, value: roundToKrxTick(r.value, krxTick) }
            : r;
    // Zone edges (order-independent); the single mid reference when the zone has no
    // usable element.
    const entryLow = entryZoneBottom(rec.entryPrices) ?? entryPrice;
    const entryHigh = entryZoneTop(rec.entryPrices) ?? entryPrice;
    const slResolved = quoted(
        resolveBullishStopLoss(rec.stopLoss, entryPrice, atr, entryLow)
    );

    // Targets are filtered, never replaced: one that is not strictly above the zone's
    // top edge is dropped and the rest stay. Inventing a level to stand in for it
    // produced a target nobody proposed, and when it landed as the furthest one it read
    // as a "1:0.0" risk:reward. The ATR cap keeps its original scope, the FIRST target
    // only: a far later target is a deliberate stretch goal, not an error.
    const aiTargets = rec.takeProfitPrices ?? [];
    // `entryHigh` is the zone's top, or `entryPrice` itself when the zone has no usable
    // element; the larger of the two is the bar a target must clear.
    const zoneCeiling = Math.max(entryHigh, entryPrice);
    const aboveZone = (tp: number): boolean =>
        Number.isFinite(tp) && tp > 0 && tp > zoneCeiling;
    const firstTarget = aiTargets[0];
    const capDropped =
        firstTarget !== undefined &&
        aboveZone(firstTarget) &&
        !isValidBullishTakeProfit(firstTarget, entryPrice, atr, entryHigh);
    const keptTargets = aiTargets.filter(
        (tp, i) => aboveZone(tp) && !(i === 0 && capDropped)
    );
    const zoneDropped = aiTargets.some(tp => !aboveZone(tp));
    // The reconciled list is always strictly ascending and without duplicates, whether or
    // not a target was dropped: every reader (plan check, risk:reward, the chart lines)
    // treats the first element as the nearest one.
    const uniqueTargets = [...new Set(keptTargets)];
    const sortedTargets = [...uniqueTargets].sort((a, b) => a - b);
    const duplicatesRemoved = uniqueTargets.length < keptTargets.length;
    const reordered = sortedTargets.some((tp, i) => tp !== uniqueTargets[i]);
    const tpChanged =
        zoneDropped || capDropped || duplicatesRemoved || reordered;

    const slWasReconciled =
        slResolved.source === 'fallback' && slResolved.value !== undefined;
    // A stop was written but is unusable, and there is no ATR to derive a replacement
    // from. Core never invents a level, so the plan is left with no stop and says so.
    const slRejected =
        rec.stopLoss !== undefined && slResolved.source === 'missing';

    if (!slWasReconciled && !slRejected && !tpChanged) {
        return { recommendation: rec, wasReconciled: false, changes: [] };
    }

    const reconciledTpArr: readonly number[] | undefined = tpChanged
        ? sortedTargets
        : rec.takeProfitPrices;

    const reconciledSl = slWasReconciled
        ? slResolved.value
        : slRejected
          ? undefined
          : rec.stopLoss;

    const aiSlMissing = rec.stopLoss === undefined;

    const reconciled: ReconciledActionLevels = {
        stopLoss: reconciledSl,
        takeProfitPrices: reconciledTpArr,
        exit: buildBullishExitText(
            entryPrice,
            reconciledSl,
            reconciledTpArr,
            currency,
            krxTick
        ),
        riskReward: buildBullishRiskRewardText(
            entryPrice,
            reconciledSl,
            reconciledTpArr,
            locale
        ),
        reason: buildReconcileReason({
            slWas: slWasReconciled,
            aiSlMissing,
            slRejected,
            zoneDropped,
            capDropped,
            duplicatesRemoved,
            reordered,
        }),
        ...(slRejected ? { stopLossRejected: true as const } : {}),
    };

    const changes: readonly string[] = [
        ...(slWasReconciled
            ? [
                  `stopLoss: ${rec.stopLoss ?? 'null'} → ${formatPrice(reconciled.stopLoss, currency, krxTick)} (fallback)`,
              ]
            : []),
        ...(slRejected
            ? [
                  `stopLoss: ${rec.stopLoss} rejected (not below the entry zone, no usable ATR for a fallback)`,
              ]
            : []),
        ...(zoneDropped
            ? [
                  `takeProfitPrices: ${aiTargets.filter(tp => !aboveZone(tp)).join(', ')} dropped (not above the entry zone)`,
              ]
            : []),
        ...(capDropped
            ? [
                  `takeProfitPrices[0]: ${firstTarget} dropped (beyond the ATR cap)`,
              ]
            : []),
        ...(duplicatesRemoved
            ? ['takeProfitPrices: duplicate targets removed']
            : []),
        ...(reordered
            ? ['takeProfitPrices: reordered ascending (nearest first)']
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
 * Localized `keyPrices` labels for the two pattern-geometry-derived targets. Exact-match strings — {@link applyPatternGeometryTarget}
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
 * not carry (an undirected pattern).
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
 * OR the pattern is `detected: false` (a
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
 * early returns already promise callers (a
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
     * Output locale for the deterministic risk:reward line. Defaults to `'ko'` so callers that omit it keep the pre-existing
     * Korean line.
     */
    locale: AnalysisLocale = DEFAULT_ANALYSIS_LOCALE,
    /**
     * KRX tick table the listing's prices round to (ETF/ETN → `'etp'`); only
     * read for a KRW `currency`.
     */
    krxTick: KrxTickTable = 'share'
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
            locale,
            krxTick
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
    const rrStopLoss = effectiveStopLoss(recommendation);
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
