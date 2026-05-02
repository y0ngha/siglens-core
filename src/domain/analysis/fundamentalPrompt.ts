// All AI-facing prompt strings must be in English — Korean reduces analysis quality.

import { MIN_CONFIDENCE_WEIGHT } from '@/domain/indicators/constants';
import type { FundamentalSnapshot, Skill } from '@/domain/types';
import { formatNullableNumber as fmt } from './promptFormat';

/** Filter skills to fundamental category with sufficient confidence weight. */
function filterFundamentalSkills(skills: readonly Skill[]): Skill[] {
    return skills.filter(
        s =>
            s.category === 'fundamental' &&
            s.confidenceWeight >= MIN_CONFIDENCE_WEIGHT
    );
}

/** Render analyst grade counts into a compact inline string. */
function formatGrades(
    g: FundamentalSnapshot['futureDirection']['gradesConsensus']
): string {
    if (!g) return 'N/A';
    return `Strong Buy: ${g.strongBuy}, Buy: ${g.buy}, Hold: ${g.hold}, Sell: ${g.sell}, Strong Sell: ${g.strongSell}`;
}

/** Render price target data into a compact inline string. */
function formatPriceTarget(
    consensus: FundamentalSnapshot['futureDirection']['priceTargetConsensus']
): string {
    if (!consensus) return 'N/A';
    return `Consensus: ${fmt(consensus.consensus)}, High: ${fmt(consensus.high)}, Low: ${fmt(consensus.low)}, Median: ${fmt(consensus.median)}`;
}

/** Render sector direction as a compact inline string. */
function formatSectorDirection(
    sd: FundamentalSnapshot['sectorDirection']
): string {
    const today =
        sd.todayChangePct != null
            ? `${sd.todayChangePct >= 0 ? '+' : ''}${sd.todayChangePct.toFixed(2)}%`
            : 'N/A';
    const history = sd.historical
        .slice(0, 3)
        .map(
            h =>
                `${h.date}: ${h.changePct >= 0 ? '+' : ''}${h.changePct.toFixed(2)}%`
        )
        .join(', ');
    return `Today: ${today}${history ? `; Recent: ${history}` : ''}`;
}

/**
 * Build the AI fundamental-analysis prompt.
 *
 * Accepts the normalised {@link FundamentalSnapshot} and a list of loaded
 * {@link Skill}s. Only skills with `category === 'fundamental'` and
 * `confidenceWeight >= MIN_CONFIDENCE_WEIGHT` are injected into the prompt.
 *
 * Returns a fully self-contained English prompt string; the JSON output schema
 * specifies Korean text for fields labelled `KO`.
 *
 * @param symbol   - Stock ticker (e.g. `'AAPL'`).
 * @param snapshot - Normalised fundamental data for the symbol.
 * @param skills   - All loaded skills; non-fundamental / low-weight entries are filtered out.
 * @returns Prompt string ready to be sent to the LLM worker.
 */
export function buildFundamentalAnalysisPrompt(
    symbol: string,
    snapshot: FundamentalSnapshot,
    skills: readonly Skill[]
): string {
    const {
        profile,
        valuation,
        peers,
        profitability,
        growth,
        health,
        futureDirection,
        sectorDirection,
    } = snapshot;

    const qualifiedSkills = filterFundamentalSkills(skills);
    const skillsSection =
        qualifiedSkills.length > 0
            ? qualifiedSkills
                  .map(s => `### ${s.name}\n${s.content}`)
                  .join('\n\n')
            : 'No additional fundamental skills loaded.';

    const peerLines =
        peers.length > 0
            ? peers
                  .map(
                      p =>
                          `  - ${p.symbol} (${p.companyName}): Market Cap ${(p.marketCap / 1e9).toFixed(0)}B`
                  )
                  .join('\n')
            : '  None';

    return `You are a seasoned equity analyst. Analyze the fundamental data for ${symbol} (${profile.companyName}) and respond with a JSON object matching the exact schema below. No markdown, no extra text — only valid JSON.

## Company Profile
- Symbol: ${symbol}
- Name: ${profile.companyName}
- Sector: ${profile.sector}
- Industry: ${profile.industry}
- Market Cap: ${(profile.marketCap / 1e9).toFixed(0)}B USD
- CEO: ${profile.ceo ?? 'N/A'}
- Description: ${profile.description ?? 'N/A'}

## Valuation Multiples
- P/E (TTM): ${fmt(valuation.per)}
- P/S (TTM): ${fmt(valuation.psr)}
- P/B: ${fmt(valuation.pbr)}
- PEG: ${fmt(valuation.peg)}
- EV/EBITDA: ${fmt(valuation.evToEbitda)}
- EPS (TTM): ${fmt(valuation.eps)}

## Comparable Peers
${peerLines}

## Profitability
- ROE: ${fmt(profitability.roe)}%
- ROA: ${fmt(profitability.roa)}%
- Operating Margin: ${fmt(profitability.operatingMargin)}%
- Net Margin: ${fmt(profitability.netMargin)}%

## Growth (YoY)
- Revenue: ${fmt(growth.revenueYoy)}%
- EPS: ${fmt(growth.epsYoy)}%

## Financial Health
- Debt Ratio: ${fmt(health.debtRatio)}
- Current Ratio: ${fmt(health.currentRatio)}
- Operating Cash Flow: ${health.operatingCashFlow != null ? (health.operatingCashFlow / 1e9).toFixed(1) + 'B' : 'N/A'}
- Altman Z-Score: ${fmt(health.altmanZScore)}
- Piotroski Score: ${health.piotroskiScore ?? 'N/A'}/9

## Forward / Analyst Outlook
- Next Earnings: ${futureDirection.nextEarningsAt ?? 'N/A'}
- Analyst EPS Estimate: ${fmt(futureDirection.analystEstimateEps)}
- Analyst Revenue Estimate: ${futureDirection.analystEstimateRevenue != null ? (futureDirection.analystEstimateRevenue / 1e9).toFixed(1) + 'B' : 'N/A'}
- Analyst Grades: ${formatGrades(futureDirection.gradesConsensus)}
- Price Target: ${formatPriceTarget(futureDirection.priceTargetConsensus)}

## Sector Direction
${formatSectorDirection(sectorDirection)}

## Fundamental Analysis Frameworks (Active Skills)
${skillsSection}

## Output Schema
{
  "overallConclusionKo": "한국어 한 단락 — 종합 결론",
  "categoryAssessments": [
    {
      "category": "valuation" | "profitability" | "growth" | "health" | "futureDirection",
      "sentiment": "bullish" | "neutral" | "bearish",
      "rationaleKo": "한국어 한 단락 — 카테고리별 평가"
    }
  ],
  "riskFactorsKo": ["위험 요인 1 (한국어)", "위험 요인 2 (한국어)"],
  "overallSentiment": "bullish" | "neutral" | "bearish"
}

Rules:
- Respond with valid JSON only. No markdown fences.
- All KO fields must be written in Korean (존댓말).
- categoryAssessments must include all 5 categories in any order.
- overallSentiment must reflect the balance of all 5 category sentiments.`;
}
