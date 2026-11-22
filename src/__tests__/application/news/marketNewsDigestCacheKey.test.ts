import { describe, it, expect } from 'vitest';
import { resolveMarketNewsDigestCacheKey } from '@/application/news/marketNewsDigestCacheKey';
import type { EnrichedNewsItem, Skill } from '@/domain/types';

const item = (id: string): EnrichedNewsItem => ({
    id,
    symbol: '__NEWS_CRYPTO__',
    source: 'CoinWire',
    url: `https://example.com/${id}`,
    publishedAt: '2026-06-15T12:00:00Z',
    titleEn: 'BTC ETF inflows surge',
    bodyEn: null,
    card: {
        titleKo: 'BTC ETF 유입 급증',
        bodyKo: null,
        summaryKo: '유입 급증',
        sentiment: 'bullish',
        category: 'macro',
        priceImpact: 'high',
    },
});

const SKILL: Skill = {
    name: 'news-flow',
    description: '',
    category: 'news',
    indicators: [],
    confidenceWeight: 0.5,
    content: '카테고리 전반의 흐름을 본다.',
    gating: { tier: 'always_on' },
};

function baseArgs() {
    return {
        category: 'crypto' as const,
        modelId: 'gemini-3.6-flash' as const,
        news: [item('digest-001')],
    };
}

describe('resolveMarketNewsDigestCacheKey 함수는', () => {
    it('tier/skills 미지정 시 기본 tier(free)와 빈 skills로 대체한다', () => {
        const result = resolveMarketNewsDigestCacheKey(baseArgs());
        expect(result.cacheKey).toBeTypeOf('string');
        expect(result.skills).toEqual([]);
    });

    it('reasoning on/off는 서로 다른 키를 만든다', () => {
        const on = resolveMarketNewsDigestCacheKey({
            ...baseArgs(),
            reasoning: true,
        });
        const off = resolveMarketNewsDigestCacheKey(baseArgs());
        expect(on.cacheKey).not.toBe(off.cacheKey);
    });

    it('locale이 다르면 서로 다른 키를 만든다', () => {
        const en = resolveMarketNewsDigestCacheKey({
            ...baseArgs(),
            locale: 'en',
        });
        const ko = resolveMarketNewsDigestCacheKey(baseArgs());
        expect(en.cacheKey).not.toBe(ko.cacheKey);
    });

    it('news 배열 순서가 달라도 동일 키(정렬로 무관)', () => {
        const a = resolveMarketNewsDigestCacheKey({
            ...baseArgs(),
            news: [item('a'), item('b')],
        });
        const b = resolveMarketNewsDigestCacheKey({
            ...baseArgs(),
            news: [item('b'), item('a')],
        });
        expect(a.cacheKey).toBe(b.cacheKey);
    });

    it('티어와 무관하게 받은 skills 전체를 그대로 돌려준다(free도 줄이지 않는다)', () => {
        const free = resolveMarketNewsDigestCacheKey({
            ...baseArgs(),
            skills: [SKILL],
            tier: 'free',
        });
        const pro = resolveMarketNewsDigestCacheKey({
            ...baseArgs(),
            skills: [SKILL],
            tier: 'pro',
        });
        expect(free.skills).toEqual([SKILL]);
        expect(pro.skills).toEqual([SKILL]);
    });

    it('free와 member는 같은 skills여도 다른 키를 만든다', () => {
        const free = resolveMarketNewsDigestCacheKey({
            ...baseArgs(),
            skills: [SKILL],
            tier: 'free',
        });
        const member = resolveMarketNewsDigestCacheKey({
            ...baseArgs(),
            skills: [SKILL],
            tier: 'member',
        });
        expect(free.cacheKey).not.toBe(member.cacheKey);
    });

    it('카탈로그에 스킬이 추가되면 키가 바뀐다', () => {
        const without = resolveMarketNewsDigestCacheKey({
            ...baseArgs(),
            skills: [SKILL],
        });
        const withExtra = resolveMarketNewsDigestCacheKey({
            ...baseArgs(),
            skills: [SKILL, { ...SKILL, name: 'news-flow-2' }],
        });
        expect(withExtra.cacheKey).not.toBe(without.cacheKey);
    });
});
