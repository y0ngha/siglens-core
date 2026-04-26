import { describe, expect, it, vi } from 'vitest';
import type { MarketSummaryData, SubmitBriefingResult } from '@/domain/types';

const getMarketSummaryMock = vi.fn<() => Promise<MarketSummaryData>>();
const submitBriefingMock = vi.fn<() => Promise<SubmitBriefingResult>>();

vi.mock('@/application/dashboard/getMarketSummary', () => ({
    getMarketSummary: () => getMarketSummaryMock(),
}));
vi.mock('@/application/market/submitBriefing', () => ({
    submitBriefing: () => submitBriefingMock(),
}));

import { getMarketSummaryWithBriefing } from '@/application/dashboard/getMarketSummaryWithBriefing';

describe('getMarketSummaryWithBriefing', () => {
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

        const result = await getMarketSummaryWithBriefing();
        expect(result).toEqual({ summary, briefing });
    });
});
