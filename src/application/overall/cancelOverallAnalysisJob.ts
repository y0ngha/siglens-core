/**
 * Cancel an in-flight overall analysis job.
 *
 * Delegates entirely to {@link cancelAnalysisJob} — the overall analysis
 * worker uses the same `/cancel` endpoint and Redis job state as the
 * technical analysis worker.
 *
 * @see cancelAnalysisJob
 * @see submitOverallAnalysis
 * @see pollOverallAnalysis
 */
export { cancelAnalysisJob as cancelOverallAnalysisJob } from '@/application/market/cancelAnalysisJob';
