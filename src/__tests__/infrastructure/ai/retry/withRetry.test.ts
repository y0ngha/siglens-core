import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    AI_RETRY_DELAY_MS,
    AI_SERVER_UNSTABLE_CODE,
    classifyError,
    get429RetryDelay,
    hasErrorCode,
    withRetry,
} from '@/infrastructure/ai/retry/withRetry';

// 이 스위트는 retry.ts의 실제 구현을 검증한다.
// provider별 *-retry.test.ts는 withRetry를 mock하므로 엔진 자체는 여기서만 커버된다.
// (절대 vi.mock('@/infrastructure/ai/retry/withRetry') 하지 않는다.)

const GRPC_RETRY_INFO_TYPE = 'type.googleapis.com/google.rpc.RetryInfo';

/** Gemini SDK ApiError 형태 — message가 JSON 문자열이고 RetryInfo가 details 배열에 들어있다. */
function geminiRetryError(retryDelay: string): Error {
    return Object.assign(new Error(), {
        message: JSON.stringify({
            error: {
                details: [
                    {
                        '@type': GRPC_RETRY_INFO_TYPE,
                        retryDelay,
                    },
                ],
            },
        }),
        status: 429,
    });
}

describe('classifyError', () => {
    it('classifies HTTP 429 as rate_limit', () => {
        expect(classifyError({ status: 429 })).toBe('rate_limit');
    });

    it('classifies HTTP 500 and 503 as server_error', () => {
        expect(classifyError({ status: 500 })).toBe('server_error');
        expect(classifyError({ status: 503 })).toBe('server_error');
    });

    it('classifies HTTP 400 as none (non-retryable)', () => {
        expect(classifyError({ status: 400 })).toBe('none');
    });

    it('classifies an object with { retryable: true } as retryable', () => {
        expect(classifyError({ retryable: true })).toBe('retryable');
    });

    it('classifies retryable: false (without status) as none', () => {
        expect(classifyError({ retryable: false })).toBe('none');
    });

    it('classifies a primitive / non-object as none', () => {
        expect(classifyError(null)).toBe('none');
        expect(classifyError(undefined)).toBe('none');
        expect(classifyError('boom')).toBe('none');
        expect(classifyError(42)).toBe('none');
    });

    it('prioritizes numeric status over retryable when both present', () => {
        // status가 숫자면 status 분기에서 즉시 반환되므로 retryable은 무시된다.
        expect(classifyError({ status: 400, retryable: true })).toBe('none');
    });

    it('ignores a non-numeric status and falls through to retryable check', () => {
        expect(classifyError({ status: 'oops', retryable: true })).toBe(
            'retryable'
        );
    });
});

describe('get429RetryDelay', () => {
    it('reads the Anthropic-style numeric retryDelay (ms)', () => {
        expect(get429RetryDelay({ retryDelay: 12000 })).toBe(12000);
    });

    it('parses Gemini-style nested RetryInfo "15s" → 15000ms', () => {
        expect(get429RetryDelay(geminiRetryError('15s'))).toBe(15000);
    });

    it('parses fractional Gemini RetryInfo "58.4s" → 58400ms', () => {
        expect(get429RetryDelay(geminiRetryError('58.4s'))).toBe(58400);
    });

    it('returns undefined for a non-object / primitive error', () => {
        expect(get429RetryDelay(null)).toBeUndefined();
        expect(get429RetryDelay('boom')).toBeUndefined();
        expect(get429RetryDelay(123)).toBeUndefined();
    });

    it('returns undefined when no retryDelay / message is present', () => {
        expect(get429RetryDelay({ status: 429 })).toBeUndefined();
    });

    it('returns undefined when message is not valid JSON', () => {
        expect(
            get429RetryDelay({ message: 'not json at all' })
        ).toBeUndefined();
    });

    it('returns undefined when details is absent or not an array', () => {
        expect(
            get429RetryDelay({ message: JSON.stringify({ error: {} }) })
        ).toBeUndefined();
        expect(
            get429RetryDelay({
                message: JSON.stringify({ error: { details: 'nope' } }),
            })
        ).toBeUndefined();
    });

    it('returns undefined when no detail matches RetryInfo @type', () => {
        expect(
            get429RetryDelay({
                message: JSON.stringify({
                    error: {
                        details: [
                            { '@type': 'something.else', retryDelay: '5s' },
                        ],
                    },
                }),
            })
        ).toBeUndefined();
    });

    it('returns undefined for a malformed retryDelay format (missing "s")', () => {
        expect(get429RetryDelay(geminiRetryError('15'))).toBeUndefined();
    });
});

