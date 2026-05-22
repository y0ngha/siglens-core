import type {
    MarketDataProvider,
    MarketDataProviderType,
} from '@/domain/ports/marketDataProvider';
import { AlpacaProvider } from '@/infrastructure/market/alpaca';
import { readMarketProviderType } from '@/infrastructure/market/config';
import { FmpProvider } from '@/infrastructure/market/fmp';

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
 * Reads `MARKET_PROVIDER` from env and
 * dispatches to the corresponding implementation. Each call returns a new
 * instance — providers are lightweight and hold no shared state.
 *
 * @returns The configured market data provider implementation.
 *
 * @throws {Error} If `MARKET_PROVIDER` is missing or unsupported (delegated
 *   from `readMarketProviderType`).
 *
 * @see fetchBarsWithIndicators
 * @see getMarketSummary
 */
export function createMarketDataProvider(): MarketDataProvider {
    return MARKET_PROVIDER_MAP[readMarketProviderType()]();
}
