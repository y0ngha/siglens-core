import { buildMarketBriefingPrompt } from '@/domain/analysis/marketBriefingPrompt';
import type { MarketSummaryData, SubmitBriefingResult } from '@/domain/types';
import { normalizeMarketBriefing } from '@/domain/analysis/normalizeMarketBriefing';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import {
    buildBriefingCacheKey,
    ISO_DATE_HOUR_PREFIX_LENGTH,
} from '@/infrastructure/cache/config';
import { readWorkerConfig } from '@/infrastructure/market/config';

export async function submitBriefing(
    data: MarketSummaryData
): Promise<SubmitBriefingResult> {
    const { workerUrl, workerSecret } = readWorkerConfig();

    const now = new Date();
    const dateHour = now.toISOString().slice(0, ISO_DATE_HOUR_PREFIX_LENGTH);
    const cacheKey = buildBriefingCacheKey(dateHour);

    const cache = createCacheProvider();
    if (cache !== null) {
        try {
            const cached = await cache.get<{
                briefing: unknown;
                generatedAt: string;
            }>(cacheKey);
            if (cached !== null) {
                return {
                    status: 'cached',
                    briefing: normalizeMarketBriefing(cached.briefing),
                    generatedAt: cached.generatedAt,
                };
            }
        } catch (error) {
            console.error('[Briefing/Submit] Cache read failed:', error);
        }
    }

    const prompt = buildMarketBriefingPrompt(data.indices, data.sectors);
    const jobId = crypto.randomUUID();

    // fire-and-forget: 에러는 무시하고 caller에게 jobId만 반환한다.
    fetch(`${workerUrl}/briefing`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Worker-Secret': workerSecret,
        },
        body: JSON.stringify({ jobId, prompt }),
        signal: AbortSignal.timeout(10_000),
    }).catch(error => {
        console.error('[Briefing/Submit] Worker request failed:', error);
    });

    return { status: 'submitted', jobId };
}
