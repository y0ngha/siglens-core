import type { BackgroundTaskOptions } from '@/application/types';
import type { MarketDataProvider } from '@/domain/ports/marketDataProvider';
import type { MarketSummaryWithBriefing } from '@/domain/types';
import { getMarketSummary } from '@/application/dashboard/getMarketSummary';
import { submitBriefing } from '@/application/market/submitBriefing';

/**
 * Combined helper that fetches the dashboard summary and concurrently kicks
 * off (or reuses a cached) AI briefing for the same hour.
 *
 * Equivalent to {@link getMarketSummary} followed by {@link submitBriefing} —
 * exposed as a single call so dashboard pages can await one promise and
 * render both the summary and the briefing status together.
 *
 * @param provider - Injected market data provider forwarded to
 *   {@link getMarketSummary}.
 * @param options - Optional background-task hooks forwarded to
 *   {@link submitBriefing}. Pass Vercel's `waitUntil` so briefing worker
 *   dispatch can continue after the response.
 * @returns The summary plus a {@link SubmitBriefingResult} (either cached
 *   briefing data or a `jobId` to poll with {@link pollBriefing}).
 *
 * @see getMarketSummary
 * @see submitBriefing
 */
export async function getMarketSummaryWithBriefing(
    provider: MarketDataProvider,
    options?: BackgroundTaskOptions
): Promise<MarketSummaryWithBriefing> {
    const summary = await getMarketSummary(provider);
    const briefing = await submitBriefing(summary, options);
    return { summary, briefing };
}
