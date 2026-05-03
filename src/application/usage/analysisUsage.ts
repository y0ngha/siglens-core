import { checkAnalysisLimit } from '@/application/usage/limits';
import type { AnalysisUsageOptions } from '@/application/usage/types';
import type { Tier, TierConfig } from '@/domain/types';
import { hashUsageIp } from '@/infrastructure/usage/hash';

/**
 * @internal Check whether the (ipHash + tier) pair is allowed to submit one
 * more analysis today.
 *
 * Hashes the raw client IP with a UTC daily salt and delegates to
 * {@link checkAnalysisLimit}. Returns `true` when tier restrictions are
 * disabled by config.
 *
 * @param usage - Caller-supplied usage tracking options.
 * @param tier - Resolved subscription tier.
 * @param occurredAt - Reference timestamp for both the IP daily salt and the
 *   limit window. Pass the same value to {@link recordAnalysisUsageSafely}
 *   so the check and the recorded log share a UTC day.
 * @param tierConfig - Tier configuration override.
 */
export async function checkAnalysisUsageAllowed(
    usage: AnalysisUsageOptions,
    tier: Tier,
    occurredAt: Date,
    tierConfig: TierConfig
): Promise<boolean> {
    const ipHash = hashUsageIp(usage.clientIp, occurredAt);
    return checkAnalysisLimit(
        {
            ipHash,
            tier,
            now: occurredAt,
            config: tierConfig,
        },
        { usage: usage.usageRepository }
    );
}

/**
 * @internal Record one successful analysis usage event.
 *
 * Writes via `usage.usageRepository.recordUsage` and never throws — failures
 * are logged via `console.warn` so caller code stays on the happy path.
 *
 * Call exactly once per analysis lifecycle path that should count toward the
 * daily limit (cache-hit return path or post-submit return path), mirroring
 * {@link checkAnalysisUsageAllowed}.
 *
 * @param usage - Caller-supplied usage tracking options. When `undefined`,
 *   the function is a no-op (tracking is opt-in).
 * @param effectiveModelId - Model identifier persisted as `model_used` when
 *   `usage.modelUsed` is not provided.
 * @param occurredAt - Reference timestamp recorded with the log entry.
 */
export async function recordAnalysisUsageSafely(
    usage: AnalysisUsageOptions | undefined,
    effectiveModelId: string,
    occurredAt?: Date
): Promise<void> {
    if (usage === undefined) return;

    try {
        await usage.usageRepository.recordUsage({
            userId: usage.userId ?? null,
            ipAddress: usage.clientIp,
            actionType: 'analysis',
            modelUsed: usage.modelUsed ?? effectiveModelId,
            occurredAt,
        });
    } catch (error) {
        console.warn(
            '[recordAnalysisUsageSafely] Failed to record analysis usage:',
            error
        );
    }
}
