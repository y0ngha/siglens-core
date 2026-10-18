import type {
    FearGreedConfidence,
    FearGreedFactor,
    FearGreedFactorKey,
    FearGreedGroup,
    FearGreedLabel,
    ScoredSnapshot,
    FearGreedWarning,
    FactorValues,
} from '@/domain/indicators/fearGreed/types';
import { percentile } from '@/domain/indicators/fearGreed/percentile';

/**
 * 5-stage sentiment cutoffs (strict less-than) for mapping a 0..100 score to a
 * label. Public so consumers can render gauge segments and classify arbitrary
 * scores consistently with {@link scoreToLabel}.
 */
export const FEAR_GREED_LABEL_CUTOFFS = {
    EXTREME_FEAR_MAX: 25,
    FEAR_MAX: 45,
    NEUTRAL_MAX: 55,
    GREED_MAX: 75,
} as const;

/**
 * @internal §4.5 self-norm warning thresholds.
 * Used internally by composeSnapshot and walkForward; not part of the public API.
 */
export const FEAR_GREED_WARNING_THRESHOLDS = {
    /** 52w position below this AND ma200 < 0 AND score >= score floor → CHRONIC_WEAKNESS */
    WEAK_RANGE_MAX: 0.3,
    /** 52w position above this AND ma200 > 0 AND score <= score ceiling → CHRONIC_STRENGTH */
    STRONG_RANGE_MIN: 0.7,
    /** Minimum score for CHRONIC_WEAKNESS to trigger */
    WEAK_SCORE_MIN: 55,
    /** Maximum score for CHRONIC_STRENGTH to trigger */
    STRONG_SCORE_MAX: 45,
} as const;

/**
 * @internal Confidence classification thresholds (sample size).
 * Used internally by composeSnapshot and walkForward; not part of the public API.
 */
export const FEAR_GREED_CONFIDENCE_THRESHOLDS = {
    NORMAL: 60,
    LIMITED: 10,
} as const;

/**
 * Map a 0..100 fear-greed score to its 5-stage sentiment label. Boundaries are
 * defined by {@link FEAR_GREED_LABEL_CUTOFFS}.
 *
 * @param score - Composite fear-greed score in the 0..100 range.
 * @returns The 5-stage sentiment label for `score`.
 */
export function scoreToLabel(score: number): FearGreedLabel {
    if (score < FEAR_GREED_LABEL_CUTOFFS.EXTREME_FEAR_MAX)
        return 'EXTREME_FEAR';
    if (score < FEAR_GREED_LABEL_CUTOFFS.FEAR_MAX) return 'FEAR';
    if (score < FEAR_GREED_LABEL_CUTOFFS.NEUTRAL_MAX) return 'NEUTRAL';
    if (score < FEAR_GREED_LABEL_CUTOFFS.GREED_MAX) return 'GREED';
    return 'EXTREME_GREED';
}

/**
 * Spec §4.5 self-norm warning detection. Symmetric chronic weakness/strength.
 *
 * @internal Used internally by composeSnapshot and walkForward.
 */
export function detectWarning(
    score: number,
    raw: FactorValues
): FearGreedWarning {
    const t = FEAR_GREED_WARNING_THRESHOLDS;
    if (
        raw.ma200Dist < 0 &&
        raw.rangePosition < t.WEAK_RANGE_MAX &&
        score >= t.WEAK_SCORE_MIN
    ) {
        return 'CHRONIC_WEAKNESS';
    }
    if (
        raw.ma200Dist > 0 &&
        raw.rangePosition > t.STRONG_RANGE_MIN &&
        score <= t.STRONG_SCORE_MAX
    ) {
        return 'CHRONIC_STRENGTH';
    }
    return null;
}

const FLOW_KEYS = ['volume_z', 'buysell_imbalance', 'poc_distance'] as const;
const TREND_KEYS = ['ma200_distance', 'range_position'] as const;

function computePctls(
    current: FactorValues,
    sample: FactorValues[]
): Record<FearGreedFactorKey, number> {
    return {
        volume_z: percentile(
            current.volumeZ,
            sample.map(s => s.volumeZ)
        ),
        buysell_imbalance: percentile(
            current.buySellImb,
            sample.map(s => s.buySellImb)
        ),
        poc_distance: percentile(
            current.pocDist,
            sample.map(s => s.pocDist)
        ),
        ma200_distance: percentile(
            current.ma200Dist,
            sample.map(s => s.ma200Dist)
        ),
        range_position: percentile(
            current.rangePosition,
            sample.map(s => s.rangePosition)
        ),
    };
}

const FACTOR_FIELD: Record<FearGreedFactorKey, keyof FactorValues> = {
    volume_z: 'volumeZ',
    buysell_imbalance: 'buySellImb',
    poc_distance: 'pocDist',
    ma200_distance: 'ma200Dist',
    range_position: 'rangePosition',
};

function rawValue(current: FactorValues, key: FearGreedFactorKey): number {
    return current[FACTOR_FIELD[key]];
}

function buildFactors(
    current: FactorValues,
    pctls: Record<FearGreedFactorKey, number>,
    keys: ReadonlyArray<FearGreedFactorKey>
): FearGreedFactor[] {
    return keys.map(k => ({
        key: k,
        rawValue: rawValue(current, k),
        percentile: pctls[k],
    }));
}

function classifyConfidence(sampleSize: number): FearGreedConfidence {
    const t = FEAR_GREED_CONFIDENCE_THRESHOLDS;
    if (sampleSize >= t.NORMAL) return 'normal';
    if (sampleSize >= t.LIMITED) return 'limited';
    return 'insufficient';
}

/**
 * Compose a snapshot from current raw factors + walk-forward sample.
 *
 * @param current - current bar's raw factor values, or null when uncomputable
 * @param sample - factor values from prior bars (current excluded)
 * @returns snapshot, or null when current is null or confidence is insufficient
 *
 * @internal Used internally by walkForward.
 */
export function composeSnapshot(
    current: FactorValues | null,
    sample: FactorValues[]
): ScoredSnapshot | null {
    if (!current) return null;
    const sampleSize = sample.length;
    const confidence = classifyConfidence(sampleSize);
    if (confidence === 'insufficient') return null;

    const pctls = computePctls(current, sample);
    const flowFactors = buildFactors(current, pctls, FLOW_KEYS);
    const trendFactors = buildFactors(current, pctls, TREND_KEYS);

    const flowScore =
        flowFactors.reduce((a, f) => a + f.percentile, 0) / FLOW_KEYS.length;
    const trendScore =
        trendFactors.reduce((a, f) => a + f.percentile, 0) / TREND_KEYS.length;
    const score = 0.5 * flowScore + 0.5 * trendScore;
    const label = scoreToLabel(score);
    const warning = detectWarning(score, current);

    const groups: FearGreedGroup[] = [
        { name: 'Flow', score: flowScore, factors: flowFactors },
        { name: 'Trend', score: trendScore, factors: trendFactors },
    ];

    return { score, label, groups, confidence, sampleSize, warning };
}
