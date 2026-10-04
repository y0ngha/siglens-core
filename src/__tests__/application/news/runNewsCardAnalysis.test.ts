import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@/application/analysis/callAnalysisAi');

import {
    NEWS_CARD_MODEL_ID,
    runNewsCardAnalysis,
} from '@/application/news/runNewsCardAnalysis';
import { callAnalysisAi } from '@/application/analysis/callAnalysisAi';
import { DEEPSEEK_V4_1_FLASH_MODEL } from '@/application/chat/constants';
import { MODEL_SPECS, supportsHardOff } from '@/domain/analysis/modelSpecs';
import { buildNewsCardAnalysisPrompt } from '@/domain/analysis/newsCardPrompt';
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

        it('providerFallback is forwarded to callAnalysisAi as fallbackOnProviderFailure', async () => {
            await runNewsCardAnalysis({
                item: testNewsItem,
                providerFallback: true,
            });

            expect(mockCallAnalysisAi).toHaveBeenCalledWith(
                expect.objectContaining({ fallbackOnProviderFailure: true })
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

        it('고정 모델은 DeepSeek V4.1 Flash이고 추론을 완전히 끌 수 있다', async () => {
            // NEWS_CARD_MODEL_ID를 리터럴로 재선언하지 않고 실제 호출 인자를
            // 본다 — 상수만 바꾸고 정책 주석을 안 고치는 드리프트를 잡는다.
            await runNewsCardAnalysis({ item: testNewsItem });

            expect(NEWS_CARD_MODEL_ID).toBe(DEEPSEEK_V4_1_FLASH_MODEL);
            expect(mockCallAnalysisAi).toHaveBeenCalledWith(
                expect.objectContaining({ model: DEEPSEEK_V4_1_FLASH_MODEL })
            );
            expect(MODEL_SPECS[NEWS_CARD_MODEL_ID].provider).toBe('deepseek');
            // 이 경로는 항상 `reasoning: false`를 보낸다. 추론을 완전히 끄지
            // 못하는 모델로 상수가 바뀌면 이 저비용 경로가 조용히 사고 토큰을
            // 쓰기 시작한다.
            expect(supportsHardOff(NEWS_CARD_MODEL_ID)).toBe(true);
        });

        it('고정부는 system에, 기사는 prompt에 실려 기사가 prefix를 깨지 않는다', async () => {
            // prefix 캐싱의 전제: system(앞쪽 큰 덩어리)에는 기사 바이트가
            // 없고, prompt는 기사 본문으로 끝난다.
            await runNewsCardAnalysis({ item: testNewsItem });

            const { system, prompt } = mockCallAnalysisAi.mock.calls[0]![0] as {
                system: string;
                prompt: string;
            };
            const { stable } = buildNewsCardAnalysisPrompt(testNewsItem);
            expect(system.endsWith(stable)).toBe(true);
            expect(system).not.toContain(testNewsItem.titleEn);
            expect(system).not.toContain(testNewsItem.bodyEn!);
            expect(prompt.endsWith(testNewsItem.bodyEn!)).toBe(true);
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

describe('runNewsCardAnalysis — 출력 로케일', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockCallAnalysisAi.mockResolvedValue(JSON.stringify(mockRawResult));
    });

    const systemOf = () =>
        mockCallAnalysisAi.mock.calls[0]![0].system as string;
    const promptOf = () =>
        mockCallAnalysisAi.mock.calls[0]![0].prompt as string;

    /**
     * 기본 로케일은 **바이트가 같아야** 한다 — 다르면 이미 쌓인 한국어 캐시가
     * 낡은 프롬프트로 만든 것이 되어 전량 재생성해야 한다.
     */
    it('로케일을 생략하면 ko와 같은 system·prompt를 보낸다', async () => {
        await runNewsCardAnalysis({ item: testNewsItem });
        const omitted = { system: systemOf(), prompt: promptOf() };

        vi.clearAllMocks();
        mockCallAnalysisAi.mockResolvedValue(JSON.stringify(mockRawResult));
        await runNewsCardAnalysis({ item: testNewsItem, locale: 'ko' });

        expect({ system: systemOf(), prompt: promptOf() }).toEqual(omitted);
    });

    it.each(['en', 'ja', 'zh'] as const)(
        '%s: 출력 언어 계약과 프롬프트 말미 리마인더가 실린다',
        async locale => {
            await runNewsCardAnalysis({ item: testNewsItem, locale });
            expect(systemOf()).toContain('overrides');
            expect(promptOf()).toContain(
                'OUTPUT LANGUAGE (FINAL, OVERRIDES EVERYTHING ABOVE)'
            );
        }
    );

    /**
     * 페르소나가 `"Korean summary"`를 못 박고 있었다(PR #184 리뷰 2라운드).
     * 출력 언어는 OUTPUT FORMAT 계약만이 정한다.
     */
    it.each(['en', 'ja', 'zh'] as const)(
        '%s: 페르소나가 한국어를 지시하지 않는다',
        async locale => {
            await runNewsCardAnalysis({ item: testNewsItem, locale });
            expect(systemOf()).not.toContain('neutral Korean summary');
        }
    );

    /**
     * in-flight 키가 로케일을 안 가르면 언어가 다른 동시 요청이 하나로 합쳐져
     * **늦게 부른 쪽이 요청하지 않은 언어를 받는다**(PR #184 리뷰 1라운드).
     */
    it('언어가 다른 동시 요청은 합쳐지지 않는다', async () => {
        let resolveFirst: (v: string) => void = () => {};
        mockCallAnalysisAi.mockImplementationOnce(
            () => new Promise<string>(r => (resolveFirst = r))
        );
        mockCallAnalysisAi.mockResolvedValue(JSON.stringify(mockRawResult));

        const ko = runNewsCardAnalysis({ item: testNewsItem, locale: 'ko' });
        const en = runNewsCardAnalysis({ item: testNewsItem, locale: 'en' });
        resolveFirst(JSON.stringify(mockRawResult));
        await Promise.all([ko, en]);

        expect(mockCallAnalysisAi).toHaveBeenCalledTimes(2);
    });

    it('같은 언어의 동시 요청은 하나로 합쳐진다', async () => {
        let resolveFirst: (v: string) => void = () => {};
        mockCallAnalysisAi.mockImplementationOnce(
            () => new Promise<string>(r => (resolveFirst = r))
        );

        const a = runNewsCardAnalysis({ item: testNewsItem, locale: 'en' });
        const b = runNewsCardAnalysis({ item: testNewsItem, locale: 'en' });
        resolveFirst(JSON.stringify(mockRawResult));
        await Promise.all([a, b]);

        expect(mockCallAnalysisAi).toHaveBeenCalledTimes(1);
    });
});

describe('runNewsCardAnalysis — 빈 결과 감지', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('제목·요약이 모두 빠진 응답은 기본값으로 정규화하고 카드 id와 함께 경고한다', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        mockCallAnalysisAi.mockResolvedValueOnce(
            JSON.stringify({ unexpected: 'shape' })
        );

        const result = await runNewsCardAnalysis({
            item: { ...testNewsItem, id: 'news-card-empty' },
        });

        expect(result.status).toBe('done');
        if (result.status === 'done') {
            expect(result.result.titleKo).toBe('');
            expect(result.result.summaryKo).toBe('');
            expect(result.result.bodyKo).toBeNull();
        }
        expect(warnSpy).toHaveBeenCalledWith(
            '[RunNewsCardAnalysis] Empty news card analysis',
            { id: 'news-card-empty' }
        );
        warnSpy.mockRestore();
    });

    it('요약만 있어도 부분 결과로 보고 경고하지 않는다', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        mockCallAnalysisAi.mockResolvedValueOnce(
            JSON.stringify({ ...mockRawResult, titleKo: '' })
        );

        const result = await runNewsCardAnalysis({
            item: { ...testNewsItem, id: 'news-card-partial' },
        });

        expect(result.status).toBe('done');
        if (result.status === 'done') {
            expect(result.result.summaryKo).toBe(mockRawResult.summaryKo);
        }
        expect(warnSpy).not.toHaveBeenCalled();
        warnSpy.mockRestore();
    });
});
