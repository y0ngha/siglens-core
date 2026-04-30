import type { BackgroundTaskOptions } from '@/application/types';
import type {
    SubmitAnalysisResult,
    Tier,
    TierConfig,
    Timeframe,
    UserTierContext,
} from '@/domain/types';

/** Options controlling analysis submission behavior. */
export interface SubmitAnalysisOptions extends BackgroundTaskOptions {
    /** Request-scoped tier context used to enforce timeframe access. */
    tierContext?: UserTierContext;
    /** Tier configuration override, mainly for tests and controlled rollouts. */
    tierConfig?: TierConfig;
}

/** Error returned when application tier gates block a timeframe request. */
export interface TierTimeframeAccessError {
    /** Machine-readable reason for the denial. */
    code: 'timeframe_not_allowed';
    /** Human-readable explanation suitable for API responses. */
    message: string;
    /** Tier used for the access decision. */
    tier: Tier;
    /** Timeframe requested by the caller. */
    timeframe: Timeframe;
    /** Timeframes available to the tier under the active config. */
    allowedTimeframes: Timeframe[];
}

/** Submit analysis outcome for application tier gate denials. */
export interface TierGateErrorResult {
    status: 'error';
    error: TierTimeframeAccessError;
}

/** Submit analysis outcome including application-level tier gate errors. */
export type SubmitAnalysisGatedResult =
    | SubmitAnalysisResult
    | TierGateErrorResult;
