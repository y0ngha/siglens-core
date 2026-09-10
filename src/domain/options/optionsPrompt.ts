// All AI-facing prompt strings must be in English — Korean reduces analysis quality.

import {
    DEFAULT_ANALYSIS_LOCALE,
    outputLanguageName,
    schemaLanguageLabel,
} from '@/domain/analysis/outputLocale';
import { formatPrice } from '@/domain/analysis/promptFormat';
import type { AssembledPrompt } from '@/domain/types';
import type { BuildOptionsAnalysisPromptOptions } from './types';
import { summarizeChainForLlm } from './summarizeChainForLlm';

/** Decimals kept for fractional metrics in the Key Metrics JSON. */
const METRIC_DECIMAL_PLACES = 4;

/**
 * `JSON.stringify` replacer that rounds fractional numbers.
 *
 * The summary carries raw floats — IV `0.28345678912`, put/call `0.8712345679`, implied
 * move `4.123456789` — which cost tokens and invite the model to quote false precision.
 * Integers (open interest, volume, whole strikes) pass through untouched.
 */
const roundMetric = (_key: string, value: unknown): unknown =>
    typeof value === 'number' && !Number.isInteger(value)
        ? Number(value.toFixed(METRIC_DECIMAL_PLACES))
        : value;

/**
 * @internal Builds the options-analysis LLM prompt.
 *
 * Build the LLM prompt for options analysis, split into a stable/dynamic pair
 * (spec §3.4, {@link AssembledPrompt}): `stable` is empty — this builder uses
 * no skills (per spec §3.2 "OPTIONS ... 스킬 도입 시 화이트리스트 확장은 후속
 * 과제") and has no other catalog-level knowledge to cache; `dynamic` is the
 * role/intro line, current price, the per-expiration Key Metrics JSON, and —
 * at the tail, after the data — the Output Schema + Interpretation Guide.
 * Keeping the output-format instructions at the tail — after the data they
 * must be grounded in — matches the fix applied to every other split builder
 * in this module (see prompt.ts's "Final reminder" comment for the full
 * rationale): output rules lose recency when they sit ahead of the data,
 * even though (as here) they contain zero interpolation and would otherwise
 * be a perfectly cacheable stable prefix. The prompt requests a JSON response
 * matching RawOptionsAnalysisResponse (kept tolerant — normalize will fill in
 * any missing fields).
 *
 * The instructions are in English; the JSON output schema specifies Korean
 * text for the model's user-facing fields (summary, commentary, message).
 *
 * @param options - Target expiration, company display name, and the
 *   pre-fetched options snapshot.
 * @returns `{ stable, dynamic }` ready to be sent to the LLM. Deterministic
 *   for a given input (no clocks, no random IDs).
 */
export function buildOptionsAnalysisPrompt(
    options: BuildOptionsAnalysisPromptOptions
): AssembledPrompt {
    const {
        expirationDate,
        companyName,
        snapshot,
        locale = DEFAULT_ANALYSIS_LOCALE,
    } = options;

    const targetChains =
        expirationDate === 'all'
            ? snapshot.chains
            : snapshot.chains.filter(c => c.expirationDate === expirationDate);

    const summaries = targetChains.map(c =>
        summarizeChainForLlm(c, snapshot.underlyingPrice)
    );

    const schemaLang = schemaLanguageLabel(locale);
    const stable = '';

    const dynamic = [
        `You are an options market analyst. Interpret the options market data for ${companyName} (${snapshot.symbol}) and write your analysis in ${outputLanguageName(locale)}.`,
        '',
        `Current price: $${formatPrice(snapshot.underlyingPrice)}`,
        '',
        '== Key Metrics by Expiration ==',
        JSON.stringify(summaries, roundMetric, 2),
        '',
        '== Output Schema ==',
        'Respond only with a JSON object matching the schema below. Do not include any other text.',
        '{',
        `  "summary": "전체 옵션 시장에 대한 한 문단 요약 (3-5문장, 친근한 어투, ${schemaLang})",`,
        '  "perExpiration": [',
        '    {',
        '      "expirationDate": "YYYY-MM-DD",',
        `      "commentary": "이 만기에 대한 해석 (2-3문장, ${schemaLang})",`,
        '      "tone": "bullish | bearish | neutral | cautious"',
        '    }',
        '  ],',
        '  "signals": [',
        '    {',
        '      "kind": "bullish | bearish | neutral | volatility",',
        `      "message": "신호 한 줄 설명 (${schemaLang})"`,
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
        `- Use a friendly but accurate tone in ${outputLanguageName(locale)}. Keep ticker symbols in English as-is (e.g. AAPL).`,
    ].join('\n');

    return { stable, dynamic };
}
