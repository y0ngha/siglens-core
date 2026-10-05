import type { MacroBriefingResponse } from '@/domain/types';
import type { EconomicEventAnalysis } from '@/domain/economy/types';

// ─────────────────────────────────────────
// Submit
// ─────────────────────────────────────────

/** {@link submitMacroBriefing} cache-hit variant — briefing already produced this hour. */
export interface SubmitMacroBriefingCached {
    /** Discriminator: cache hit returned a previously produced briefing. */
    status: 'cached';
    /** Cached, normalized briefing. */
    briefing: MacroBriefingResponse;
    /** ISO timestamp at which the cached briefing was originally produced. */
    generatedAt: string;
}

/** {@link submitMacroBriefing} cache-miss variant — a fresh job was enqueued. */
export interface SubmitMacroBriefingSubmitted {
    /** Discriminator: cache miss; a worker job was enqueued and the caller should poll. */
    status: 'submitted';
    /** Worker job identifier — pass to {@link pollMacroBriefing} to await the result. */
    jobId: string;
}

/** Result of {@link submitMacroBriefing} — either a cache hit or a freshly submitted job. */
export type SubmitMacroBriefingResult =
    SubmitMacroBriefingCached | SubmitMacroBriefingSubmitted;

// ─────────────────────────────────────────
// Poll
// ─────────────────────────────────────────

/** {@link pollMacroBriefing} variant — worker still running; the caller should retry. */
export interface PollMacroBriefingProcessing {
    /** Discriminator: worker job has not finished yet; caller should poll again. */
    status: 'processing';
}

/** {@link pollMacroBriefing} variant — worker failed or returned an unusable result. */
export interface PollMacroBriefingError {
    /** Discriminator: worker reported failure or the result was missing/malformed. */
    status: 'error';
    /** Failure reason (worker error, missing/malformed result, etc.). */
    error: string;
}

/** {@link pollMacroBriefing} variant — worker finished successfully with a normalized briefing. */
export interface PollMacroBriefingDone {
    /** Discriminator: worker finished successfully and a normalized briefing is available. */
    status: 'done';
    /** Final, normalized briefing for the polled job. */
    briefing: MacroBriefingResponse;
    /** ISO timestamp at which the briefing was produced. */
    generatedAt: string;
}

/** Result of {@link pollMacroBriefing}. */
export type PollMacroBriefingResult =
    | PollMacroBriefingProcessing
    | PollMacroBriefingError
    | PollMacroBriefingDone;

// ─────────────────────────────────────────
// Submit Economic Event Analysis
// ─────────────────────────────────────────

/** {@link submitEconomicEventAnalysis} cache-hit variant — analysis already cached. */
export interface SubmitEconomicEventAnalysisCached {
    /** Discriminator: cache hit returned a previously produced analysis. */
    status: 'cached';
    /** Cached, normalized analysis result. */
    result: EconomicEventAnalysis;
}

/** {@link submitEconomicEventAnalysis} cache-miss variant — a fresh job was enqueued. */
export interface SubmitEconomicEventAnalysisSubmitted {
    /** Discriminator: cache miss; a worker job was enqueued and the caller should poll. */
    status: 'submitted';
    /** Worker job identifier — pass to {@link pollEconomicEventAnalysis} to await the result. */
    jobId: string;
}

/** Result of {@link submitEconomicEventAnalysis} — either a cache hit or a freshly submitted job. */
export type SubmitEconomicEventAnalysisResult =
    SubmitEconomicEventAnalysisCached | SubmitEconomicEventAnalysisSubmitted;

// ─────────────────────────────────────────
// Poll Economic Event Analysis
// ─────────────────────────────────────────

/** {@link pollEconomicEventAnalysis} variant — worker still running; the caller should retry. */
export interface PollEconomicEventAnalysisProcessing {
    /** Discriminator: worker job has not finished yet; caller should poll again. */
    status: 'processing';
}

/** {@link pollEconomicEventAnalysis} variant — worker failed or returned an unusable result. */
export interface PollEconomicEventAnalysisError {
    /** Discriminator: worker reported failure or the result was missing/malformed. */
    status: 'error';
    /** Failure reason (worker error, missing/malformed result, etc.). */
    error: string;
}

/** {@link pollEconomicEventAnalysis} variant — worker finished successfully with a normalized analysis. */
export interface PollEconomicEventAnalysisDone {
    /** Discriminator: worker finished successfully and a normalized analysis is available. */
    status: 'done';
    /** Final, normalized economic-event analysis for the polled job. */
    result: EconomicEventAnalysis;
}

/** Result of {@link pollEconomicEventAnalysis}. */
export type PollEconomicEventAnalysisResult =
    | PollEconomicEventAnalysisProcessing
    | PollEconomicEventAnalysisError
    | PollEconomicEventAnalysisDone;

// ─────────────────────────────────────────
// Submit Indicator Translation
// ─────────────────────────────────────────

/** {@link submitIndicatorTranslation} cache-hit variant — translation already cached. */
export interface SubmitIndicatorTranslationCached {
    /** Discriminator: cache hit returned a previously produced translation. */
    status: 'cached';
    /** Cached Korean indicator name. */
    nameKo: string;
}

