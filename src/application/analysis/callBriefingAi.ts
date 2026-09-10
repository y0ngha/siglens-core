import { resolveBriefingModel } from '@/application/analysis/briefingModel';
import type { CallBriefingAiOptions } from '@/application/analysis/types';
import { MODEL_SPECS } from '@/domain/analysis/modelSpecs';
import type {
    DeepSeekModelId,
    GeminiModelId,
} from '@/domain/analysis/modelSpecs';
import { getProviderForModel } from '@/domain/llm/providers';
import { callDeepSeekWithRetry } from '@/infrastructure/ai/retry/deepseekRetry';
import { callGeminiWithRetry } from '@/infrastructure/ai/retry/geminiRetry';
import { resolveServerApiKey } from '@/infrastructure/ai/serverKeys';

/** 비용/CPU 안전 상한 — briefing은 분석보다 더 짧은 10s로 제한한다. */
const BRIEFING_MAX_RETRY_DELAY_MS = 10_000;

/**
 * 브리핑용 AI 호출.
 *
 * 브리핑은 tier/BYOK 개념 없이 항상 provider의 서버 키를 쓴다 — 분석의
 * `shouldUseServerKey`/`requiresUserApiKey`와는 별개의 단순한 provider 분기다.
 * (`callAnalysisAi`를 재사용하면 tier가 undefined일 때 non-free 모델이 BYOK 경로를
 * 타서 브리핑이 깨진다 — 예: gemini-3.1-pro-preview override.)
 *
 * `resolveBriefingModel`이 `BriefingModelId`(gemini | deepseek)로 좁혀 주므로 아래
 * 분기는 exhaustive다 — "지원하지 않는 provider" 런타임 가드가 필요 없다. 새 provider를
 * 브리핑에 추가하려면 `BriefingModelId`를 넓히는 순간 여기서 타입 에러가 난다.
 */
export async function callBriefingAi(
    options: CallBriefingAiOptions
): Promise<string> {
    const { prompt, requestedModel, fallbackModel, signal, correlationId } =
        options;

    const model = resolveBriefingModel(requestedModel, fallbackModel);
    const apiKey = resolveServerApiKey(getProviderForModel(model));

    if (MODEL_SPECS[model].provider === 'deepseek') {
        return callDeepSeekWithRetry(prompt, model as DeepSeekModelId, apiKey, {
            signal,
            abortIfCumulativeDelayReachesMs: BRIEFING_MAX_RETRY_DELAY_MS,
            jobId: correlationId,
        });
    }
    return callGeminiWithRetry(prompt, model as GeminiModelId, apiKey, {
        signal,
        abortIfCumulativeDelayReachesMs: BRIEFING_MAX_RETRY_DELAY_MS,
        jobId: correlationId,
    });
}
