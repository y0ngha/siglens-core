import { Redis } from '@upstash/redis';
import { readUpstashConfig } from '@/infrastructure/upstash/config';
import type {
    EmailTokenPurpose,
    EmailTokenStore,
    EmailTokenValue,
} from './types';

const KEY_PREFIX = 'email_token';

interface RedisPair {
    writer: Redis;
    reader: Redis;
}

let cachedRedisPair: RedisPair | null = null;
let cachedConfigKey: string | null = null;

/** @internal Build the Redis key for an email-token entry. */
export function buildEmailTokenKey(
    purpose: EmailTokenPurpose,
    email: string
): string {
    return `${KEY_PREFIX}:${purpose}:${email}`;
}

function getRedisPair(config: {
    url: string;
    token: string;
    readonlyToken?: string;
}): RedisPair {
    const configKey = `${config.url}:${config.token}:${config.readonlyToken ?? ''}`;
    if (cachedRedisPair !== null && cachedConfigKey === configKey) {
        return cachedRedisPair;
    }

    const writer = new Redis({ url: config.url, token: config.token });
    const reader = config.readonlyToken
        ? new Redis({ url: config.url, token: config.readonlyToken })
        : writer;
    cachedRedisPair = { writer, reader };
    cachedConfigKey = configKey;
    return cachedRedisPair;
}

/**
 * Construct an {@link EmailTokenStore} backed by Upstash Redis.
 *
 * Reads connection settings from env. Returns `null` when the required vars
 * are not present so callers can decide how to degrade — typically by
 * surfacing the missing-infrastructure error to the consumer rather than
 * silently dropping email-verification or password-reset state.
 *
 * @returns A configured email-token store, or `null` when Upstash env is missing.
 *
 * @example
 * ```ts
 * const tokens = createEmailTokenStore();
 * if (!tokens) throw new Error('Upstash Redis is not configured');
 * await tokens.set('email_verification', email, { status: 'pending', tokenHash }, 1800);
 * ```
 */
export function createEmailTokenStore(): EmailTokenStore | null {
    const config = readUpstashConfig();
    if (!config) return null;

    const { writer, reader } = getRedisPair(config);

    return {
        async set(purpose, email, value, ttlSeconds) {
            await writer.set(buildEmailTokenKey(purpose, email), value, {
                ex: ttlSeconds,
            });
        },
        async get(purpose, email) {
            return reader.get<EmailTokenValue>(
                buildEmailTokenKey(purpose, email)
            );
        },
        async delete(purpose, email) {
            await writer.del(buildEmailTokenKey(purpose, email));
        },
    };
}
