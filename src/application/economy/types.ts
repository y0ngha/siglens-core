import type { MacroBriefingResponse } from '@/domain/types';

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
