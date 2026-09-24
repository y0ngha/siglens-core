import { resolveRestrictionFlag, TIER_CONFIG } from '@/domain/tier';
import type {
    ActionRecommendation,
    AnalysisResponse,
    FilteredActionRecommendation,
    FilteredAnalysisResponse,
    FilteredAnalysisResult,
    ReconciledActionLevels,
    Tier,
    TierConfig,
    TierInfoDepth,
} from '@/domain/types';

type OptionalActionFieldKey =
    'entryRecommendation' | 'entryPrices' | 'stopLoss' | 'takeProfitPrices';

type OptionalActionField =
    | readonly [
          'entryRecommendation',
          NonNullable<FilteredActionRecommendation['entryRecommendation']>,
      ]
    | readonly [
          'entryPrices',
          NonNullable<FilteredActionRecommendation['entryPrices']>,
      ]
    | readonly [
          'stopLoss',
          NonNullable<FilteredActionRecommendation['stopLoss']>,
      ]
    | readonly [
          'takeProfitPrices',
          NonNullable<FilteredActionRecommendation['takeProfitPrices']>,
      ];

function isDepthAllowed(
    allowedDepth: readonly TierInfoDepth[],
    depth: TierInfoDepth
): boolean {
    return allowedDepth.includes(depth);
}

function getLockedInfoDepth(
    allowedDepth: readonly TierInfoDepth[],
    allDepth: readonly TierInfoDepth[]
): readonly TierInfoDepth[] {
    return allDepth.filter(depth => !allowedDepth.includes(depth));
}

function optionalActionField<Key extends OptionalActionFieldKey>(
    allowed: boolean,
    key: Key,
    value: FilteredActionRecommendation[Key] | undefined
): OptionalActionField | undefined {
    if (!allowed || value === undefined) return undefined;

    // Key and value are paired by the generic signature; TypeScript widens the
    // tuple when returning it as the explicit union used by Object.fromEntries.
    return [key, value] as OptionalActionField;
}

function filterOptionalActionFields(
    recommendation: ActionRecommendation,
    allowEntry: boolean,
    allowStoploss: boolean,
    allowTarget: boolean
): Partial<FilteredActionRecommendation> {
    const fields = [
        optionalActionField(
            allowEntry,
            'entryRecommendation',
            recommendation.entryRecommendation
        ),
        optionalActionField(
            allowEntry,
            'entryPrices',
            recommendation.entryPrices
        ),
        optionalActionField(allowStoploss, 'stopLoss', recommendation.stopLoss),
        optionalActionField(
            allowTarget,
            'takeProfitPrices',
            recommendation.takeProfitPrices
        ),
    ].filter((field): field is OptionalActionField => field !== undefined);

    // Object.fromEntries widens keys, but optionalActionField restricts every key
    // to OptionalActionFieldKey and every value to that key's declared type.
    return Object.fromEntries(fields) as Partial<FilteredActionRecommendation>;
}

function filterReconciledLevels(
    levels: ReconciledActionLevels | undefined,
    allowStoplossAndTarget: boolean
): ReconciledActionLevels | undefined {
    if (!levels || !allowStoplossAndTarget) return undefined;

    return {
        ...(levels.stopLoss !== undefined ? { stopLoss: levels.stopLoss } : {}),
        ...(levels.takeProfitPrices !== undefined
            ? { takeProfitPrices: levels.takeProfitPrices }
            : {}),
        exit: levels.exit,
        riskReward: levels.riskReward,
        reason: levels.reason,
    };
}

