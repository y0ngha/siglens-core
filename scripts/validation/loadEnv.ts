import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Parse `KEY=VALUE` env text into a record. Pure (no I/O). */
export function parseEnv(text: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const rawLine of text.split('\n')) {
        const line = rawLine.trim();
        if (line === '' || line.startsWith('#')) continue;
        const eq = line.indexOf('=');
        if (eq === -1) continue;
        const key = line.slice(0, eq).trim();
        let value = line.slice(eq + 1).trim();
        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }
        if (key !== '') out[key] = value;
    }
    return out;
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
    // Resolve relative to this file's location: scripts/validation/ → Project/siglens/.env.local
    const thisDir = dirname(fileURLToPath(import.meta.url));
    const envPath = join(thisDir, '../../../siglens/.env.local');
    const env = loadEnvFile(envPath);
    const key = env.FMP_API_KEY;
    if (!key) {
        throw new Error(
            'FMP_API_KEY not found in process.env or ../siglens/.env.local'
        );
    }
    return key;
}
