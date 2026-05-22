import { Redis } from '@upstash/redis';
import type {
    JobStateSetOpts,
    JobStateStore,
} from '@/domain/ports/jobStateStore';
import { readUpstashConfig } from '@/infrastructure/upstash/config';

/**
 * @adapter implements {@link JobStateStore}
 *
 * CacheProvider.delete가 지원하지 않는 다중 키 일괄 삭제(deleteMany)를 위한
 * job 전용 Upstash Redis 어댑터. 도메인 포트의 기술 중립 시그니처
 * (`ttlSeconds`, `deleteMany`)를 Upstash 클라이언트의 Redis-native 호출
 * (`{ ex }`, `del(...)`)로 변환한다.
 */
export function createJobStateStore(): JobStateStore | null {
    const config = readUpstashConfig();
    if (config === null) return null;
    const redis = new Redis({ url: config.url, token: config.token });
    return {
        get: <T>(key: string) => redis.get<T>(key),
        set: async <T>(
            key: string,
            value: T,
            opts: JobStateSetOpts
        ): Promise<void> => {
            await redis.set(key, value, { ex: opts.ttlSeconds });
        },
        deleteMany: (...keys: string[]) => redis.del(...keys),
    };
}
