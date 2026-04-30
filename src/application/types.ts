import type {
    AnalysisResponse,
    Tier,
    TierConfig,
    WaitUntil,
} from '@/domain/types';
import type { SubmitAnalysisError } from '@/application/usage/types';
import type { UsageRepository } from '@/infrastructure/db';

/** Runtime hooks for background tasks started by application use-cases. */
export interface BackgroundTaskOptions {
    /**
     * Optional serverless lifetime extender for fire-and-forget work.
     *
     * On Vercel, pass `waitUntil` from `@vercel/functions` so worker dispatch,
     * cache writes, cleanup, and other background promises can continue after
     * the response is returned.
     */
    waitUntil?: WaitUntil;
}

/** Usage tracking and daily limit options for analysis submissions. */
export interface AnalysisUsageOptions {
    /** Repository used to check today's count and record successful usage. */
    usageRepository: UsageRepository;
    /** Raw client IP. It is hashed before persistence and never stored. */
    clientIp: string;
    /** Resolved subscription tier for the request. */
    tier: Tier;
    /** Authenticated user UUID, or null/undefined for anonymous usage. */
    userId?: string | null;
    /** Model/backend identifier stored in usage_logs.model_used. */
    modelUsed?: string;
    /** Clock injection for UTC-day tests. Defaults to infrastructure time. */
    occurredAt?: Date;
    /** Optional tier configuration override for tests or controlled rollout. */
    tierConfig?: TierConfig;
}

/** Runtime hooks and usage controls for analysis submissions. */
export interface SubmitAnalysisOptions extends BackgroundTaskOptions {
    /** Optional usage tracking. Omitted callers keep the previous behavior. */
    usage?: AnalysisUsageOptions;
}

/** Outcome of {@link submitAnalysis}: cached result, queued job, or usage error. */
export type SubmitAnalysisResult =
    | { status: 'cached'; result: AnalysisResponse }
    | { status: 'submitted'; jobId: string }
    | { status: 'error'; error: SubmitAnalysisError };
