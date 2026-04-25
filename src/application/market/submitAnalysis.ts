import { buildAnalysisPrompt } from '@/domain/analysis/prompt';
import { lastNonNull } from '@/domain/indicators/utils';
import type {
    AnalysisResponse,
    Skill,
    SubmitAnalysisResult,
    Timeframe,
} from '@/domain/types';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import { buildAnalysisCacheKey } from '@/infrastructure/cache/config';
import { fetchBarsWithIndicators } from '@/application/market/barsApi';
import { readWorkerConfig } from '@/infrastructure/market/config';
import { setJobMeta } from '@/infrastructure/jobs/queue';
import { FileSkillsLoader } from '@/infrastructure/skills/loader';

export async function submitAnalysis(
    symbol: string,
    timeframe: Timeframe,
    force: boolean = false,
    fmpSymbol?: string
): Promise<SubmitAnalysisResult> {
    const { workerUrl, workerSecret } = readWorkerConfig();

    const cache = createCacheProvider();
    const cacheKey = buildAnalysisCacheKey(symbol, timeframe);

    if (!force && cache !== null) {
        try {
            const cached = await cache.get<AnalysisResponse>(cacheKey);
            if (cached !== null) {
                return { status: 'cached', result: cached };
            }
        } catch (error) {
            console.error('[Submit] Cache read failed:', error);
        }
    }

    const { bars, indicators } = await fetchBarsWithIndicators(
        symbol,
        timeframe,
        fmpSymbol
    );

    const skillsLoader = new FileSkillsLoader();
    let skillsDegraded = false;
    const skills = await skillsLoader.loadSkills().catch(error => {
        console.error(
            '[Submit] Skills loading failed, proceeding without skills:',
            error
        );
        skillsDegraded = true;
        return [] as Skill[];
    });

    const prompt = buildAnalysisPrompt(
        symbol,
        bars,
        indicators,
        skills,
        timeframe
    );

    const jobId = crypto.randomUUID();
    const lastClose = bars[bars.length - 1]?.close;
    const atr = lastNonNull(indicators.atr) ?? undefined;
    await setJobMeta(jobId, {
        symbol,
        timeframe,
        skillsDegraded,
        lastClose,
        atr,
    });

    // fire-and-forget: 에러는 무시하고 caller에게 jobId만 반환한다.
    fetch(`${workerUrl}/analyze`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Worker-Secret': workerSecret,
        },
        body: JSON.stringify({ jobId, prompt }),
        signal: AbortSignal.timeout(300_000),
    }).catch(error => {
        console.error('[Submit] Worker request failed:', error);
    });

    return { status: 'submitted', jobId };
}
