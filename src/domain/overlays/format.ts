import { formatBarDate, formatPriceAtDp } from '@/domain/analysis/promptFormat';
import type { OverlayFormat, OverlayPoint } from '@/domain/types';

/** @internal `2026-01-05 101.20` — the one point format every candidate prompt line uses. */
export function formatOverlayPoint(
    point: OverlayPoint,
    fmt: OverlayFormat
): string {
    return `${formatBarDate(point.time, fmt.timeframe)} ${formatPriceAtDp(point.price, fmt.priceDp)}`;
}

/** @internal A price at the candidate's precision — the number format every candidate prompt line uses. */
export function formatOverlayPrice(price: number, fmt: OverlayFormat): string {
    return formatPriceAtDp(price, fmt.priceDp);
}