/** {@link submitIndicatorTranslation} cache-miss variant — a fresh job was enqueued. */
export interface SubmitIndicatorTranslationSubmitted {
    /** Discriminator: cache miss; a worker job was enqueued and the caller should poll. */
    status: 'submitted';
    /** Worker job identifier — pass to {@link pollIndicatorTranslation} to await the result. */
    jobId: string;
}

/** Result of {@link submitIndicatorTranslation} — either a cache hit or a freshly submitted job. */
export type SubmitIndicatorTranslationResult =
    SubmitIndicatorTranslationCached | SubmitIndicatorTranslationSubmitted;

// ─────────────────────────────────────────
// Poll Indicator Translation
// ─────────────────────────────────────────

/** {@link pollIndicatorTranslation} variant — worker still running; the caller should retry. */
export interface PollIndicatorTranslationProcessing {
    /** Discriminator: worker job has not finished yet; caller should poll again. */
    status: 'processing';
}

/** {@link pollIndicatorTranslation} variant — worker failed or returned an unusable result. */
export interface PollIndicatorTranslationError {
    /** Discriminator: worker reported failure or the result was missing/malformed. */
    status: 'error';
    /** Failure reason (worker error, missing/malformed result, etc.). */
    error: string;
}

/** {@link pollIndicatorTranslation} variant — worker finished successfully with a Korean name. */
export interface PollIndicatorTranslationDone {
    /** Discriminator: worker finished successfully and a Korean name is available. */
    status: 'done';
    /** Korean indicator name produced by the translation job. */
    nameKo: string;
}

/** Result of {@link pollIndicatorTranslation}. */
export type PollIndicatorTranslationResult =
    | PollIndicatorTranslationProcessing
    | PollIndicatorTranslationError
    | PollIndicatorTranslationDone;

// ─────────────────────────────────────────
// Run (direct-await replacements for Submit + Poll)
// ─────────────────────────────────────────

/**
 * Options for a `runMacroBriefing` call — the direct (non-queued) successor to
 * the `submitMacroBriefing` + `pollMacroBriefing` pair.
 */
export interface RunMacroBriefingOptions {
    /**
     * Cancellation signal. When provided, forwarded to `callBriefingAi` so a
     * dropped connection aborts the underlying AI provider request.
     */
    signal?: AbortSignal;
}

/**
 * Result of a `runMacroBriefing` call.
 *
 * - `cached`: a recent briefing was found in the cache and returned as-is.
 * - `done`: the LLM completed and the result is ready.
 *
 * LLM-level failures propagate as thrown exceptions.
 */
export type RunMacroBriefingResult =
    | { status: 'cached'; briefing: MacroBriefingResponse; generatedAt: string }
    | { status: 'done'; briefing: MacroBriefingResponse; generatedAt: string };

/**
 * Options for a `runEconomicEventAnalysis` call — the direct (non-queued)
 * successor to the `submitEconomicEventAnalysis` + `pollEconomicEventAnalysis` pair.
 */
export interface RunEconomicEventAnalysisOptions {
    /**
     * Cancellation signal. When provided, forwarded to `callAnalysisAi` so a
     * dropped connection aborts the underlying AI provider request.
     */
    signal?: AbortSignal;
}

/**
 * Result of a `runEconomicEventAnalysis` call.
 *
 * - `cached`: a recent analysis was found in the cache and returned as-is.
 * - `done`: the LLM completed and the result is ready.
 *
 * LLM-level failures propagate as thrown exceptions.
 */
export type RunEconomicEventAnalysisResult =
    | { status: 'cached'; result: EconomicEventAnalysis }
    | { status: 'done'; result: EconomicEventAnalysis };

/**
 * Options for a `runIndicatorTranslation` call — the direct (non-queued)
 * successor to the `submitIndicatorTranslation` + `pollIndicatorTranslation` pair.
 */
export interface RunIndicatorTranslationOptions {
    /**
     * Cancellation signal. When provided, forwarded to `callAnalysisAi` so a
     * dropped connection aborts the underlying AI provider request.
     */
    signal?: AbortSignal;
}

/**
 * Result of a `runIndicatorTranslation` call.
 *
 * - `cached`: a recent translation was found in the cache and returned as-is.
 * - `done`: the LLM completed and the Korean name is ready. An empty `nameKo`
 *   (`''`) signals that the LLM returned garbage — callers should fall back to
 *   the original English name.
 *
 * LLM-level failures propagate as thrown exceptions.
 */
export type RunIndicatorTranslationResult =
    { status: 'cached'; nameKo: string } | { status: 'done'; nameKo: string };

/**
 * Result of `peekMacroBriefingCacheEntry` — a cached macro briefing plus the
 * time it was generated.
 */
export interface MacroBriefingCacheEntry {
    briefing: MacroBriefingResponse;
    /** ISO timestamp the briefing was generated at; `null` for a legacy cache entry written without it. */
    generatedAt: string | null;
}
