import { lastOf } from '@/domain/analysis/analysisUtils';
import {
    formatNullableNumber,
    formatQuotedPrice,
} from '@/domain/analysis/promptFormat';
import type { IndicatorPrintContext, IndicatorReadInput } from '@/domain/types';

/** The percent factor a ratio is printed with. */
export const PERCENT_FACTOR = 100;

// ─── Printed figures ──────────────────────────────────────────────────────────
// A card repeats the number the prompt printed, not the number it was printed from: the same
// formatter at the same precision, parsed back. `null` is the section's own `N/A`.

export const parsePrinted = (text: string): number | null =>
    text === 'N/A' ? null : Number(text.replaceAll(',', ''));

export type Maybe = number | null | undefined;

/** A bounded oscillator or ratio: `fmt`, two decimals. */
export const fmt = (n: Maybe): number | null =>
    parsePrinted(formatNullableNumber(n, 2));

/** A price-axis value at the quoted precision (a KRX price on its tick). */
export const price = (n: Maybe, print: IndicatorPrintContext): number | null =>
    parsePrinted(formatQuotedPrice(n, print.quoting));

/** A difference of prices at the difference precision. */
export const diff = (n: Maybe, print: IndicatorPrintContext): number | null =>
    parsePrinted(formatNullableNumber(n, print.differenceDp));

/** A volume-scale figure the prompt groups by thousands: a whole number. */
export const volume = (n: Maybe): number | null =>
    n == null || !Number.isFinite(n) ? null : Math.round(n) + 0;

export const lastNonNull = (arr: readonly (number | null)[]): number | null =>
    arr.findLast((v): v is number => v !== null) ?? null;

export const barCloseOf = ({
    selection,
    print,
}: IndicatorReadInput): number | null => price(selection.price, print);

/** The latest element of a per-bar series, or `null` when it is empty. */
export const lastIndicator = <T>(series: T[]): T | null => lastOf(series);
