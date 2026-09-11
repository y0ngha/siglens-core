import { Redis } from '@upstash/redis';
import { SECONDS_PER_DAY } from '@/domain/constants/time';
import type { CounterStore } from '@/domain/ports/counterStore';
import { CounterStoreUnavailableError } from '@/domain/ports/counterStore';
import { readUpstashConfig } from '@/infrastructure/upstash/config';

export type CounterPeriod = 'day' | 'month';
/** `open`: allow on outage (legacy chat). `closed`: throw CounterStoreUnavailableError on outage (agent). */
export type CounterFailurePolicy = 'open' | 'closed';

export interface CounterStoreOptions {
    prefix: string;
    period: CounterPeriod;
    failurePolicy: CounterFailurePolicy;
    clock?: () => Date;
}

const MONTH_TTL_SECONDS = 32 * SECONDS_PER_DAY;
const ISO_DATE_LENGTH = 10;
const ISO_MONTH_LENGTH = 7;

function bucket(period: CounterPeriod, now: Date): string {
    const iso = now.toISOString();
    return period === 'day'
        ? iso.slice(0, ISO_DATE_LENGTH)
        : iso.slice(0, ISO_MONTH_LENGTH);
}

/**
 * @adapter implements {@link CounterStore}
 *
 * Upstash-backed {@link CounterStore}. Keys are `${prefix}:${subject}:${bucket}`
 * with the bucket in UTC (same convention as `hashUsageIp`). INCR + EXPIRE NX
 * keeps the first write atomic enough for quotas; an over-limit INCR is
 * immediately DECR'd so `remaining` never drifts negative.
 *
 * With `failurePolicy: 'closed'`, an outage (no config or a Redis error)
 * makes `consume` log the `[agent] quota store unavailable` alarm marker
 * once and throw {@link CounterStoreUnavailableError}, so callers answer
 * `server_busy` rather than a quota refusal.
 */
export function createCounterStore(options: CounterStoreOptions): CounterStore {
    const config = readUpstashConfig();
    const redis =
        config === null
            ? null
            : new Redis({ url: config.url, token: config.token });
    const clock = options.clock ?? (() => new Date());
    const ttl = options.period === 'day' ? SECONDS_PER_DAY : MONTH_TTL_SECONDS;
    const allowOnFailure = options.failurePolicy === 'open';
    const keyFor = (subject: string): string =>
        `${options.prefix}:${subject}:${bucket(options.period, clock())}`;

    return {
        async consume(subject, limit) {
            if (redis === null) {
                if (!allowOnFailure) {
                    console.warn('[agent] quota store unavailable', {
                        op: 'consume',
                        prefix: options.prefix,
                        reason: 'no redis config',
                    });
                    throw new CounterStoreUnavailableError(options.prefix);
                }
                return true;
            }
            const key = keyFor(subject);
            try {
                const count = await redis.incr(key);
                await redis.expire(key, ttl, 'NX');
                if (count > limit) {
                    await redis.decr(key);
                    return false;
                }
                return true;
            } catch (error) {
                if (!allowOnFailure) {
                    console.warn('[agent] quota store unavailable', {
                        op: 'consume',
                        prefix: options.prefix,
                        error,
                    });
                    throw new CounterStoreUnavailableError(options.prefix, {
                        cause: error,
                    });
                }
                return true;
            }
        },
        async refund(subject) {
            if (redis === null) return;
            try {
                const key = keyFor(subject);
                const count = await redis.get<number>(key);
                if (count !== null && count > 0) await redis.decr(key);
                // ponytail: bucket is recomputed from clock() at refund time,
                // so a refund crossing UTC midnight misses yesterday's key
                // (accepted; fix = pass the consume-time bucket key through).
            } catch {
                return;
            }
        },
        async remaining(subject, limit) {
            if (redis === null) return allowOnFailure ? limit : 0;
            try {
                const count = await redis.get<number>(keyFor(subject));
                return Math.max(0, limit - (count ?? 0));
            } catch {
                return allowOnFailure ? limit : 0;
            }
        },
    };
}
