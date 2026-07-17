import type { PositionBucket } from '@/domain/types';

/** @internal Unrealized-return threshold (20%) separating profit from deep-profit/deep-loss. */
const DEEP_BAND_THRESHOLD = 0.2;
/** @internal Unrealized-return threshold (5%) separating near-breakeven from profit/loss. */
const NEAR_BREAKEVEN_THRESHOLD = 0.05;

/**
 * Derive the coarse {@link PositionBucket} for a member's holding from the
 * average cost basis and the current price — pure, no I/O
 * (personalized-analysis-by-position-bucket spec, Subsystem C).
 *
 * Based on the unrealized return `r = (currentPrice - avgPrice) / avgPrice`:
 * - `r >= 0.20` → `'deep-profit'`
 * - `0.05 <= r < 0.20` → `'profit'`
 * - `-0.05 < r < 0.05` → `'near-breakeven'`
 * - `-0.20 < r <= -0.05` → `'loss'`
 * - `r <= -0.20` → `'deep-loss'`
 *
 * The caller (siglens action layer) is responsible for reading `avgPrice`
 * server-side and never trusting a client-supplied value — see the spec's
 * cross-repo split. This function only performs the pure math; it has no
 * opinion on tier gating or where the inputs came from.
 *
 * @param avgPrice - Member's average cost basis for the holding.
 * @param currentPrice - Current (or last-cached) price used for the analysis.
 * @returns The bucket, or `null` when either input is non-positive or
 *   non-finite (a bucket cannot be derived — callers should fall back to the
 *   legacy no-bucket cache key and prompt).
 */
export function bucketizePosition(
    avgPrice: number,
    currentPrice: number
): PositionBucket | null {
    if (
        !Number.isFinite(avgPrice) ||
        !Number.isFinite(currentPrice) ||
        avgPrice <= 0 ||
        currentPrice <= 0
    ) {
        return null;
    }

    const r = (currentPrice - avgPrice) / avgPrice;

    if (r >= DEEP_BAND_THRESHOLD) return 'deep-profit';
    if (r >= NEAR_BREAKEVEN_THRESHOLD) return 'profit';
    if (r > -NEAR_BREAKEVEN_THRESHOLD) return 'near-breakeven';
    if (r > -DEEP_BAND_THRESHOLD) return 'loss';
    return 'deep-loss';
}
