import {
    asArray,
    asNumberOrNull,
    asObject,
    asString,
} from '@/domain/analysis/normalizePrimitives';
import type { TreasuryRateSnapshot } from './types';

/**
 * Extract the most recent 2Y/10Y treasury yields from an FMP treasury-rates response.
 *
 * FMP normally returns rows newest-first, but the input is sorted descending by
 * `date` defensively (mirroring {@link normalizeEconomicIndicatorSeries}) so a
 * change in wire ordering cannot silently pick a stale row. Missing maturities
 * are preserved as `null` on the returned snapshot rather than dropped, so
 * callers can distinguish "not available" from "absent".
 *
 * @param raw - FMP treasury-rates response (arbitrary shape).
 * @returns Snapshot of the latest row, or `null` if the input is empty / no row
 *   carries a `date`.
 */
export function normalizeTreasuryRates(
    raw: unknown
): TreasuryRateSnapshot | null {
    const sorted = asArray(raw).toSorted((a, b) => {
        const da = asString(asObject(a)?.date);
        const db = asString(asObject(b)?.date);
        return da < db ? 1 : da > db ? -1 : 0;
    });
    const first = asObject(sorted[0]);
    if (first === null) return null;
    const date = asString(first.date);
    if (date === '') return null;
    return {
        date,
        year2: asNumberOrNull(first.year2),
        year10: asNumberOrNull(first.year10),
    };
}

/**
 * Compute the 2s10s yield spread (10Y minus 2Y, in percentage points).
 *
 * A negative value signals an inverted yield curve (a classic recession signal).
 *
 * @param snap - Treasury rate snapshot. Pass `null` when rates are unavailable.
 * @returns Spread in percentage points, or `null` if either leg is missing.
 */
export function computeYieldSpread(
    snap: TreasuryRateSnapshot | null
): number | null {
    if (snap === null || snap.year2 === null || snap.year10 === null) {
        return null;
    }
    return snap.year10 - snap.year2;
}
