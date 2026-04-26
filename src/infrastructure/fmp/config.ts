import type { FmpConfig } from '@/infrastructure/fmp/types';

export function readFmpConfig(): FmpConfig {
    const apiKey = process.env.FMP_API_KEY;
    if (!apiKey) {
        throw new Error('FMP_API_KEY must be set');
    }
    return { apiKey };
}

export function tryReadFmpConfig(): FmpConfig | null {
    const apiKey = process.env.FMP_API_KEY;
    if (!apiKey) return null;
    return { apiKey };
}
