import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import type { Timeframe } from '@/domain/types';
import {
    EMPTY_INDICATOR_RESULT,
    EMPTY_SMC_RESULT,
} from '@/domain/indicators/constants';

vi.mock('@/infrastructure/cache/redis');
vi.mock('@/infrastructure/jobs/queue');
vi.mock('@/infrastructure/skills/loader');
vi.mock('@/application/market/barsApi');
vi.mock('@/domain/analysis/prompt', () => ({
    buildAnalysisPrompt: vi.fn(() => 'mock-prompt'),
}));
vi.mock('@/domain/indicators/fearGreed', () => ({
    computeFearGreedIndex: vi.fn(),
}));

import { submitAnalysis } from '@/application/market/submitAnalysis';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import { setJobMeta } from '@/infrastructure/jobs/queue';
import {
    createSkillsProvider,
    loadSkillsCached,
} from '@/infrastructure/skills/loader';
import { fetchBarsWithIndicators } from '@/application/market/barsApi';
import { buildAnalysisPrompt } from '@/domain/analysis/prompt';
import { computeFearGreedIndex } from '@/domain/indicators/fearGreed';
import type { MarketDataProvider } from '@/domain/ports/marketDataProvider';
import { TEST_TIER_CONFIG } from '@/__tests__/helpers/testTierConfig';

const mockCreateCacheProvider = createCacheProvider as Mock;
const mockSetJobMeta = setJobMeta as Mock;
const mockFetchBarsWithIndicators = fetchBarsWithIndicators as Mock;
const mockBuildAnalysisPrompt = buildAnalysisPrompt as Mock;
const mockComputeFearGreedIndex = computeFearGreedIndex as Mock;

const mockCacheGet = vi.fn();
const mockCacheSet = vi.fn();
const mockCacheProvider = {
    get: mockCacheGet,
    set: mockCacheSet,
    delete: vi.fn(),
};

const mockFetch = vi.fn();

const fakeProvider: MarketDataProvider = {
    getBars: vi.fn().mockResolvedValue([]),
    getQuote: vi.fn().mockResolvedValue(null),
};

const mockBarsData = {
    bars: [
        {
            time: 1705312200,
            open: 100,
            high: 105,
            low: 99,
            close: 103,
            volume: 1000000,
        },
    ],
    indicators: { ...EMPTY_INDICATOR_RESULT, smc: EMPTY_SMC_RESULT },
};

describe('submitAnalysis assetClass forwarding', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal('fetch', mockFetch);
        process.env = {
            ...originalEnv,
            WORKER_URL: 'https://worker.test',
            WORKER_SECRET: 'test-secret',
        };
        (createSkillsProvider as Mock).mockReturnValue({ loadSkills: vi.fn() });
        (loadSkillsCached as Mock).mockResolvedValue({
            skills: [],
            skillsDegraded: false,
        });
        mockCreateCacheProvider.mockReturnValue(mockCacheProvider);
        mockSetJobMeta.mockResolvedValue(undefined);
        mockFetch.mockResolvedValue(new Response('{}', { status: 200 }));
        mockFetchBarsWithIndicators.mockResolvedValue(mockBarsData);
        mockComputeFearGreedIndex.mockReturnValue(null);
        mockCacheGet.mockResolvedValue(null); // cache miss → triggers analysis
    });

    it('forwards assetClass=crypto into the analysis prompt', async () => {
        await submitAnalysis(
            'BTCUSD',
            'Bitcoin',
            '1Day' as Timeframe,
            true,
            'BTCUSD',
            {
                marketDataProvider: fakeProvider,
                tierConfig: TEST_TIER_CONFIG,
                assetClass: 'crypto',
            }
        );

        expect(mockBuildAnalysisPrompt).toHaveBeenCalled();
        const callArgs = mockBuildAnalysisPrompt.mock.calls[0];
        // 8th arg (index 7) is assetClass
        expect(callArgs[7]).toBe('crypto');
    });

    it('defaults to equity when assetClass is not passed', async () => {
        await submitAnalysis(
            'AAPL',
            'Apple',
            '1Day' as Timeframe,
            true,
            'AAPL',
            {
                marketDataProvider: fakeProvider,
                tierConfig: TEST_TIER_CONFIG,
            }
        );

        expect(mockBuildAnalysisPrompt).toHaveBeenCalled();
        const callArgs = mockBuildAnalysisPrompt.mock.calls[0];
        expect(callArgs[7]).toBe('equity');
    });
});
