import type {
    FearGreedConfidence,
    FearGreedFactor,
    FearGreedFactorKey,
    FearGreedGroup,
    FearGreedLabel,
    FearGreedSnapshot,
    FearGreedWarning,
    FactorValues,
} from '@/domain/indicators/fearGreed/types';
import { percentile } from '@/domain/indicators/fearGreed/percentile';

export function scoreToLabel(score: number): FearGreedLabel {
    if (score < 25) return 'EXTREME_FEAR';
    if (score < 45) return 'FEAR';
    if (score < 55) return 'NEUTRAL';
    if (score < 75) return 'GREED';
    return 'EXTREME_GREED';
}

/**
 * Spec §4.5 self-norm warning detection. Symmetric chronic weakness/strength.
 */
export function detectWarning(
    score: number,
    raw: FactorValues
): FearGreedWarning {
    if (raw.ma200Dist < 0 && raw.rangePosition < 0.3 && score >= 55) {
        return 'CHRONIC_WEAKNESS';
    }
    if (raw.ma200Dist > 0 && raw.rangePosition > 0.7 && score <= 45) {
        return 'CHRONIC_STRENGTH';
    }
    return null;
}

const FLOW_KEYS = ['volume_z', 'buysell_imbalance', 'poc_distance'] as const;
const TREND_KEYS = ['ma200_distance', 'range_position'] as const;

interface PctlByKey {
    volume_z: number;
    buysell_imbalance: number;
    poc_distance: number;
    ma200_distance: number;
    range_position: number;
}

function computePctls(
    current: FactorValues,
    sample: FactorValues[]
): PctlByKey {
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

function rawValue(current: FactorValues, key: FearGreedFactorKey): number {
    switch (key) {
        case 'volume_z':
            return current.volumeZ;
        case 'buysell_imbalance':
            return current.buySellImb;
        case 'poc_distance':
            return current.pocDist;
        case 'ma200_distance':
            return current.ma200Dist;
        case 'range_position':
            return current.rangePosition;
    }
}

function buildFactors(
    current: FactorValues,
    pctls: PctlByKey,
    keys: ReadonlyArray<FearGreedFactorKey>
): FearGreedFactor[] {
    return keys.map(k => ({
        key: k,
        rawValue: rawValue(current, k),
        percentile: pctls[k],
    }));
}

function classifyConfidence(sampleSize: number): FearGreedConfidence {
    if (sampleSize >= 60) return 'normal';
    if (sampleSize >= 10) return 'limited';
    return 'insufficient';
}

/**
 * Compose a snapshot from current raw factors + walk-forward sample.
 *
 * @param current - current bar's raw factor values, or null when uncomputable
 * @param sample - factor values from prior bars (current excluded)
 * @param sampleSize - sample.length (passed explicitly for clarity in callers)
 * @returns snapshot, or null when current is null or confidence is insufficient
 */
export function composeSnapshot(
    current: FactorValues | null,
    sample: FactorValues[],
    sampleSize: number
): FearGreedSnapshot | null {
    if (!current) return null;
    const confidence = classifyConfidence(sampleSize);
    if (confidence === 'insufficient') return null;

    const pctls = computePctls(current, sample);
    const flowFactors = buildFactors(current, pctls, FLOW_KEYS);
    const trendFactors = buildFactors(current, pctls, TREND_KEYS);

    const flowScore =
        flowFactors.reduce((a, f) => a + f.percentile, 0) /
        flowFactors.length;
    const trendScore =
        trendFactors.reduce((a, f) => a + f.percentile, 0) /
        trendFactors.length;
    const score = 0.5 * flowScore + 0.5 * trendScore;
    const label = scoreToLabel(score);
    const warning = detectWarning(score, current);

    const groups: FearGreedGroup[] = [
        { name: 'Flow', score: flowScore, factors: flowFactors },
        { name: 'Trend', score: trendScore, factors: trendFactors },
    ];

    return { score, label, groups, confidence, sampleSize, warning };
}
