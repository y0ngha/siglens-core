import { Redis } from '@upstash/redis';
import { readUpstashConfig } from '@/infrastructure/upstash/config';
import type { JobRedisClient, RedisSetOpts } from '@/infrastructure/jobs/types';

/** CacheProvider.delete가 지원하지 않는 다중 키 일괄 삭제(del)를 위한 job 전용 Redis 팩토리. */
export function createJobRedis(): JobRedisClient | null {
    const config = readUpstashConfig();
    if (!config) return null;
    const redis = new Redis({ url: config.url, token: config.token });
    // Upstash exposes `nx` only via a separate overload of `set`; wrapping it
    // as a dedicated `setNx` keeps `JobRedisClient.set` and `JobRedisClient.setNx`
    // from colliding on the single set signature shape.
    return {
        get: <T>(key: string) => redis.get<T>(key),
        set: <T>(key: string, value: T, opts: RedisSetOpts) =>
            redis.set(key, value, { ex: opts.ex }),
        setNx: <T>(key: string, value: T, opts: RedisSetOpts) =>
            redis.set(key, value, { ex: opts.ex, nx: true }),
        del: (...keys: string[]) => redis.del(...keys),
        incr: (key: string) => redis.incr(key),
        decr: (key: string) => redis.decr(key),
        expire: (key: string, seconds: number) => redis.expire(key, seconds),
    };
}
