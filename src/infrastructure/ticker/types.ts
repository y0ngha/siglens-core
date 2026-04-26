export interface FmpSearchResult {
    symbol: string;
    name: string;
    currency: string;
    exchangeFullName: string;
    exchange: string;
}

export interface TranslatorEntry {
    symbol: string;
    name: string;
}

export interface TranslatorConfig {
    apiKey: string;
    freeApiKey: string | undefined;
    model: string;
}
