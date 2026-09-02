import { describe, it, expect } from 'vitest';
import {
    buildAnalysisCacheKey,
    buildFundamentalCacheKey,
    DEFAULT_ANALYSIS_MODEL_ID,
    FUNDAMENTAL_PROMPT_TEMPLATE_VERSION,
    PROMPT_TEMPLATE_VERSION,
    CACHE_KEY_SCHEMA_VERSION,
} from '@/infrastructure/cache/config';
import { hashSkillCatalog } from '@/infrastructure/hash/analysisInput';
import type { Skill } from '@/domain/types';

const skill = (overrides: Partial<Skill>): Skill => ({
    name: 'Skill',
    description: 'desc',
    indicators: [],
    confidenceWeight: 0.8,
    content: 'body',
    ...overrides,
});

const CATALOG_A: Skill[] = [
    skill({
        name: 'RSI Guide',
        gating: {
            tier: 'gated',
            signalKind: 'event',
            triggers: ['rsi_oversold'],
        },
        tokenCost: 850,
    }),
    skill({ name: 'Head and Shoulders', gating: { tier: 'always_on' } }),
];

// Same names but a different gating tag on one skill.
const CATALOG_B: Skill[] = [
    skill({
        name: 'RSI Guide',
        gating: {
            tier: 'gated',
            signalKind: 'event',
            triggers: ['rsi_overbought'], // changed trigger
        },
        tokenCost: 850,
    }),
    skill({ name: 'Head and Shoulders', gating: { tier: 'always_on' } }),
];

describe('hashSkillCatalog', () => {
    it('is deterministic regardless of input order', () => {
        const a = hashSkillCatalog(CATALOG_A);
        const reversed = hashSkillCatalog([...CATALOG_A].toReversed());
        expect(a).toBe(reversed);
    });

    it('differs when a gating tag changes', () => {
        expect(hashSkillCatalog(CATALOG_A)).not.toBe(
            hashSkillCatalog(CATALOG_B)
        );
    });

    it('differs when tokenCost changes — the digest auto-invalidation contract', () => {
        // This is the mechanism that makes editing a skill's PROMPT_DIGEST
        // self-invalidating: the loader hard-fails if a digest is missing, and
        // the frontmatter's measured `token_cost` moves whenever the digest
        // text is edited, so a digest change always changes `tokenCost` here
        // and therefore always produces a new fingerprint — no separate cache
        // bump is needed when only digest wording changes.
        const bumped = CATALOG_A.map(s =>
            s.name === 'RSI Guide' ? { ...s, tokenCost: 999 } : s
        );
        expect(hashSkillCatalog(CATALOG_A)).not.toBe(hashSkillCatalog(bumped));
    });

    it('ignores fields outside name/gating/tokenCost (e.g. content)', () => {
        const contentChanged = CATALOG_A.map(s => ({
            ...s,
            content: `${s.content} — edited`,
        }));
        expect(hashSkillCatalog(CATALOG_A)).toBe(
            hashSkillCatalog(contentChanged)
        );
    });

    it('returns a short stable hex string', () => {
        const fp = hashSkillCatalog(CATALOG_A);
        // Documented contract: a fixed-length 16-char lowercase hex prefix,
        // stable across repeated calls on the same catalog.
        expect(fp).toMatch(/^[0-9a-f]{16}$/);
        expect(hashSkillCatalog(CATALOG_A)).toBe(fp);
    });

    it('handles untagged skills (gating/tokenCost default to null)', () => {
        const untagged = [skill({ name: 'Untagged' })];
        const tagged = [
            skill({ name: 'Untagged', gating: { tier: 'always_on' } }),
        ];
        // An untagged skill hashes deterministically and differs from the same
        // name carrying a gating tag — proving the null fallbacks participate.
        expect(hashSkillCatalog(untagged)).toMatch(/^[0-9a-f]+$/);
        expect(hashSkillCatalog(untagged)).not.toBe(hashSkillCatalog(tagged));
    });

    it('returns a stable hash for an empty catalog', () => {
        expect(hashSkillCatalog([])).toBe(hashSkillCatalog([]));
    });
});

describe('chart cache key folds the skill fingerprint', () => {
    it('omits the fingerprint segment when none is passed (backward compatible)', () => {
        expect(buildAnalysisCacheKey('AAPL', '1Day', 'gemini-2.5-flash')).toBe(
            `analysis:AAPL:1Day:gemini-2.5-flash:${PROMPT_TEMPLATE_VERSION}`
        );
    });

    it('appends the fingerprint segment when provided', () => {
        const fp = hashSkillCatalog(CATALOG_A);
        expect(
            buildAnalysisCacheKey('AAPL', '1Day', 'gemini-2.5-flash', fp)
        ).toBe(
            `analysis:AAPL:1Day:gemini-2.5-flash:${PROMPT_TEMPLATE_VERSION}:${fp}`
        );
    });

    it('two different skill catalogs → different chart cache keys', () => {
        const keyA = buildAnalysisCacheKey(
            'AAPL',
            '1Day',
            DEFAULT_ANALYSIS_MODEL_ID,
            hashSkillCatalog(CATALOG_A)
        );
        const keyB = buildAnalysisCacheKey(
            'AAPL',
            '1Day',
            DEFAULT_ANALYSIS_MODEL_ID,
            hashSkillCatalog(CATALOG_B)
        );
        expect(keyA).not.toBe(keyB);
    });
});

describe('fundamental cache key folds the skill fingerprint', () => {
    it('omits the fingerprint segment when none is passed', () => {
        expect(buildFundamentalCacheKey('AAPL', 'gemini-2.5-pro')).toBe(
            `${CACHE_KEY_SCHEMA_VERSION}:analysis:fundamental:AAPL:gemini-2.5-pro:${FUNDAMENTAL_PROMPT_TEMPLATE_VERSION}`
        );
    });

    it('two different skill catalogs → different fundamental cache keys', () => {
        const keyA = buildFundamentalCacheKey(
            'AAPL',
            'gemini-2.5-pro',
            hashSkillCatalog(CATALOG_A)
        );
        const keyB = buildFundamentalCacheKey(
            'AAPL',
            'gemini-2.5-pro',
            hashSkillCatalog(CATALOG_B)
        );
        expect(keyA).not.toBe(keyB);
    });
});
