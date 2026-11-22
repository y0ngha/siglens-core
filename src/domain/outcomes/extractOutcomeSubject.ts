import {
    entryZoneBottom,
    entryZoneTop,
    effectiveStopLoss,
} from '@/domain/analysis/planCheck';
import {
    VALID_ENTRY_RECOMMENDATIONS,
    VALID_PLAN_POSITIONS,
    VALID_RISK_LEVELS,
    VALID_TRENDS,
} from '@/domain/analysis/normalize';
import {
    asArray,
    asObject,
    asOptionalEnum,
} from '@/domain/analysis/normalizePrimitives';
import { parsePromptReferenceLevels } from '@/domain/analysis/promptNumbers';
import { OUTCOME_SUBJECT_VERSION } from '@/domain/outcomes/constants';
import type { OutcomeLevelRole, OutcomeSubject } from '@/domain/outcomes/types';
import type {
    ActionRecommendation,
    PatternBreakoutDirection,
} from '@/domain/types';

const DIRECTIONS: readonly PatternBreakoutDirection[] = ['up', 'down'];

/**
 * A price tolerance of 0.6 units of the last printed decimal: the rounding width of a
 * printed price.
 */
const REFERENCE_TOLERANCE_UNITS = 0.6;

function finitePositive(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function positiveOrUndefined(value: unknown): number | undefined {
    return finitePositive(value) ? value : undefined;
}

function positiveNumbers(value: unknown): number[] {
    return asArray(value).filter(finitePositive);
}

function unique(values: readonly number[]): number[] {
    return [...new Set(values)];
}

/**
 * The stored recommendation re-typed field by field, so the shared plan helpers
 * (`effectiveStopLoss`, the zone edges) read it rather than a second copy of their rules
 * here. Prose is not read; unusable prices are dropped before the helpers see them.
 */
function readRecommendation(
    raw: Record<string, unknown>
): ActionRecommendation {
    const reconciled = asObject(raw.reconciledLevels);
    // A `stopLoss` key that is present but unusable means core left no stop (the plan check
    // does not fall back to the model's); only an absent key lets the model's stop stand.
    const reconciledStop = positiveOrUndefined(reconciled?.stopLoss);
    const stopRejected =
        reconciled !== null &&
        (reconciled.stopLossRejected === true ||
            (Object.hasOwn(reconciled, 'stopLoss') &&
                reconciledStop === undefined));
    return {
        positionAnalysis: '',
        entry: '',
        exit: '',
        riskReward: '',
        entryPrices: positiveNumbers(raw.entryPrices),
        stopLoss: positiveOrUndefined(raw.stopLoss),
        reconciledLevels:
            reconciled === null
                ? undefined
                : {
                      exit: '',
                      riskReward: '',
                      reason: '',
                      stopLoss: reconciledStop,
                      takeProfitPrices: Array.isArray(
                          reconciled.takeProfitPrices
                      )
                          ? positiveNumbers(reconciled.takeProfitPrices)
                          : undefined,
                      stopLossRejected: stopRejected ? true : undefined,
                  },
    };
}

function extractPlan(rawRecommendation: unknown): OutcomeSubject['plan'] {
    const raw = asObject(rawRecommendation);
    if (raw === null) return null;
    const rec = readRecommendation(raw);
    const entryLow = entryZoneBottom(rec.entryPrices);
    const entryHigh = entryZoneTop(rec.entryPrices);
    const targets =
        rec.reconciledLevels?.takeProfitPrices ??
        positiveNumbers(raw.takeProfitPrices);
    return {
        recommendation:
            asOptionalEnum(
                raw.entryRecommendation,
                VALID_ENTRY_RECOMMENDATIONS
            ) ?? null,
        // Read as stored, without validating the rest of the state: the label only needs
        // the position, and an invalid one is `null` like an absent one.
        position:
            asOptionalEnum(
                asObject(raw.planState)?.position,
                VALID_PLAN_POSITIONS
            ) ?? null,
        entryLow,
        entryHigh,
        stop: effectiveStopLoss(rec) ?? null,
        targets: unique(targets)
            .filter(price => entryHigh === null || price > entryHigh)
            .toSorted((a, b) => a - b),
        reconciled: rec.reconciledLevels !== undefined,
    };
}

/** Labels of the prompt's Market Reference levels printed at `price`, in first-seen order. */
function referenceLabels(
    price: number,
    referenceLevels: ReturnType<typeof parsePromptReferenceLevels>
): string[] {
    return [
        ...new Set(
            referenceLevels
                .filter(
                    level =>
                        Math.abs(level.price - price) <=
                        REFERENCE_TOLERANCE_UNITS * 10 ** -level.decimals
                )
                .map(level => level.label)
        ),
    ];
}

function extractLevels(
    rawKeyLevels: unknown,
    promptDynamic: string | null
): OutcomeSubject['levels'] {
    const keyLevels = asObject(rawKeyLevels);
    if (keyLevels === null) return [];
    const referenceLevels =
        promptDynamic === null ? [] : parsePromptReferenceLevels(promptDynamic);
    const priceOf = (entry: unknown): number | undefined =>
        positiveOrUndefined(asObject(entry)?.price);
    const entries: readonly {
        role: OutcomeLevelRole;
        price: number | undefined;
    }[] = [
        ...asArray(keyLevels.support).map(entry => ({
            role: 'support' as const,
            price: priceOf(entry),
        })),
        ...asArray(keyLevels.resistance).map(entry => ({
            role: 'resistance' as const,
            price: priceOf(entry),
        })),
        { role: 'poc' as const, price: priceOf(keyLevels.poc) },
    ];
    return entries
        .flatMap(({ role, price }) =>
            price === undefined ? [] : [{ role, price }]
        )
        .filter(
            (level, i, all) =>
                all.findIndex(
                    other =>
                        other.role === level.role && other.price === level.price
                ) === i
        )
        .map(level => ({
            ...level,
            refLabels: referenceLabels(level.price, referenceLevels),
        }));
}

function extractScenarioTargets(
    rawPriceTargets: unknown
): OutcomeSubject['scenarioTargets'] {
    const priceTargets = asObject(rawPriceTargets);
    if (priceTargets === null) return [];
    return (['bullish', 'bearish'] as const).flatMap(side =>
        asArray(asObject(priceTargets[side])?.targets).flatMap(entry => {
            const price = positiveOrUndefined(asObject(entry)?.price);
            return price === undefined ? [] : [{ side, price }];
        })
    );
}

function extractPatterns(rawPatterns: unknown): OutcomeSubject['patterns'] {
    return asArray(rawPatterns).flatMap(entry => {
        const pattern = asObject(entry);
        const geometry = asObject(pattern?.geometry);
        const direction = asOptionalEnum(geometry?.direction, DIRECTIONS);
        const breakout = positiveOrUndefined(geometry?.breakoutLevel);
        const extreme = positiveOrUndefined(geometry?.extremeLevel);
        if (
            pattern === null ||
            geometry === null ||
            pattern.detected !== true ||
            typeof pattern.patternName !== 'string' ||
            direction === undefined ||
            breakout === undefined ||
            extreme === undefined
        ) {
            return [];
        }
        return [
            {
                name: pattern.patternName,
                candidateId:
                    typeof pattern.candidateId === 'string'
                        ? pattern.candidateId
                        : null,
                breakout,
                extreme,
                direction,
                invalidation:
                    positiveOrUndefined(geometry.invalidationLevel) ?? null,
            },
        ];
    });
}

function extractAnchor(rawDataAsOf: unknown): OutcomeSubject['anchor'] {
    const dataAsOf = asObject(rawDataAsOf);
    const barTime = dataAsOf?.barTime;
    const close = dataAsOf?.close;
    return typeof barTime === 'number' &&
        Number.isInteger(barTime) &&
        barTime > 0 &&
        finitePositive(close)
        ? { barTime, close }
        : null;
}

/**
 * Copies what an analysis claimed (verdict, plan, key levels, scenario targets, detected
 * pattern geometry) into an {@link OutcomeSubject}, so a label can be computed after the
 * analysis row is gone and recomputed when the label definitions change.
 *
 * `result` is stored JSON and is read defensively: nothing is assumed about its shape.
 * Returns `null` unless it is an object with a valid `trend` and `riskLevel`. The plan is
 * read through the same helpers the plan check uses: the stop is `effectiveStopLoss`
 * (`null` when core rejected it, never the rejected model value), the targets are the
 * reconciled array where core wrote one, the zone is the min / max of the usable entry
 * prices. Usable means finite and positive; anything else is dropped, not repaired.
 *
 * A `reconciledLevels.stopLoss` key that is present but unusable (null, zero, negative,
 * not finite) means core left no stop: `stop` is `null` and the model's stop is **not**
 * used, as in the plan check. The model's stop stands only when `reconciledLevels` is
 * absent or has no `stopLoss` key at all.
 *
 * @param result - The stored (unfiltered, normalized) `AnalysisResponse`, as parsed JSON.
 * @param promptDynamic - The dynamic prompt the analysis was generated from, used to tag
 *   levels with the Market Reference labels printed at their price; `null` tags none.
 * @returns The subject, or `null` when `result` is not a usable analysis.
 */
export function extractOutcomeSubject(
    result: unknown,
    promptDynamic: string | null
): OutcomeSubject | null {
    const raw = asObject(result);
    const trend = asOptionalEnum(raw?.trend, VALID_TRENDS);
    const riskLevel = asOptionalEnum(raw?.riskLevel, VALID_RISK_LEVELS);
    if (raw === null || trend === undefined || riskLevel === undefined) {
        return null;
    }
    return {
        v: OUTCOME_SUBJECT_VERSION,
        anchor: extractAnchor(raw.dataAsOf),
        trend,
        riskLevel,
        plan: extractPlan(raw.actionRecommendation),
        levels: extractLevels(raw.keyLevels, promptDynamic),
        scenarioTargets: extractScenarioTargets(raw.priceTargets),
        patterns: extractPatterns(raw.patternSummaries),
    };
}
