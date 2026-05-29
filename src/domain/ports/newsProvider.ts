import type {
    EarningsCalendarItem,
    EarningsReport,
    NewsItem,
} from '@/domain/types';

/**
 * Lookback window for news article queries.
 *
 * - `'24h'` — last 24 hours (used for chart-page news augment A2/A3 section).
 * - `'7d'`  — last 7 days (default for news analysis page).
 * - `'30d'` — last 30 days (extended context for low-activity symbols).
 */
export type NewsTimeRange = '24h' | '7d' | '30d';

/**
 * @internal Port for fetching news articles and earnings calendar/report data.
 * @port
 * News + earnings calendar fetcher abstraction the domain depends on for
 * retrieving articles, earnings schedules, and earnings reports.
 *
 * Adapters surface the underlying client's errors to the caller — graceful
 * degradation (e.g. treating a fetch failure as an empty result) is the
 * responsibility of the application-layer caller, not the adapter.
 *
 * @see NewsTimeRange
 * @see NewsItem
 * @see EarningsCalendarItem
 * @see EarningsReport
 */
export interface NewsProvider {
    /**
     * Fetch recent news articles for a symbol within the given time window.
     *
     * @param symbol - Ticker symbol (e.g. `"AAPL"`).
     * @param range  - Lookback window (`'24h'` | `'7d'` | `'30d'`).
     * @returns Ordered list of news items (most recent first). Empty array when
     *          no articles are available for the period.
     */
    fetchNews(symbol: string, range: NewsTimeRange): Promise<NewsItem[]>;

    /**
     * Fetch the full earnings calendar from the provider.
     *
     * FMP does not offer per-symbol filtering on the stable calendar endpoint,
     * so consumers must cache the full result and filter locally.
     *
     * @returns All scheduled earnings events across all symbols.
     */
    fetchEarningsCalendarAll(): Promise<EarningsCalendarItem[]>;

    /**
     * Fetch the latest earnings report for a symbol.
     *
     * @param symbol - Ticker symbol (e.g. `"AAPL"`).
     * @returns The most recent earnings report, or `null` when unavailable.
     */
    fetchEarningsReport(symbol: string): Promise<EarningsReport | null>;
}
