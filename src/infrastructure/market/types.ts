import type { Bar, MarketQuote, Timeframe } from '@/domain/types';

export interface GetBarsOptions {
    symbol: string;
    timeframe: Timeframe;
    limit?: number;
    before?: string;
    from?: string;
}

export type MarketDataProviderType = 'alpaca' | 'fmp';

export interface MarketDataProvider {
    getBars(options: GetBarsOptions): Promise<Bar[]>;
    getQuote(symbol: string): Promise<MarketQuote | null>;
}

export type AcquireReanalyzeCooldownResult =
    | { ok: true }
    | { ok: false; remainingMs: number };

export interface WorkerConfig {
    workerUrl: string;
    workerSecret: string;
}

export interface AlpacaConfig {
    apiKey: string;
    secretKey: string;
}

export interface FmpConfig {
    apiKey: string;
}
