import type { MarketDataProvider } from '@/domain/ports/marketDataProvider';
import { AlpacaProvider } from '@/infrastructure/market/alpaca';
import { readMarketProviderType } from '@/infrastructure/market/config';
import { FmpProvider } from '@/infrastructure/market/fmp';
import type { MarketDataProviderType } from '@/infrastructure/market/types';

const MARKET_PROVIDER_MAP: Record<
    MarketDataProviderType,
    () => MarketDataProvider
> = {
    alpaca: () => new AlpacaProvider(),
    fmp: () => new FmpProvider(),
};

/**
 * @adapter implements {@link MarketDataProvider}
 *
 * Construct the configured {@link MarketDataProvider} (Alpaca or FMP).
 *
 * Reads `MARKET_DATA_PROVIDER` from env and dispatches to the corresponding
 * implementation. Each call returns a new instance — providers are
 * lightweight and hold no shared state.
 *
 * @returns The configured market data provider implementation.
 *
 * @throws {Error} If the selected adapter's required credentials are
 *   missing (delegated from the adapter constructor — Alpaca requires
 *   `ALPACA_API_KEY` and `ALPACA_API_SECRET` (or `ALPACA_SECRET_KEY`);
 *   FMP requires `FMP_API_KEY`).
 *
 * @see fetchBarsWithIndicators
 * @see getMarketSummary
 */
export function createMarketDataProvider(): MarketDataProvider {
    return MARKET_PROVIDER_MAP[readMarketProviderType()]();
}
