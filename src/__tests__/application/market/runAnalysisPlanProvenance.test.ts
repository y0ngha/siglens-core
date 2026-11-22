import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import type { MarketDataProvider } from '@/domain/ports/marketDataProvider';
import {
    EMPTY_INDICATOR_RESULT,
    EMPTY_SMC_RESULT,
} from '@/domain/indicators/constants';
import type { AnalysisResponse, Skill } from '@/domain/types';

vi.mock('@/application/analysis/callAnalysisAi');
vi.mock('@/infrastructure/skills/loader');
vi.mock('@/application/market/barsApi');
vi.mock('@/domain/analysis/prompt', () => ({
    buildAnalysisPrompt: vi.fn(() => ({
        stable: 'mock-stable',
        dynamic: [
            'Symbol: AAPL',
            '## Market Reference (deterministic · advisory)',
            '- 101.50 (VWAP; 1.50% away)',
            '- 99.25 (Pivot S1; 3.64% away)',
            '- 110.00 (Round 110; 6.80% away)',
        ].join('\n'),
        overlayCandidates: [],
        overlayBuildFailures: [],
        patternScreenFailure: null,
        patternArbitration: { kept: [], dropped: [] },
        patternGeometries: new Map(),
        trend: null,
        injectedSkills: [],
        indicatorCards: [],
        cycleCards: [],
    })),
}));
vi.mock('@/domain/analysis/priceProvenance', async importOriginal => {
    const actual =
        await importOriginal<
            typeof import('@/domain/analysis/priceProvenance')
        >();
    return {
        ...actual,
        checkPriceProvenance: vi.fn(actual.checkPriceProvenance),
    };
});

import { callAnalysisAi } from '@/application/analysis/callAnalysisAi';
import { fetchBarsWithIndicators } from '@/application/market/barsApi';
import {
    PLAN_PROVENANCE_WARNING_LOG,
    runAnalysis,
} from '@/application/market/runAnalysis';
import { checkPriceProvenance } from '@/domain/analysis/priceProvenance';
import { loadSkillsCached } from '@/infrastructure/skills/loader';

const mockCallAnalysisAi = callAnalysisAi as Mock;
const mockFetchBars = fetchBarsWithIndicators as Mock;
const mockLoadSkills = loadSkillsCached as Mock;
const mockCheckProvenance = checkPriceProvenance as Mock;

const provider: MarketDataProvider = {
    getBars: vi.fn().mockResolvedValue([]),
    getQuote: vi.fn().mockResolvedValue(null),
};

/** The last close is 103, so the prompt quotes prices with two decimals. */
const BARS = {
    bars: [
        {
            time: 1705312200,
            open: 100,
            high: 105,
            low: 99,
            close: 103,
            volume: 1_000_000,
        },
    ],
    indicators: { ...EMPTY_INDICATOR_RESULT, smc: EMPTY_SMC_RESULT },
};

function modelReply(
    plan: {
        entryPrices: number[];
        stopLoss: number;
        takeProfitPrices: number[];
    },
    patternSummaries: unknown[] = []
): string {
    return JSON.stringify({
        summary: '요약',
        trend: 'bullish',
        indicatorResults: [],
        riskLevel: 'low',
        keyLevels: { support: [], resistance: [] },
        priceTargets: { bullish: null, bearish: null },
        patternSummaries,
        strategyResults: [],
        candlePatterns: [],
        trendlines: [],
        actionRecommendation: {
            positionAnalysis: '현재가 위치',
            entry: '',
            exit: '',
            riskReward: '',
            entryRecommendation: 'enter',
            ...plan,
        },
    });
}

const run = () =>
    runAnalysis('AAPL', 'Apple Inc.', '1Day', false, undefined, {
        marketDataProvider: provider,
        cache: null,
    });

