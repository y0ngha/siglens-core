import {
    asArray,
    asNumber,
    asObject,
    asString,
} from '@/domain/analysis/normalizePrimitives';
import type { EconomicIndicatorPoint, EconomicIndicatorSeries } from './types';

/**
 * Normalize an FMP `/economic-indicators?name=<N>` response into a typed series.
 *
 * Drops points where `value` is not finite or `date` is empty. Re-sorts
 * descending by date (defensive: FMP usually returns newest-first) so that
 * `latest` / `previous` extraction is order-independent.
 *
 * @param name - FMP indicator identifier (e.g. `'federalFunds'`). Preserved
 *   verbatim in the result.
 * @param raw - FMP response (arbitrary shape; non-arrays resolve to an empty series).
 * @param trendLength - Maximum number of most-recent-to-oldest points to include in `trend`.
 * @param unit - Unit label for the series' values (e.g. `'%'`), when the
 *   caller's own registry knows it. This module has no such registry itself
 *   (spec 2026-09-18 §B3) — omit when unknown; the macro-briefing prompt
 *   then formats the series as level-type rather than rate-type.
 * @returns Normalized indicator series with `latest`, `previous`, `trend`, and `unit`.
 */
export function normalizeEconomicIndicatorSeries(
    name: string,
    raw: unknown,
    trendLength: number,
    unit?: string
): EconomicIndicatorSeries {
    const points: EconomicIndicatorPoint[] = asArray(raw)
        .map(item => {
            const obj = asObject(item);
            if (obj === null) return null;
            const value = asNumber(obj.value);
            const date = asString(obj.date);
            if (value === undefined || date === '') return null;
            return { date, value } satisfies EconomicIndicatorPoint;
        })
        .filter((p): p is EconomicIndicatorPoint => p !== null)
        .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

    return {
        name,
        latest: points[0] ?? null,
        previous: points[1] ?? null,
        trend: points.slice(0, trendLength),
        ...(unit !== undefined ? { unit } : {}),
    };
}
