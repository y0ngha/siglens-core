/** Small numeric helpers for the replay report. Pure; every function states its empty case. */

import { quantile } from '@/domain/outcomes/weekClusterBootstrap';

/** Mean, or `null` for no values. */
export function mean(values: readonly number[]): number | null {
    return values.length === 0
        ? null
        : values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Sample standard error of the mean (`s / sqrt(n)`); `null` below two values. */
export function standardError(values: readonly number[]): number | null {
    const m = mean(values);
    if (m === null || values.length < 2) return null;
    const variance =
        values.reduce((sum, value) => sum + (value - m) ** 2, 0) /
        (values.length - 1);
    return Math.sqrt(variance / values.length);
}

export function median(values: readonly number[]): number | null {
    return quantile(values, 0.5);
}

/** `|A ∩ B| / |A ∪ B|` of two sets of keys; `1` when both are empty. */
export function jaccard(a: readonly string[], b: readonly string[]): number {
    const left = new Set(a);
    const right = new Set(b);
    const union = new Set([...left, ...right]);
    if (union.size === 0) return 1;
    const shared = [...left].filter(key => right.has(key)).length;
    return shared / union.size;
}

/** Every unordered pair of distinct positions of `items`, in input order. */
export function pairsOf<T>(items: readonly T[]): readonly (readonly [T, T])[] {
    return items.flatMap((first, i) =>
        items.slice(i + 1).map((second): readonly [T, T] => [first, second])
    );
}
