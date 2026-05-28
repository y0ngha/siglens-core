import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BackgroundTaskOptions } from '@/application/types';
import type { MarketDataProvider } from '@/domain/ports/marketDataProvider';
import type { MarketSummaryData, SubmitBriefingResult } from '@/domain/types';

const mockGetQuote = vi.fn();
const mockGetBars = vi.fn();

const fakeProvider: MarketDataProvider = {
    getQuote: mockGetQuote,
    getBars: mockGetBars,
};

const getMarketSummaryMock = vi.fn<() => Promise<MarketSummaryData>>();
const submitBriefingMock =
    vi.fn<
        (
            data?: MarketSummaryData,
            options?: BackgroundTaskOptions
        ) => Promise<SubmitBriefingResult>
    >();

vi.mock('@/application/dashboard/getMarketSummary', () => ({
    getMarketSummary: () => getMarketSummaryMock(),
}));
vi.mock('@/application/market/submitBriefing', () => ({
    submitBriefing: (
        data: MarketSummaryData,
        options?: BackgroundTaskOptions
    ) => submitBriefingMock(data, options),
}));

import { getMarketSummaryWithBriefing } from '@/application/dashboard/getMarketSummaryWithBriefing';

describe('getMarketSummaryWithBriefing', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('summary + briefing 을 결합해 반환한다', async () => {
        const summary: MarketSummaryData = {
            indices: [],
            sectors: [],
        };
        const briefing: SubmitBriefingResult = {
            status: 'submitted',
            jobId: 'job-1',
        };
        getMarketSummaryMock.mockResolvedValue(summary);
        submitBriefingMock.mockResolvedValue(briefing);

        const result = await getMarketSummaryWithBriefing(fakeProvider);
        expect(result).toEqual({ summary, briefing });
        expect(submitBriefingMock).toHaveBeenCalledWith(summary, undefined);
    });

    it('waitUntil 옵션을 submitBriefing으로 전달한다', async () => {
        const summary: MarketSummaryData = {
            indices: [],
            sectors: [],
        };
        const briefing: SubmitBriefingResult = {
            status: 'submitted',
            jobId: 'job-1',
        };
        const options: BackgroundTaskOptions = { waitUntil: vi.fn() };
        getMarketSummaryMock.mockResolvedValue(summary);
        submitBriefingMock.mockResolvedValue(briefing);

        await getMarketSummaryWithBriefing(fakeProvider, options);

        expect(submitBriefingMock).toHaveBeenCalledWith(summary, options);
    });
});
