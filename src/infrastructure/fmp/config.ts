import type { FmpConfig } from '@/infrastructure/fmp/types';

/**
 * Read the FMP API key from env; throw when missing.
 *
 * Use this for code paths that genuinely cannot proceed without FMP — the
 * thrown error is the right signal to fail fast and surface a configuration
 * problem.
 *
 * @returns The validated config.
 *
 * @throws {Error} If `FMP_API_KEY` is unset or empty.
 *
 * @see tryReadFmpConfig
 */
export function readFmpConfig(): FmpConfig {
    const apiKey = process.env.FMP_API_KEY;
    if (!apiKey) {
        throw new Error('FMP_API_KEY must be set');
    }
    return { apiKey };
}

/**
 * Read the FMP API key from env; return `null` when missing.
 *
 * Use this for optional code paths (e.g. the FMP cancel signal) so missing
 * configuration falls through to a no-op instead of crashing.
 *
 * @returns The validated config, or `null` when `FMP_API_KEY` is unset.
 *
 * @see readFmpConfig
 */
export function tryReadFmpConfig(): FmpConfig | null {
    const apiKey = process.env.FMP_API_KEY;
    if (!apiKey) return null;
    return { apiKey };
}
