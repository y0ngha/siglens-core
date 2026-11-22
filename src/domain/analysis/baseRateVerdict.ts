import {
    BASE_RATE_MIN_N,
    type BaseRateVerdict,
} from '@/domain/analysis/measuredBaseRates';

/** What the verdict rule reads for one row: the JSON companion of a generated table lets a test recompute it. */
export interface VerdictInputs {
    n: number;
    /**
     * Whether the test of the difference rejects zero at the table's level: the Holm-adjusted p
     * across the subject's eligible families, or (single-row subjects) the interval's low bound
     * above zero. `null` when it could not be computed.
     */
    significant: boolean | null;
    mean: number | null;
    low: number | null;
    /** The difference's mean in each time half and market; `null` when the data does not cover it. */
    splits: Record<'early' | 'late' | 'us' | 'kr', number | null>;
}

/**
 * @internal The one verdict rule of every measured table and record (WP-17 G3, DOM-8):
 *  - `insufficient_sample` below `BASE_RATE_MIN_N` events;
 *  - `beats_placebo` iff the test rejects zero, the difference is positive, its interval's low
 *    bound is above zero and the sign holds in both time halves and in the US and Korean
 *    markets separately; a half or market the data does not cover fails the rule (fail closed);
 *  - `no_edge` otherwise.
 *
 * Not on the public API: the generated tables and the replay scripts apply it; consumers read
 * the verdict from the table.
 */
export function verdictOf(input: VerdictInputs): BaseRateVerdict {
    if (input.n < BASE_RATE_MIN_N) return 'insufficient_sample';
    const splitsHold = Object.values(input.splits).every(
        v => v !== null && v > 0
    );
    return input.significant === true &&
        input.mean !== null &&
        input.mean > 0 &&
        input.low !== null &&
        input.low > 0 &&
        splitsHold
        ? 'beats_placebo'
        : 'no_edge';
}
