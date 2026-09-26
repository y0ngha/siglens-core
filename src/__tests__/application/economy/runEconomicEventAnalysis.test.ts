import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@/application/analysis/callAnalysisAi');
vi.mock('@/infrastructure/cache/redis');

import { runEconomicEventAnalysis } from '@/application/economy/runEconomicEventAnalysis';
import { callAnalysisAi } from '@/application/analysis/callAnalysisAi';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import { ECONOMIC_EVENT_CACHE_TTL } from '@/infrastructure/cache/config';
import { MODEL_SPECS, supportsHardOff } from '@/domain/analysis/modelSpecs';
import type { EconomicEventAnalysisInput } from '@/domain/economy/types';
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

const mockRawResult = {
    sentiment: 'bullish',
    summaryKo: 'CPI 예상 하회로 금리 인하 기대 강화.',
    interpretationKo: '위험 자산에 긍정적 신호.',
};

const mockCachedResult = {
    sentiment: 'neutral' as const,
    summaryKo: '캐시된 경제 이벤트 분석.',
    interpretationKo: '중립 해석.',
};

const CPI_INPUT: EconomicEventAnalysisInput = {
    region: '미국',
    event: 'CPI MoM',
    impact: 'High',
    actual: 0.1,
    estimate: 0.3,
    previous: 0.4,
    unit: '%',
};

