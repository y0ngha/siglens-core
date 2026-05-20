import type { OptionsSnapshot } from './types';
import { summarizeChainForLlm } from './summarizeChainForLlm';

/**
 * Input options for {@link buildOptionsAnalysisPrompt}.
 *
 * Exported as part of the Tier 4 public API so consumers can type-annotate
 * inputs and adapt to schema changes without inference chains.
 */
export interface BuildOptionsAnalysisPromptOptions {
    /** Specific expiration ('YYYY-MM-DD') or 'all' for aggregated analysis. */
    expirationDate: string | 'all';
    companyName: string;
    snapshot: OptionsSnapshot;
}

/**
 * Build the LLM prompt for options analysis. The prompt requests a JSON
 * response matching RawOptionsAnalysisResponse (kept tolerant — normalize
 * will fill in any missing fields).
 *
 * @param options - Target expiration, company display name, and the
 *   pre-fetched options snapshot.
 * @returns A multi-section Korean-language prompt string ready to send to
 *   the LLM. Deterministic for a given input (no clocks, no random IDs).
 */
export function buildOptionsAnalysisPrompt(
    options: BuildOptionsAnalysisPromptOptions
): string {
    const { expirationDate, companyName, snapshot } = options;

    const targetChains =
        expirationDate === 'all'
            ? snapshot.chains
            : snapshot.chains.filter(c => c.expirationDate === expirationDate);

    const summaries = targetChains.map(c =>
        summarizeChainForLlm(c, snapshot.underlyingPrice)
    );

    return [
        `당신은 옵션 시장 분석가입니다. ${companyName} (${snapshot.symbol})의 옵션 시장 데이터를 한국어로 해석해주세요.`,
        '',
        `현재 주가: $${snapshot.underlyingPrice}`,
        '',
        '== 만기별 핵심 지표 ==',
        JSON.stringify(summaries, null, 2),
        '',
        '== 응답 형식 ==',
        '아래 JSON 스키마로만 응답하세요. 다른 텍스트는 포함하지 마세요.',
        '```json',
        '{',
        '  "summary": "전체 옵션 시장에 대한 한 문단 요약 (3-5문장, 친근한 어투, 한국어)",',
        '  "perExpiration": [',
        '    {',
        '      "expirationDate": "YYYY-MM-DD",',
        '      "commentary": "이 만기에 대한 해석 (2-3문장)",',
        '      "tone": "bullish | bearish | neutral | cautious"',
        '    }',
        '  ],',
        '  "signals": [',
        '    {',
        '      "kind": "bullish | bearish | neutral | volatility",',
        '      "message": "신호 한 줄 설명"',
        '    }',
        '  ],',
        '  "analyzedAt": "ISO datetime"',
        '}',
        '```',
        '',
        '== 해석 가이드 ==',
        '- Max Pain: 옵션 만기일 부근 주가가 끌리는 가격',
        '- P/C Ratio: 풋/콜 OI 비율. 1보다 크면 풋 우세 (방어적), 작으면 콜 우세 (공격적)',
        '- ATM IV: 시장이 예상하는 변동성',
        '- topOpenInterestStrikes: 돈이 가장 많이 쌓인 strike 3개',
        '- 친근하지만 정확한 한국어 톤. 종목 명은 영어 그대로 (예: AAPL).',
    ].join('\n');
}
