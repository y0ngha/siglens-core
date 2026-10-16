import {
    INVESTOR_FLOWS_AXES,
    PROMPT_MAX_NAME_CHARS,
    PROMPT_MAX_SQUEEZE_COMPONENTS,
} from '@/domain/investorFlows/constants';
import type {
    InvestorFlowsAxisBase,
    InvestorFlowsAxisId,
    InvestorFlowsEvidence,
    InvestorFlowsFreshness,
    InvestorFlowsScorecard,
    InvestorFlowsSignal,
    SqueezeRiskScore,
} from '@/domain/investorFlows/types';

/** Prompt heading per axis (US listings); names the source and its lag so the model reads the number in context. */
export const INVESTOR_FLOWS_AXIS_HEADINGS: Readonly<
    Record<InvestorFlowsAxisId, string>
> = {
    institutional:
        'institutional — SEC 13F holdings, quarterly, filed up to ~45 days after quarter end (13F option positions are underlying notional, mostly hedges)',
    insider:
        'insider — SEC Form 4 transactions (filed ~2 business days after the trade) and Form 144 notices of proposed sales',
    largeHolders:
        'largeHolders — SEC Schedule 13D (activist intent) and 13G (passive) filings by 5%+ owners',
    short: 'short — FINRA short interest (twice a month) and off-exchange short volume (daily); SEC fails to deliver (published ~2 weeks late) and Reg SHO threshold lists',
    dilution:
        'dilution — SEC registration and offering filings (S-1/F-1, S-3/F-3 shelves, 424B prospectus supplements, Form D) over the last 180 days',
};

/** Axes scored for Korean listings, in canonical order. */
export const KR_SCORED_AXES: readonly InvestorFlowsAxisId[] = [
    'insider',
    'largeHolders',
];

/** Prompt heading per Korean-scored axis. */
export const KR_INVESTOR_FLOWS_AXIS_HEADINGS: Readonly<
    Record<'insider' | 'largeHolders', string>
> = {
    insider:
        'insider — DART executive / major-shareholder ownership reports (임원·주요주주 소유상황보고; no trade cause is reported) and trading-plan reports (거래계획보고서)',
    largeHolders:
        'largeHolders — DART 5%+ major-holder reports (대량보유 상황보고; no holding purpose is reported)',
};

/** The line that replaces the US-only axes for a Korean listing. Prompt wording. */
export const KR_NOT_PROVIDED_LINE =
    '- institutional, short, dilution — NOT PROVIDED for Korean listings: institutional / foreign net buying, short selling and offering filings are not in this dataset. Say they are not provided; never describe them as neutral or fill them in from general knowledge.';

/** Strip line breaks and clip a filing-supplied name so it cannot inject prompt structure. */
export function sanitizePromptText(text: string, maxChars: number): string {
    const flat = text.replace(/\s+/g, ' ').trim();
    return flat.length > maxChars ? `${flat.slice(0, maxChars)}…` : flat;
}

function formatEvidence(evidence: InvestorFlowsEvidence): string {
    return Object.entries(evidence)
        .map(([key, value]) => `${key}=${value === null ? 'n/a' : value}`)
        .join(', ');
}

function formatSignal(signal: InvestorFlowsSignal): string {
    const subject =
        signal.subject === undefined
            ? ''
            : ` [${sanitizePromptText(signal.subject, PROMPT_MAX_NAME_CHARS)}]`;
    return `  - ${signal.id}${subject}: ${signal.direction}, ${signal.strength} (${formatEvidence(signal.evidence)})`;
}

function formatMetrics(metrics: object | null): string {
    if (metrics === null) return '';
    const parts = Object.entries(metrics).flatMap(([key, value]) => {
        if (value === null) return [`${key}=n/a`];
        if (typeof value === 'object') return [];
        return [`${key}=${value}`];
    });
    return parts.length === 0 ? '' : `\n  metrics: ${parts.join(', ')}`;
}

type FormattableAxis = InvestorFlowsAxisBase & {
    metrics: object | null;
    krMetrics?: object;
};

function formatAxis(axis: FormattableAxis, headingText: string): string {
    const heading = `- ${headingText}`;
    if (axis.sufficiency === 'insufficient') {
        const signals = axis.signals.map(formatSignal).join('\n');
        return `${heading}\n  NO DATA — the inputs for this axis are missing or too thin to score. This is not a neutral reading.${signals === '' ? '' : `\n${signals}`}`;
    }
    const signals =
        axis.signals.length === 0
            ? '\n  signals: none'
            : `\n  signals:\n${axis.signals.map(formatSignal).join('\n')}`;
    return `${heading}\n  label=${axis.label}, score=${axis.score}${formatMetrics(axis.krMetrics ?? axis.metrics)}${signals}`;
}

