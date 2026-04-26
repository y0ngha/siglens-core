import { AlpacaProvider } from './alpaca';
import { readMarketProviderType } from './config';
import { FmpProvider } from './fmp';
import type { MarketDataProvider, MarketDataProviderType } from './types';

const MARKET_PROVIDER_MAP: Record<
    MarketDataProviderType,
    () => MarketDataProvider
> = {
    alpaca: () => new AlpacaProvider(),
    fmp: () => new FmpProvider(),
};

export function createMarketDataProvider(): MarketDataProvider {
    return MARKET_PROVIDER_MAP[readMarketProviderType()]();
}
