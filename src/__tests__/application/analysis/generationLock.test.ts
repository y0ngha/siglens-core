import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dedupeGeneration } from '@/application/analysis/generationLock';
import type { CacheProvider } from '@/domain/ports/cache';
import {
    buildGenerationLockKey,
    buildGenerationResultKey,
    GENERATION_LOCK_TTL_SECONDS,
    GENERATION_RESULT_MAX_LENGTH,
    GENERATION_RESULT_TTL_SECONDS,
} from '@/infrastructure/cache/config';

interface Entry {
    value: unknown;
    expiresAt: number;
}

interface SharedStore {
    /** Live (non-expired) value, or `undefined`. */
    peek(key: string): unknown;
    put(key: string, value: unknown, ttlSeconds?: number): void;
    remove(key: string): void;
    provider: Required<CacheProvider>;
}

/**
 * In-memory stand-in for one shared Redis that honours TTLs against
 * `Date.now()` (so fake timers expire keys), two "instances" share it.
 */
function createSharedStore(): SharedStore {
    const entries = new Map<string, Entry>();
    const peek = (key: string): unknown => {
        const entry = entries.get(key);
        if (entry === undefined) return undefined;
        if (Date.now() >= entry.expiresAt) {
            entries.delete(key);
            return undefined;
        }
        return entry.value;
    };
    const put = (key: string, value: unknown, ttlSeconds = 3_600): void => {
        entries.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
    };
    const provider: Required<CacheProvider> = {
        async get<T>(key: string): Promise<T | null> {
            const value = peek(key);
            return value === undefined ? null : (value as T);
        },
        async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
            put(key, value, ttlSeconds);
        },
        async delete(key: string): Promise<void> {
            entries.delete(key);
        },
        async setIfAbsent<T>(
            key: string,
            value: T,
            ttlSeconds: number
        ): Promise<boolean> {
            if (peek(key) !== undefined) return false;
            put(key, value, ttlSeconds);
            return true;
        },
        async deleteIfEquals(key: string, value: string): Promise<boolean> {
            if (peek(key) !== value) return false;
            entries.delete(key);
            return true;
        },
    };
    vi.spyOn(provider, 'set');
    vi.spyOn(provider, 'delete');
    vi.spyOn(provider, 'setIfAbsent');
    vi.spyOn(provider, 'deleteIfEquals');
    return { peek, put, remove: key => entries.delete(key), provider };
}

const KEY = 'analysis:AAPL:1Day:model:p1';
const LOCK = buildGenerationLockKey(KEY);
const FAST = { pollIntervalMs: 10, maxWaitMs: 1_000 };
const RAW = '{"summary":"winner"}';
const PEER_RAW = '{"summary":"peer"}';

/** The token the provider was asked to store as the lock value. */
function ownedToken(provider: Required<CacheProvider>): string {
    return vi.mocked(provider.setIfAbsent).mock.calls[0]![1] as string;
}

