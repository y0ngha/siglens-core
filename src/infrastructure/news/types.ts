/**
 * NewsProvider infrastructure types.
 *
 * Defines the time-range alias and the fetcher interface used by the
 * application layer to retrieve news articles, earnings calendars, and
 * earnings reports. Consumer (siglens) implements this against FMP
 * `/stable/news/stock`, `/stable/earnings-calendar`, `/stable/earnings`.
 *
 * Core depends only on this interface — never on the concrete HTTP client.
 */
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
 * News + earnings calendar fetcher abstraction. Consumer (siglens) implements
 * via FMP `/stable/news/stock`, `/stable/earnings-calendar`, `/stable/earnings`.
 *
 * `fetchEarningsCalendarAll` returns the full calendar without a symbol filter
 * because FMP does not support per-symbol calendar queries on the stable tier.
 * Consumer must DB-cache this data via a daily Cron job (Phase 2 Task 2.5) and
 * filter by symbol at the repository layer.
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
