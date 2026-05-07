// All AI-facing prompt strings must be in English — Korean reduces analysis quality.
// Exception: the Fear & Greed section is intentionally Korean because it is rendered
// as a sentiment hint for the analyst LLM whose final output is Korean.

import type { FearGreedSnapshot } from '@/domain/indicators/fearGreed/types';

/**
 * Format a fearGreed snapshot as a Korean prompt section.
 *
 * Emits the spec §4.4 / §4.5 sentiment block:
 *   ## 공포·탐욕 지수 (참고)
 *   - 점수: {score} / 100 ({label})
 *   - Flow 그룹: {flow_score} | Trend 그룹: {trend_score}
 *   [- 주의: {warning_text}]
 *
 *   위 sentiment를 위 가격·거래량 분석과 종합해 해석해 주세요.
 *
 * Used by both the technical analysis prompt (`buildAnalysisPrompt`) and the
 * overall analysis prompt (`buildOverallAnalysisPrompt`) to surface the same
 * sentiment context to the LLM. Centralising the formatting here keeps the
 * two prompts in lock-step whenever the spec text changes.
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
    const warningNote =
        fg.warning === 'CHRONIC_WEAKNESS'
            ? '\n- 주의: 이 종목은 장기 약세 사이클입니다. 점수는 자기 분포 대비 상대적 위치를 의미합니다.'
            : fg.warning === 'CHRONIC_STRENGTH'
              ? '\n- 주의: 이 종목은 장기 강세 사이클입니다. 점수는 자기 분포 대비 상대적 위치를 의미합니다.'
              : '';
    return (
        `## 공포·탐욕 지수 (참고)\n` +
        `- 점수: ${Math.round(fg.score)} / 100 (${fg.label})\n` +
        `- Flow 그룹: ${Math.round(flowGroup.score)} | Trend 그룹: ${Math.round(trendGroup.score)}` +
        warningNote +
        `\n\n위 sentiment를 위 가격·거래량 분석과 종합해 해석해 주세요.`
    );
}
