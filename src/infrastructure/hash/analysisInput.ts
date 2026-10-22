import { createHash } from 'node:crypto';
import { selectMacroCalendarRows } from '@/domain/analysis/newsPrompt';
import type { EconomicCalendarEvent, Skill } from '@/domain/types';

/** Length of the hex prefix (~64 bits) used for analysis cache input hashing. Collision probability is negligible at expected cardinalities. */
const ANALYSIS_INPUT_HASH_LENGTH = 16;

/** Length of the hex prefix (~32 bits) read from the digest to derive a seed. */
const SEED_HEX_LENGTH = 8;

/** @internal Mask keeping the seed a non-negative signed 32-bit integer. */
export const MAX_INT32 = 0x7fffffff;

/** Full lowercase-hex SHA-256 digest of the input. */
function sha256Hex(input: string): string {
    return createHash('sha256').update(input).digest('hex');
}

/**
 * @internal
 * Compute a deterministic SHA-256 hash of a serialized input, truncated for cache key use.
 *
 * @param serialized - String to hash (typically `JSON.stringify(snapshot)` or sorted-id-join).
 * @returns 16-character lowercase hex prefix of the SHA-256 digest.
 */
export function hashAnalysisInput(serialized: string): string {
    return sha256Hex(serialized).slice(0, ANALYSIS_INPUT_HASH_LENGTH);
}

/**
 * @internal
 * Non-reversible scope tag for a caller-supplied API key, used only to keep
 * in-process in-flight joins apart. 16 hex chars (~64 bits) of SHA-256; the raw
 * key never leaves this function.
 */
export function hashApiKeyScope(apiKey: string): string {
    return sha256Hex(apiKey).slice(0, ANALYSIS_INPUT_HASH_LENGTH);
}

/** @internal Fields read from a {@link Skill} when hashing a prompt-skill set for a cache key. */
interface NormalizedSkillForHash {
    name: string;
    content: string;
    confidenceWeight: number;
    category: NonNullable<Skill['category']> | null;
    gating: NonNullable<Skill['gating']> | null;
}

/**
 * @internal
 * Normalize a skill list into the field set used to fingerprint prompt
 * skills for cache-key hashing, sorted by `name` so the fingerprint is
 * independent of input order.
 *
 * @param skills - Skills sampled for a prompt.
 * @returns Normalized, name-sorted skill records ready for `JSON.stringify`.
 */
export function normalizeSkillsForHash(
    skills: readonly Skill[]
): NormalizedSkillForHash[] {
    return skills
        .map(s => ({
            name: s.name,
            content: s.content,
            confidenceWeight: s.confidenceWeight,
            category: s.category ?? null,
            gating: s.gating ?? null,
        }))
        .toSorted((a, b) => a.name.localeCompare(b.name));
}

/**
 * @internal
 * Deterministic fingerprint of the **skill-selection metadata** of a catalog —
 * each skill's `name`, `gating`, and `tokenCost`, the exact fields the chart
 * selector ({@link selectSkills}) reads. Folded into the chart and fundamental
 * cache keys so that editing the gating frontmatter (or the gating logic that
 * shapes which skills are injected) invalidates previously-cached analyses
 * instead of serving them stale for the full TTL.
 *
 * Skills are sorted by `name` first, so the fingerprint is independent of the
 * loader's file-walk order. Fields outside `name`/`gating`/`tokenCost` (e.g.
 * `content`, `description`) are intentionally excluded: a body edit is already
 * covered by the news/overall content fingerprint and a prompt-template bump,
 * and including it here would over-invalidate the chart cache.
 *
 * @param skills - The loaded skill catalog.
 * @returns 16-character lowercase hex prefix of the SHA-256 digest.
 */
export function hashSkillCatalog(skills: readonly Skill[]): string {
    const serialized = JSON.stringify(
        skills
            .map(s => ({
                name: s.name,
                gating: s.gating ?? null,
                tokenCost: s.tokenCost ?? null,
            }))
            // Pin the locale: a locale-free `localeCompare` is
            // environment-dependent, so the same catalog would hash
            // differently per server locale and break the cache key.
            .toSorted((a, b) => a.name.localeCompare(b.name, 'en'))
    );
    return hashAnalysisInput(serialized);
}

/**
 * @internal
 * Sorted, unambiguously-serialized fingerprint parts for a macro-calendar
 * event set. Each part is `JSON.stringify([date, event, impact,
 * actual, estimate, previous, unit])` — every field the news prompt's `##
 * Macro Calendar` section actually renders (`formatMacroCalendarRow`,
 * `newsPrompt.ts`), not just a subset, and JSON-array-encoded rather than
 * `|`-joined so an `event` name containing a literal `|` cannot collide
 * with a field boundary (e.g. `'A|B'` + `impact:'C'` vs. `event:'A'` +
 * fields containing `'B|C'` previously hashed identically).
 *
 * Selects rows via {@link selectMacroCalendarRows} — the SAME date-ascending
 * sort + 12-row cap the prompt itself applies — so a change to a row beyond
 * the cap (never rendered into the prompt) does not invalidate the cache,
 * and the fingerprint can never cover a row the prompt omits.
 *
 * Shared between `runNewsAnalysis`'s input hash and its skill-sampling seed
 * so both invalidate whenever any rendered field of a rendered row changes,
 * including `estimate`/`previous` (an initial estimate revision, or a
 * previous-period restatement, changes prompt bytes exactly like `actual`
 * being filled in — excluding them would serve a stale cached analysis for
 * a re-estimated or restated release).
 *
 * Empty input produces an empty array, so a caller that spreads the result
 * into a hash string or seed-parts array (rather than appending it
 * unconditionally) keeps every pre-macro-calendar input byte-identical.
 *
 * @param macroCalendar - Macro calendar events forwarded to the news prompt.
 * @returns Sorted fingerprint strings, one per rendered event.
 */
export function macroCalendarFingerprintParts(
    macroCalendar: readonly EconomicCalendarEvent[]
): string[] {
    return selectMacroCalendarRows(macroCalendar)
        .map(e =>
            JSON.stringify([
                e.date,
                e.event,
                e.impact,
                e.actual,
                e.estimate,
                e.previous,
                e.unit,
            ])
        )
        .toSorted();
}

/**
 * @internal
 * Derive a deterministic non-negative 31-bit integer seed from a serialized
 * input. Same input → same seed, giving reproducible generation on providers
 * that accept a seed.
 *
 * @param serialized - String to derive the seed from.
 * @returns Non-negative 31-bit integer seed.
 */
export function analysisSeed(serialized: string): number {
    return (
        parseInt(sha256Hex(serialized).slice(0, SEED_HEX_LENGTH), 16) &
        MAX_INT32
    );
}
