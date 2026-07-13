import { createHash } from 'node:crypto';
import type { Skill } from '@/domain/types';

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
