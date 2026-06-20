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
    | SubmitMacroBriefingCached
    | SubmitMacroBriefingSubmitted;

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
    | SubmitEconomicEventAnalysisCached
    | SubmitEconomicEventAnalysisSubmitted;

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
