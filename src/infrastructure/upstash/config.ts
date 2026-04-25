import type { UpstashEnvConfig } from '@/infrastructure/upstash/types';

export function readUpstashConfig(): UpstashEnvConfig | null {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) return null;
    return {
        url,
        token,
        readonlyToken: process.env.UPSTASH_REDIS_REST_READONLY_TOKEN ?? '',
    };
}
