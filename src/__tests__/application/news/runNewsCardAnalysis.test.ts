import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@/application/analysis/callAnalysisAi');

import { runNewsCardAnalysis } from '@/application/news/runNewsCardAnalysis';
import { callAnalysisAi } from '@/application/analysis/callAnalysisAi';
import type { NewsItem } from '@/domain/types';

const mockCallAnalysisAi = callAnalysisAi as Mock;

/** Minimal valid raw LLM result for a news card. */
const mockRawResult = {
    titleKo: '애플 신제품 발표',
    bodyKo: '애플이 신제품을 발표했습니다.',
    summaryKo: '신제품 발표',
    sentiment: 'bullish',
    category: 'product',
    priceImpact: 'medium',
};

/** Minimal valid NewsItem. */
const testNewsItem: NewsItem = {
    id: 'news-card-001',
    symbol: 'AAPL',
    source: 'Reuters',
    url: 'https://reuters.com/news-card-001',
    publishedAt: '2026-05-01T10:00:00Z',
    titleEn: 'Apple announces new product lineup',
    bodyEn: 'Apple has announced a new product lineup today.',
};

describe('runNewsCardAnalysis', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockCallAnalysisAi.mockResolvedValue(JSON.stringify(mockRawResult));
    });

    describe('LLM 호출 + done 반환', () => {
        it('callAnalysisAi를 1회 호출하고 done 상태와 result를 반환한다', async () => {
            const result = await runNewsCardAnalysis({ item: testNewsItem });

            expect(mockCallAnalysisAi).toHaveBeenCalledTimes(1);
            expect(result.status).toBe('done');
            if (result.status === 'done') {
                expect(result.result.titleKo).toBe(mockRawResult.titleKo);
                expect(result.result.summaryKo).toBe(mockRawResult.summaryKo);
            }
        });

        it('signal을 callAnalysisAi에 그대로 전달한다', async () => {
            const controller = new AbortController();

            await runNewsCardAnalysis({
                item: testNewsItem,
                signal: controller.signal,
            });

            expect(mockCallAnalysisAi).toHaveBeenCalledWith(
                expect.objectContaining({ signal: controller.signal })
            );
        });

        it('thinkingBudget을 callAnalysisAi에 전달한다', async () => {
            await runNewsCardAnalysis({
                item: testNewsItem,
                thinkingBudget: 0,
            });

            expect(mockCallAnalysisAi).toHaveBeenCalledWith(
                expect.objectContaining({ thinkingBudget: 0 })
            );
        });

        it('thinkingBudget을 생략하면 callAnalysisAi에 undefined로 전달된다', async () => {
            await runNewsCardAnalysis({ item: testNewsItem });

            expect(mockCallAnalysisAi).toHaveBeenCalledWith(
                expect.objectContaining({ thinkingBudget: undefined })
            );
        });
    });

    describe('in-flight 중복 제거', () => {
        it('같은 item.id 동시 호출은 LLM을 1회만 태운다', async () => {
            let resolveAi: (value: string) => void = () => {};
            mockCallAnalysisAi.mockReturnValueOnce(
                new Promise<string>(resolve => {
                    resolveAi = resolve;
                })
            );

            const both = Promise.all([
                runNewsCardAnalysis({ item: testNewsItem }),
                runNewsCardAnalysis({ item: testNewsItem }),
            ]);

            resolveAi(JSON.stringify(mockRawResult));
            const [a, b] = await both;

            expect(mockCallAnalysisAi).toHaveBeenCalledTimes(1);
            expect(a.status).toBe('done');
            expect(b.status).toBe('done');
        });

        it('다른 item.id는 각각 별도로 LLM을 호출한다', async () => {
            const itemB: NewsItem = { ...testNewsItem, id: 'news-card-002' };

            await runNewsCardAnalysis({ item: testNewsItem });
            await runNewsCardAnalysis({ item: itemB });

            expect(mockCallAnalysisAi).toHaveBeenCalledTimes(2);
        });
    });
});
