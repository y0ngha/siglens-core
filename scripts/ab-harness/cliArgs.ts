/**
 * Minimal `--flag value` CLI argument parser shared by every `ab-harness`
 * script. Pure (no I/O) so it is directly unit-testable.
 *
 * Supports `--flag value` and boolean `--flag` (no following value, or the
 * next token is itself a flag) — the latter is stored as the string
 * `'true'` so callers can do a simple truthy/undefined check without a
 * separate boolean map.
 */
export function parseArgs(argv: readonly string[]): Record<string, string> {
    const out: Record<string, string> = {};
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (!arg.startsWith('--')) continue;
        const key = arg.slice(2);
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith('--')) {
            out[key] = next;
            i++;
        } else {
            out[key] = 'true';
        }
    }
    return out;
}

/**
 * Parse and validate a `--<flagName>` value as a positive integer, defaulting
 * to `1` when unset. Shared by every `ab-harness` script that takes a
 * repeat-count flag (`judge.ts --passes`, `runModels.ts --samples`) — both
 * used to reimplement this exact validation independently.
 */
export function parsePositiveIntArg(
    raw: string | undefined,
    flagName: string
): number {
    if (raw === undefined) return 1;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 1) {
        throw new Error(
            `--${flagName} must be a positive integer (got "${raw}")`
        );
    }
    return value;
}
