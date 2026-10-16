import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@/application/analysis/callAnalysisAi');
vi.mock('@/infrastructure/cache/redis');
vi.mock('@/infrastructure/skills/loader');

import { callAnalysisAi } from '@/application/analysis/callAnalysisAi';
import { DEEPSEEK_V4_1_FLASH_MODEL } from '@/application/chat/constants';
import { runInvestorFlowsAnalysis } from '@/application/investorFlows/runInvestorFlowsAnalysis';
import { INVESTOR_FLOWS_RESPONSE_SCHEMA } from '@/domain/analysis/responseSchemas';
import { evaluateInvestorFlows } from '@/domain/investorFlows/evaluateInvestorFlows';
import type { InvestorFlowsDataProvider } from '@/domain/ports/investorFlowsDataProvider';
import type { InvestorFlowsSnapshot, TierModel } from '@/domain/types';
import {
    buildInvestorFlowsCacheKey,
    INVESTOR_FLOWS_CACHE_TTL_SECONDS,
} from '@/infrastructure/cache/config';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import { loadSkillsCached } from '@/infrastructure/skills/loader';
import {
    dailyBars,
    daysBeforeAsOf,
    emptySnapshot,
    krMajorHolderReport,
    quarter,
    shortInterestSeries,
    shortVolumeSeries,
    topHolders,
} from '../../fixtures/investorFlows';

const mockCallAnalysisAi = callAnalysisAi as Mock;
const mockCreateCacheProvider = createCacheProvider as Mock;

const mockCacheGet = vi.fn();
const mockCacheSet = vi.fn();
const mockCacheProvider = {
    get: mockCacheGet,
    set: mockCacheSet,
    delete: vi.fn(),
};

const flowsQuarter = quarter({
    holders: 106_000,
    newHolders: 7000,
    exited: 1000,
    netShareChange: 35_000_000,
});

/** A snapshot with institutional, short-interest and short-volume data. */
const SNAPSHOT: InvestorFlowsSnapshot = emptySnapshot({
    institutional: {
        quarters: [flowsQuarter],
        topHolders: topHolders(10, 8, 0),
        topHoldersPeriod: flowsQuarter.period,
    },
    shortInterest: shortInterestSeries(12_000_000, 9_000_000),
    shortVolume: shortVolumeSeries(1),
});

const mockGetSnapshot = vi.fn();
const dataProvider: InvestorFlowsDataProvider = {
    getInvestorFlowsSnapshot: mockGetSnapshot,
};

const RAW_RESULT = {
    summaryKo: '기관 순매수가 이어졌습니다.',
    axisInterpretations: [{ axis: 'institutional', interpretationKo: '해석' }],
    keySignalsKo: ['신호'],
    risksKo: ['리스크'],
    dataNotesKo: ['투자 조언이 아닙니다.'],
};

const CACHED_RESULT = { ...RAW_RESULT, summaryKo: '캐시된 요약.' };

const BASE_OPTIONS = {
    symbol: 'AAPL',
    modelId: 'gemini-3.6-flash' as const,
    dataProvider,
};

function sentCall() {
    return mockCallAnalysisAi.mock.calls.at(-1)![0] as {
        prompt: string;
        system: string;
        model: string;
        tier: string;
        userApiKey?: string;
        seed: number;
        responseSchema: unknown;
        reasoning?: boolean;
        correlationId: string;
    };
}

