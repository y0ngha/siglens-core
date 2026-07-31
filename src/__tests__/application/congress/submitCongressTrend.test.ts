import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';
import type { CongressTrade, Skill } from '@/domain/types';
import type { CongressTradesProvider } from '@/domain/ports/congressTradesProvider';
import { normalizeCongressTrendResponse } from '@/domain/analysis/normalizeCongressTrend';
import { CONGRESS_SYSTEM_PROMPT } from '@/domain/analysis/systemPrompt';
import { DEFAULT_TIER } from '@/domain/tier';

vi.mock('@/infrastructure/cache/redis');
vi.mock('@/infrastructure/jobs/queue');
vi.mock('@/application/background');
vi.mock('@/infrastructure/skills/loader');

import { submitCongressTrend } from '@/application/congress/submitCongressTrend';
import { buildCongressTrendCacheKey } from '@/infrastructure/cache/config';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import {
    analysisSeed,
    hashSkillCatalog,
} from '@/infrastructure/hash/analysisInput';
import { setJobMeta } from '@/infrastructure/jobs/queue';
import { fireAndForget } from '@/application/background';
import { loadSkillsCached } from '@/infrastructure/skills/loader';
import { createSkillSamplingPlan } from '@/infrastructure/skills/sampling';

/** Fingerprint of the empty skill catalog the loader stub returns by default. */
const EMPTY_CATALOG_FP = `free:${hashSkillCatalog([])}`;

const makeCongressSkills = (): Skill[] =>
    Array.from({ length: 4 }, (_, index) => ({
        name: `congress-skill-${index}`,
        description: `congress skill ${index}`,
        category: 'congress',
        indicators: [],
        confidenceWeight: 1,
        content: `congress-skill-content-${index}`,
        gating: { tier: 'always_on' },
    }));

const mockCreateCacheProvider = createCacheProvider as Mock;
const mockSetJobMeta = setJobMeta as Mock;
const mockFireAndForget = fireAndForget as Mock;
const mockLoadSkillsCached = loadSkillsCached as Mock;

const mockCacheGet = vi.fn();
const mockCacheSet = vi.fn();
const mockCacheProvider = {
    get: mockCacheGet,
    set: mockCacheSet,
    delete: vi.fn(),
};

const mockFetch = vi.fn();

/** One senate trade row — enough to make the normalized trades non-empty. */
const senateRow = {
    firstName: 'Jane',
    lastName: 'Doe',
    office: 'Jane Doe',
    district: 'CA',
    owner: 'self',
    type: 'Purchase',
    amount: '$1,001 - $15,000',
    assetType: 'Stock',
    assetDescription: 'Apple Inc',
    transactionDate: '2026-05-01',
    disclosureDate: '2026-05-20',
    link: 'https://example.test/1',
    capitalGainsOver200USD: 'false',
};

const mockGetTrades = vi.fn();
const mockDataProvider: CongressTradesProvider = {
    getTrades: mockGetTrades,
};

/** Build a typed trade fixture to assert against (mirrors normalizeCongressTrades output). */
function makeTrade(): CongressTrade[] {
    return [
        {
            chamber: 'senate',
            firstName: 'Jane',
            lastName: 'Doe',
            office: 'Jane Doe',
            district: 'CA',
            owner: 'self',
            side: 'buy',
            rawType: 'Purchase',
            amount: { min: 1001, max: 15000, label: '$1,001 - $15,000' },
            assetType: 'Stock',
            assetDescription: 'Apple Inc',
            transactionDate: '2026-05-01',
            disclosureDate: '2026-05-20',
            link: 'https://example.test/1',
            capitalGainsOver200USD: false,
        },
    ];
}

const mockCachedResult = {
    summaryKo: '캐시된 의회 거래 동향입니다.',
    notableMembersKo: ['Jane Doe 상원의원'],
    riskNoteKo: '공시 지연 주의.',
    overallSentiment: 'bullish' as const,
};

