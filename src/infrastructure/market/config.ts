import type {
    AlpacaConfig,
    MarketDataProviderType,
    WorkerConfig,
} from '@/infrastructure/market/types';

export function readAlpacaConfig(): AlpacaConfig {
    const apiKey = process.env.ALPACA_API_KEY;
    const secretKey =
        process.env.ALPACA_API_SECRET ?? process.env.ALPACA_SECRET_KEY;
    if (!apiKey || !secretKey) {
        throw new Error(
            'ALPACA_API_KEY and (ALPACA_API_SECRET or ALPACA_SECRET_KEY) must be set'
        );
    }
    return { apiKey, secretKey };
}

export function readMarketProviderType(): MarketDataProviderType {
    const raw = process.env.MARKET_DATA_PROVIDER;
    if (raw === 'alpaca') return 'alpaca';
    return 'fmp';
}

export function readWorkerConfig(): WorkerConfig {
    const workerUrl = process.env.WORKER_URL;
    const workerSecret = process.env.WORKER_SECRET;
    if (!workerUrl || !workerSecret) {
        throw new Error(
            'WORKER_URL and WORKER_SECRET environment variables are required'
        );
    }
    return { workerUrl, workerSecret };
}

export function tryReadWorkerConfig(): WorkerConfig | null {
    const workerUrl = process.env.WORKER_URL;
    const workerSecret = process.env.WORKER_SECRET;
    if (!workerUrl || !workerSecret) return null;
    return { workerUrl, workerSecret };
}
