import { enrichAnalysisWithConfidence } from '@/domain/analysis/confidence';
import { postProcessAnalysisWithReconcile } from '@/domain/analysis/ai-levels';
import type {
    PollAnalysisResult,
    RawAnalysisResponse,
    Skill,
} from '@/domain/types';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import {
    buildAnalysisCacheKey,
    computeEffectiveTtl,
} from '@/infrastructure/cache/config';
import {
    cleanupJob,
    getJobError,
    getJobMeta,
    getJobResult,
    getJobStatus,
} from '@/infrastructure/jobs/queue';
import { FileSkillsLoader } from '@/infrastructure/skills/loader';

export async function pollAnalysis(jobId: string): Promise<PollAnalysisResult> {
    const status = await getJobStatus(jobId);

    if (status === null || status === 'processing') {
        return { status: 'processing' };
    }

    if (status === 'error') {
        const error = await getJobError(jobId);
        cleanupJob(jobId).catch(e =>
            console.warn('[Poll] cleanupJob failed:', e)
        );
        return { status: 'error', error: error ?? 'Unknown error' };
    }

    // status === 'done'
    const [rawResult, meta] = await Promise.all([
        getJobResult(jobId),
        getJobMeta(jobId),
    ]);

    if (!rawResult) {
        console.error('[Poll] Result not found', {
            jobId,
            rawResultType: typeof rawResult,
            rawResultValue: rawResult,
            hasMeta: meta !== null,
            symbol: meta?.symbol,
            timeframe: meta?.timeframe,
        });
        cleanupJob(jobId).catch(e =>
            console.warn('[Poll] cleanupJob failed:', e)
        );
        return { status: 'error', error: 'Result not found' };
    }

    // submitAnalysis가 JSON.stringify(RawAnalysisResponse)로 저장하고
    // getJobResult가 JSON.parse 후 반환하므로, 구조가 RawAnalysisResponse와 일치한다고 보장된다.
    const parsed = rawResult as RawAnalysisResponse;
    if (!parsed.summary || !parsed.trend || !parsed.riskLevel) {
        cleanupJob(jobId).catch(e =>
            console.warn('[Poll] cleanupJob failed:', e)
        );
        return { status: 'error', error: 'Invalid response from worker' };
    }

    const skillsLoader = new FileSkillsLoader();
    let skills: Skill[] = [];
    try {
        skills = await skillsLoader.loadSkills();
    } catch (error) {
        console.error(
            '[Poll] Skills loading failed, proceeding without skills:',
            error
        );
    }
    const skillsDegraded = meta?.skillsDegraded ?? false;

    const enriched = enrichAnalysisWithConfidence(parsed, skills);

    const reconciled = postProcessAnalysisWithReconcile(
        enriched,
        meta?.lastClose,
        meta?.atr
    );

    const now = new Date();
    const analyzedAt = now.toISOString();
    const result = { ...reconciled, analyzedAt };

    if (meta) {
        const cache = createCacheProvider();
        if (cache !== null) {
            const cacheKey = buildAnalysisCacheKey(meta.symbol, meta.timeframe);
            const ttl = computeEffectiveTtl(meta.timeframe, now);
            cache
                .set(cacheKey, { ...result, skillsDegraded }, ttl)
                .catch(error =>
                    console.error('[Poll] Cache write failed:', error)
                );
        }
    }

    cleanupJob(jobId).catch(e => console.warn('[Poll] cleanupJob failed:', e));

    return { status: 'done', result };
}