describe('submitCongressTrend 함수는', () => {
    const originalEnv = process.env;

    const BASE_OPTIONS = {
        symbol: 'AAPL',
        modelId: 'gemini-2.5-flash' as const,
        dataProvider: mockDataProvider,
    };

    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal('fetch', mockFetch);
        process.env = {
            ...originalEnv,
            WORKER_URL: 'https://worker.test',
            WORKER_SECRET: 'test-secret',
        };

        mockCreateCacheProvider.mockReturnValue(mockCacheProvider);
        mockSetJobMeta.mockResolvedValue(undefined);
        mockFetch.mockResolvedValue(new Response('{}', { status: 200 }));
        mockFireAndForget.mockImplementation(() => undefined);
        mockLoadSkillsCached.mockResolvedValue({
            skills: [],
            skillsDegraded: false,
        });

        // Default: senate returns one row, house returns none → 1 trade total.
        mockGetTrades.mockImplementation((_symbol: string, chamber: string) =>
            Promise.resolve(chamber === 'senate' ? [senateRow] : [])
        );
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        process.env = originalEnv;
    });

    describe('캐시 히트일 때', () => {
        it('cached 상태와 함께 결과를 반환하고 provider를 호출하지 않는다', async () => {
            mockCacheGet.mockResolvedValueOnce(mockCachedResult);

            const result = await submitCongressTrend(BASE_OPTIONS);

            expect(result.status).toBe('cached');
            if (result.status === 'cached') {
                expect(result.result).toEqual(
                    normalizeCongressTrendResponse(mockCachedResult)
                );
            }
            expect(mockSetJobMeta).not.toHaveBeenCalled();
            expect(mockFetch).not.toHaveBeenCalled();
            expect(mockDataProvider.getTrades).not.toHaveBeenCalled();
        });

        it('summaryKo가 비어 있으면 캐시 미스로 처리하고 provider를 호출한다', async () => {
            mockCacheGet.mockResolvedValueOnce({
                summaryKo: '',
                notableMembersKo: [],
                riskNoteKo: '',
                overallSentiment: 'neutral',
            });

            const result = await submitCongressTrend(BASE_OPTIONS);

            expect(result.status).toBe('submitted');
            expect(mockDataProvider.getTrades).toHaveBeenCalled();
        });

        it('force=true이면 캐시를 우회한다', async () => {
            mockCacheGet.mockReset();
            mockCacheGet.mockResolvedValue(mockCachedResult);

            const result = await submitCongressTrend({
                ...BASE_OPTIONS,
                force: true,
            });

            expect(result.status).toBe('submitted');
            expect(mockCacheGet).not.toHaveBeenCalled();
            expect(mockDataProvider.getTrades).toHaveBeenCalled();
        });

        it('캐시 읽기가 실패하면 catch에서 흡수하고 submit 경로로 진행한다', async () => {
            mockCacheGet.mockRejectedValueOnce(new Error('redis down'));

            const result = await submitCongressTrend(BASE_OPTIONS);

            expect(result.status).toBe('submitted');
            expect(mockDataProvider.getTrades).toHaveBeenCalled();
        });

        it('캐시 프로바이더가 null이면 캐시 조회를 건너뛰고 제출한다', async () => {
            mockCreateCacheProvider.mockReturnValueOnce(null);

            const result = await submitCongressTrend(BASE_OPTIONS);

            expect(result.status).toBe('submitted');
            expect(mockCacheGet).not.toHaveBeenCalled();
            expect(mockFireAndForget).toHaveBeenCalledTimes(1);
        });
    });

    describe('캐시 미스 + 거래가 있을 때', () => {
        beforeEach(() => {
            mockCacheGet.mockResolvedValueOnce(null);
        });

        it('senate/house provider를 병렬 호출하고 submitted + jobId를 반환하며 워커에 POST 1회', async () => {
            const result = await submitCongressTrend(BASE_OPTIONS);

            expect(result.status).toBe('submitted');
            if (result.status === 'submitted') {
                expect(typeof result.jobId).toBe('string');
                expect(result.jobId.length).toBeGreaterThan(0);
            }
            expect(mockDataProvider.getTrades).toHaveBeenCalledWith(
                'AAPL',
                'senate',
                50
            );
            expect(mockDataProvider.getTrades).toHaveBeenCalledWith(
                'AAPL',
                'house',
                50
            );
            expect(mockSetJobMeta).toHaveBeenCalled();
            expect(mockFireAndForget).toHaveBeenCalledTimes(1);
            expect(mockFetch).toHaveBeenCalledTimes(1);
        });

        it('limit을 명시하면 provider에 그대로 전달한다', async () => {
            await submitCongressTrend({ ...BASE_OPTIONS, limit: 25 });

            expect(mockDataProvider.getTrades).toHaveBeenCalledWith(
                'AAPL',
                'senate',
                25
            );
        });

        it('워커에 jobId, modelId, cacheKey를 포함한 메타를 등록한다', async () => {
            await submitCongressTrend(BASE_OPTIONS);

            expect(mockSetJobMeta).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    symbol: 'AAPL',
                    modelId: 'gemini-2.5-flash',
                    cacheKey: expect.any(String),
                })
            );
        });

        it('워커 body에 analysisType=congress, system, responseSchema, seed, DEFAULT_TIER를 포함한다', async () => {
            await submitCongressTrend(BASE_OPTIONS);

            const body = JSON.parse(
                mockFetch.mock.calls[0][1].body as string
            ) as Record<string, unknown>;
            expect(body.analysisType).toBe('congress');
            // Design C: the always-on skill digest (`stable`, non-empty for
            // this builder) folds into the SYSTEM prompt.
            const system = body.system as string;
            expect(system.startsWith(CONGRESS_SYSTEM_PROMPT)).toBe(true);
            expect(system.length).toBeGreaterThan(
                CONGRESS_SYSTEM_PROMPT.length
            );
            expect(body.promptStable).toBeUndefined();
            expect(body.promptDynamic).toBeUndefined();
            expect(body.seed).toBe(
                analysisSeed(`${system}\n\n${body.prompt as string}`)
            );
            expect(body.responseSchema).toBeDefined();
            expect(body.tier).toBe(DEFAULT_TIER);
        });

        it('options.tier가 지정되면 worker payload에 그대로 전달된다', async () => {
            await submitCongressTrend({ ...BASE_OPTIONS, tier: 'pro' });

            const body = JSON.parse(
                mockFetch.mock.calls[0][1].body as string
            ) as Record<string, unknown>;
            expect(body.tier).toBe('pro');
        });

        it('skillsDegraded=true이면 job meta에 포함한다', async () => {
            mockLoadSkillsCached.mockResolvedValue({
                skills: [],
                skillsDegraded: true,
            });

            await submitCongressTrend(BASE_OPTIONS);

            expect(mockSetJobMeta).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({ skillsDegraded: true })
            );
        });

        it('정규화된 trades가 프롬프트에 반영된다 (sanity: 의원명 포함)', async () => {
            // The fixture row should survive normalize → prompt; assert the
            // member office string appears, proving normalizeCongressTrades ran.
            const expectedTrade = makeTrade()[0];
            await submitCongressTrend(BASE_OPTIONS);

            const body = JSON.parse(
                mockFetch.mock.calls[0][1].body as string
            ) as Record<string, unknown>;
            expect(body.prompt).toContain(expectedTrade.office);
        });

        it('provider가 throw하면 fetch_failed error를 반환한다', async () => {
            mockGetTrades.mockRejectedValueOnce(new Error('FMP API error'));

            const result = await submitCongressTrend(BASE_OPTIONS);

            expect(result.status).toBe('error');
            if (result.status === 'error') {
                expect(result.code).toBe('fetch_failed');
                expect(result.error).toContain('FMP API error');
            }
            expect(mockSetJobMeta).not.toHaveBeenCalled();
            expect(mockFireAndForget).not.toHaveBeenCalled();
        });
    });

    describe('BYOK 헤더 전달이', () => {
        beforeEach(() => {
            mockCacheGet.mockResolvedValueOnce(null);
        });

        it('userApiKey가 제공되면 X-AI-API-KEY 헤더를 포함해서 워커에 전달한다', async () => {
            const result = await submitCongressTrend({
                ...BASE_OPTIONS,
                userApiKey: 'usr-key',
            });

            expect(result.status).toBe('submitted');
            expect(mockFetch).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    headers: expect.objectContaining({
                        'X-AI-API-KEY': 'usr-key',
                    }),
                })
            );
        });

        it('userApiKey가 없으면 X-AI-API-KEY 헤더를 포함하지 않는다', async () => {
            const result = await submitCongressTrend(BASE_OPTIONS);

            expect(result.status).toBe('submitted');
            const fetchCall = mockFetch.mock.calls[0][1] as {
                headers: Record<string, string>;
            };
            expect(fetchCall.headers['X-AI-API-KEY']).toBeUndefined();
        });

        it('congress는 tier gating 없이 userApiKey 유무와 무관하게 항상 진행한다', async () => {
            // Congress has no BYOK gate (unlike submitAnalysis/submitFinancialsAnalysis):
            // a premium-model request without a key must NOT be blocked.
            const result = await submitCongressTrend({
                ...BASE_OPTIONS,
                modelId: 'gemini-2.5-pro',
                tier: 'member',
            });

            expect(result.status).toBe('submitted');
        });
    });

    describe('reasoning 토글이 적용될 때 (member-reasoning-toggle spec Part A)', () => {
        beforeEach(() => {
            mockCacheGet.mockResolvedValueOnce(null);
        });

        it('reasoning: true이면 :reason=on 캐시 키로 조회하고 Worker body에 reasoning: true를 포함한다', async () => {
            await submitCongressTrend({ ...BASE_OPTIONS, reasoning: true });

            expect(mockCacheGet).toHaveBeenCalledWith(
                buildCongressTrendCacheKey(
                    'AAPL',
                    'gemini-2.5-flash',
                    EMPTY_CATALOG_FP,
                    true
                )
            );
            const body = JSON.parse(
                mockFetch.mock.calls[0][1].body as string
            ) as Record<string, unknown>;
            expect(body.reasoning).toBe(true);
        });

        it('reasoning을 생략하면 기존 캐시 키와 동일하고 Worker body에 reasoning 필드가 없다', async () => {
            await submitCongressTrend(BASE_OPTIONS);

            expect(mockCacheGet).toHaveBeenCalledWith(
                buildCongressTrendCacheKey(
                    'AAPL',
                    'gemini-2.5-flash',
                    EMPTY_CATALOG_FP
                )
            );
            const body = JSON.parse(
                mockFetch.mock.calls[0][1].body as string
            ) as Record<string, unknown>;
            expect(body.reasoning).toBeUndefined();
        });
    });

    describe('tier별 skill sampling이 적용될 때', () => {
        it('free prompt는 정해진 sampled skills만 포함하고 member 캐시와 분리된다', async () => {
            const skills = makeCongressSkills();
            mockLoadSkillsCached.mockResolvedValue({
                skills,
                skillsDegraded: false,
            });
            mockCacheGet.mockResolvedValue(null);

            await submitCongressTrend({ ...BASE_OPTIONS, tier: 'free' });
            const freeMeta = mockSetJobMeta.mock.calls.at(-1)?.[1] as {
                cacheKey: string;
            };
            const freeSystem = JSON.parse(
                mockFetch.mock.calls.at(-1)?.[1].body as string
            ).system as string;

            await submitCongressTrend({ ...BASE_OPTIONS, tier: 'member' });
            const memberMeta = mockSetJobMeta.mock.calls.at(-1)?.[1] as {
                cacheKey: string;
            };
            const memberSystem = JSON.parse(
                mockFetch.mock.calls.at(-1)?.[1].body as string
            ).system as string;

            const freePlan = createSkillSamplingPlan(skills, 'free', [
                'congress',
                'AAPL',
                'gemini-2.5-flash',
                'reasoning-off',
                'free',
            ]);
            const memberPlan = createSkillSamplingPlan(skills, 'member', [
                'congress',
                'AAPL',
                'gemini-2.5-flash',
                'reasoning-off',
                'member',
            ]);
            const namesIn = (system: string): string[] =>
                skills
                    .filter(skill => system.includes(skill.content))
                    .map(skill => skill.name)
                    .toSorted();

            expect(namesIn(freeSystem)).toEqual(
                freePlan.skills.map(skill => skill.name).toSorted()
            );
            expect(namesIn(freeSystem)).toHaveLength(3);
            expect(namesIn(memberSystem)).toEqual(
                memberPlan.skills.map(skill => skill.name).toSorted()
            );
            expect(namesIn(memberSystem)).toHaveLength(4);
            expect(freeMeta.cacheKey).toBe(
                buildCongressTrendCacheKey(
                    'AAPL',
                    'gemini-2.5-flash',
                    `free:${freePlan.fingerprint}`
                )
            );
            expect(memberMeta.cacheKey).toBe(
                buildCongressTrendCacheKey(
                    'AAPL',
                    'gemini-2.5-flash',
                    `member:${memberPlan.fingerprint}`
                )
            );
            expect(freeMeta.cacheKey).not.toBe(memberMeta.cacheKey);
        });

        it('identical sampled catalogs still use separate free and member cache keys', async () => {
            mockCacheGet.mockResolvedValue(null);

            await submitCongressTrend({ ...BASE_OPTIONS, tier: 'free' });
            await submitCongressTrend({ ...BASE_OPTIONS, tier: 'member' });

            expect(mockCacheGet.mock.calls[0]?.[0]).not.toBe(
                mockCacheGet.mock.calls[1]?.[0]
            );
        });

        it('free tier never starves congress skills to zero when the loaded catalog mixes non-technical categories', async () => {
            // Regression fixture for the sampleSkillsForTier "mixed catalog"
            // bug: fundamental/news/congress skills all carry a `category`
            // but no `type`. Before the fix, all three collapsed into one
            // shared 'regular' bucket capped at 3 total, so this 12-skill
            // catalog (4 per category) could sample zero congress skills
            // into the prompt even though congressTrendPrompt only keeps
            // `category === 'congress'` skills. With the fix, congress gets
            // its own <=3 cap independent of fundamental/news.
            const congressSkills = makeCongressSkills();
            const fundamentalSkills: Skill[] = Array.from(
                { length: 4 },
                (_, index) => ({
                    name: `fundamental-skill-${index}`,
                    description: `fundamental skill ${index}`,
                    category: 'fundamental',
                    indicators: [],
                    confidenceWeight: 1,
                    content: `fundamental-skill-content-${index}`,
                    gating: { tier: 'always_on' },
                })
            );
            const newsSkills: Skill[] = Array.from(
                { length: 4 },
                (_, index) => ({
                    name: `news-skill-${index}`,
                    description: `news skill ${index}`,
                    category: 'news',
                    indicators: [],
                    confidenceWeight: 1,
                    content: `news-skill-content-${index}`,
                    gating: { tier: 'always_on' },
                })
            );
            const mixedSkills = [
                ...congressSkills,
                ...fundamentalSkills,
                ...newsSkills,
            ];
            mockLoadSkillsCached.mockResolvedValue({
                skills: mixedSkills,
                skillsDegraded: false,
            });
            mockCacheGet.mockResolvedValue(null);

            await submitCongressTrend({ ...BASE_OPTIONS, tier: 'free' });

            const body = JSON.parse(
                mockFetch.mock.calls.at(-1)?.[1].body as string
            ) as { system: string };
            const congressNamesInPrompt = congressSkills
                .filter(skill => body.system.includes(skill.content))
                .map(skill => skill.name);

            expect(congressNamesInPrompt.length).toBeGreaterThan(0);
            expect(congressNamesInPrompt).toHaveLength(3);
            // Fundamental/news content must never leak into the congress
            // prompt (congressTrendPrompt filters by category, independent
            // of this grouping fix).
            expect(
                [...fundamentalSkills, ...newsSkills].some(skill =>
                    body.system.includes(skill.content)
                )
            ).toBe(false);

            // Cross-check at the sampling-plan level, independent of prompt
            // wiring: the free plan itself must retain 3 congress skills.
            const freePlan = createSkillSamplingPlan(mixedSkills, 'free', [
                'congress',
                'AAPL',
                'gemini-2.5-flash',
                'reasoning-off',
                'free',
            ]);
            expect(
                freePlan.skills.filter(skill => skill.category === 'congress')
                    .length
            ).toBe(3);
        });
    });

    describe('거래가 0건일 때', () => {
        it('no_trades를 반환하고 잡을 등록하지 않으며 워커를 호출하지 않는다', async () => {
            mockCacheGet.mockResolvedValueOnce(null);
            mockGetTrades.mockResolvedValue([]);

            const result = await submitCongressTrend({
                ...BASE_OPTIONS,
                symbol: 'NONE',
            });

            expect(result).toEqual({ status: 'no_trades' });
            // Fetch happened (both chambers) but no job/worker dispatch.
            expect(mockDataProvider.getTrades).toHaveBeenCalledTimes(2);
            expect(mockSetJobMeta).not.toHaveBeenCalled();
            expect(mockFireAndForget).not.toHaveBeenCalled();
            expect(mockFetch).not.toHaveBeenCalled();
        });
    });

    describe('skipEnqueueIfMiss 옵션이 true일 때', () => {
        beforeEach(() => {
            mockCacheGet.mockReset();
        });

        it('캐시 미스이면 fetch/워커 없이 miss_no_trigger를 반환한다', async () => {
            mockCacheGet.mockResolvedValue(null);

            const result = await submitCongressTrend({
                ...BASE_OPTIONS,
                skipEnqueueIfMiss: true,
            });

            expect(result).toEqual({ status: 'miss_no_trigger' });
            expect(mockDataProvider.getTrades).not.toHaveBeenCalled();
            expect(mockSetJobMeta).not.toHaveBeenCalled();
            expect(mockFetch).not.toHaveBeenCalled();
        });

        it('캐시 히트면 평소처럼 cached 결과를 반환한다', async () => {
            mockCacheGet.mockResolvedValue(mockCachedResult);

            const result = await submitCongressTrend({
                ...BASE_OPTIONS,
                skipEnqueueIfMiss: true,
            });

            expect(result.status).toBe('cached');
            expect(mockFetch).not.toHaveBeenCalled();
        });
    });
});
