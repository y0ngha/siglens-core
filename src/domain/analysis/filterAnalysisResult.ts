import { TIER_CONFIG } from '@/domain/tier';
import type {
    ActionRecommendation,
    AnalysisResponse,
    FilteredActionRecommendation,
    FilteredAnalysisResponse,
    FilteredResult,
    ReconciledActionLevels,
    Tier,
    TierConfig,
    TierInfoDepth,
} from '@/domain/types';

const ALL_INFO_DEPTH: readonly TierInfoDepth[] = TIER_CONFIG.infoDepth.pro;

function isDepthAllowed(
    allowedDepth: readonly TierInfoDepth[],
    depth: TierInfoDepth
): boolean {
    return allowedDepth.includes(depth);
}

function getLockedInfoDepth(
    allowedDepth: readonly TierInfoDepth[]
): TierInfoDepth[] {
    return ALL_INFO_DEPTH.filter(depth => !allowedDepth.includes(depth));
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

    return {
        positionAnalysis: allowFullDetail
            ? recommendation.positionAnalysis
            : null,
        entry: allowEntry ? recommendation.entry : null,
        exit: allowStoplossAndTarget ? recommendation.exit : null,
        riskReward: allowStoplossAndTarget ? recommendation.riskReward : null,
        ...(allowEntry && recommendation.entryRecommendation !== undefined
            ? { entryRecommendation: recommendation.entryRecommendation }
            : {}),
        ...(allowEntry && recommendation.entryPrices !== undefined
            ? { entryPrices: recommendation.entryPrices }
            : {}),
        ...(allowStoploss && recommendation.stopLoss !== undefined
            ? { stopLoss: recommendation.stopLoss }
            : {}),
        ...(allowTarget && recommendation.takeProfitPrices !== undefined
            ? { takeProfitPrices: recommendation.takeProfitPrices }
            : {}),
        ...(reconciledLevels ? { reconciledLevels } : {}),
    };
}

/**
 * Filter an analysis response to the information depth available to a tier.
 *
 * Restrictions are disabled by default through {@link TIER_CONFIG}; in that
 * mode the original result object is returned unchanged. When enabled, fields
 * unavailable to `tier` are replaced with `null` so consumers can render locked
 * paywall states without receiving hidden analysis content.
 *
 * @param result - Fully enriched analysis response.
 * @param tier - Subscription tier that controls field visibility.
 * @param config - Tier configuration; defaults to {@link TIER_CONFIG}.
 * @returns Filtered analysis data and the info-depth fragments hidden from the tier.
 */
export function filterAnalysisResult(
    result: AnalysisResponse,
    tier: Tier,
    config: TierConfig = TIER_CONFIG
): FilteredResult {
    const allowedDepth = config.infoDepth[tier];
    if (!config.featureFlags.enableTierRestrictions) {
        return { result, lockedInfoDepth: [] };
    }

    const allowDirection = isDepthAllowed(allowedDepth, 'direction');
    const allowSummary = isDepthAllowed(allowedDepth, 'summary');
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
        patternSummaries: allowFullDetail
            ? result.patternSummaries.map(pattern => ({
                  ...pattern,
                  confidenceWeight: allowConfidence
                      ? pattern.confidenceWeight
                      : 0,
              }))
            : null,
        strategyResults: allowFullDetail
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
        lockedInfoDepth: getLockedInfoDepth(allowedDepth),
    };
}
