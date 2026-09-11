import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockIncr, mockExpire, mockGet, mockDecr, mockRedisConstructor } =
    vi.hoisted(() => {
        const incr = vi.fn();
        const expire = vi.fn();
        const get = vi.fn();
        const decr = vi.fn();
        const constructor = vi.fn(() => ({ incr, expire, get, decr }));
        return {
            mockIncr: incr,
            mockExpire: expire,
            mockGet: get,
            mockDecr: decr,
            mockRedisConstructor: constructor,
        };
    });

vi.mock('@upstash/redis', () => ({ Redis: mockRedisConstructor }));

import { CounterStoreUnavailableError } from '@/domain/ports/counterStore';
import { createCounterStore } from '@/infrastructure/usage/counterStore';

const NOW = new Date('2026-09-12T23:30:00Z');
const originalEnv = process.env;

describe('createCounterStore', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        mockRedisConstructor.mockImplementation(() => ({
            incr: mockIncr,
            expire: mockExpire,
            get: mockGet,
            decr: mockDecr,
        }));
        process.env = {
            ...originalEnv,
            UPSTASH_REDIS_REST_URL: 'https://redis.test',
            UPSTASH_REDIS_REST_TOKEN: 'token',
        };
    });
    afterEach(() => {
        process.env = originalEnv;
    });

    it('day 버킷 키는 UTC 날짜, INCR 후 EXPIRE NX', async () => {
        mockIncr.mockResolvedValue(1);
        const store = createCounterStore({
            prefix: 'agent:q:turns',
            period: 'day',
            failurePolicy: 'closed',
            clock: () => NOW,
        });
        await expect(store.consume('u1', 5)).resolves.toBe(true);
        expect(mockIncr).toHaveBeenCalledWith('agent:q:turns:u1:2026-09-12');
        expect(mockExpire).toHaveBeenCalledWith(
            'agent:q:turns:u1:2026-09-12',
            86_400,
            'NX'
        );
    });

    it('month 버킷 키는 YYYY-MM, TTL 32일', async () => {
        mockIncr.mockResolvedValue(1);
        const store = createCounterStore({
            prefix: 'agent:q:search',
            period: 'month',
            failurePolicy: 'closed',
            clock: () => NOW,
        });
        await store.consume('global', 1000);
        expect(mockIncr).toHaveBeenCalledWith('agent:q:search:global:2026-09');
        expect(mockExpire).toHaveBeenCalledWith(
            'agent:q:search:global:2026-09',
            32 * 86_400,
            'NX'
        );
    });

    it('한도 초과면 false를 돌려주고 즉시 되돌린다(카운트 부풀림 방지)', async () => {
        mockIncr.mockResolvedValue(6);
        const store = createCounterStore({
            prefix: 'p',
            period: 'day',
            failurePolicy: 'closed',
            clock: () => NOW,
        });
        await expect(store.consume('u1', 5)).resolves.toBe(false);
        expect(mockDecr).toHaveBeenCalledWith('p:u1:2026-09-12');
    });

    it('경계값: count === limit이면 true, DECR 없음', async () => {
        mockIncr.mockResolvedValue(5);
        const store = createCounterStore({
            prefix: 'p',
            period: 'day',
            failurePolicy: 'closed',
            clock: () => NOW,
        });
        await expect(store.consume('u1', 5)).resolves.toBe(true);
        expect(mockDecr).not.toHaveBeenCalled();
    });

    it('failurePolicy closed + config 없음: consume이 CounterStoreUnavailableError로 reject, remaining 0, 마커 로그', async () => {
        process.env = { ...originalEnv };
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const store = createCounterStore({
            prefix: 'p',
            period: 'day',
            failurePolicy: 'closed',
            clock: () => NOW,
        });
        await expect(store.consume('u1', 5)).rejects.toBeInstanceOf(
            CounterStoreUnavailableError
        );
        // The error message must not duplicate the CloudWatch alarm marker.
        await expect(store.consume('u1', 5)).rejects.toThrow(
            'counter store unavailable (p)'
        );
        expect(warn.mock.calls[0]![0]).toBe('[agent] quota store unavailable');
        await expect(store.remaining('u1', 5)).resolves.toBe(0);
        warn.mockRestore();
    });

    it('failurePolicy closed + 런타임 오류: consume이 CounterStoreUnavailableError로 reject, 마커 로그', async () => {
        mockIncr.mockRejectedValue(new Error('down'));
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const store = createCounterStore({
            prefix: 'p',
            period: 'day',
            failurePolicy: 'closed',
            clock: () => NOW,
        });
        await expect(store.consume('u1', 5)).rejects.toBeInstanceOf(
            CounterStoreUnavailableError
        );
        expect(warn.mock.calls[0]![0]).toBe('[agent] quota store unavailable');
        warn.mockRestore();
    });

    it('failurePolicy open: Redis 오류 → consume true, remaining limit', async () => {
        mockIncr.mockRejectedValue(new Error('down'));
        mockGet.mockRejectedValue(new Error('down'));
        const store = createCounterStore({
            prefix: 'p',
            period: 'day',
            failurePolicy: 'open',
            clock: () => NOW,
        });
        await expect(store.consume('u1', 5)).resolves.toBe(true);
        await expect(store.remaining('u1', 5)).resolves.toBe(5);
    });

    it('remaining = limit - count(음수 방지), refund는 0 아래로 내려가지 않는다', async () => {
        mockGet.mockResolvedValue(7);
        const store = createCounterStore({
            prefix: 'p',
            period: 'day',
            failurePolicy: 'closed',
            clock: () => NOW,
        });
        await expect(store.remaining('u1', 5)).resolves.toBe(0);
        mockGet.mockResolvedValue(0);
        await store.refund('u1');
        expect(mockDecr).not.toHaveBeenCalled();
    });

    it('refund: count가 있으면 DECR 호출', async () => {
        mockGet.mockResolvedValue(2);
        const store = createCounterStore({
            prefix: 'p',
            period: 'day',
            failurePolicy: 'closed',
            clock: () => NOW,
        });
        await store.refund('u1');
        expect(mockDecr).toHaveBeenCalledWith('p:u1:2026-09-12');
    });

    it('remaining: 키가 없으면(null) limit을 그대로 반환', async () => {
        mockGet.mockResolvedValue(null);
        const store = createCounterStore({
            prefix: 'p',
            period: 'day',
            failurePolicy: 'closed',
            clock: () => NOW,
        });
        await expect(store.remaining('u1', 5)).resolves.toBe(5);
    });
});
