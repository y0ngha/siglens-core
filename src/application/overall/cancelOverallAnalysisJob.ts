/**
 * Cancels a pending or running overall analysis job.
 *
 * @param jobId - The job ID returned by {@link submitOverallAnalysis}.
 * @returns `true` if the job was cancelled successfully.
 *
 * @see cancelAnalysisJob
 * @see submitOverallAnalysis
 * @see pollOverallAnalysis
 */
export { cancelAnalysisJob as cancelOverallAnalysisJob } from '@/application/market/cancelAnalysisJob';
