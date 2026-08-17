import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@/application/analysis/callAnalysisAi');
vi.mock('@/infrastructure/cache/redis');

import { runMarketNewsDigest } from '@/application/news/runMarketNewsDigest';
import { callAnalysisAi } from '@/application/analysis/callAnalysisAi';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import { NEWS_CACHE_TTL_SECONDS } from '@/infrastructure/cache/config';
import type { EnrichedNewsItem } from '@/domain/types';

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

const mockRawResult = {
    currentDriverKo: '시장 전반 상승 모멘텀.',
    keyEventsKo: ['BTC ETF 유입 급증'],
    upcomingEventsKo: [],
    overallSentiment: 'bullish' as const,
};

function baseArgs() {
    return {
        category: 'crypto' as const,
        categoryLabel: '미국 암호화폐',
        modelId: 'gemini-2.5-flash' as const,
        news: [ITEM],
    };
}

describe('runMarketNewsDigest', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockCreateCacheProvider.mockReturnValue(mockCacheProvider);
        mockCacheGet.mockResolvedValue(null);
        mockCacheSet.mockResolvedValue(undefined);
        mockCallAnalysisAi.mockResolvedValue(JSON.stringify(mockRawResult));
    });

    describe('no_news 가드', () => {
        it('뉴스가 없으면 LLM 전에 no_news를 반환한다', async () => {
            const result = await runMarketNewsDigest({
                ...baseArgs(),
                news: [],
            });

            expect(result.status).toBe('no_news');
            expect(mockCallAnalysisAi).not.toHaveBeenCalled();
        });
    });

    describe('cache hit', () => {
        it('cache hit → callAnalysisAi NOT called, returns {status:"cached"}', async () => {
            mockCacheGet.mockResolvedValueOnce(mockRawResult);

            const result = await runMarketNewsDigest(baseArgs());

            expect(result.status).toBe('cached');
            expect(mockCallAnalysisAi).not.toHaveBeenCalled();
        });

        it('force=true이면 캐시를 우회한다', async () => {
            mockCacheGet.mockResolvedValue(mockRawResult);

            const result = await runMarketNewsDigest({
                ...baseArgs(),
                force: true,
            });

            expect(result.status).toBe('done');
            expect(mockCallAnalysisAi).toHaveBeenCalledTimes(1);
        });
    });

    describe('cache miss → LLM', () => {
        it('callAnalysisAi를 1회 호출하고 done을 반환한다', async () => {
            const result = await runMarketNewsDigest(baseArgs());

            expect(mockCallAnalysisAi).toHaveBeenCalledTimes(1);
            expect(result.status).toBe('done');
        });

        it('signal을 callAnalysisAi에 그대로 전달한다', async () => {
            const controller = new AbortController();

            await runMarketNewsDigest({
                ...baseArgs(),
                signal: controller.signal,
            });

            expect(mockCallAnalysisAi).toHaveBeenCalledWith(
                expect.objectContaining({ signal: controller.signal })
            );
        });

        it('reasoning을 callAnalysisAi에 그대로 전달한다', async () => {
            // `true`는 모델 스펙을 오버라이드한다 — 스펙상 non-thinking인
            // deepseek-v4-flash에서도 추론이 켜져야 한다(그래야 추론 티어
            // 모델 값을 치르지 않고 다이제스트 품질을 유지한다).
            await runMarketNewsDigest({ ...baseArgs(), reasoning: true });

            expect(mockCallAnalysisAi).toHaveBeenCalledWith(
                expect.objectContaining({ reasoning: true })
            );
        });

        it('reasoning을 생략하면 undefined로 전달해 모델 스펙 기본값을 보존한다', async () => {
            // `callAnalysisAi`는 `reasoning === undefined`를 "개입 안 함"으로
            // 취급한다. 여기서 false로 강등하면 호출자가 스펙 기본값을 고를
            // 방법이 사라진다.
            await runMarketNewsDigest(baseArgs());

            expect(mockCallAnalysisAi).toHaveBeenCalledWith(
                expect.objectContaining({ reasoning: undefined })
            );
        });

        it('결과를 NEWS_CACHE_TTL_SECONDS로 캐시에 기록한다', async () => {
            await runMarketNewsDigest(baseArgs());

            expect(mockCacheSet).toHaveBeenCalledWith(
                expect.any(String),
                expect.anything(),
                NEWS_CACHE_TTL_SECONDS
            );
        });
    });

    describe('skipEnqueueIfMiss (봇 경로)', () => {
        it('캐시 미스 + skipEnqueueIfMiss → LLM을 태우지 않는다', async () => {
            const result = await runMarketNewsDigest({
                ...baseArgs(),
                skipEnqueueIfMiss: true,
            });

            expect(result.status).toBe('miss_no_trigger');
            expect(mockCallAnalysisAi).not.toHaveBeenCalled();
        });

        it('캐시 히트 + skipEnqueueIfMiss → cached를 반환한다', async () => {
            mockCacheGet.mockResolvedValueOnce(mockRawResult);

            const result = await runMarketNewsDigest({
                ...baseArgs(),
                skipEnqueueIfMiss: true,
            });

            expect(result.status).toBe('cached');
            expect(mockCallAnalysisAi).not.toHaveBeenCalled();
        });
    });

    describe('in-flight 중복 제거', () => {
        it('같은 캐시 키 동시 호출은 LLM을 1회만 태운다', async () => {
            let resolveAi: (value: string) => void = () => {};
            mockCallAnalysisAi.mockReturnValueOnce(
                new Promise<string>(resolve => {
                    resolveAi = resolve;
                })
            );

            const both = Promise.all([
                runMarketNewsDigest(baseArgs()),
                runMarketNewsDigest(baseArgs()),
            ]);

            resolveAi(JSON.stringify(mockRawResult));
            const [a, b] = await both;

            expect(mockCallAnalysisAi).toHaveBeenCalledTimes(1);
            expect(a.status).toBe('done');
            expect(b.status).toBe('done');
        });
    });
});
