import type { BackgroundTaskOptions } from '@/application/types';
import type { OverallDependencyInputs } from '@/application/overall/dependencyResolver';
import type { OverallAnalysisResponse } from '@/domain/types';

// ─────────────────────────────────────────
// Submit
// ─────────────────────────────────────────

/**
 * Options controlling overall analysis submission behavior.
 *
 * Extends {@link OverallDependencyInputs} with background-task hooks.
 * The caller is responsible for constructing all three dependency-axis options
 * before invoking {@link submitOverallAnalysis}.
 */
export interface SubmitOverallAnalysisOptions
    extends OverallDependencyInputs,
        BackgroundTaskOptions {}

/** The caller receives a cached overall analysis — no new job was created. */
export interface SubmitOverallAnalysisCached {
    status: 'cached';
    result: OverallAnalysisResponse;
}

/**
 * One or more dependency axes are still processing.
 *
 * The caller should poll each pending axis by its `jobId`, then retry
 * `submitOverallAnalysis` once all three are resolved.
 */
export interface SubmitOverallAnalysisPendingDependencies {
    status: 'pending_dependencies';
    /**
     * Maps each axis to its background `jobId`, or `undefined` if that
     * axis already resolved from cache and is not pending.
     */
    pendingJobs: Record<'technical' | 'fundamental' | 'news', string | undefined>;
}

/** A new overall analysis job was submitted; poll with `jobId` for the result. */
export interface SubmitOverallAnalysisSubmitted {
    status: 'submitted';
    jobId: string;
}

/**
 * Union of all possible outcomes from {@link submitOverallAnalysis}.
 *
 * - `cached` — a fresh analysis exists in the cache; result is embedded.
 * - `pending_dependencies` — one or more axis jobs are still running; retry after polling each.
 * - `submitted` — overall analysis job submitted; poll via {@link pollOverallAnalysis}.
 */
export type SubmitOverallAnalysisResult =
    | SubmitOverallAnalysisCached
    | SubmitOverallAnalysisPendingDependencies
    | SubmitOverallAnalysisSubmitted;

// ─────────────────────────────────────────
// Poll
// ─────────────────────────────────────────

/**
 * Outcome of {@link pollOverallAnalysis}: still processing, finished, or errored.
 *
 * - `processing` — the worker has not finished yet; caller should retry.
 * - `done` — the overall analysis is ready; result is embedded.
 * - `error` — the worker reported a failure or the payload could not be normalized.
 */
export type PollOverallAnalysisResult =
    | { status: 'processing' }
    | { status: 'done'; result: OverallAnalysisResponse }
    | { status: 'error'; error: string };
