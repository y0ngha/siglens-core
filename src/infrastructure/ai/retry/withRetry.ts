/** useAnalysis.ts가 이 문자열로 매칭하여 사용자 안내 메시지를 표시하는 5xx 소진 센티넬 코드. */
export const AI_SERVER_UNSTABLE_CODE = 'AI_SERVER_UNSTABLE';

/**
 * Provider별 retry 모듈이 공유하는 정책 상수.
 * 변경 시 모든 provider(Claude/Gemini/ChatGPT)의 동작이 함께 바뀐다.
 */
export const AI_RETRY_MAX_ATTEMPTS = 5;
export const AI_RETRY_DELAY_MS = 5000;

/**
 * Provider 모듈이 throw하는 sentinel error에 해당 code가 붙어있는지 검사한다.
 * Claude의 `CLAUDE_MAX_TOKENS`, Gemini의 `GEMINI_MAX_TOKENS` 모두 동일 패턴을 공유한다.
 */
export function hasErrorCode(error: unknown, code: string): boolean {
    return (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        // 'code' in error 가드로 좁혀졌지만 TS가 { code: unknown }으로 완전 추론하지 못해 캐스트
        (error as { code: unknown }).code === code
    );
}

export type ErrorKind = 'rate_limit' | 'server_error' | 'retryable' | 'none';

const RETRY_ALLOWABLE_TIME_MS = 300_000;

export function classifyError(error: unknown): ErrorKind {
    if (typeof error !== 'object' || error === null) return 'none';

    if (
        'status' in error &&
        typeof (error as { status: unknown }).status === 'number'
    ) {
        const status = (error as { status: number }).status;
        if (status === 429) return 'rate_limit';
        if (status >= 500) return 'server_error';
        return 'none';
    }

    if (
        'retryable' in error &&
        (error as { retryable: unknown }).retryable === true
    ) {
        return 'retryable';
    }

    return 'none';
}

const GRPC_RETRY_INFO_TYPE =
    'type.googleapis.com/google.rpc.RetryInfo' as const;

interface GrpcRetryInfo {
    '@type': typeof GRPC_RETRY_INFO_TYPE;
    retryDelay: string; // e.g. "15s", "58s"
}

function isRetryInfo(detail: unknown): detail is GrpcRetryInfo {
    return (
        typeof detail === 'object' &&
        detail !== null &&
        (detail as Record<string, unknown>)['@type'] === GRPC_RETRY_INFO_TYPE &&
        typeof (detail as Record<string, unknown>)['retryDelay'] === 'string'
    );
}

