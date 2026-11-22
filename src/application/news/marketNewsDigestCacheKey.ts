import type {
    MarketNewsDigestCacheKeyOptions,
    MarketNewsDigestCacheKeyPlan,
} from '@/application/news/marketNewsDigestTypes';
import { DEFAULT_TIER } from '@/domain/tier';
import type { Skill } from '@/domain/types';
import { buildMarketNewsDigestCacheKey } from '@/infrastructure/cache/config';
import {
    hashAnalysisInput,
    normalizeSkillsForHash,
} from '@/infrastructure/hash/analysisInput';
import { tierCapKeyPart } from '@/infrastructure/skills/sampling';

/**
 * Derive a deterministic input hash from the news article IDs, tier, and skill catalog.
 */
function hashMarketNewsDigestInput(
    sortedNewsIds: readonly string[],
    tier: string,
    skills: readonly Skill[]
): string {
    const sortedIds = sortedNewsIds.join(',');
    const skillFingerprint = JSON.stringify(normalizeSkillsForHash(skills));
    return hashAnalysisInput(`${tier}|${sortedIds}|${skillFingerprint}`);
}

/**
 * @internal Single source of truth for the market-news digest cache key.
 *
 * Every path that touches the digest cache — {@link runMarketNewsDigest} (read
 * + write) and {@link peekMarketNewsDigestCache} (read) — derives its key here,
 * so the keys are byte-identical for the same options and an entry written by
 * one path is always readable by the other. Do not inline this derivation
 * anywhere else.
 *
 * Also returns the skills the key encodes, so a caller builds its prompt from
 * exactly the skill set the hash covers.
 */
export function resolveMarketNewsDigestCacheKey(
    options: MarketNewsDigestCacheKeyOptions
): MarketNewsDigestCacheKeyPlan {
    const { category, modelId, news } = options;
    const tier = options.tier ?? DEFAULT_TIER;
    // Sorted once so the key stays independent of the caller's array order.
    const sortedNewsIds = news.map(n => n.id).toSorted();
    const skills = options.skills ?? [];

    const inputHash = hashMarketNewsDigestInput(
        sortedNewsIds,
        tierCapKeyPart(tier),
        skills
    );

    // `reasoning`은 캐시 키에 반드시 들어가야 한다 — 추론 on/off는 같은 기사
    // 집합에서도 결과 깊이를 바꾸므로, 빠뜨리면 먼저 캐시를 채운 쪽이 TTL 동안
    // 반대 모드 호출자의 결과까지 결정해버린다(runNewsAnalysis의 buildNewsCacheKey와
    // 동일한 이유). `false`/`undefined`는 접미사를 붙이지 않으므로 이 옵션이
    // 생기기 전에 쓰인 엔트리는 그대로 히트한다.
    return {
        cacheKey: buildMarketNewsDigestCacheKey(
            category,
            modelId,
            inputHash,
            options.reasoning,
            options.locale
        ),
        skills,
    };
}
