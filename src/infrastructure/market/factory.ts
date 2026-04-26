import { AlpacaProvider } from '@/infrastructure/market/alpaca';
import { readMarketProviderType } from '@/infrastructure/market/config';
import { FmpProvider } from '@/infrastructure/market/fmp';
import type {
    MarketDataProvider,
    MarketDataProviderType,
} from '@/infrastructure/market/types';

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
