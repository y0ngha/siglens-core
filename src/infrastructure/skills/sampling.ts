import { gatedSkillCapForTier } from '@/domain/analysis/skillTierCap';
import type { Skill, Tier } from '@/domain/types';
import { hashSkillCatalog } from '@/infrastructure/hash/analysisInput';

/** @internal Cache-key part distinguishing reasoning-on from reasoning-off submissions (also the investor-flows LLM seed). */
export function reasoningSeedPart(reasoning?: boolean): string {
    return reasoning === true ? 'reasoning-on' : 'reasoning-off';
}

/**
 * @internal
 * Fingerprint of the whole loaded catalog (names, gating, token cost) for
 * cache-key derivation. It carries no tier and no cap: those are added by
 * {@link tierCapKeyPart}, so two symbols of one tier share the fingerprint
 * because they share the catalog. It stays a named wrapper (one caller,
 * {@link skillCatalogKeyPart}) so the cache-key role is in the name, independent of
 * what `hashSkillCatalog` hashes.
 */
export function fingerprintSkillCatalog(skills: readonly Skill[]): string {
    return hashSkillCatalog(skills);
}

/**
 * @internal
 * The tier as it enters a cache key: `member` and `pro` as themselves (their
 * keys are unchanged), `free` as `free-c<cap>` with the gated-skill cap
 * (`gatedSkillCapForTier`). The cap changes which skills a free prompt
 * carries without changing the catalog, so folding it in makes a change of
 * `FREE_TIER_GATED_SKILLS_PER_GROUP` move every free key by itself.
 */
export function tierCapKeyPart(tier: Tier): string {
    const cap = gatedSkillCapForTier(tier);
    return cap === null ? tier : `${tier}-c${cap}`;
}

/**
 * @internal
 * The `skillFingerprint` key segment of the technical, fundamental,
 * financials and congress caches: `<tier key part>:<catalog fingerprint>`.
 * Free and member never share an entry; two free symbols share the catalog
 * fingerprint. News and the market-news digest fold {@link tierCapKeyPart}
 * into their input hash instead.
 */
export function skillCatalogKeyPart(
    tier: Tier,
    skills: readonly Skill[]
): string {
    return `${tierCapKeyPart(tier)}:${fingerprintSkillCatalog(skills)}`;
}
