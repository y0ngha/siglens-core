import { formatPlainNumber } from '@/domain/plainNumber';

/** Which side the ratio says has more: calls (`< 1`), puts (`> 1`) or neither (`=== 1`). */
export type PutCallSide = 'more_calls' | 'more_puts' | 'even';

/** What the ratio counts: open contracts (an options chain) or underlying notional (13F filings). */
export type PutCallBasis = 'open_interest' | 'notional';

/** A put/call ratio read for the model: the side as a code and the same reading as one sentence. */
export interface PutCallReading {
    side: PutCallSide;
    text: string;
}

interface BasisWording {
    /** Clause after "puts per call". */
    measuredBy: string;
    morePuts: string;
    moreCalls: string;
}

const EVEN_TEXT = 'puts and calls even';

const BASIS_WORDING: Record<PutCallBasis, BasisWording> = {
    open_interest: {
        measuredBy: 'by open interest',
        morePuts: 'more put contracts open than call contracts',
        moreCalls: 'more call contracts open than put contracts',
    },
    notional: {
        measuredBy: 'by underlying notional (13F)',
        morePuts: 'more put exposure than call exposure',
        moreCalls: 'more call exposure than put exposure',
    },
};

function sideOf(ratio: number): PutCallSide {
    if (ratio < 1) return 'more_calls';
    return ratio > 1 ? 'more_puts' : 'even';
}

function sideText(side: PutCallSide, wording: BasisWording): string {
    if (side === 'more_calls') return wording.moreCalls;
    return side === 'more_puts' ? wording.morePuts : EVEN_TEXT;
}

/**
 * Reads a put/call ratio (puts per call) as a side, so the model states which side
 * has more instead of inverting the ratio.
 *
 * The side comes from the value exactly as passed: a caller that prints a rounded
 * ratio passes the rounded value, so the printed number and the side cannot
 * disagree. The reading is a count, not a mood: it names no sentiment, because
 * puts are often hedges.
 *
 * @param ratio - Puts per call, e.g. `0.58`. `null`, non-finite and negative values have no reading.
 * @param basis - What the ratio counts; selects the wording only.
 * @returns The reading, or `null` when the ratio is unusable.
 *
 * @example
 * ```ts
 * readPutCallRatio(0.58, 'open_interest');
 * // { side: 'more_calls',
 * //   text: '0.58 puts per call by open interest: more call contracts open than put contracts' }
 * ```
 */
export function readPutCallRatio(
    ratio: number | null,
    basis: PutCallBasis
): PutCallReading | null {
    if (ratio === null || !Number.isFinite(ratio) || ratio < 0) return null;
    const wording = BASIS_WORDING[basis];
    const side = sideOf(ratio);
    return {
        side,
        text: `${formatPlainNumber(ratio)} puts per call ${wording.measuredBy}: ${sideText(side, wording)}`,
    };
}