describe('runAnalysis plan provenance warning', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Back to the wrapped real check (vi.fn(impl) restores its implementation).
        mockCheckProvenance.mockReset();
        mockLoadSkills.mockResolvedValue({
            skills: [] as Skill[],
            skillsDegraded: false,
        });
        mockFetchBars.mockResolvedValue(BARS);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('warns once with counts and field names when a plan price is not in the prompt', async () => {
        mockCallAnalysisAi.mockResolvedValue(
            modelReply({
                entryPrices: [99.25, 101.5],
                stopLoss: 95.37,
                takeProfitPrices: [110, 118.4],
            })
        );
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        await run();

        const provenanceWarnings = warn.mock.calls.filter(
            ([message]) => message === PLAN_PROVENANCE_WARNING_LOG
        );
        expect(provenanceWarnings).toEqual([
            [
                PLAN_PROVENANCE_WARNING_LOG,
                {
                    symbol: 'AAPL',
                    timeframe: '1Day',
                    checked: 5,
                    ungrounded: 2,
                    fields: ['stopLoss', 'takeProfitPrices'],
                },
            ],
        ]);
    });

    it('carries neither prompt text nor a price in the log line', async () => {
        mockCallAnalysisAi.mockResolvedValue(
            modelReply({
                entryPrices: [99.25],
                stopLoss: 95.37,
                takeProfitPrices: [118.4],
            })
        );
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        await run();

        const logged = JSON.stringify(
            warn.mock.calls.filter(
                ([message]) => message === PLAN_PROVENANCE_WARNING_LOG
            )
        );
        expect(logged).not.toContain('Market Reference');
        expect(logged).not.toContain('95.37');
        expect(logged).not.toContain('118.4');
    });

    it('stays silent when every plan price is printed in the prompt', async () => {
        mockCallAnalysisAi.mockResolvedValue(
            modelReply({
                entryPrices: [99.25, 101.5],
                stopLoss: 99.25,
                takeProfitPrices: [110],
            })
        );
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        await run();

        expect(
            warn.mock.calls.filter(
                ([message]) => message === PLAN_PROVENANCE_WARNING_LOG
            )
        ).toEqual([]);
    });

    it('does not change the returned analysis', async () => {
        const reply = modelReply({
            entryPrices: [99.25, 101.5],
            stopLoss: 95.37,
            takeProfitPrices: [118.4],
        });
        mockCallAnalysisAi.mockResolvedValue(reply);
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const withWarning = await run();

        mockCheckProvenance.mockReturnValue({
            checked: { plan: 0, other: 0, keyPrices: 0 },
            plan: [],
            other: [],
            keyPrices: [],
        });
        const withoutWarning = await run();

        const stripClock = (value: unknown) =>
            JSON.parse(
                JSON.stringify(value, (key, v) =>
                    key === 'analyzedAt' ? undefined : v
                )
            );
        expect(stripClock(withWarning)).toEqual(stripClock(withoutWarning));
    });

    it('never fails a generation when the check itself throws', async () => {
        mockCallAnalysisAi.mockResolvedValue(
            modelReply({
                entryPrices: [99.25],
                stopLoss: 95.37,
                takeProfitPrices: [118.4],
            })
        );
        mockCheckProvenance.mockImplementation(() => {
            throw new Error('boom');
        });
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});

        const result = await run();

        expect(result.status).toBe('done');
        expect(error).toHaveBeenCalledWith(
            '[PlanProvenance] check failed:',
            expect.any(Error)
        );
    });

    it('measures plan prices at the precision the prompt quotes the last close with', async () => {
        mockCallAnalysisAi.mockResolvedValue(
            modelReply({
                entryPrices: [99.25],
                stopLoss: 95.37,
                takeProfitPrices: [110],
            })
        );
        vi.spyOn(console, 'warn').mockImplementation(() => {});

        await run();

        expect(mockCheckProvenance).toHaveBeenCalledWith(
            expect.objectContaining({ priceDecimals: 2 })
        );
    });

    it('warns once for two concurrent callers that share one generation', async () => {
        const reply = modelReply({
            entryPrices: [99.25],
            stopLoss: 95.37,
            takeProfitPrices: [118.4],
        });
        mockCallAnalysisAi.mockImplementation(
            () => new Promise(resolve => setTimeout(() => resolve(reply), 25))
        );
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const [first, second] = await Promise.all([run(), run()]);

        expect(first.status).toBe('done');
        expect(second.status).toBe('done');
        expect(mockCallAnalysisAi).toHaveBeenCalledTimes(1);
        expect(
            warn.mock.calls.filter(
                ([message]) => message === PLAN_PROVENANCE_WARNING_LOG
            )
        ).toHaveLength(1);
    });

    it('logs nothing and leaks no unhandled rejection when the producer generation rejects', async () => {
        mockCallAnalysisAi.mockImplementation(
            () =>
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('provider down')), 25)
                )
        );
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const unhandled = vi.fn();
        process.on('unhandledRejection', unhandled);

        const settled = await Promise.allSettled([run(), run()]);
        await new Promise(resolve => setTimeout(resolve, 10));
        process.off('unhandledRejection', unhandled);

        expect(settled.map(result => result.status)).toEqual([
            'rejected',
            'rejected',
        ]);
        expect(
            warn.mock.calls.filter(
                ([message]) => message === PLAN_PROVENANCE_WARNING_LOG
            )
        ).toEqual([]);
        expect(unhandled).not.toHaveBeenCalled();
    });

    it('checks the analysis as the model wrote it, before KRX tick rounding', async () => {
        mockCallAnalysisAi.mockResolvedValue(
            modelReply({
                entryPrices: [99.25],
                stopLoss: 95.37,
                takeProfitPrices: [118.4],
            })
        );
        vi.spyOn(console, 'warn').mockImplementation(() => {});

        await runAnalysis('AAPL', 'Apple Inc.', '1Day', false, undefined, {
            marketDataProvider: provider,
            cache: null,
            currency: 'KRW',
            krxTickTable: 'share',
        });

        const [{ result }] = mockCheckProvenance.mock.lastCall as [
            { result: AnalysisResponse },
        ];
        expect(result.actionRecommendation?.entryPrices).toEqual([99.25]);
        expect(mockCheckProvenance).toHaveBeenCalledWith(
            expect.objectContaining({ priceDecimals: 0 })
        );
    });

    it('names the key-price class among the fields when it also has findings', async () => {
        mockCallAnalysisAi.mockResolvedValue(
            modelReply(
                {
                    entryPrices: [99.25],
                    stopLoss: 95.37,
                    takeProfitPrices: [110],
                },
                [
                    {
                        id: 'x',
                        patternName: 'double_top',
                        skillName: 'double_top',
                        detected: true,
                        trend: 'bearish',
                        summary: 's',
                        confidenceWeight: 1,
                        keyPrices: [{ label: '넥라인', price: 77.77 }],
                    },
                ]
            )
        );
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        await run();

        const [[, payload]] = warn.mock.calls.filter(
            ([message]) => message === PLAN_PROVENANCE_WARNING_LOG
        );
        expect(payload).toEqual(
            expect.objectContaining({
                checked: 3,
                ungrounded: 1,
                fields: ['stopLoss', 'keyPrices'],
            })
        );
    });
});
