import type { MarketSummaryWithBriefing } from '@/domain/types';
import { getMarketSummary } from '@/application/dashboard/getMarketSummary';
import { submitBriefing } from '@/application/market/submitBriefing';

export async function getMarketSummaryWithBriefing(): Promise<MarketSummaryWithBriefing> {
    const summary = await getMarketSummary();
    const briefing = await submitBriefing(summary);
    return { summary, briefing };
}
