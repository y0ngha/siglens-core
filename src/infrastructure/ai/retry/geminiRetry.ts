import {
    DISABLED_THINKING_BUDGET,
    MODEL_SPECS,
    getThinkingBudgetSequence,
} from '@/domain/analysis/modelSpecs';
import {
    callGemini,
    MAX_TOKENS_CODE,
} from '@/infrastructure/ai/providers/gemini';
import type { GeminiModelId } from '@/domain/analysis/modelSpecs';
import {
    AI_RETRY_DELAY_MS,
    AI_RETRY_MAX_ATTEMPTS,
    hasErrorCode,
    withRetry,
} from '@/infrastructure/ai/retry/withRetry';

/**
 * Mutable budget reference — withRetry 체인에서 감소된 budget을 보존한다.
 * 매 시도마다 `current`가 다음 budget으로 갱신된다.
 */
type BudgetRef = { current: number };

// MAX_TOKENS 발생 시 thinking budget을 단계적으로 줄이며 같은 요청을 이어서 재시도한다.
// budgetRef.current는 매 시도마다 업데이트되어 5xx 재시도 시 감소된 budget에서 재개한다
export async function callGeminiReducingBudget(
    prompt: string,
    model: GeminiModelId,
    apiKey: string,
    signal: AbortSignal | undefined,
    budgetRef: BudgetRef,
    system?: string,
    responseSchema?: unknown,
    seed?: number,
    jobId?: string
): Promise<string> {
    const budgets = getThinkingBudgetSequence(budgetRef.current);
    const budgetCount = budgets.length;

    for (let i = 0; i < budgetCount; i++) {
        const budget = budgets[i];
        budgetRef.current = budget;
        try {
            return await callGemini(prompt, {
                apiKey,
                model,
                thinking: budget > DISABLED_THINKING_BUDGET,
                thinkingBudget: budget,
                seed,
                signal,
                system,
                responseSchema,
                jobId,
            });
        } catch (error) {
            if (hasErrorCode(error, MAX_TOKENS_CODE)) {
                const next = budgets[i + 1];
                if (next !== undefined) {
                    console.warn(
                        `[Worker] Gemini MAX_TOKENS (thinkingBudget=${budget}). Retrying with budget=${next}.`
                    );
                    continue;
                }
                // thinking off(budget=0)에서도 MAX_TOKENS → 응답 자체가 너무 긴 경우
                console.error(
                    '[Worker] Gemini MAX_TOKENS even with thinking disabled. Response is too long.'
                );
                throw error;
            }

            // 429/5xx 등 일시적 에러 → 외부 withRetry로 전파
            // budgetRef.current는 이미 현재 budget으로 설정되어 있음
            throw error;
        }
    }

    // getThinkingBudgetSequence() always ends with DISABLED_THINKING_BUDGET, so the loop exits by return/throw.
    /* istanbul ignore next */
    throw new Error('All thinking budget steps exhausted');
}

export interface GeminiWithRetryOptions {
    maxAttempts?: number;
    signal?: AbortSignal;
    abortIfCumulativeDelayReachesMs?: number;
    /** 미지정 시 `MODEL_SPECS[model].thinkingBudget`로 초기화된 새 참조가 생성됨 */
    budgetRef?: BudgetRef;
    system?: string;
    responseSchema?: unknown;
    /** core가 디스패치하는 deterministic seed. 미지정 시 seed 미설정. */
    seed?: number;
    jobId?: string;
}

export async function callGeminiWithRetry(
    prompt: string,
    model: GeminiModelId,
    apiKey: string,
    options: GeminiWithRetryOptions = {}
): Promise<string> {
    const {
        maxAttempts = AI_RETRY_MAX_ATTEMPTS,
        signal,
        abortIfCumulativeDelayReachesMs,
        budgetRef = { current: MODEL_SPECS[model].thinkingBudget },
        system,
        responseSchema,
        seed,
        jobId,
    } = options;
    return withRetry(
        () =>
            callGeminiReducingBudget(
                prompt,
                model,
                apiKey,
                signal,
                budgetRef,
                system,
                responseSchema,
                seed,
                jobId
            ),
        {
            maxAttempts,
            baseDelayMs: AI_RETRY_DELAY_MS,
            abortIfCumulativeDelayReachesMs,
        }
    );
}
