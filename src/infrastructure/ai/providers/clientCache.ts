/** @internal Most distinct API keys whose SDK client stays cached per provider. */
export const CLIENT_CACHE_MAX_ENTRIES = 64;

/**
 * @internal
 * Small LRU for provider SDK clients, keyed by API key.
 *
 * Under `keyPolicy: 'byok-only'` the key set is caller-chosen, so an unbounded
 * `Map` would grow with every distinct key ever seen. A handful of server keys
 * stay hot and are never evicted in practice; an evicted client is simply
 * rebuilt on the next call.
 */
export function createClientCache<T>(
    build: (apiKey: string) => T,
    maxEntries: number = CLIENT_CACHE_MAX_ENTRIES
): { get(apiKey: string): T; size(): number } {
    const entries = new Map<string, T>();
    return {
        get(apiKey: string): T {
            const hit = entries.get(apiKey);
            if (hit !== undefined) {
                // Re-insert to mark most recently used (Map keeps insertion order).
                entries.delete(apiKey);
                entries.set(apiKey, hit);
                return hit;
            }
            const client = build(apiKey);
            entries.set(apiKey, client);
            if (entries.size > maxEntries) {
                const oldest = entries.keys().next().value;
                if (oldest !== undefined) entries.delete(oldest);
            }
            return client;
        },
        size: () => entries.size,
    };
}