describe('dedupeGeneration', () => {
    beforeEach(() => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('(Happy) 락 승자는 랜덤 토큰으로 락을 잡고, 토큰에 묶인 키로 게시한 뒤 자기 락만 푼다', async () => {
        const { peek, provider } = createSharedStore();
        const generate = vi.fn().mockResolvedValue(RAW);

        await expect(
            dedupeGeneration(provider, KEY, generate, FAST)
        ).resolves.toBe(RAW);

        const token = ownedToken(provider);
        expect(token).toMatch(/^[0-9a-f-]{36}$/);
        expect(provider.setIfAbsent).toHaveBeenCalledWith(
            LOCK,
            token,
            GENERATION_LOCK_TTL_SECONDS
        );
        expect(provider.set).toHaveBeenCalledWith(
            buildGenerationResultKey(KEY, token),
            { raw: RAW },
            GENERATION_RESULT_TTL_SECONDS
        );
        expect(provider.deleteIfEquals).toHaveBeenCalledWith(LOCK, token);
        expect(provider.delete).not.toHaveBeenCalled();
        expect(peek(LOCK)).toBeUndefined();
    });

    it('(Happy) 다른 인스턴스가 락을 쥐고 있으면 생성하지 않고 그 토큰의 결과를 받는다', async () => {
        const { put, remove, provider } = createSharedStore();
        put(LOCK, 'peer-token');
        setTimeout(() => {
            put(buildGenerationResultKey(KEY, 'peer-token'), {
                raw: PEER_RAW,
            });
            remove(LOCK);
        }, 30);
        const generate = vi.fn().mockResolvedValue(RAW);

        await expect(
            dedupeGeneration(provider, KEY, generate, FAST)
        ).resolves.toBe(PEER_RAW);
        expect(generate).not.toHaveBeenCalled();
    });

    it('(Happy) 이미 게시된 결과는 첫 sleep 전에 읽는다', async () => {
        vi.useFakeTimers();
        const { put, provider } = createSharedStore();
        put(LOCK, 'peer-token');
        put(buildGenerationResultKey(KEY, 'peer-token'), { raw: PEER_RAW });
        const generate = vi.fn();

        // 타이머를 전혀 진행하지 않아도 끝나야 한다.
        await expect(
            dedupeGeneration(provider, KEY, generate, {
                pollIntervalMs: 60_000,
            })
        ).resolves.toBe(PEER_RAW);
        expect(generate).not.toHaveBeenCalled();
    });

    it('(Worst) 이전 생성의 결과(다른 토큰)는 재사용하지 않는다', async () => {
        const { put, provider } = createSharedStore();
        put(buildGenerationResultKey(KEY, 'old-token'), { raw: '"stale"' });
        put(LOCK, 'new-token');
        setTimeout(() => {
            put(buildGenerationResultKey(KEY, 'new-token'), {
                raw: PEER_RAW,
            });
        }, 30);
        const generate = vi.fn();

        await expect(
            dedupeGeneration(provider, KEY, generate, FAST)
        ).resolves.toBe(PEER_RAW);
        expect(generate).not.toHaveBeenCalled();
    });

    it('(Worst) 승자가 결과 없이 락을 풀면(실패) 기다리지 않고 한 번 직접 생성한다', async () => {
        const { put, remove, provider } = createSharedStore();
        put(LOCK, 'peer-token');
        setTimeout(() => remove(LOCK), 20);
        const generate = vi.fn().mockResolvedValue(RAW);

        await expect(
            dedupeGeneration(provider, KEY, generate, {
                pollIntervalMs: 10,
                maxWaitMs: 60_000,
            })
        ).resolves.toBe(RAW);
        expect(generate).toHaveBeenCalledTimes(1);
    });

    it('(Worst) 피어 결과가 accept를 통과하지 못하면 한 번 직접 생성한다', async () => {
        const { put, provider } = createSharedStore();
        put(LOCK, 'peer-token');
        put(buildGenerationResultKey(KEY, 'peer-token'), {
            raw: 'not json at all',
        });
        setTimeout(() => provider.delete(LOCK), 20);
        const generate = vi.fn().mockResolvedValue(RAW);

        await expect(
            dedupeGeneration(provider, KEY, generate, FAST)
        ).resolves.toBe(RAW);
        expect(generate).toHaveBeenCalledTimes(1);
    });

    it('(Worst) 대기 상한을 넘기면 직접 생성하고, 남의 락은 건드리지 않는다', async () => {
        const { put, peek, provider } = createSharedStore();
        put(LOCK, 'peer-token');
        const generate = vi.fn().mockResolvedValue(RAW);

        await expect(
            dedupeGeneration(provider, KEY, generate, {
                pollIntervalMs: 10,
                maxWaitMs: 50,
            })
        ).resolves.toBe(RAW);
        expect(generate).toHaveBeenCalledTimes(1);
        expect(peek(LOCK)).toBe('peer-token');
        expect(provider.deleteIfEquals).not.toHaveBeenCalled();
        expect(provider.delete).not.toHaveBeenCalled();
    });

    it('(Worst) 생성이 TTL을 넘겨 락이 만료되고 후임이 잡았으면, 끝난 뒤에도 후임의 락을 지우지 않는다', async () => {
        vi.useFakeTimers();
        const { peek, provider } = createSharedStore();
        let finish: (raw: string) => void = () => {};
        const generate = vi.fn(
            () =>
                new Promise<string>(resolve => {
                    finish = resolve;
                })
        );

        const pending = dedupeGeneration(provider, KEY, generate, FAST);
        await vi.advanceTimersByTimeAsync(0);
        expect(generate).toHaveBeenCalledTimes(1);

        // 락 TTL이 지나 만료되고, 다른 인스턴스가 새 토큰으로 잡는다.
        await vi.advanceTimersByTimeAsync(
            GENERATION_LOCK_TTL_SECONDS * 1000 + 1
        );
        expect(peek(LOCK)).toBeUndefined();
        await expect(
            provider.setIfAbsent(LOCK, 'successor', GENERATION_LOCK_TTL_SECONDS)
        ).resolves.toBe(true);

        finish(RAW);
        await expect(pending).resolves.toBe(RAW);
        expect(peek(LOCK)).toBe('successor');
        expect(provider.delete).not.toHaveBeenCalled();
    });

    it('(Worst) 생성이 실패해도 자기 락을 풀고 에러를 그대로 던진다', async () => {
        const { peek, provider } = createSharedStore();
        const generate = vi.fn().mockRejectedValue(new Error('provider down'));

        await expect(
            dedupeGeneration(provider, KEY, generate, FAST)
        ).rejects.toThrow('provider down');
        expect(peek(LOCK)).toBeUndefined();
        expect(
            peek(buildGenerationResultKey(KEY, ownedToken(provider)))
        ).toBeUndefined();
    });

    it('(Worst) 대기 중 abort되면 signal의 reason으로 reject하고 타이머를 남기지 않는다', async () => {
        vi.useFakeTimers();
        const { put, provider } = createSharedStore();
        put(LOCK, 'peer-token');
        const controller = new AbortController();
        const generate = vi.fn().mockResolvedValue(RAW);

        const pending = dedupeGeneration(provider, KEY, generate, {
            signal: controller.signal,
            pollIntervalMs: 1_000,
            maxWaitMs: 60_000,
        });
        const settled = expect(pending).rejects.toThrow('client gone');
        await vi.advanceTimersByTimeAsync(0);
        expect(vi.getTimerCount()).toBe(1);
        controller.abort(new Error('client gone'));

        await settled;
        expect(generate).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('(Edge) 락 획득 중 Redis 오류는 fail-open — 생성하되 해제·게시는 하지 않는다', async () => {
        const { provider } = createSharedStore();
        vi.mocked(provider.setIfAbsent).mockRejectedValueOnce(
            new Error('redis down')
        );
        const generate = vi.fn().mockResolvedValue(RAW);

        await expect(
            dedupeGeneration(provider, KEY, generate, FAST)
        ).resolves.toBe(RAW);
        expect(generate).toHaveBeenCalledTimes(1);
        expect(provider.deleteIfEquals).not.toHaveBeenCalled();
        expect(provider.delete).not.toHaveBeenCalled();
        expect(provider.set).not.toHaveBeenCalled();
    });

    it('(Edge) deleteIfEquals가 없는 provider는 명시적으로 해제하지 않고 TTL에 맡긴다', async () => {
        const { peek, provider } = createSharedStore();
        const { deleteIfEquals: _omitted, ...withoutCompareDelete } = provider;
        const generate = vi.fn().mockResolvedValue(RAW);

        await expect(
            dedupeGeneration(withoutCompareDelete, KEY, generate, FAST)
        ).resolves.toBe(RAW);
        expect(peek(LOCK)).toBe(ownedToken(provider));
        expect(provider.delete).not.toHaveBeenCalled();
    });

    it('(Edge) setIfAbsent가 없는 provider나 null 캐시는 프로세스 내 dedupe만 한다', async () => {
        const plain: CacheProvider = {
            get: vi.fn(),
            set: vi.fn(),
            delete: vi.fn(),
        };
        const generate = vi.fn().mockResolvedValue(RAW);

        await expect(dedupeGeneration(plain, KEY, generate)).resolves.toBe(RAW);
        await expect(dedupeGeneration(null, KEY, generate)).resolves.toBe(RAW);
        expect(plain.get).not.toHaveBeenCalled();
        expect(plain.set).not.toHaveBeenCalled();
        expect(generate).toHaveBeenCalledTimes(2);
    });

    it('(Edge) 같은 프로세스의 동시 호출은 락을 한 번만 잡고 한 번만 생성한다', async () => {
        const { provider } = createSharedStore();
        const generate = vi.fn().mockResolvedValue(RAW);

        const [a, b] = await Promise.all([
            dedupeGeneration(provider, KEY, generate, FAST),
            dedupeGeneration(provider, KEY, generate, FAST),
        ]);

        expect([a, b]).toEqual([RAW, RAW]);
        expect(generate).toHaveBeenCalledTimes(1);
        expect(provider.setIfAbsent).toHaveBeenCalledTimes(1);
    });

    it('(Edge) JSON이 아니거나 너무 큰 원문은 게시하지 않는다(락은 푼다)', async () => {
        const nonJson = createSharedStore();
        await expect(
            dedupeGeneration(
                nonJson.provider,
                KEY,
                vi.fn().mockResolvedValue('```json\n{}\n```'),
                FAST
            )
        ).resolves.toBe('```json\n{}\n```');
        expect(nonJson.provider.set).not.toHaveBeenCalled();
        expect(nonJson.peek(LOCK)).toBeUndefined();

        const huge = createSharedStore();
        const big = JSON.stringify('x'.repeat(GENERATION_RESULT_MAX_LENGTH));
        await expect(
            dedupeGeneration(
                huge.provider,
                `${KEY}:big`,
                vi.fn().mockResolvedValue(big),
                FAST
            )
        ).resolves.toBe(big);
        expect(huge.provider.set).not.toHaveBeenCalled();
    });

    it('(Edge) 호출자 accept가 거부한 원문도 게시하지 않는다', async () => {
        const { provider } = createSharedStore();
        await dedupeGeneration(provider, KEY, vi.fn().mockResolvedValue(RAW), {
            ...FAST,
            accept: () => false,
        });
        expect(provider.set).not.toHaveBeenCalled();
    });
});
