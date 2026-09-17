import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@/application/analysis/callAnalysisAi');
vi.mock('@/infrastructure/cache/redis');

import { peekMarketNewsDigestCache } from '@/application/news/peekMarketNewsDigestCache';
import { runMarketNewsDigest } from '@/application/news/runMarketNewsDigest';
import { callAnalysisAi } from '@/application/analysis/callAnalysisAi';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import type { EnrichedNewsItem, Skill } from '@/domain/types';

const mockCallAnalysisAi = callAnalysisAi as Mock;
const mockCreateCacheProvider = createCacheProvider as Mock;

const mockCacheGet = vi.fn();
const mockCacheSet = vi.fn();
const mockCacheProvider = {
    get: mockCacheGet,
    set: mockCacheSet,
    delete: vi.fn(),
};

const ITEM: EnrichedNewsItem = {
    id: 'digest-001',
    symbol: '__NEWS_CRYPTO__',
    source: 'CoinWire',
    url: 'https://example.com/btc',
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
};

const SKILL: Skill = {
    name: 'news-flow',
    description: '',
    category: 'news',
    indicators: [],
    confidenceWeight: 0.5,
    content: '카테고리 전반의 흐름을 본다.',
    gating: { tier: 'always_on' },
};

const CACHED_RAW = {
    currentDriverKo: '시장 전반 상승 모멘텀.',
    keyEventsKo: ['BTC ETF 유입 급증'],
    upcomingEventsKo: [],
    overallSentiment: 'bullish' as const,
};

function baseArgs() {
    return {
        category: 'crypto' as const,
        categoryLabel: '미국 암호화폐',
        modelId: 'gemini-3.6-flash' as const,
        news: [ITEM],
    };
}

describe('peekMarketNewsDigestCache 함수는', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockCreateCacheProvider.mockReturnValue(mockCacheProvider);
        mockCacheGet.mockResolvedValue(null);
        mockCacheSet.mockResolvedValue(undefined);
        mockCallAnalysisAi.mockResolvedValue(JSON.stringify(CACHED_RAW));
    });

    it('news가 비면 캐시를 읽지 않고 null', async () => {
        const result = await peekMarketNewsDigestCache({
            ...baseArgs(),
            news: [],
        });
        expect(result).toBeNull();
        expect(mockCreateCacheProvider).not.toHaveBeenCalled();
    });

    it('캐시 프로바이더가 없으면 null', async () => {
        mockCreateCacheProvider.mockReturnValueOnce(null);
        expect(await peekMarketNewsDigestCache(baseArgs())).toBeNull();
        expect(mockCacheGet).not.toHaveBeenCalled();
    });

    it('캐시 미스면 null', async () => {
        expect(await peekMarketNewsDigestCache(baseArgs())).toBeNull();
    });

    it('캐시 읽기가 throw하면 로깅 후 null', async () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        mockCacheGet.mockRejectedValueOnce(new Error('cache down'));
        expect(await peekMarketNewsDigestCache(baseArgs())).toBeNull();
        expect(spy).toHaveBeenCalledWith(
            '[MarketNewsDigest/Peek]',
            'Cache read failed:',
            expect.any(Error)
        );
        spy.mockRestore();
    });

    it('hit이면 정규화된 다이제스트를 반환한다', async () => {
        // 누락 필드가 정규화로 채워지는지까지 확인한다.
        mockCacheGet.mockResolvedValueOnce({
            currentDriverKo: '시장 전반 상승 모멘텀.',
            keyEventsKo: ['BTC ETF 유입 급증'],
            overallSentiment: 'bullish',
        });
        const result = await peekMarketNewsDigestCache(baseArgs());
        expect(result).toEqual({
            currentDriverKo: '시장 전반 상승 모멘텀.',
            keyEventsKo: ['BTC ETF 유입 급증'],
            upcomingEventsKo: [],
            overallSentiment: 'bullish',
        });
    });

    it('LLM을 호출하지 않고 캐시에 쓰지 않는다', async () => {
        await peekMarketNewsDigestCache(baseArgs());
        expect(mockCallAnalysisAi).not.toHaveBeenCalled();
        expect(mockCacheSet).not.toHaveBeenCalled();
    });

    describe('키 동등성', () => {
        it.each([
            ['기본 옵션', {}],
            ['reasoning on', { reasoning: true }],
            ['locale en', { locale: 'en' as const }],
            ['skills + tier', { skills: [SKILL], tier: 'pro' as const }],
        ])(
            '%s에서 runMarketNewsDigest가 쓰는 키를 그대로 읽는다',
            async (_label, extra) => {
                const options = { ...baseArgs(), ...extra };

                await runMarketNewsDigest(options);
                const writtenKey = mockCacheSet.mock.calls[0]?.[0] as string;
                expect(writtenKey).toBeTypeOf('string');

                mockCacheGet.mockClear();
                await peekMarketNewsDigestCache(options);
                const readKey = mockCacheGet.mock.calls[0]?.[0] as string;

                expect(readKey).toBe(writtenKey);
            }
        );

        it('reasoning on/off는 서로 다른 키를 읽는다', async () => {
            await peekMarketNewsDigestCache({
                ...baseArgs(),
                reasoning: true,
            });
            await peekMarketNewsDigestCache(baseArgs());
            const [onKey, offKey] = mockCacheGet.mock.calls.map(
                call => call[0] as string
            );
            expect(onKey).not.toBe(offKey);
        });
    });
});
