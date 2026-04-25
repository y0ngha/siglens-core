import type {
    ClusteredKeyLevel,
    ClusteredKeyLevels,
    KeyLevel,
    KeyLevels,
} from '@/domain/types';

export const DEFAULT_EPSILON_PERCENT = 0.005;
const PRICE_DECIMAL_FACTOR = 100;

function isValidKeyLevel(level: KeyLevel | null | undefined): boolean {
    return level != null && level.price > 0 && level.reason.trim() !== '';
}

export function validateKeyLevels(keyLevels: KeyLevels): KeyLevels {
    const support = keyLevels.support.filter(isValidKeyLevel);
    const resistance = keyLevels.resistance.filter(isValidKeyLevel);
    const poc =
        keyLevels.poc !== undefined && isValidKeyLevel(keyLevels.poc)
            ? keyLevels.poc
            : undefined;

    return { support, resistance, poc };
}

function clusterLevels(
    levels: KeyLevel[],
    epsilon: number
): ClusteredKeyLevel[] {
    if (levels.length === 0) return [];

    // levels is non-empty after the guard above
    const sorted = levels.toSorted((a, b) => a.price - b.price);

    // Sliding window clustering: for-loop avoids O(N²) spread inside reduce
    const clusters: KeyLevel[][] = [[sorted[0]!]];
    for (let i = 1; i < sorted.length; i++) {
        const current = sorted[i]!;
        const lastCluster = clusters[clusters.length - 1]!;
        const lastPrice = lastCluster[lastCluster.length - 1]!.price;
        if (current.price - lastPrice <= epsilon) {
            lastCluster.push(current);
        } else {
            clusters.push([current]);
        }
    }

    return clusters.map(group => {
        const count = group.length;
        const rawPrice =
            group.reduce((sum, level) => sum + level.price, 0) / count;
        const price =
            Math.round(rawPrice * PRICE_DECIMAL_FACTOR) / PRICE_DECIMAL_FACTOR;
        const reason = count === 1 ? group[0].reason : `${count}개 지표 수렴`;

        return { price, reason, count, sources: group };
    });
}

export function clusterKeyLevels(
    keyLevels: KeyLevels,
    currentPrice: number,
    epsilonPercent: number = DEFAULT_EPSILON_PERCENT
): ClusteredKeyLevels {
    const epsilon = epsilonPercent * currentPrice;

    return {
        support: clusterLevels(keyLevels.support, epsilon).toReversed(),
        resistance: clusterLevels(keyLevels.resistance, epsilon),
        poc: keyLevels.poc,
    };
}
