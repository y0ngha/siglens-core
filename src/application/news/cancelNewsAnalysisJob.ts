/**
 * Cancel an in-flight news analysis job.
 *
 * Delegates entirely to {@link cancelAnalysisJob} — the news analysis
 * worker uses the same `/cancel` endpoint and Redis job state as the
 * technical analysis worker.
 *
 * @param jobId - The `jobId` returned by {@link submitNewsAnalysis}.
 * @returns `true` if the job was cancelled successfully.
 *
 * @see submitNewsAnalysis
 * @see pollNewsAnalysis
 */
export { cancelAnalysisJob as cancelNewsAnalysisJob } from '@/application/market/cancelAnalysisJob';
