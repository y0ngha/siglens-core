import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@/application/analysis/callAnalysisAi');

import {
    NEWS_CARD_MODEL_ID,
    runNewsCardAnalysis,
} from '@/application/news/runNewsCardAnalysis';
import { callAnalysisAi } from '@/application/analysis/callAnalysisAi';
import { MODEL_SPECS } from '@/domain/analysis/modelSpecs';
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

        it('추론을 항상 끈 채로 callAnalysisAi를 호출한다', async () => {
            // 호출자가 정할 수 있는 값이 아니라 이 use-case의 고정 정책이다:
            // 번역 + 라벨링은 결정적 변환이라 추론 이득이 없다. `reasoning`은
            // 모델 스펙을 오버라이드하므로, NEWS_CARD_MODEL_ID가 thinking
            // 모델로 바뀌어도 이 단언이 그 회귀를 잡는다(구 `thinkingBudget: 0`은
            // DeepSeek 분기에서 무시되므로 같은 보호를 못 한다).
            await runNewsCardAnalysis({ item: testNewsItem });

            expect(mockCallAnalysisAi).toHaveBeenCalledWith(
                expect.objectContaining({ reasoning: false })
            );
        });

        it('고정 모델은 DeepSeek non-thinking 라인이다', async () => {
            // NEWS_CARD_MODEL_ID를 리터럴로 재선언하지 않고 실제 호출 인자를
            // 본다 — 상수만 바꾸고 정책 주석을 안 고치는 드리프트를 잡는다.
            await runNewsCardAnalysis({ item: testNewsItem });

            expect(mockCallAnalysisAi).toHaveBeenCalledWith(
                expect.objectContaining({ model: NEWS_CARD_MODEL_ID })
            );
            expect(MODEL_SPECS[NEWS_CARD_MODEL_ID].provider).toBe('deepseek');
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
