import {
    INVESTOR_FLOWS_AXES,
    PROMPT_MAX_NAME_CHARS,
} from '@/domain/investorFlows/constants';
import type {
    InvestorFlowsAxisBase,
    InvestorFlowsAxisId,
    InvestorFlowsEvidence,
    InvestorFlowsFreshness,
    InvestorFlowsScorecard,
    InvestorFlowsSignal,
} from '@/domain/investorFlows/types';

/** Prompt heading per axis; names the source and its lag so the model reads the number in context. */
export const INVESTOR_FLOWS_AXIS_HEADINGS: Readonly<
    Record<InvestorFlowsAxisId, string>
> = {
    institutional:
        'institutional — SEC 13F holdings, quarterly, filed up to ~45 days after quarter end',
    insider:
        'insider — SEC Form 4 transactions, filed ~2 business days after the trade',
    largeHolders:
        'largeHolders — SEC Schedule 13D (activist intent) and 13G (passive) filings by 5%+ owners',
    short: 'short — FINRA short interest (twice a month) and off-exchange short volume (daily)',
};

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

function formatAxis(
    axis: InvestorFlowsAxisBase & { metrics: object | null }
): string {
    const heading = `- ${INVESTOR_FLOWS_AXIS_HEADINGS[axis.id]}`;
    if (axis.sufficiency === 'insufficient') {
        const signals = axis.signals.map(formatSignal).join('\n');
        return `${heading}\n  NO DATA — the inputs for this axis are missing or too thin to score. This is not a neutral reading.${signals === '' ? '' : `\n${signals}`}`;
    }
    const signals =
        axis.signals.length === 0
            ? '\n  signals: none'
            : `\n  signals:\n${axis.signals.map(formatSignal).join('\n')}`;
    return `${heading}\n  label=${axis.label}, score=${axis.score}${formatMetrics(axis.metrics)}${signals}`;
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
    ].join('\n');
}

/**
 * Render the computed scorecard as prompt text: composite, the four axes in
 * canonical order (an axis without data says so explicitly instead of reading
 * as neutral), then the freshness block.
 */
export function formatInvestorFlowsScorecard(
    scorecard: InvestorFlowsScorecard
): string {
    const { composite } = scorecard;
    const compositeLine =
        composite.score === null
            ? `Composite: NO DATA (fewer than two axes had data; axes with data: ${composite.axesUsed.join(', ') || 'none'})`
            : `Composite: label=${composite.label}, score=${composite.score} (axes used: ${composite.axesUsed.join(', ')})`;
    const axes = INVESTOR_FLOWS_AXES.map(id => formatAxis(scorecard[id])).join(
        '\n'
    );
    return `${compositeLine}\n${axes}\n\nData freshness:\n${formatInvestorFlowsFreshness(scorecard.freshness)}`;
}
