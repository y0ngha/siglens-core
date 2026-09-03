import type { PriorAnalysis } from '@/domain/types';

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

/**
 * @internal Return type of `narrowPriorAnalysesForCacheKey` — the
 * window-filtered, capped, newest-first prior-analysis set plus the
 * cache-key fingerprint derived from it. See that function's doc comment in
 * `infrastructure/cache/config.ts` for the two-stage narrowing this is stage
 * 1 of.
 */
export interface NarrowedPriorAnalyses {
    /** Window-filtered, capped, newest-first list. Feed to stage 2 (`selectPriorAnalyses`), unfiltered by bar. */
    candidates: PriorAnalysis[];
    /** Cache-key segment for this set; `undefined` when `candidates` is empty (byte-identical to no history at all). */
    fingerprint: string | undefined;
}

/**
 * Return type of `analysisHistoryQuery`, which sizes the consumer's own
 * "recent analyses" DB query for `SubmitAnalysisOptions.priorAnalyses`.
 *
 * `analysisHistoryQuery` is a public Tier 3 export (`src/index.ts`), unlike
 * its sibling `narrowPriorAnalysesForCacheKey` — so this interface is public
 * too (no `@internal`), giving consumers a named return type in their IDE
 * instead of an anonymous object literal.
 */
export interface AnalysisHistoryQuery {
    /** Maximum rows worth fetching. */
    limit: number;
    /** How far back in milliseconds the `WHERE` clause should reach from now. */
    sinceMs: number;
}
