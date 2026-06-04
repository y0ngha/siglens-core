import type { SanityResult } from '@/domain/types';

interface SanityOptions {
    min?: number;
    max?: number;
    /** Expected number of leading `null` warmup entries. */
    expectedWarmup?: number;
    label?: string;
}

/**
 * @internal Validate an indicator series for implementation correctness:
 * leading-null warmup count, finite non-null values, and optional [min,max]
 * bounds. Aggregates every violation into `issues` rather than throwing.
 */
export function checkSanity(
    series: readonly (number | null)[],
    opts: SanityOptions = {}
): SanityResult {
    const issues: string[] = [];
    const label = opts.label ?? 'series';

    let leadingNulls = 0;
    while (leadingNulls < series.length && series[leadingNulls] === null) {
        leadingNulls++;
    }
    if (
        opts.expectedWarmup !== undefined &&
        leadingNulls !== opts.expectedWarmup
    ) {
        issues.push(
            `${label}: warmup nulls ${leadingNulls} != expected ${opts.expectedWarmup}`
        );
    }

    for (let i = 0; i < series.length; i++) {
        const v = series[i];
        if (v === null) continue;
        if (!Number.isFinite(v)) {
            issues.push(`${label}: non-finite value at index ${i} (${v})`);
            continue;
        }
        if (opts.min !== undefined && v < opts.min) {
            issues.push(`${label}: value ${v} at ${i} below min ${opts.min}`);
        }
        if (opts.max !== undefined && v > opts.max) {
            issues.push(`${label}: value ${v} at ${i} above max ${opts.max}`);
        }
    }

    return { pass: issues.length === 0, issues };
}
