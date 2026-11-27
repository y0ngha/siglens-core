import { PROVIDER_TIMEFRAMES } from '@/domain/constants/market';

/**
 * Timeframes the agent's bar reads accept: every provider timeframe plus
 * weekly and monthly bars, which the consumer aggregates from daily bars
 * (`aggregateBarsToWeekly` / `aggregateBarsToMonthly`). SIGLENS analyses
 * offered to the agent keep the {@link PROVIDER_TIMEFRAMES} list, although
 * core itself can now build a `1Week` analysis: letting the agent ask for a
 * weekly analysis is a tool-description change the consumer evaluates first.
 */
export const AGENT_BARS_TIMEFRAMES = [
    ...PROVIDER_TIMEFRAMES,
    '1Week',
    '1Month',
] as const;
/** One of {@link AGENT_BARS_TIMEFRAMES}. */
export type AgentBarsTimeframe = (typeof AGENT_BARS_TIMEFRAMES)[number];

/** Analysis kinds the agent can have produced afresh during a turn. */
export const FRESH_ANALYSIS_KINDS = [
    'technical',
    'overall',
    'news',
    'options',
] as const;
export type FreshAnalysisKind = (typeof FRESH_ANALYSIS_KINDS)[number];