// Gemini SDK ApiError: message가 JSON 문자열이고 details는 그 안에 포함됨
//   → error.message = '{"error":{"details":[{RetryInfo}]}}'
// Anthropic SDK RateLimitError: error.retryDelay — 숫자(ms)
export function get429RetryDelay(error: unknown): number | undefined {
    if (typeof error !== 'object' || error === null) return undefined;

    // Anthropic SDK — retryDelay(ms) 숫자
    const direct = (error as Record<string, unknown>)['retryDelay'];
    if (typeof direct === 'number') return direct;

    // Gemini SDK — message JSON 파싱 후 details 탐색
    const message = (error as Record<string, unknown>)['message'];
    if (typeof message !== 'string') return undefined;

    let details: unknown;
    try {
        const parsed = JSON.parse(message) as Record<string, unknown>;
        const inner = parsed['error'];
        if (typeof inner === 'object' && inner !== null) {
            details = (inner as Record<string, unknown>)['details'];
        }
    } catch {
        return undefined;
    }

    if (!Array.isArray(details)) return undefined;

    const retryInfo = details.find(isRetryInfo);
    if (!retryInfo) return undefined;

    // "15s" → 15000, "58.4s" → 58400
    const match = retryInfo.retryDelay.match(/^(\d+(?:\.\d+)?)s$/);
    if (!match) return undefined;
    return Math.ceil(parseFloat(match[1]) * 1000);
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 재시도 루프 전체의 wall-clock 예산. `abortIfCumulativeDelayReachesMs`가 **sleep 시간만**
 * 세는 것과 달리 이 예산은 `fn()` 실행시간까지 포함한다.
 *
 * 왜 둘 다 필요한가 — 느린 실패 사례:
 * 큰 프롬프트에서 호출이 **수백 초** 만에 실패했는데,
 * 그 시점 `cumulativeDelay`는 0이라 delay cap(30초)을 통과해 재시도가 시작됐다.
 * 호출자(SSE 라우트)의 마감을 넘겨 두 번째 시도는 완주할 수 없었고,
 * 대기 중이던 요청 여러 건이 한꺼번에 타임아웃으로 실패했다(core `dedupeInFlight`가
 * 같은 캐시 키를 한 promise로 묶기 때문). 즉 **sleep 예산만으로는 느린 실패를 못 막는다.**
 *
 * 다음 시도의 소요시간은 직전 시도의 소요시간으로 추정한다 — 같은 프로바이더에
 * 같은 프롬프트를 다시 보내므로 가장 가까운 근거다. 추정이 예산을 넘기면
 * 재시도를 아예 시작하지 않는다: 수백 초를 태우고 죽은 호출은 "일시적 blip"이 아니라
 * degrade된 프로바이더이고, 재시도해 봐야 비용과 사용자 대기만 두 배가 된다.
 *
 * 값(240초)은 **재시도가 정당한 최대 구간**이다 — 호출자 마감을 그대로 따라가지 않는다.
 * 마감이 길어지면(예: 5분 → 10분) 그 여유는 "느린 첫 시도 하나를 완주시키는" 데 쓰여야지
 * "수백 초짜리 실패를 한 번 더 반복하는" 데 쓰일 것이 아니다. 따라서 마감을 늘려도 이 값은
 * 그대로 두는 것이 기본이며, 특정 호출이 더 넉넉한 재시도를 정당화한다면 그 호출만
 * `wallClockBudgetMs`로 개별 지정한다.
 */
export const RETRY_WALL_CLOCK_BUDGET_MS = 240_000;

/**
 * 두 가지 예산 중 하나라도 초과가 예상되면 루프를 중단하고 AI_SERVER_UNSTABLE_CODE를 throw한다:
 * `abortIfCumulativeDelayReachesMs`(누적 sleep) / `wallClockBudgetMs`(fn 실행시간 포함 총 경과).
 */
export async function withRetry<T>(
    fn: () => Promise<T>,
    options: {
        maxAttempts: number;
        baseDelayMs: number;
        abortIfCumulativeDelayReachesMs?: number;
        wallClockBudgetMs?: number;
    }
): Promise<T> {
    const {
        maxAttempts,
        baseDelayMs,
        abortIfCumulativeDelayReachesMs,
        wallClockBudgetMs,
    } = options;
    const delayLimit =
        abortIfCumulativeDelayReachesMs ?? RETRY_ALLOWABLE_TIME_MS;
    const wallClockLimit = wallClockBudgetMs ?? RETRY_WALL_CLOCK_BUDGET_MS;
    const startedAt = Date.now();
    let cumulativeDelay = 0;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const attemptStartedAt = Date.now();
        try {
            return await fn();
        } catch (error) {
            const attemptMs = Date.now() - attemptStartedAt;
            const kind = classifyError(error);

            if (kind === 'none' || attempt === maxAttempts) {
                if (kind !== 'none') {
                    throw new Error(AI_SERVER_UNSTABLE_CODE);
                }
                throw error;
            }

            const delay =
                kind === 'rate_limit'
                    ? (get429RetryDelay(error) ?? baseDelayMs)
                    : baseDelayMs * Math.pow(2, attempt - 1);

            if (cumulativeDelay + delay >= delayLimit) {
                console.warn(
                    `[Retry] Cumulative retry delay (${cumulativeDelay + delay}ms) would exceed limit (${delayLimit}ms). Aborting retries.`
                );
                break;
            }

            // 다음 시도가 직전 시도만큼 걸린다고 보고, 그 완주분까지 예산 안에 들어오는지 본다.
            const elapsed = Date.now() - startedAt;
            if (elapsed + delay + attemptMs >= wallClockLimit) {
                console.warn(
                    `[Retry] Wall-clock budget would be exceeded (elapsed ${elapsed}ms + delay ${delay}ms + last attempt ${attemptMs}ms >= ${wallClockLimit}ms). Aborting retries.`
                );
                break;
            }

            const label = kind === 'rate_limit' ? '429' : '5xx';
            console.warn(
                `[Retry] Attempt ${attempt}/${maxAttempts} failed (${label}). Retrying in ${delay}ms...`,
                error
            );
            cumulativeDelay += delay;
            await sleep(delay);
        }
    }
    // 두 예산(누적 delay / wall-clock) 중 하나를 초과해 break된 경우에만 도달
    throw new Error(AI_SERVER_UNSTABLE_CODE);
}
