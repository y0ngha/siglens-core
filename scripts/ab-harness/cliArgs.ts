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
