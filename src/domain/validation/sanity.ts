import type { SanityOptions, SanityResult } from '@/domain/types';

/**
 * @internal Validate an indicator series for implementation correctness:
 * leading-null warmup count, finite non-null values, and optional [min,max]
 * bounds. Aggregates every violation into `issues` rather than throwing.
 */
export function checkSanity(
    series: readonly (number | null)[],
    opts: SanityOptions = {}
): SanityResult {
    const label = opts.label ?? 'series';

    const firstNonNull = series.findIndex(v => v !== null);
    const leadingNulls = firstNonNull === -1 ? series.length : firstNonNull;
    const warmupIssues =
        opts.expectedWarmup !== undefined &&
        leadingNulls !== opts.expectedWarmup
            ? [
                  `${label}: warmup nulls ${leadingNulls} != expected ${opts.expectedWarmup}`,
              ]
            : [];

    const valueIssues = series.flatMap((v, i): string[] => {
        if (v === null) return [];
        if (!Number.isFinite(v)) {
            return [`${label}: non-finite value at index ${i} (${v})`];
        }
        return [
            ...(opts.min !== undefined && v < opts.min
                ? [`${label}: value ${v} at ${i} below min ${opts.min}`]
                : []),
            ...(opts.max !== undefined && v > opts.max
                ? [`${label}: value ${v} at ${i} above max ${opts.max}`]
                : []),
        ];
    });

    const issues = [...warmupIssues, ...valueIssues];
    return { pass: issues.length === 0, issues };
}
