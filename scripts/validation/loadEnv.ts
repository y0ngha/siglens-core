import { readFileSync, existsSync } from 'node:fs';

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
 * Resolve `FMP_API_KEY` from `process.env`, falling back to an env file.
 *
 * The env file path is explicit: pass `envFile`, or set `SIGLENS_ENV_FILE`
 * (e.g. `SIGLENS_ENV_FILE=/path/to/.env.local`). No default location is
 * guessed. Throws a clear error when the key cannot be found.
 */
export function requireFmpApiKey(
    envFile: string | undefined = process.env.SIGLENS_ENV_FILE
): string {
    const fromProcess = process.env.FMP_API_KEY;
    if (fromProcess) return fromProcess;
    if (!envFile) {
        throw new Error(
            'FMP_API_KEY not found in process.env and no env file given — set FMP_API_KEY or SIGLENS_ENV_FILE=/path/to/.env.local'
        );
    }
    const key = loadEnvFile(envFile).FMP_API_KEY;
    if (!key) {
        throw new Error(
            `FMP_API_KEY not found in process.env or in env file ${envFile}`
        );
    }
    return key;
}