function filterActionRecommendation(
    recommendation: ActionRecommendation | undefined,
    allowedDepth: readonly TierInfoDepth[]
): FilteredActionRecommendation | null {
    if (!recommendation) return null;

    const allowFullDetail = isDepthAllowed(allowedDepth, 'full_detail');
    const allowEntry = isDepthAllowed(allowedDepth, 'entry');
    const allowStoploss = isDepthAllowed(allowedDepth, 'stoploss');
    const allowTarget = isDepthAllowed(allowedDepth, 'target');
    const allowStoplossAndTarget = allowStoploss && allowTarget;
    const reconciledLevels = filterReconciledLevels(
        recommendation.reconciledLevels,
        allowStoplossAndTarget
    );
    const optionalFields = filterOptionalActionFields(
        recommendation,
        allowEntry,
        allowStoploss,
        allowTarget
    );

    return {
        positionAnalysis: allowFullDetail
            ? recommendation.positionAnalysis
            : null,
        entry: allowEntry ? recommendation.entry : null,
        exit: allowStoplossAndTarget ? recommendation.exit : null,
        riskReward: allowStoplossAndTarget ? recommendation.riskReward : null,
        ...optionalFields,
        ...(reconciledLevels ? { reconciledLevels } : {}),
        // `planCheck` is derived from stopLoss and takeProfitPrices, so it rides the same
        // gate as those fields — otherwise a free-tier response would hand back the exact
        // risk:reward the paywall is withholding, just in numeric form.
        ...(allowStoplossAndTarget && recommendation.planCheck
            ? { planCheck: recommendation.planCheck }
            : {}),
    };
}

/**
 * Filter an analysis response to the information depth available to a tier.
 *
 * Info-depth restrictions are ON by default through {@link TIER_CONFIG}
 * (`enableInfoDepthRestrictions`), so free-tier responses are masked by
 * default. The original result object is returned unchanged only when the
 * resolved restriction flag is `false` (a legacy config with restrictions
 * disabled). When restrictions are enabled, fields unavailable to `tier` are
 * replaced with `null` so consumers can render locked paywall states without
 * receiving hidden analysis content.
 *
 * @param result - Fully enriched analysis response.
 * @param tier - Subscription tier that controls field visibility.
 * @param config - Tier configuration; defaults to {@link TIER_CONFIG}.
 * @returns Filtered analysis data and the info-depth fragments hidden from the tier.
 *
 * @example
 * ```ts
 * const { result, lockedInfoDepth } = filterAnalysisResult(
 *     analysis,
 *     'member',
 *     config
 * );
 * const shouldShowEntryPaywall = lockedInfoDepth.includes('entry');
 * ```
 */
export function filterAnalysisResult(
    result: AnalysisResponse,
    tier: Tier,
    config: TierConfig = TIER_CONFIG
): FilteredAnalysisResult {
    const allowedDepth = config.infoDepth[tier];
    const restrictionsEnabled = resolveRestrictionFlag(
        config.featureFlags.enableInfoDepthRestrictions,
        config.featureFlags.enableTierRestrictions
    );
    if (!restrictionsEnabled) {
        return { result, lockedInfoDepth: [] };
    }

    const allowDirection = isDepthAllowed(allowedDepth, 'direction');
    const allowSummary = isDepthAllowed(allowedDepth, 'summary');
    const allowSkillDetection = isDepthAllowed(allowedDepth, 'skill_detection');
    const allowPartialDetail = isDepthAllowed(allowedDepth, 'partial_detail');
    const allowFullDetail = isDepthAllowed(allowedDepth, 'full_detail');
    const allowTarget = isDepthAllowed(allowedDepth, 'target');
    const allowConfidence = isDepthAllowed(allowedDepth, 'confidence');

    const filtered: FilteredAnalysisResponse = {
        summary: allowSummary ? result.summary : null,
        trend: allowDirection ? result.trend : null,
        indicatorResults: allowPartialDetail ? result.indicatorResults : null,
        riskLevel: allowPartialDetail ? result.riskLevel : null,
        keyLevels: allowPartialDetail ? result.keyLevels : null,
        priceTargets: allowTarget ? result.priceTargets : null,
        patternSummaries: allowSkillDetection
            ? result.patternSummaries.map(pattern => ({
                  ...pattern,
                  confidenceWeight: allowConfidence
                      ? pattern.confidenceWeight
                      : 0,
              }))
            : null,
        strategyResults: allowSkillDetection
            ? result.strategyResults.map(strategy => ({
                  ...strategy,
                  confidenceWeight: allowConfidence
                      ? strategy.confidenceWeight
                      : 0,
              }))
            : null,
        candlePatterns: allowPartialDetail ? result.candlePatterns : null,
        trendlines: allowFullDetail ? result.trendlines : null,
        actionRecommendation: filterActionRecommendation(
            result.actionRecommendation,
            allowedDepth
        ),
        analyzedAt: result.analyzedAt,
    };

    return {
        result: filtered,
        lockedInfoDepth: getLockedInfoDepth(allowedDepth, config.infoDepth.pro),
    };
}
