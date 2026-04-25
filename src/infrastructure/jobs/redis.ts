import { Redis } from '@upstash/redis';

/** CacheProvider가 지원하지 않는 저수준 TTL-SET 명령을 위한 job 전용 Redis 팩토리. */
export function createJobRedis(): Redis | null {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;

    if (!url || !token) {
        return null;
    }

    return new Redis({ url, token });
}
