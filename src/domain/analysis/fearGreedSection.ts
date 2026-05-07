// All AI-facing prompt strings must be in English — Korean reduces analysis quality.

import type { FearGreedSnapshot, FearGreedWarning } from '@/domain/types';

const WARNING_NOTE: Record<NonNullable<FearGreedWarning>, string> = {
    CHRONIC_WEAKNESS:
        '\n- Note: This stock is in a long-term bearish cycle. The score represents its relative position within its own distribution.',
    CHRONIC_STRENGTH:
        '\n- Note: This stock is in a long-term bullish cycle. The score represents its relative position within its own distribution.',
};

/**
 * Format a fearGreed snapshot as an English prompt section.
 *
 * Emits the spec §4.4 / §4.5 sentiment block:
 *   ## Fear & Greed Index (Reference)
 *   - Score: {score} / 100 ({label})
 *   - Flow Group: {flow_score} | Trend Group: {trend_score}
 *   [- Note: {warning_text}]
 *
 *   Please interpret this sentiment in conjunction with the price and volume analysis above.
 *
 * Used by both the technical analysis prompt (`buildAnalysisPrompt`) and the
 * overall analysis prompt (`buildOverallAnalysisPrompt`) to surface the same
 * sentiment context to the LLM. Centralising the formatting here keeps the
 * two prompts in lock-step whenever the spec text changes.
 *
 * @throws {Error} When the snapshot is missing the Flow or Trend group.
 *   `composeSnapshot` always emits both Flow and Trend groups; this guard
 *   fires only for manually constructed or externally corrupted snapshots.
 *
 * @internal Used by analysis prompt builders; not part of the public API.
 */
export function formatFearGreedSection(fg: FearGreedSnapshot): string {
    const flowGroup = fg.groups.find(g => g.name === 'Flow');
    const trendGroup = fg.groups.find(g => g.name === 'Trend');
    if (!flowGroup || !trendGroup) {
        throw new Error(
            'FearGreedSnapshot must contain both Flow and Trend groups'
        );
    }
    const warningNote = fg.warning ? WARNING_NOTE[fg.warning] : '';
    return (
        '## Fear & Greed Index (Reference)\n' +
        `- Score: ${Math.round(fg.score)} / 100 (${fg.label})\n` +
        `- Flow Group: ${Math.round(flowGroup.score)} | Trend Group: ${Math.round(trendGroup.score)}` +
        warningNote +
        '\n\nPlease interpret this sentiment in conjunction with the price and volume analysis above.'
    );
}
