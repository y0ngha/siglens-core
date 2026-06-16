/** @internal Cached payload for a market briefing entry. */
export interface CachedBriefingData {
    briefing: unknown;
    generatedAt: string;
}

/**
 * @internal Cached payload for a macro (economy) briefing entry.
 *
 * Structurally identical to {@link CachedBriefingData} — declared as an alias
 * so the macro path can diverge later (e.g. a `regime` field) without
 * disturbing the market path, while today's shared shape is enforced by the
 * type system rather than copy-paste.
 */
export type CachedMacroBriefingData = CachedBriefingData;
