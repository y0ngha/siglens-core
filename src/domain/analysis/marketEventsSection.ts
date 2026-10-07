import { selectMarketEvents } from '@/domain/analysis/marketEvents';
import { barTimeMs, findAnchorBarIndex } from '@/domain/analysis/priorAnalysis';
import {
    formatBarDateTime,
    TIMEFRAME_LABEL,
} from '@/domain/analysis/promptFormat';
import type { Bar, MarketEvent, Timeframe } from '@/domain/types';

/**
 * @internal
 * One rendered event line, anchored to the bar it landed on.
 *
 * `selectMarketEvents` has already dropped anything published before the first
 * bar, so `findAnchorBarIndex` always has at least `bars[0]` to return for an
 * entry reaching here — it cannot yield `null`. The non-null assertion
 * documents that guarantee rather than reintroducing a defensive branch no
 * test could exercise (CONVENTIONS.md#TE-5), matching how
 * `selectPriorAnalyses` handles the same invariant.
 */
function formatEvent(entry: MarketEvent, bars: readonly Bar[]): string {
    const anchorIndex = findAnchorBarIndex(bars, entry.publishedAt.getTime())!;

    const barsAgo = bars.length - 1 - anchorIndex;
    // Same helper `formatBarRow` and `## Prior Analyses` use, so this stamp
    // appears verbatim in the bar rows above and the model can line the event
    // up with the candle it landed on.
    const at = formatBarDateTime(barTimeMs(bars[anchorIndex]));

    return `- ${barsAgo} bars ago (${at}): ${entry.category}, ${entry.sentiment}, ${entry.impact} impact`;
}

/**
 * @internal
 *
 * Renders market events into a `## Market Events` prompt section, narrowing
 * them to the rendered bar window first (see {@link selectMarketEvents}).
 *
 * Only the classification is rendered — never the headline or body. The model
 * needs to know *that* a high-impact earnings event landed on a given bar to
 * explain a gap; reading the article is the news and overall axes' job, and
 * pulling prose in here would duplicate them.
 *
 * Returns `''` when nothing renders, following the same "empty section is
 * skipped by the caller" contract `buildAnalysisPrompt` already uses for
 * `positionHint` and `## Prior Analyses`.
 *
 * @param events - Candidate events for this symbol, any order.
 * @param bars - OHLCV history for the same symbol + timeframe, oldest-first.
 * @param symbol - Ticker symbol, for the section header.
 * @param timeframe - Chart timeframe, for the section header label.
 */
export function formatMarketEventsSection(
    events: readonly MarketEvent[],
    bars: readonly Bar[],
    symbol: string,
    timeframe: Timeframe
): string {
    const selected = selectMarketEvents(events, bars);
    if (selected.length === 0) return '';

    const lines = selected.map(entry => formatEvent(entry, bars));

    const header = `## Market Events (${symbol} · ${TIMEFRAME_LABEL[timeframe]} · what landed on the bars above)`;
    return [header, ...lines].join('\n');
}
