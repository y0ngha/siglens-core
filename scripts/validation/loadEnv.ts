import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/** Parse `KEY=VALUE` env text into a record. Pure (no I/O). */
export function parseEnv(text: string): Record<string, string> {
    return text.split('\n').reduce<Record<string, string>>((acc, rawLine) => {
        const line = rawLine.trim();
        if (line === '' || line.startsWith('#')) return acc;
        const eq = line.indexOf('=');
        if (eq === -1) return acc;
        const key = line.slice(0, eq).trim();
        if (key === '') return acc;
        const rawValue = line.slice(eq + 1).trim();
        const isQuoted =
            (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
            (rawValue.startsWith("'") && rawValue.endsWith("'"));
        acc[key] = isQuoted ? rawValue.slice(1, -1) : rawValue;
        return acc;
    }, {});
}

/** Read and parse an `.env` file; returns an empty record when absent. */
export function loadEnvFile(path: string): Record<string, string> {
    if (!existsSync(path)) return {};
    return parseEnv(readFileSync(path, 'utf-8'));
}

/**
 * Resolve `FMP_API_KEY` from the sibling siglens app's `.env.local`
 * (or `process.env` as a fallback). Throws a clear error when missing.
 */
export function requireFmpApiKey(): string {
    const fromProcess = process.env.FMP_API_KEY;
    if (fromProcess) return fromProcess;
    // Resolve relative to this file: scripts/validation/ → Project/siglens/.env.local
    const envPath = join(import.meta.dirname, '../../../siglens/.env.local');
    const env = loadEnvFile(envPath);
    const key = env.FMP_API_KEY;
    if (!key) {
        throw new Error(
            'FMP_API_KEY not found in process.env or ../siglens/.env.local'
        );
    }
    return key;
}