describe('runEconomicEventAnalysis', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockCreateCacheProvider.mockReturnValue(mockCacheProvider);
        mockCacheGet.mockResolvedValue(null);
        mockCacheSet.mockResolvedValue(undefined);
        mockCallAnalysisAi.mockResolvedValue(JSON.stringify(mockRawResult));
    });

    describe('cache hit', () => {
        it('cache hit → callAnalysisAi NOT called, returns {status:"cached"}', async () => {
            mockCacheGet.mockResolvedValueOnce(mockCachedResult);

            const result = await runEconomicEventAnalysis(CPI_INPUT);

            expect(result.status).toBe('cached');
            expect(mockCallAnalysisAi).not.toHaveBeenCalled();
        });
    });

    describe('cache miss → LLM', () => {
        it('callAnalysisAi를 1회 호출하고 done을 반환한다', async () => {
            const result = await runEconomicEventAnalysis(CPI_INPUT);

            expect(mockCallAnalysisAi).toHaveBeenCalledTimes(1);
            expect(result.status).toBe('done');
        });

        it('signal을 callAnalysisAi에 그대로 전달한다', async () => {
            const controller = new AbortController();

            await runEconomicEventAnalysis(CPI_INPUT, {
                signal: controller.signal,
            });

            expect(mockCallAnalysisAi).toHaveBeenCalledWith(
                expect.objectContaining({ signal: controller.signal })
            );
        });

        it('추론을 끈 채로 DeepSeek non-thinking 모델을 호출한다', async () => {
            // 호출자가 정할 수 있는 값이 아니라 이 use-case의 고정 정책이다.
            // `reasoning: false`는 모델 스펙을 오버라이드하므로,
            // ECONOMIC_EVENT_MODEL이 나중에 thinking 모델로 바뀌어도 이 경로는
            // 꺼진 상태를 유지해야 한다 — 이 단언이 그 회귀를 잡는다.
            await runEconomicEventAnalysis(CPI_INPUT);

            expect(mockCallAnalysisAi).toHaveBeenCalledWith(
                expect.objectContaining({ reasoning: false })
            );
            // 모델 상수를 리터럴로 재선언하지 않고 실제 호출 인자를 본다 —
            // 상수만 바꾸고 정책 주석을 안 고치는 드리프트를 잡는다.
            const { model } = mockCallAnalysisAi.mock.calls[0][0] as {
                model: ActiveModelId;
            };
            expect(MODEL_SPECS[model].provider).toBe('gemini');
            // reasoning:false는 Gemini 분기에서 thinkingBudget 0이 된다 —
            // 리터럴 0을 400으로 거부하는 모델로 상수가 바뀌면 전 호출이 죽는다.
            expect(supportsHardOff(model)).toBe(true);
        });

        it('결과를 ECONOMIC_EVENT_CACHE_TTL로 캐시에 기록한다', async () => {
            await runEconomicEventAnalysis(CPI_INPUT);

            expect(mockCacheSet).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    sentiment: expect.any(String),
                }),
                ECONOMIC_EVENT_CACHE_TTL
            );
        });
    });

    describe('캐시 프로바이더 없음', () => {
        it('cache provider null이면 조회 건너뛰고 LLM을 호출한다', async () => {
            mockCreateCacheProvider.mockReturnValueOnce(null);

            const result = await runEconomicEventAnalysis(CPI_INPUT);

            expect(result.status).toBe('done');
            expect(mockCacheGet).not.toHaveBeenCalled();
            expect(mockCallAnalysisAi).toHaveBeenCalledTimes(1);
        });
    });

    describe('입력 동일성 — 해시 결정성', () => {
        it('동일 입력은 같은 캐시 키를 사용한다 (cache 두 번 get)', async () => {
            await runEconomicEventAnalysis(CPI_INPUT);
            await runEconomicEventAnalysis(CPI_INPUT);

            const [firstKey] = mockCacheGet.mock.calls[0] as [string];
            const [secondKey] = mockCacheGet.mock.calls[1] as [string];
            expect(firstKey).toBe(secondKey);
        });

        it('입력이 다르면 캐시 키도 다르다', async () => {
            await runEconomicEventAnalysis(CPI_INPUT);
            await runEconomicEventAnalysis({
                ...CPI_INPUT,
                actual: 0.5,
            });

            const [firstKey] = mockCacheGet.mock.calls[0] as [string];
            const [secondKey] = mockCacheGet.mock.calls[1] as [string];
            expect(firstKey).not.toBe(secondKey);
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
                runEconomicEventAnalysis(CPI_INPUT),
                runEconomicEventAnalysis(CPI_INPUT),
            ]);

            resolveAi(JSON.stringify(mockRawResult));
            const [a, b] = await both;

            expect(mockCallAnalysisAi).toHaveBeenCalledTimes(1);
            expect(a.status).toBe('done');
            expect(b.status).toBe('done');
        });
    });

    /**
     * `Interest Rate Decision`은 한국·미국에서 문자열이 같고 수치도 우연히 겹칠 수
     * 있다. region이 해시에 없으면 미국 해설이 한국 이벤트에 캐시 히트되어
     * 프롬프트를 고친 의미가 사라진다.
     */
    it('region이 다르면 캐시 키가 갈린다', async () => {
        mockCacheGet.mockResolvedValue(null);

        const base = {
            event: 'Interest Rate Decision',
            impact: 'High' as const,
            actual: 2.75,
            estimate: 2.75,
            previous: 2.75,
            unit: '%',
        };

        await runEconomicEventAnalysis({ ...base, region: '미국' });
        await runEconomicEventAnalysis({ ...base, region: '한국' });

        const keys = mockCacheGet.mock.calls.map(c => c[0] as string);
        expect(keys).toHaveLength(2);
        expect(keys[0]).not.toBe(keys[1]);
    });

    describe('캐시 장애 내성', () => {
        it('캐시 조회가 실패하면 로그만 남기고 LLM 분석 후 같은 키로 캐시에 기록한다', async () => {
            const errorSpy = vi
                .spyOn(console, 'error')
                .mockImplementation(() => undefined);
            mockCacheGet.mockRejectedValueOnce(new Error('redis down'));

            const result = await runEconomicEventAnalysis(CPI_INPUT);

            expect(result.status).toBe('done');
            expect(result.result.sentiment).toBe('bullish');
            expect(mockCallAnalysisAi).toHaveBeenCalledTimes(1);
            expect(mockCacheSet).toHaveBeenCalledWith(
                mockCacheGet.mock.calls[0][0],
                result.result,
                ECONOMIC_EVENT_CACHE_TTL
            );
            expect(errorSpy).toHaveBeenCalledWith(
                '[RunEconomicEventAnalysis] Cache read failed:',
                expect.any(Error)
            );
            errorSpy.mockRestore();
        });

        it('캐시 쓰기가 실패해도 분석 결과는 그대로 반환되고 오류는 로그로만 남는다', async () => {
            const errorSpy = vi
                .spyOn(console, 'error')
                .mockImplementation(() => undefined);
            const writeError = new Error('redis write failed');
            mockCacheSet.mockRejectedValueOnce(writeError);

            const result = await runEconomicEventAnalysis(CPI_INPUT);

            expect(result.status).toBe('done');
            expect(result.result.summaryKo).toBe(mockRawResult.summaryKo);
            await vi.waitFor(() =>
                expect(errorSpy).toHaveBeenCalledWith(
                    '[RunEconomicEventAnalysis] Cache write failed:',
                    writeError
                )
            );
            errorSpy.mockRestore();
        });
    });
});