describe('runInvestorFlowsAnalysis', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockCreateCacheProvider.mockReturnValue(mockCacheProvider);
        mockCacheGet.mockResolvedValue(null);
        mockCacheSet.mockResolvedValue(undefined);
        mockCallAnalysisAi.mockResolvedValue(JSON.stringify(RAW_RESULT));
        mockGetSnapshot.mockResolvedValue(SNAPSHOT);
    });

    describe('cache hit', () => {
        it('returns the cached analysis without fetching or calling the AI', async () => {
            mockCacheGet.mockResolvedValueOnce(CACHED_RESULT);
            const result = await runInvestorFlowsAnalysis(BASE_OPTIONS);
            expect(result).toEqual({
                status: 'cached',
                result: expect.objectContaining({ summaryKo: '캐시된 요약.' }),
            });
            expect(mockGetSnapshot).not.toHaveBeenCalled();
            expect(mockCallAnalysisAi).not.toHaveBeenCalled();
        });

        it('reads the key built from symbol, model, reasoning, locale and the FINRA switch', async () => {
            await runInvestorFlowsAnalysis({
                ...BASE_OPTIONS,
                reasoning: true,
                locale: 'en',
                includeFinraData: false,
            });
            expect(mockCacheGet).toHaveBeenCalledWith(
                buildInvestorFlowsCacheKey(
                    'AAPL',
                    'gemini-3.6-flash',
                    true,
                    'en',
                    false
                )
            );
        });

        it('treats a cached entry with an empty summary as a miss', async () => {
            mockCacheGet.mockResolvedValueOnce({
                ...CACHED_RESULT,
                summaryKo: '',
            });
            const result = await runInvestorFlowsAnalysis(BASE_OPTIONS);
            expect(result.status).toBe('done');
            expect(mockCallAnalysisAi).toHaveBeenCalledTimes(1);
        });

        it('does not read the cache when force is set, and writes the fresh result', async () => {
            mockCacheGet.mockResolvedValue(CACHED_RESULT);
            const result = await runInvestorFlowsAnalysis({
                ...BASE_OPTIONS,
                force: true,
            });
            expect(result.status).toBe('done');
            expect(mockCacheGet).not.toHaveBeenCalled();
            expect(mockCacheSet).toHaveBeenCalledTimes(1);
        });
    });

    describe('skipEnqueueIfMiss', () => {
        it('returns miss_no_trigger before the snapshot fetch on a cache miss', async () => {
            const result = await runInvestorFlowsAnalysis({
                ...BASE_OPTIONS,
                skipEnqueueIfMiss: true,
            });
            expect(result).toEqual({ status: 'miss_no_trigger' });
            expect(mockGetSnapshot).not.toHaveBeenCalled();
            expect(mockCallAnalysisAi).not.toHaveBeenCalled();
        });

        it('still serves a cache hit', async () => {
            mockCacheGet.mockResolvedValueOnce(CACHED_RESULT);
            const result = await runInvestorFlowsAnalysis({
                ...BASE_OPTIONS,
                skipEnqueueIfMiss: true,
            });
            expect(result.status).toBe('cached');
        });
    });

    describe('data guards', () => {
        it('returns no_data when the provider has no snapshot, without calling the AI', async () => {
            mockGetSnapshot.mockResolvedValue(null);
            const result = await runInvestorFlowsAnalysis(BASE_OPTIONS);
            expect(result).toEqual({ status: 'no_data' });
            expect(mockCallAnalysisAi).not.toHaveBeenCalled();
        });

        it('returns no_data when every axis is insufficient', async () => {
            mockGetSnapshot.mockResolvedValue(emptySnapshot());
            const result = await runInvestorFlowsAnalysis(BASE_OPTIONS);
            expect(result).toEqual({ status: 'no_data' });
            expect(mockCallAnalysisAi).not.toHaveBeenCalled();
            expect(mockCacheSet).not.toHaveBeenCalled();
        });

        it('proceeds when at least one axis has data', async () => {
            mockGetSnapshot.mockResolvedValue(
                emptySnapshot({ shortInterest: shortInterestSeries(1, 2, 6) })
            );
            const result = await runInvestorFlowsAnalysis(BASE_OPTIONS);
            expect(result.status).toBe('done');
        });

        it('returns no_data when FINRA is switched off and short data was the only data', async () => {
            mockGetSnapshot.mockResolvedValue(
                emptySnapshot({ shortInterest: shortInterestSeries(1, 2, 6) })
            );
            const result = await runInvestorFlowsAnalysis({
                ...BASE_OPTIONS,
                includeFinraData: false,
            });
            expect(result).toEqual({ status: 'no_data' });
        });

        it('returns a fetch_failed error when the provider throws', async () => {
            const errorSpy = vi
                .spyOn(console, 'error')
                .mockImplementation(() => {});
            mockGetSnapshot.mockRejectedValueOnce(new Error('FMP down'));
            const result = await runInvestorFlowsAnalysis(BASE_OPTIONS);
            expect(result).toMatchObject({
                status: 'error',
                code: 'fetch_failed',
            });
            expect(result.status === 'error' && result.error).toContain(
                'FMP down'
            );
            expect(mockCallAnalysisAi).not.toHaveBeenCalled();
            errorSpy.mockRestore();
        });
    });

    describe('cache miss → LLM', () => {
        it('calls the AI once and returns the normalized result with the scorecard it interpreted', async () => {
            const result = await runInvestorFlowsAnalysis(BASE_OPTIONS);
            expect(mockCallAnalysisAi).toHaveBeenCalledTimes(1);
            expect(result).toEqual({
                status: 'done',
                result: expect.objectContaining({
                    summaryKo: RAW_RESULT.summaryKo,
                    axisInterpretations: RAW_RESULT.axisInterpretations,
                }),
                scorecard: evaluateInvestorFlows(SNAPSHOT),
            });
        });

        it('injects the computed scorecard and uses the investor-flows schema, correlation id and no skills', async () => {
            await runInvestorFlowsAnalysis(BASE_OPTIONS);
            const call = sentCall();
            expect(call.responseSchema).toBe(INVESTOR_FLOWS_RESPONSE_SCHEMA);
            expect(call.correlationId).toBe('AAPL:investorFlows');
            expect(call.prompt).toContain(
                '## Investor Flows Scorecard (computed)'
            );
            expect(call.system).toContain(
                'who is buying and selling a US stock'
            );
            expect(vi.mocked(loadSkillsCached)).not.toHaveBeenCalled();
        });

        it('writes the normalized result with the investor-flows TTL', async () => {
            await runInvestorFlowsAnalysis(BASE_OPTIONS);
            await vi.waitFor(() =>
                expect(mockCacheSet).toHaveBeenCalledWith(
                    buildInvestorFlowsCacheKey('AAPL', 'gemini-3.6-flash'),
                    expect.objectContaining({
                        summaryKo: RAW_RESULT.summaryKo,
                    }),
                    INVESTOR_FLOWS_CACHE_TTL_SECONDS
                )
            );
        });

        it('forwards signal, tier and the BYOK key, and defaults the tier', async () => {
            const controller = new AbortController();
            await runInvestorFlowsAnalysis({
                ...BASE_OPTIONS,
                tier: 'member',
                userApiKey: 'usr-key',
                signal: controller.signal,
            });
            expect(mockCallAnalysisAi).toHaveBeenCalledWith(
                expect.objectContaining({
                    tier: 'member',
                    userApiKey: 'usr-key',
                    signal: controller.signal,
                })
            );
            await runInvestorFlowsAnalysis({ ...BASE_OPTIONS, force: true });
            expect(sentCall().tier).toBe('free');
        });

        it('forwards providerFallback as fallbackOnProviderFailure', async () => {
            await runInvestorFlowsAnalysis({
                ...BASE_OPTIONS,
                providerFallback: true,
            });
            expect(mockCallAnalysisAi).toHaveBeenCalledWith(
                expect.objectContaining({ fallbackOnProviderFailure: true })
            );
        });

        it('maps a model id missing from MODEL_SPECS to the DeepSeek default', async () => {
            await runInvestorFlowsAnalysis({
                ...BASE_OPTIONS,
                modelId: 'gemini-2.5-flash' as unknown as TierModel,
            });
            expect(sentCall().model).toBe(DEEPSEEK_V4_1_FLASH_MODEL);
        });

        it('shares one generation between concurrent callers on the same key', async () => {
            let resolveAi: (value: string) => void = () => {};
            mockCallAnalysisAi.mockReturnValueOnce(
                new Promise<string>(resolve => {
                    resolveAi = resolve;
                })
            );
            const both = Promise.all([
                runInvestorFlowsAnalysis(BASE_OPTIONS),
                runInvestorFlowsAnalysis(BASE_OPTIONS),
            ]);
            await vi.waitFor(() =>
                expect(mockCallAnalysisAi).toHaveBeenCalledTimes(1)
            );
            resolveAi(JSON.stringify(RAW_RESULT));
            const [a, b] = await both;
            expect(mockCallAnalysisAi).toHaveBeenCalledTimes(1);
            expect([a.status, b.status]).toEqual(['done', 'done']);
        });
    });

    describe('options that change the model output (APP-5)', () => {
        const seedFor = async (extra: object) => {
            await runInvestorFlowsAnalysis({
                ...BASE_OPTIONS,
                force: true,
                ...extra,
            });
            return sentCall().seed;
        };

        it('folds reasoning into the seed and passes it through', async () => {
            const off = await seedFor({});
            const on = await seedFor({ reasoning: true });
            expect(on).not.toBe(off);
            expect(sentCall().reasoning).toBe(true);
        });

        it('drops FINRA data from the prompt when includeFinraData is false', async () => {
            await runInvestorFlowsAnalysis({ ...BASE_OPTIONS, force: true });
            const withFinra = sentCall().prompt;
            expect(withFinra).toContain('Short interest settlements');

            await runInvestorFlowsAnalysis({
                ...BASE_OPTIONS,
                force: true,
                includeFinraData: false,
            });
            const without = sentCall().prompt;
            expect(without).not.toContain('Short interest settlements');
            expect(without).toContain(
                'FINRA short data is not included for this symbol'
            );
            expect(without).toContain('NO DATA — the inputs for this axis');
        });

        it('keeps FINRA-off and FINRA-on generations on different cache keys', async () => {
            await runInvestorFlowsAnalysis({
                ...BASE_OPTIONS,
                includeFinraData: false,
            });
            expect(mockCacheGet).toHaveBeenCalledWith(
                expect.stringContaining(':finra=off')
            );
        });
    });

    describe('expansion inputs', () => {
        const LISTED = {
            listed: true,
            consecutiveDays: 9,
            firstListedDate: daysBeforeAsOf(12),
            markets: ['Nasdaq'],
        };

        it('drops the threshold list from the scorecard and the prompt when includeExchangeLists is false', async () => {
            mockGetSnapshot.mockResolvedValue({
                ...SNAPSHOT,
                thresholdList: LISTED,
            });
            const on = await runInvestorFlowsAnalysis({
                ...BASE_OPTIONS,
                force: true,
            });
            expect(sentCall().prompt).toContain(
                'listed for 9 consecutive trading days'
            );
            const off = await runInvestorFlowsAnalysis({
                ...BASE_OPTIONS,
                force: true,
                includeExchangeLists: false,
            });
            const prompt = sentCall().prompt;
            expect(prompt).not.toContain('listed for 9 consecutive');
            expect(prompt).toContain(
                'Reg SHO threshold-list data is not included'
            );
            expect(prompt).not.toContain('reg_sho_threshold_listed');
            expect(
                on.status === 'done' &&
                    on.scorecard.short.metrics.thresholdListed
            ).toBe(true);
            expect(
                off.status === 'done' &&
                    off.scorecard.short.metrics.thresholdListed
            ).toBeNull();
        });

        it('keeps exchange-lists-off generations on their own cache key', async () => {
            await runInvestorFlowsAnalysis({
                ...BASE_OPTIONS,
                includeExchangeLists: false,
            });
            expect(mockCacheGet).toHaveBeenCalledWith(
                expect.stringContaining(':regsho=off')
            );
        });

        it('computes the squeeze score from squeezeContext and puts it in the prompt', async () => {
            const result = await runInvestorFlowsAnalysis({
                ...BASE_OPTIONS,
                squeezeContext: { dailyBars: dailyBars({ count: 25 }) },
            });
            expect(result.status).toBe('done');
            const scorecard =
                result.status === 'done' ? result.scorecard : null;
            expect(scorecard?.squeezeRisk?.score).not.toBeNull();
            expect(sentCall().prompt).toContain(
                `Short squeeze risk (computed): score=${scorecard?.squeezeRisk?.score}/100`
            );
        });

        it('keeps generations with and without a squeeze context on different cache keys', async () => {
            await runInvestorFlowsAnalysis(BASE_OPTIONS);
            const withoutKey = mockCacheGet.mock.calls.at(-1)![0] as string;
            await runInvestorFlowsAnalysis({
                ...BASE_OPTIONS,
                squeezeContext: { dailyBars: dailyBars({ count: 25 }) },
            });
            const withKey = mockCacheGet.mock.calls.at(-1)![0] as string;
            expect(withoutKey).not.toBe(withKey);
            expect(withKey).toBe(`${withoutKey}:squeeze=on`);
            expect(withoutKey).not.toContain(':squeeze');
        });

        it('leaves the squeeze score out without a context', async () => {
            const result = await runInvestorFlowsAnalysis(BASE_OPTIONS);
            expect(
                result.status === 'done' && result.scorecard.squeezeRisk
            ).toBeNull();
            expect(sentCall().prompt).not.toContain(
                'Short squeeze risk (computed)'
            );
        });

        it('uses the DART prompt and persona for a Korean snapshot', async () => {
            mockGetSnapshot.mockResolvedValue(
                emptySnapshot({
                    market: 'kr',
                    kr: {
                        majorHolders: [krMajorHolderReport()],
                        insiders: [],
                        tradingPlans: [],
                    },
                })
            );
            const result = await runInvestorFlowsAnalysis({
                ...BASE_OPTIONS,
                symbol: '005930.KS',
            });
            expect(result.status).toBe('done');
            const { prompt, system } = sentCall();
            expect(system).toContain('Korean listings as disclosed to DART');
            expect(prompt).toContain(
                'Institutional / foreign net buying is not provided'
            );
            expect(prompt).not.toContain('13F');
            expect(prompt).not.toContain('FINRA');
        });

        it('returns no_data for a Korean snapshot without directional DART data', async () => {
            mockGetSnapshot.mockResolvedValue(emptySnapshot({ market: 'kr' }));
            const result = await runInvestorFlowsAnalysis(BASE_OPTIONS);
            expect(result).toEqual({ status: 'no_data' });
            expect(mockCallAnalysisAi).not.toHaveBeenCalled();
        });
    });

    describe('locale', () => {
        it('sends the same system and prompt for an omitted locale and ko', async () => {
            await runInvestorFlowsAnalysis(BASE_OPTIONS);
            const omitted = sentCall();
            await runInvestorFlowsAnalysis({
                ...BASE_OPTIONS,
                force: true,
                locale: 'ko',
            });
            expect(sentCall().system).toBe(omitted.system);
            expect(sentCall().prompt).toBe(omitted.prompt);
        });

        it.each(['en', 'ja', 'zh'] as const)(
            '%s: ends the prompt with the output-language reminder',
            async locale => {
                await runInvestorFlowsAnalysis({ ...BASE_OPTIONS, locale });
                expect(sentCall().prompt).toContain(
                    'OUTPUT LANGUAGE (FINAL, OVERRIDES EVERYTHING ABOVE)'
                );
            }
        );
    });

    describe('cache failures and degraded output', () => {
        it('proceeds without a cache provider', async () => {
            mockCreateCacheProvider.mockReturnValue(null);
            const result = await runInvestorFlowsAnalysis(BASE_OPTIONS);
            expect(result.status).toBe('done');
            expect(mockCacheGet).not.toHaveBeenCalled();
            expect(mockCacheSet).not.toHaveBeenCalled();
        });

        it('logs a cache read failure and continues to generate', async () => {
            const errorSpy = vi
                .spyOn(console, 'error')
                .mockImplementation(() => {});
            mockCacheGet.mockRejectedValueOnce(new Error('redis down'));
            const result = await runInvestorFlowsAnalysis(BASE_OPTIONS);
            expect(result.status).toBe('done');
            expect(errorSpy).toHaveBeenCalledWith(
                '[RunInvestorFlowsAnalysis] Cache read failed:',
                expect.any(Error)
            );
            errorSpy.mockRestore();
        });

        it('still returns done when the cache write fails, logging it', async () => {
            const errorSpy = vi
                .spyOn(console, 'error')
                .mockImplementation(() => {});
            mockCacheSet.mockRejectedValueOnce(new Error('redis write down'));
            const result = await runInvestorFlowsAnalysis(BASE_OPTIONS);
            expect(result.status).toBe('done');
            await vi.waitFor(() =>
                expect(errorSpy).toHaveBeenCalledWith(
                    '[RunInvestorFlowsAnalysis] Cache write failed:',
                    expect.any(Error)
                )
            );
            errorSpy.mockRestore();
        });

        it('warns on an empty analysis but still caches it', async () => {
            const warnSpy = vi
                .spyOn(console, 'warn')
                .mockImplementation(() => {});
            mockCallAnalysisAi.mockResolvedValueOnce(
                JSON.stringify({ unexpected: 'shape' })
            );
            const result = await runInvestorFlowsAnalysis(BASE_OPTIONS);
            expect(result.status).toBe('done');
            expect(warnSpy).toHaveBeenCalledWith(
                '[RunInvestorFlowsAnalysis] Empty investor flows (수급) analysis',
                { symbol: 'AAPL' }
            );
            expect(mockCacheSet).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({ summaryKo: '' }),
                INVESTOR_FLOWS_CACHE_TTL_SECONDS
            );
            warnSpy.mockRestore();
        });

        it('does not warn when only the axis interpretations are present', async () => {
            const warnSpy = vi
                .spyOn(console, 'warn')
                .mockImplementation(() => {});
            mockCallAnalysisAi.mockResolvedValueOnce(
                JSON.stringify({ ...RAW_RESULT, summaryKo: '' })
            );
            await runInvestorFlowsAnalysis(BASE_OPTIONS);
            expect(warnSpy).not.toHaveBeenCalled();
            warnSpy.mockRestore();
        });

        it('lets an AI failure propagate', async () => {
            mockCallAnalysisAi.mockRejectedValueOnce(new Error('provider 500'));
            await expect(
                runInvestorFlowsAnalysis(BASE_OPTIONS)
            ).rejects.toThrow('provider 500');
        });
    });
});