describe('hasErrorCode', () => {
    it('returns true when the error carries the matching code', () => {
        expect(
            hasErrorCode({ code: 'GEMINI_MAX_TOKENS' }, 'GEMINI_MAX_TOKENS')
        ).toBe(true);
    });

    it('returns false for a mismatching code or non-object', () => {
        expect(hasErrorCode({ code: 'OTHER' }, 'GEMINI_MAX_TOKENS')).toBe(
            false
        );
        expect(hasErrorCode(null, 'GEMINI_MAX_TOKENS')).toBe(false);
        expect(hasErrorCode('boom', 'GEMINI_MAX_TOKENS')).toBe(false);
    });
});

describe('withRetry', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.runOnlyPendingTimers();
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    /**
     * fake timer 환경에서 backoff를 통과시킨다.
     * advanceTimersByTimeAsync는 타이머 콜백 사이마다 microtask를 flush하므로,
     * withRetry가 await로 쌓는 체인(catch → sleep → 다음 attempt)을 끝까지 구동한다.
     * 누적 backoff(최대 수십 초)를 충분히 덮는 큰 값을 진행시킨다.
     */
    async function flushRetries<T>(
        promise: Promise<T>
    ): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
        const settled = promise.then(
            value => ({ ok: true as const, value }),
            error => ({ ok: false as const, error })
        );
        // 매 반복마다 타이머를 진행시키고 microtask를 flush한다.
        // 다음 backoff 타이머가 등록될 때까지 반복하다 모든 타이머가 비면 종료한다.
        for (let i = 0; i < 50; i++) {
            await vi.advanceTimersByTimeAsync(600_000);
            if (vi.getTimerCount() === 0) break;
        }
        return settled;
    }

    it('returns immediately on a successful call (no timers scheduled)', async () => {
        const fn = vi.fn<() => Promise<string>>().mockResolvedValue('ok');

        const result = await withRetry(fn, {
            maxAttempts: 5,
            baseDelayMs: AI_RETRY_DELAY_MS,
        });

        expect(result).toBe('ok');
        expect(fn).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('succeeds after N transient (5xx) failures', async () => {
        const fn = vi
            .fn<() => Promise<string>>()
            .mockRejectedValueOnce({ status: 503 })
            .mockRejectedValueOnce({ status: 500 })
            .mockResolvedValue('recovered');

        const settled = await flushRetries(
            withRetry(fn, { maxAttempts: 5, baseDelayMs: 1000 })
        );

        expect(settled.ok).toBe(true);
        if (settled.ok) expect(settled.value).toBe('recovered');
        expect(fn).toHaveBeenCalledTimes(3);
    });

    it('applies exponential backoff baseDelayMs * 2^(attempt-1) for 5xx', async () => {
        const setTimeoutSpy = vi.spyOn(global, 'setTimeout');
        const fn = vi
            .fn<() => Promise<string>>()
            .mockRejectedValueOnce({ status: 500 }) // attempt 1 → delay 1000 * 2^0 = 1000
            .mockRejectedValueOnce({ status: 500 }) // attempt 2 → delay 1000 * 2^1 = 2000
            .mockResolvedValue('done');

        await flushRetries(
            withRetry(fn, { maxAttempts: 5, baseDelayMs: 1000 })
        );

        const delays = setTimeoutSpy.mock.calls.map(call => call[1]);
        expect(delays).toEqual([1000, 2000]);
    });

    it('honors a parsed 429 retry delay instead of exponential backoff', async () => {
        const setTimeoutSpy = vi.spyOn(global, 'setTimeout');
        const rateLimited = Object.assign(new Error('rate limited'), {
            status: 429,
            retryDelay: 7000,
        });
        const fn = vi
            .fn<() => Promise<string>>()
            .mockRejectedValueOnce(rateLimited)
            .mockResolvedValue('done');

        await flushRetries(
            withRetry(fn, { maxAttempts: 5, baseDelayMs: 1000 })
        );

        const delays = setTimeoutSpy.mock.calls.map(call => call[1]);
        expect(delays).toEqual([7000]);
    });

    it('falls back to baseDelayMs for a 429 with no parseable delay', async () => {
        const setTimeoutSpy = vi.spyOn(global, 'setTimeout');
        const fn = vi
            .fn<() => Promise<string>>()
            .mockRejectedValueOnce({ status: 429 })
            .mockResolvedValue('done');

        await flushRetries(
            withRetry(fn, { maxAttempts: 5, baseDelayMs: 3000 })
        );

        const delays = setTimeoutSpy.mock.calls.map(call => call[1]);
        expect(delays).toEqual([3000]);
    });

    it('rethrows a "none"-kind error immediately without retrying', async () => {
        const nonRetryable = Object.assign(new Error('bad request'), {
            status: 400,
        });
        const fn = vi
            .fn<() => Promise<string>>()
            .mockRejectedValue(nonRetryable);

        await expect(
            withRetry(fn, { maxAttempts: 5, baseDelayMs: 1000 })
        ).rejects.toBe(nonRetryable);
        expect(fn).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('throws AI_SERVER_UNSTABLE_CODE when maxAttempts is exhausted on a retryable error', async () => {
        const fn = vi
            .fn<() => Promise<string>>()
            .mockRejectedValue({ status: 503 });

        const settled = await flushRetries(
            withRetry(fn, { maxAttempts: 3, baseDelayMs: 1000 })
        );

        expect(settled.ok).toBe(false);
        if (!settled.ok)
            expect((settled.error as Error).message).toBe(
                AI_SERVER_UNSTABLE_CODE
            );
        // maxAttempts 회 모두 호출된다.
        expect(fn).toHaveBeenCalledTimes(3);
    });

    it('throws AI_SERVER_UNSTABLE_CODE when cumulative delay would exceed the abort limit', async () => {
        const fn = vi
            .fn<() => Promise<string>>()
            .mockRejectedValue({ status: 503 });

        const settled = await flushRetries(
            withRetry(fn, {
                maxAttempts: 10,
                baseDelayMs: 1000,
                // 첫 시도 backoff(1000) 이후 두 번째 backoff(2000)에서 누적 3000 ≥ 1500 → 중단.
                abortIfCumulativeDelayReachesMs: 1500,
            })
        );

        expect(settled.ok).toBe(false);
        if (!settled.ok)
            expect((settled.error as Error).message).toBe(
                AI_SERVER_UNSTABLE_CODE
            );
        // 첫 backoff(1000)만 sleep, 두 번째에서 한도 초과로 break → fn은 2회 호출.
        expect(fn).toHaveBeenCalledTimes(2);
    });

    /**
     * wall-clock 예산 가드.
     *
     * `abortIfCumulativeDelayReachesMs`는 **sleep 시간만** 세므로 느린 실패를 못 막는다.
     * 2026-08-09 프로덕션에서 `deepseek-v4-pro`가 248.5초 만에 실패했는데 그 시점
     * 누적 delay는 0이라 delay cap(30s)을 통과해 재시도가 시작됐고, 호출자 마감(300초)을
     * 넘겨 대기 중이던 4건이 한꺼번에 실패했다.
     */
    /** 지정한 시간만큼 fake time을 태우고 5xx로 죽는 호출. */
    function slowFailure(durationMs: number): () => Promise<string> {
        return async () => {
            await new Promise(resolve => setTimeout(resolve, durationMs));
            throw Object.assign(new Error('5xx'), { status: 503 });
        };
    }

    it('does not start a retry when the previous attempt was slow enough to blow the budget', async () => {
        // 250초 소요 후 실패 — 위 실측 재현. 기본 예산(240s)을 이미 넘겼다.
        const fn = vi
            .fn<() => Promise<string>>()
            .mockImplementation(slowFailure(250_000));

        const settled = await flushRetries(
            withRetry(fn, { maxAttempts: 5, baseDelayMs: AI_RETRY_DELAY_MS })
        );

        expect(settled.ok).toBe(false);
        if (!settled.ok)
            expect((settled.error as Error).message).toBe(
                AI_SERVER_UNSTABLE_CODE
            );
        // 재시도를 시작조차 하지 않는다.
        expect(fn).toHaveBeenCalledTimes(1);
        // 누적 delay cap이 아니라 wall-clock 예산에서 끊겼음을 확인한다.
        expect(console.warn).toHaveBeenCalledWith(
            expect.stringContaining('Wall-clock budget would be exceeded')
        );
    });

    it('still retries fast failures — the budget only blocks slow ones', async () => {
        const fn = vi
            .fn<() => Promise<string>>()
            .mockRejectedValueOnce({ status: 503 })
            .mockResolvedValue('recovered');

        const settled = await flushRetries(
            withRetry(fn, { maxAttempts: 5, baseDelayMs: AI_RETRY_DELAY_MS })
        );

        expect(settled.ok).toBe(true);
        if (settled.ok) expect(settled.value).toBe('recovered');
        expect(fn).toHaveBeenCalledTimes(2);
    });

    it('aborts once repeated mid-length attempts accumulate past the budget', async () => {
        // 60초짜리 실패는 개별로는 예산 안이지만, 반복되면 누적으로 넘긴다.
        // 시도 4회(60s×4) + backoff(5+10+20) 후 다음 시도분까지 더하면 375s ≥ 300s.
        const fn = vi
            .fn<() => Promise<string>>()
            .mockImplementation(slowFailure(60_000));

        const settled = await flushRetries(
            withRetry(fn, {
                maxAttempts: 5,
                baseDelayMs: AI_RETRY_DELAY_MS,
                wallClockBudgetMs: 300_000,
            })
        );

        expect(settled.ok).toBe(false);
        // maxAttempts(5)에 도달하기 전에 예산에서 끊긴다.
        expect(fn).toHaveBeenCalledTimes(4);
    });

    it('honors an explicit wallClockBudgetMs over the default', async () => {
        // 기본값(240s)이면 1회로 끝날 250초 실패를, 600s 예산에서는 한 번 더 시도한다.
        const fn = vi
            .fn<() => Promise<string>>()
            .mockImplementation(slowFailure(250_000));

        const settled = await flushRetries(
            withRetry(fn, {
                maxAttempts: 5,
                baseDelayMs: AI_RETRY_DELAY_MS,
                wallClockBudgetMs: 600_000,
            })
        );

        expect(settled.ok).toBe(false);
        expect(fn).toHaveBeenCalledTimes(2);
    });
});

/**
 * W1 회귀 가드: withRetry의 abortIfCumulativeDelayReachesMs(누적 재시도 지연 상한)가
 * 실제로 재시도를 조기 중단시키는지 검증한다.
 *
 * 4562cc2("gemini free key 삭제")가 이 cap을 호출부에서 끊어버리면서, 분석/브리핑 경로가
 * default RETRY_ALLOWABLE_TIME_MS(=5분)로 회귀했다. 이 테스트는 cap이 주어지면 5xx storm이
 * 5분이 아니라 cap 안에서 멈추는 것을 보장한다.
 */
describe('withRetry — cumulative-delay cap (W1)', () => {
    function serverError(): Error & { status: number } {
        return Object.assign(new Error('5xx'), { status: 503 });
    }

    it('aborts retries once cumulative delay would reach the cap (10s)', async () => {
        vi.useFakeTimers();
        try {
            // 5xx를 항상 던지는 fn. baseDelayMs=5000 → 백오프: 5000, 10000, ...
            // 1번째 실패 후 delay=5000(누적 5000 < 10000) → sleep
            // 2번째 실패 후 delay=10000(누적 5000+10000=15000 >= 10000) → break/abort
            const fn = vi.fn(async () => {
                throw serverError();
            });

            const promise = withRetry(fn, {
                maxAttempts: 5,
                baseDelayMs: 5000,
                abortIfCumulativeDelayReachesMs: 10_000,
            });
            // unhandled rejection 경고 방지용 핸들러
            const assertion = expect(promise).rejects.toThrow(
                AI_SERVER_UNSTABLE_CODE
            );

            // 첫 백오프(5000ms) 통과시켜 두 번째 시도까지 진행
            await vi.advanceTimersByTimeAsync(5000);
            await assertion;

            // maxAttempts(5)를 모두 쓰지 않고 cap에서 멈췄어야 한다.
            // 시도 1, 2만 발생 (2번째 실패 후 누적 지연이 cap을 넘어 abort).
            expect(fn).toHaveBeenCalledTimes(2);
        } finally {
            vi.useRealTimers();
        }
    });

    it('without a cap, keeps retrying up to maxAttempts (no early abort)', async () => {
        vi.useFakeTimers();
        try {
            const fn = vi.fn(async () => {
                throw serverError();
            });

            const promise = withRetry(fn, {
                maxAttempts: 3,
                baseDelayMs: 1000,
                // cap 미지정 → default 5분 상한이므로 maxAttempts까지 소진된다.
            });
            const assertion = expect(promise).rejects.toThrow(
                AI_SERVER_UNSTABLE_CODE
            );

            // 두 번의 백오프(1000ms, 2000ms)를 통과시켜 3번째 시도까지 진행
            await vi.advanceTimersByTimeAsync(1000);
            await vi.advanceTimersByTimeAsync(2000);
            await assertion;

            expect(fn).toHaveBeenCalledTimes(3);
        } finally {
            vi.useRealTimers();
        }
    });

    /**
     * W1의 핵심 비용 시나리오: 429 + provider가 지정한 큰 retryDelay가 cap과 충돌하는 경우.
     * get429RetryDelay는 provider별 retryDelay를 추출하는데(아래 두 형태), 그 값이 cap을
     * 넘으면 withRetry는 retryDelay를 통째로 기다리거나 maxAttempts까지 도는 대신 cap에서
     * 즉시 중단해야 한다. 이게 깨지면 단일 429가 분석 경로를 58초(또는 그 이상) 묶어둔다.
     *
     *   - Gemini gRPC RetryInfo: error.message = JSON, details에 retryDelay "58s"
     *   - Anthropic RateLimitError: error.retryDelay = 숫자(ms)
     */
    describe('429 path — provider retryDelay vs cap', () => {
        function geminiRateLimit(retryDelaySeconds: string): Error & {
            status: number;
        } {
            // gemini-retry.ts의 get429RetryDelay가 파싱하는 실제 SDK 형태를 모사
            const message = JSON.stringify({
                error: {
                    details: [
                        {
                            '@type': 'type.googleapis.com/google.rpc.RetryInfo',
                            retryDelay: retryDelaySeconds,
                        },
                    ],
                },
            });
            return Object.assign(new Error(message), { status: 429 });
        }

        function anthropicRateLimit(
            retryDelayMs: number
        ): Error & { status: number; retryDelay: number } {
            return Object.assign(new Error('429'), {
                status: 429,
                retryDelay: retryDelayMs,
            });
        }

        it('aborts at the cap when a Gemini 429 retryDelay (58s) exceeds the 30s cap (no full-delay wait, no maxAttempts run)', async () => {
            vi.useFakeTimers();
            try {
                // retryDelay "58s" = 58_000ms > cap 30_000ms
                // 1번째 실패 후 delay=58_000(누적 0+58_000 >= 30_000) → 즉시 abort.
                const fn = vi.fn(async () => {
                    throw geminiRateLimit('58s');
                });

                const promise = withRetry(fn, {
                    maxAttempts: 5,
                    baseDelayMs: 5000,
                    abortIfCumulativeDelayReachesMs: 30_000,
                });
                const assertion = expect(promise).rejects.toThrow(
                    AI_SERVER_UNSTABLE_CODE
                );

                // 58s를 기다리지 않고 0ms 만에 abort해야 하므로 타이머를 거의 전진시키지 않아도
                // 즉시 reject되어야 한다. (cap 미초과 시였다면 58s sleep으로 pending 상태였을 것)
                await assertion;

                // 단 1회만 호출 — retryDelay 전체(58s)를 기다리지도, maxAttempts(5)까지 돌지도 않음.
                expect(fn).toHaveBeenCalledTimes(1);
            } finally {
                vi.useRealTimers();
            }
        });

        it('aborts at the cap when an Anthropic numeric 429 retryDelay (60s) exceeds the 30s cap', async () => {
            vi.useFakeTimers();
            try {
                // retryDelay=60_000ms > cap 30_000ms → 첫 실패 직후 abort.
                const fn = vi.fn(async () => {
                    throw anthropicRateLimit(60_000);
                });

                const promise = withRetry(fn, {
                    maxAttempts: 5,
                    baseDelayMs: 5000,
                    abortIfCumulativeDelayReachesMs: 30_000,
                });
                const assertion = expect(promise).rejects.toThrow(
                    AI_SERVER_UNSTABLE_CODE
                );

                await assertion;

                expect(fn).toHaveBeenCalledTimes(1);
            } finally {
                vi.useRealTimers();
            }
        });

        it('respects a 429 retryDelay that fits under the cap before aborting (falsifiability guard)', async () => {
            vi.useFakeTimers();
            try {
                // retryDelay "12s" = 12_000ms < cap 30_000ms.
                // 1번째 실패 후 delay=12_000(누적 12_000 < 30_000) → sleep 후 재시도.
                // 2번째 실패 후 delay=12_000(누적 12_000+12_000=24_000 < 30_000) → sleep 후 재시도.
                // 3번째 실패 후 delay=12_000(누적 24_000+12_000=36_000 >= 30_000) → abort.
                // → cap이 즉시-abort가 아니라 "누적이 cap에 도달할 때만" 끊는지 확인(테스트 위변조 방지).
                const fn = vi.fn(async () => {
                    throw geminiRateLimit('12s');
                });

                const promise = withRetry(fn, {
                    maxAttempts: 5,
                    baseDelayMs: 5000,
                    abortIfCumulativeDelayReachesMs: 30_000,
                });
                const assertion = expect(promise).rejects.toThrow(
                    AI_SERVER_UNSTABLE_CODE
                );

                // 두 번의 12s 백오프를 통과시켜 3번째 시도까지 진행
                await vi.advanceTimersByTimeAsync(12_000);
                await vi.advanceTimersByTimeAsync(12_000);
                await assertion;

                // 시도 1,2,3 발생 후 cap에서 멈춤 — maxAttempts(5)까지 가지 않음.
                expect(fn).toHaveBeenCalledTimes(3);
            } finally {
                vi.useRealTimers();
            }
        });
    });
});
