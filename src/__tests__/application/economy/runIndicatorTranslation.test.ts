import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@/application/analysis/callAnalysisAi');
vi.mock('@/infrastructure/cache/redis');

import { runIndicatorTranslation } from '@/application/economy/runIndicatorTranslation';
import { callAnalysisAi } from '@/application/analysis/callAnalysisAi';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import { INDICATOR_TRANSLATION_CACHE_TTL } from '@/infrastructure/cache/config';
import { MODEL_SPECS, supportsHardOff } from '@/domain/analysis/modelSpecs';
import type { ActiveModelId } from '@/domain/types';

const mockCallAnalysisAi = callAnalysisAi as Mock;
const mockCreateCacheProvider = createCacheProvider as Mock;

const mockCacheGet = vi.fn();
const mockCacheSet = vi.fn();
const mockCacheProvider = {
    get: mockCacheGet,
    set: mockCacheSet,
    delete: vi.fn(),
};

/** Raw LLM response for "CPI MoM". */
const mockRawResult = { nameKo: '소비자물가지수 월간' };

/** Already-translated Korean name stored in cache. */
const CACHED_KO = '캐시된 한국어 지표명';

describe('runIndicatorTranslation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockCreateCacheProvider.mockReturnValue(mockCacheProvider);
        mockCacheGet.mockResolvedValue(null);
        mockCacheSet.mockResolvedValue(undefined);
        mockCallAnalysisAi.mockResolvedValue(JSON.stringify(mockRawResult));
    });

    describe('options.cache 주입', () => {
        const injectedGet = vi.fn();
        const injectedSet = vi.fn();
        const injectedCache = {
            get: injectedGet,
            set: injectedSet,
            delete: vi.fn(),
        };

        beforeEach(() => {
            injectedGet.mockReset();
            injectedSet.mockReset();
            injectedGet.mockResolvedValue(null);
            injectedSet.mockResolvedValue(undefined);
        });

        it('주입한 캐시에서 읽고, env 캐시는 만들지도 읽지도 않는다', async () => {
            injectedGet.mockResolvedValueOnce({ nameKo: CACHED_KO });

            const result = await runIndicatorTranslation('cpi_mom', {
                cache: injectedCache,
            });

            expect(result.status).toBe('cached');
            expect(injectedGet).toHaveBeenCalledTimes(1);
            expect(mockCreateCacheProvider).not.toHaveBeenCalled();
            expect(mockCacheGet).not.toHaveBeenCalled();
            expect(mockCallAnalysisAi).not.toHaveBeenCalled();
        });

        it('cache: null 이면 env 캐시로 폴백하지 않고 캐시 없이 실행한다', async () => {
            const result = await runIndicatorTranslation('cpi_mom', {
                cache: null,
            });

            expect(result.status).toBe('done');
            expect(mockCreateCacheProvider).not.toHaveBeenCalled();
            expect(mockCacheGet).not.toHaveBeenCalled();
            expect(mockCacheSet).not.toHaveBeenCalled();
            expect(mockCallAnalysisAi).toHaveBeenCalledTimes(1);
        });
    });

    describe('cache hit', () => {
        it('cache hit → callAnalysisAi NOT called, returns {status:"cached"}', async () => {
            mockCacheGet.mockResolvedValueOnce({ nameKo: CACHED_KO });

            const result = await runIndicatorTranslation('cpi_mom');

            expect(result.status).toBe('cached');
            expect(result.nameKo).toBe(CACHED_KO);
            expect(mockCallAnalysisAi).not.toHaveBeenCalled();
        });
    });

    describe('cache miss → LLM', () => {
        it('callAnalysisAi를 1회 호출하고 done을 반환한다', async () => {
            const result = await runIndicatorTranslation('cpi_mom');

            expect(mockCallAnalysisAi).toHaveBeenCalledTimes(1);
            expect(result.status).toBe('done');
        });

        it('LLM이 반환한 nameKo를 done result에 담는다', async () => {
            const result = await runIndicatorTranslation('cpi_mom');

            if (result.status === 'done') {
                expect(result.nameKo).toBe('소비자물가지수 월간');
            }
        });

        it('signal을 callAnalysisAi에 그대로 전달한다', async () => {
            const controller = new AbortController();

            await runIndicatorTranslation('cpi_mom', {
                signal: controller.signal,
            });

            expect(mockCallAnalysisAi).toHaveBeenCalledWith(
                expect.objectContaining({ signal: controller.signal })
            );
        });

        it('추론을 끈 채로 DeepSeek non-thinking 모델을 호출한다', async () => {
            // 지표명 한 줄 번역은 사실상 사전 조회다 — 이 use-case의 고정
            // 정책이며 호출자가 바꿀 수 없다. `reasoning: false`는 모델 스펙을
            // 오버라이드하므로 INDICATOR_TRANSLATION_MODEL이 thinking 모델로
            // 바뀌어도 이 경로는 꺼진 상태를 유지해야 한다.
            await runIndicatorTranslation('cpi_mom');

            expect(mockCallAnalysisAi).toHaveBeenCalledWith(
                expect.objectContaining({ reasoning: false })
            );
            // 모델 상수를 리터럴로 재선언하지 않고 실제 호출 인자를 본다.
            const { model } = mockCallAnalysisAi.mock.calls[0][0] as {
                model: ActiveModelId;
            };
            expect(MODEL_SPECS[model].provider).toBe('gemini');
            // reasoning:false는 Gemini 분기에서 thinkingBudget 0이 된다 —
            // 리터럴 0을 400으로 거부하는 모델로 상수가 바뀌면 전 호출이 죽는다.
            expect(supportsHardOff(model)).toBe(true);
        });

        it('결과를 { nameKo } envelope으로 INDICATOR_TRANSLATION_CACHE_TTL에 기��한다', async () => {
            await runIndicatorTranslation('cpi_mom');

            expect(mockCacheSet).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({ nameKo: expect.any(String) }),
                INDICATOR_TRANSLATION_CACHE_TTL
            );
        });
    });

    describe('캐시 프로바이더 없음', () => {
        it('cache provider null이면 조회 건너뛰고 LLM을 호출한다', async () => {
            mockCreateCacheProvider.mockReturnValueOnce(null);

            const result = await runIndicatorTranslation('cpi_mom');

            expect(result.status).toBe('done');
            expect(mockCacheGet).not.toHaveBeenCalled();
            expect(mockCallAnalysisAi).toHaveBeenCalledTimes(1);
        });
    });

    describe('LLM 응답이 파싱 불가', () => {
        it('garbage JSON이면 nameKo가 빈 문자열로 정규화된다', async () => {
            mockCallAnalysisAi.mockResolvedValueOnce('NOT_JSON');

            const result = await runIndicatorTranslation('cpi_mom');

            expect(result.status).toBe('done');
            if (result.status === 'done') {
                expect(result.nameKo).toBe('');
            }
        });
    });

    describe('in-flight 중복 제거', () => {
        it('같은 normalized name 동시 호출은 LLM을 1회만 태운다', async () => {
            let resolveAi: (value: string) => void = () => {};
            mockCallAnalysisAi.mockReturnValueOnce(
                new Promise<string>(resolve => {
                    resolveAi = resolve;
                })
            );

            const both = Promise.all([
                runIndicatorTranslation('cpi_mom'),
                runIndicatorTranslation('cpi_mom'),
            ]);

            resolveAi(JSON.stringify(mockRawResult));
            const [a, b] = await both;

            expect(mockCallAnalysisAi).toHaveBeenCalledTimes(1);
            expect(a.status).toBe('done');
            expect(b.status).toBe('done');
        });
    });

    describe('캐시 장애 내성', () => {
        it('캐시 조회가 실패하면 로그만 남기고 LLM으로 번역해 캐시에 다시 기록한다', async () => {
            const errorSpy = vi
                .spyOn(console, 'error')
                .mockImplementation(() => undefined);
            mockCacheGet.mockRejectedValueOnce(new Error('redis down'));

            const result = await runIndicatorTranslation('cpi_mom');

            expect(result).toEqual({
                status: 'done',
                nameKo: '소비자물가지수 월간',
            });
            expect(mockCallAnalysisAi).toHaveBeenCalledTimes(1);
            expect(mockCacheSet).toHaveBeenCalledWith(
                mockCacheGet.mock.calls[0][0],
                { nameKo: '소비자물가지수 월간' },
                INDICATOR_TRANSLATION_CACHE_TTL
            );
            expect(errorSpy).toHaveBeenCalledWith(
                '[RunIndicatorTranslation] Cache read failed:',
                expect.any(Error)
            );
            errorSpy.mockRestore();
        });

        it('캐시 쓰기가 실패해도 번역 결과는 그대로 반환되고 오류는 로그로만 남는다', async () => {
            const errorSpy = vi
                .spyOn(console, 'error')
                .mockImplementation(() => undefined);
            const writeError = new Error('redis write failed');
            mockCacheSet.mockRejectedValueOnce(writeError);

            const result = await runIndicatorTranslation('cpi_mom');

            expect(result).toEqual({
                status: 'done',
                nameKo: '소비자물가지수 월간',
            });
            await vi.waitFor(() =>
                expect(errorSpy).toHaveBeenCalledWith(
                    '[RunIndicatorTranslation] Cache write failed:',
                    writeError
                )
            );
            errorSpy.mockRestore();
        });
    });
});
