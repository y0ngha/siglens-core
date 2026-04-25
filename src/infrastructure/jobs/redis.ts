import { Redis } from '@upstash/redis';
import { readUpstashConfig } from '@/infrastructure/upstash/config';
import type { JobRedisClient } from '@/infrastructure/jobs/types';

/** CacheProvider.delete가 지원하지 않는 다중 키 일괄 삭제(del)를 위한 job 전용 Redis 팩토리. */
export function createJobRedis(): JobRedisClient | null {
    const config = readUpstashConfig();
    if (!config) return null;
    return new Redis({ url: config.url, token: config.token });
}