/** The computed squeeze score: level, coverage and its largest inputs. */
export function formatSqueezeRisk(squeeze: SqueezeRiskScore): string {
    if (squeeze.score === null) {
        return 'Short squeeze risk (computed): NO DATA — no short-side input (FINRA, fails to deliver, threshold list) was available. This is not a low reading.';
    }
    const coverage =
        squeeze.sufficiency === 'full'
            ? 'all inputs present'
            : `partial — missing: ${squeeze.missing.join(', ')}`;
    const cap = squeeze.levelCapped
        ? '; level held at elevated because no short-positioning input was available'
        : '';
    const top = squeeze.components
        .slice(0, PROMPT_MAX_SQUEEZE_COMPONENTS)
        .map(c => `${c.id}=${c.value} (contribution ${c.contribution})`)
        .join(', ');
    return `Short squeeze risk (computed): score=${squeeze.score}/100, level=${squeeze.level} (${coverage}${cap})\n  top inputs: ${top}\n  last completed daily bar used: ${squeeze.lastBarDate ?? 'none'}`;
}

/** Dates of every underlying source, so an answer can say how old each number is. */
export function formatInvestorFlowsFreshness(
    freshness: InvestorFlowsFreshness
): string {
    const quarter =
        freshness.latestInstitutionalPeriod === null
            ? '13F quarters: none'
            : `13F: scored quarter ${freshness.institutionalPeriod ?? 'none (no complete quarter)'}; latest quarter present ${freshness.latestInstitutionalPeriod} is ${freshness.latestInstitutionalPeriodComplete ? 'complete' : 'IN PROGRESS (partial, not scored)'}`;
    return [
        `- Snapshot as-of: ${freshness.asOf ?? 'unknown'}`,
        `- ${quarter}`,
        `- FINRA short interest settlement date: ${freshness.shortInterestSettlementDate ?? 'n/a'}`,
        `- FINRA off-exchange short volume latest trade date: ${freshness.shortVolumeLatestDate ?? 'n/a'}`,
        `- Insider window: ${freshness.insiderWindow.from ?? 'n/a'} to ${freshness.insiderWindow.to ?? 'n/a'} (${freshness.insiderTransactionsInWindow} Form 4 transactions)`,
        `- 13D/13G window: ${freshness.largeHolderWindow.from ?? 'n/a'} to ${freshness.largeHolderWindow.to ?? 'n/a'}`,
        `- SEC fails-to-deliver latest settlement date: ${freshness.failsToDeliverLatestDate ?? 'n/a'}`,
        `- Offering filings window: ${freshness.dilutionWindow.from ?? 'n/a'} to ${freshness.dilutionWindow.to ?? 'n/a'}`,
    ].join('\n');
}

/** Dates of the Korean (DART) sources. */
export function formatKrInvestorFlowsFreshness(
    freshness: InvestorFlowsFreshness
): string {
    return [
        `- Snapshot as-of: ${freshness.asOf ?? 'unknown'}`,
        `- Latest DART receipt date: ${freshness.krDisclosureLatestDate ?? 'n/a'}`,
        `- DART window: ${freshness.insiderWindow.from ?? 'n/a'} to ${freshness.insiderWindow.to ?? 'n/a'} (${freshness.insiderTransactionsInWindow} executive / major-shareholder and trading-plan reports)`,
    ].join('\n');
}

function compositeLineOf(scorecard: InvestorFlowsScorecard): string {
    const { composite } = scorecard;
    return composite.score === null
        ? `Composite: NO DATA (fewer than two axes had data; axes with data: ${composite.axesUsed.join(', ') || 'none'})`
        : `Composite: label=${composite.label}, score=${composite.score} (axes used: ${composite.axesUsed.join(', ')})`;
}

function formatKrScorecard(scorecard: InvestorFlowsScorecard): string {
    const axes = KR_SCORED_AXES.map(id =>
        id === 'insider'
            ? formatAxis(
                  scorecard.insider,
                  KR_INVESTOR_FLOWS_AXIS_HEADINGS.insider
              )
            : formatAxis(
                  scorecard.largeHolders,
                  KR_INVESTOR_FLOWS_AXIS_HEADINGS.largeHolders
              )
    ).join('\n');
    return `${compositeLineOf(scorecard)}\n${axes}\n${KR_NOT_PROVIDED_LINE}\n\nData freshness:\n${formatKrInvestorFlowsFreshness(scorecard.freshness)}`;
}

/**
 * Render the computed scorecard as prompt text: composite, the axes in
 * canonical order (an axis without data says so explicitly instead of reading
 * as neutral), the squeeze score when one was computed, then the freshness block.
 *
 * A Korean scorecard renders only the two DART-scored axes with DART headings,
 * one line saying the US-only sources are not provided (no 13F / FINRA / SEC
 * wording), and the DART freshness block.
 */
export function formatInvestorFlowsScorecard(
    scorecard: InvestorFlowsScorecard
): string {
    if (scorecard.market === 'kr') return formatKrScorecard(scorecard);
    const axes = INVESTOR_FLOWS_AXES.map(id =>
        formatAxis(scorecard[id], INVESTOR_FLOWS_AXIS_HEADINGS[id])
    ).join('\n');
    const squeeze =
        scorecard.squeezeRisk === null
            ? ''
            : `\n${formatSqueezeRisk(scorecard.squeezeRisk)}`;
    return `${compositeLineOf(scorecard)}\n${axes}${squeeze}\n\nData freshness:\n${formatInvestorFlowsFreshness(scorecard.freshness)}`;
}
