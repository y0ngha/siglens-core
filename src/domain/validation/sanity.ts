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

    // Per MISTAKES.md #14.5: conditional multi-push (min/max each add 0–1 issues)
    // reads more clearly as a loop than flatMap + inner spreads, and avoids the
    // throwaway temp arrays. O(N) either way.
    const valueIssues: string[] = [];
    const n = series.length;
    for (let i = 0; i < n; i++) {
        const v = series[i];
        if (v === null) continue;
        if (!Number.isFinite(v)) {
            valueIssues.push(`${label}: non-finite value at index ${i} (${v})`);
            continue;
        }
        if (opts.min !== undefined && v < opts.min) {
            valueIssues.push(
                `${label}: value ${v} at ${i} below min ${opts.min}`
            );
        }
        if (opts.max !== undefined && v > opts.max) {
            valueIssues.push(
                `${label}: value ${v} at ${i} above max ${opts.max}`
            );
        }
    }

    const issues = [...warmupIssues, ...valueIssues];
    return { pass: issues.length === 0, issues };
}
