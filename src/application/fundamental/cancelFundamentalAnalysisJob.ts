/**
 * Cancel an in-flight fundamental analysis job.
 *
 * Delegates entirely to {@link cancelAnalysisJob} — the fundamental analysis
 * worker uses the same `/cancel` endpoint and Redis job state as the
 * technical analysis worker.
 *
 * @param jobId - The `jobId` returned by {@link submitFundamentalAnalysis}.
 * @returns `true` if the job was cancelled successfully.
 *
 * @see submitFundamentalAnalysis
 * @see pollFundamentalAnalysis
 */
export { cancelAnalysisJob as cancelFundamentalAnalysisJob } from '@/application/market/cancelAnalysisJob';
