// All AI-facing prompt strings must be in English — Korean reduces analysis quality.

import type { BuildOptionsAnalysisPromptOptions } from './types';
import { summarizeChainForLlm } from './summarizeChainForLlm';

/**
 * Build the LLM prompt for options analysis. The prompt requests a JSON
 * response matching RawOptionsAnalysisResponse (kept tolerant — normalize
 * will fill in any missing fields).
 *
 * The instructions are in English; the JSON output schema specifies Korean
 * text for the model's user-facing fields (summary, commentary, message).
 *
 * @param options - Target expiration, company display name, and the
 *   pre-fetched options snapshot.
 * @returns A multi-section prompt string ready to send to the LLM.
 *   Deterministic for a given input (no clocks, no random IDs).
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
        `You are an options market analyst. Interpret the options market data for ${companyName} (${snapshot.symbol}) and write your analysis in Korean.`,
        '',
        `Current price: $${snapshot.underlyingPrice}`,
        '',
        '== Key Metrics by Expiration ==',
        JSON.stringify(summaries, null, 2),
        '',
        '== Output Schema ==',
        'Respond only with a JSON object matching the schema below. Do not include any other text.',
        '{',
        '  "summary": "전체 옵션 시장에 대한 한 문단 요약 (3-5문장, 친근한 어투, 한국어)",',
        '  "perExpiration": [',
        '    {',
        '      "expirationDate": "YYYY-MM-DD",',
        '      "commentary": "이 만기에 대한 해석 (2-3문장, 한국어)",',
        '      "tone": "bullish | bearish | neutral | cautious"',
        '    }',
        '  ],',
        '  "signals": [',
        '    {',
        '      "kind": "bullish | bearish | neutral | volatility",',
        '      "message": "신호 한 줄 설명 (한국어)"',
        '    }',
        '  ]',
        '}',
        '',
        'Respond with valid JSON only. No markdown fences.',
        '',
        '== Interpretation Guide ==',
        '- Max Pain: the price the underlying tends to gravitate toward near expiration.',
        '- P/C Ratio: put/call OI ratio. Greater than 1 means puts dominate (defensive); less than 1 means calls dominate (aggressive).',
        '- ATM IV: the volatility the market expects.',
        '- topOpenInterestStrikes: the 3 strikes with the most accumulated open interest.',
        '- topVolumeStrikes: the 3 strikes most actively traded today — read together with OI (accumulated bets) to spot price levels where the market is newly moving.',
        '- topOiBidAskSummary: bid/ask quotes (mid · spread) for the top OI strikes — a tight spread signals good liquidity at that price level.',
        '- Use a friendly but accurate Korean tone in the output. Keep ticker symbols in English as-is (e.g. AAPL).',
    ].join('\n');
}
