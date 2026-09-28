import {
    formatBarDate,
    formatNullableNumber,
} from '@/domain/analysis/promptFormat';
import type { OverlayFormat, OverlayPoint } from '@/domain/types';

/** @internal `2026-01-05 101.20` — the one point format every candidate prompt line uses. */
export function formatOverlayPoint(
    point: OverlayPoint,
    fmt: OverlayFormat
): string {
    return `${formatBarDate(point.time, fmt.timeframe)} ${formatNullableNumber(point.price, fmt.priceDp)}`;
}
