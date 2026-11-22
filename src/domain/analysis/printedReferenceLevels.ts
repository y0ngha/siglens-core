import {
    formatQuotedPrice,
    type PriceQuoting,
} from '@/domain/analysis/promptFormat';
import type {
    HorizonKey,
    HorizonReference,
    MarketReference,
    ReferenceLevel,
} from '@/domain/types';

/** @internal The horizons in the order the prompt prints them. */
export const HORIZON_KEYS: readonly HorizonKey[] = ['short', 'medium', 'long'];

/** Level kinds that come from a horizon's Fibonacci leg (not the ABC projection). */
const FIB_LEG_LEVEL_KINDS: readonly ReferenceLevel['kind'][] = [
    'fib_retracement',
    'fib_extension',
];

/** Whether two horizons resolved to the very same swing pair. */
const isSameFibLeg = (
    a: HorizonReference['fibProjection'],
    b: HorizonReference['fibProjection']
): boolean =>
    a != null &&
    b != null &&
    a.highIndex === b.highIndex &&
    a.lowIndex === b.lowIndex;

/**
 * @internal
 * The earlier horizon whose Fibonacci leg `key` repeats, or `null`. A horizon that repeats
 * an earlier leg points at it instead of printing the anchor, the table and the `Fib …%`
 * level rows again.
 */
export function sameFibLegAs(
    reference: MarketReference,
    key: HorizonKey
): HorizonKey | null {
    const index = HORIZON_KEYS.indexOf(key);
    return (
        HORIZON_KEYS.slice(0, index).find(earlier =>
            isSameFibLeg(
                reference[earlier].fibProjection,
                reference[key].fibProjection
            )
        ) ?? null
    );
}

/**
 * @internal
 * The levels of one side a horizon block prints under its `Resistance (above):` or
 * `Support (below):` heading: all of them, except the Fibonacci-leg rows of a horizon that
 * repeats an earlier horizon's leg. The one predicate the market reference section and the
 * stop and target candidates share (DOM-8: a candidate is a line the model was shown).
 */
export function printableLevels(
    levels: readonly ReferenceLevel[],
    repeatedLegOf: HorizonKey | null
): ReferenceLevel[] {
    return repeatedLegOf === null
        ? [...levels]
        : levels.filter(l => !FIB_LEG_LEVEL_KINDS.includes(l.kind));
}

/**
 * @internal
 * The price the prompt prints for `price` under `quoting` (KRX tick, then `quoting.dp`
 * decimals), as a number; `null` when it is not finite. Deciding anything on the raw price
 * instead would disagree with the text the model reads at the last printed digit.
 */
export function printedPrice(
    price: number,
    quoting: PriceQuoting
): number | null {
    const printed = Number(formatQuotedPrice(price, quoting));
    return Number.isFinite(printed) ? printed : null;
}

/**
 * @internal
 * Every level on one side across the three horizons that the prompt prints, beyond the
 * at-price band (the `atPrice` flag the market reference set from half the mean bar range),
 * with `price` replaced by the **printed** price, one entry per printed price (the first
 * horizon that prints it keeps its label), nearest first.
 */
export function printedLevelsOnSide(
    reference: MarketReference,
    side: 'support' | 'resistance',
    quoting: PriceQuoting
): ReferenceLevel[] {
    const printed = HORIZON_KEYS.flatMap(key =>
        printableLevels(
            reference[key].levels[side],
            sameFibLegAs(reference, key)
        )
    ).flatMap(level => {
        const price = level.atPrice ? null : printedPrice(level.price, quoting);
        return price === null ? [] : [{ ...level, price }];
    });
    const byPrice = new Map(
        printed
            .toReversed()
            .map((level): [number, ReferenceLevel] => [level.price, level])
    );
    return [...byPrice.values()].toSorted((a, b) =>
        side === 'support' ? b.price - a.price : a.price - b.price
    );
}
