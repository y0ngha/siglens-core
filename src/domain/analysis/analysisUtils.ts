/** @internal Last element of the array, or null when the array is empty. */
export const lastOf = <T>(arr: T[]): T | null =>
    arr.length > 0 ? arr[arr.length - 1] : null;

import type { Bar } from '@/domain/types';

/** @internal A price usable for level math: finite and strictly positive. */
export const isUsablePrice = (price: number): boolean =>
    Number.isFinite(price) && price > 0;

/**
 * @internal
 * Whether every OHLC field of a bar is a usable price.
 *
 * Providers return placeholder bars: Yahoo KRX daily data carried rows like
 * `O:0 H:0 L:0 C:285000 V:0` (seen on 2026-09-08/09 for every large-cap), which
 * made `Period Low` 0 and printed `Current vs Low: Infinity%`, and dragged every
 * low-based indicator toward zero. A bar with a non-positive or non-finite price
 * is not a trade, so it is dropped rather than repaired.
 */
export const hasUsablePrices = (bar: Bar): boolean =>
    isUsablePrice(bar.open) &&
    isUsablePrice(bar.high) &&
    isUsablePrice(bar.low) &&
    isUsablePrice(bar.close);
