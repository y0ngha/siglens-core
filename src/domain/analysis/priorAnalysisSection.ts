// This section, like `ANTI_FABRICATION_GUARDRAIL` and `formatFearGreedSection`,
// is deliberately English-only with no `locale` parameter. Two reasons, not one:
// prose in a non-English locale measurably degrades analysis quality (see the
// header comment in `fearGreedSection.ts`), and — more importantly here — the
// prior-analysis history pool feeding this renderer is shared across all four
// output locales, and the cache-key fingerprint the caller derives from that
// same pool must not fork per locale. A `locale` parameter would make the
// rendered digest (and therefore the fingerprint) vary per locale for data
// that is identical underneath, splitting one cache entry into four for no
// reason. Do not add one.

import { barTimeMs, findAnchorBarIndex } from '@/domain/analysis/priorAnalysis';
import {
    TIMEFRAME_LABEL,
    formatBarDateTime,
    formatNullableNumber,
} from '@/domain/analysis/promptFormat';
import type { Bar, PriorAnalysis, Timeframe } from '@/domain/types';

const PRICE_DECIMAL_PLACES = 2;
const PERCENT_DECIMAL_PLACES = 2;

/**
 * Price for prompt injection, or `null` when the value is not a finite number.
 *
 * `formatNullableNumber` only guards `null`/`undefined`: `NaN.toFixed(2)` is
 * the literal string `'NaN'` and `Infinity.toFixed(2)` is `'Infinity'`, so an
 * unguarded consumer row with `stopLoss: NaN` would render `SL NaN` straight
 * into a prompt billed to a paid model. Callers treat `null` as "this value is
 * absent" and omit the corresponding fragment, which is the honest reading of
 * a non-finite input — the same posture {@link percentFrom} takes for a zero
 * reference price.
 */
const finitePrice = (n: number | undefined): string | null =>
    n != null && Number.isFinite(n)
        ? formatNullableNumber(n, PRICE_DECIMAL_PLACES)
        : null;

const fmtPrice = (n: number): string =>
    formatNullableNumber(n, PRICE_DECIMAL_PLACES);

/** Signed percentage, e.g. `+1.80%` / `-4.30%` — mirrors the `sign + toFixed` convention already used by `marketBriefingPrompt.ts` / `fundamentalPrompt.ts`. */
const fmtSignedPercent = (n: number): string =>
    `${n >= 0 ? '+' : ''}${n.toFixed(PERCENT_DECIMAL_PLACES)}%`;

/**
 * Percentage move of `value` from `reference`, formatted signed.
 *
 * A `reference` of `0` yields `'n/a'` rather than `Infinity%` / `NaN%`. A real
 * `Bar.close` is never `0` for a tradeable instrument, but this renderer's
 * output goes straight into a model prompt, so a bad consumer feed would
 * otherwise inject silent garbage rather than fail. Sibling domain modules
 * guard the identical "percent change from a close" pattern the same way
 * (`dashboard.ts`, `marketCalendar.ts`); they substitute `0`, which would be a
 * false reading here, so this one reports the absence instead.
 */
const percentFrom = (reference: number, value: number): string =>
    reference === 0 || !Number.isFinite(reference) || !Number.isFinite(value)
        ? 'n/a'
        : fmtSignedPercent(((value - reference) / reference) * 100);

/**
 * `low <= stopLoss` when a stop was set; renders which of the two happened,
 * never silently omits it. Returns `null` for a non-finite `stopLoss` so the
 * fragment is dropped entirely.
 *
 * The `null` case is not cosmetic. Every comparison against `NaN` is `false`,
 * so an unguarded `NaN` stop would always render the literal verdict
 * `'stop not breached'` — a confident, wrong statement of fact handed to the
 * model, which is worse than saying nothing.
 */
const formatStopWord = (stopLoss: number, low: number): string | null => {
    if (!Number.isFinite(stopLoss) || !Number.isFinite(low)) return null;
    return low <= stopLoss ? 'stop breached' : 'stop not breached';
};

/**
 * `high >= takeProfitPrices[0]` (the nearest target, first because they are
 * ascending); renders which of the two happened, never silently omits it.
 * Returns `null` for a non-finite target — see {@link formatStopWord} for why
 * a wrong verdict is worse than an absent one.
 */
const formatTargetWord = (firstTarget: number, high: number): string | null => {
    if (!Number.isFinite(firstTarget) || !Number.isFinite(high)) return null;
    return high >= firstTarget ? 'target reached' : 'target not reached';
};

/** `entry a-b` for a range, `entry a` for a single price; `''` when absent. */
const formatEntryPlanPart = (
    entryPrices: readonly number[] | undefined
): string => {
    if (!entryPrices || entryPrices.length === 0) return '';
    // Non-finite entries are dropped before the range is formed, so a partly
    // corrupt array degrades to the usable subset instead of rendering
    // `entry NaN-180.00`.
    const finite = entryPrices.filter(Number.isFinite);
    if (finite.length === 0) return '';
    if (finite.length === 1) return `entry ${fmtPrice(finite[0])}`;
    return `entry ${fmtPrice(finite[0])}-${fmtPrice(finite[finite.length - 1])}`;
};

/** `TP a/b/...` in the given (ascending) order; `''` when absent. */
const formatTakeProfitPlanPart = (
    takeProfitPrices: readonly number[] | undefined
): string => {
    if (!takeProfitPrices || takeProfitPrices.length === 0) return '';
    const finite = takeProfitPrices.filter(Number.isFinite);
    if (finite.length === 0) return '';
    return `TP ${finite.map(fmtPrice).join('/')}`;
};

/** One rendered past call, newest-first order trusted from the caller (`selected` is not re-sorted here). */
function formatEntry(
    entry: PriorAnalysis,
    bars: readonly Bar[]
): string | null {
    const anchorIndex = findAnchorBarIndex(bars, entry.generatedAt.getTime());
    if (anchorIndex === null) return null;

    const anchorBar = bars[anchorIndex];
    const lastBar = bars[bars.length - 1];
    const barsAgo = bars.length - 1 - anchorIndex;
    // Derived from the anchor bar's own time (not `generatedAt`) and rendered
    // with the **same** helper `formatBarRow` uses, so this string appears
    // verbatim in `## Recent Bar Data` above. That exact match is the point:
    // it lets the model line a past call up with the bar it was made on
    // instead of counting `N bars ago` backwards — a count that cannot be
    // converted into elapsed time, since bar distance skips overnight and
    // weekend gaps.
    const anchorDate = formatBarDateTime(barTimeMs(anchorBar));

    const planParts = [
        formatEntryPlanPart(entry.entryPrices),
        formatTakeProfitPlanPart(entry.takeProfitPrices),
        finitePrice(entry.stopLoss) !== null
            ? `SL ${finitePrice(entry.stopLoss)}`
            : '',
    ].filter(part => part !== '');
    const plan =
        planParts.length > 0 ? planParts.join(', ') : 'no entry recommended';

    const headerLine = `- ${barsAgo} bars ago (${anchorDate}): ${entry.trend}, ${entry.riskLevel} risk | ${plan}`;

    const subsequentBars = bars.slice(anchorIndex + 1);
    if (subsequentBars.length === 0) {
        // The analysis lands on the final bar — there is no "afterwards" to
        // score it against. Rendering a since-line here would fabricate an
        // outcome (e.g. "now" identical to the reference price by
        // construction), so the entry stops at the header line.
        return headerLine;
    }

    const reference = anchorBar.close;
    const high = Math.max(...subsequentBars.map(b => b.high));
    const low = Math.min(...subsequentBars.map(b => b.low));
    const now = lastBar.close;

    // Bar-derived prices need the same non-finite guard as the consumer's own
    // numbers. `bars` come from the injected `MarketDataProvider`, which core
    // does not control: a single `NaN` high propagates through `Math.max` and
    // would render `high NaN` into a prompt billed to a paid model — the exact
    // defect the `PriorAnalysis` field guards above exist to prevent, just
    // arriving by a different path.
    const highText = finitePrice(high);
    const lowText = finitePrice(low);
    const nowText = finitePrice(now);
    if (highText === null || lowText === null || nowText === null) {
        // Without a trustworthy reference frame there is no honest outcome to
        // state, so the entry stops at its header line rather than reporting a
        // partial one the model would read as complete.
        return headerLine;
    }

    const stopWord =
        entry.stopLoss != null ? formatStopWord(entry.stopLoss, low) : null;
    // The nearest target is the first FINITE one, not simply `[0]` — a corrupt
    // leading element must not suppress a verdict the remaining targets can
    // still support.
    const nearestTarget = entry.takeProfitPrices?.find(Number.isFinite);
    const targetWord =
        nearestTarget !== undefined
            ? formatTargetWord(nearestTarget, high)
            : null;

    const sinceParts = [
        `high ${highText} (${percentFrom(reference, high)})`,
        `low ${lowText} (${percentFrom(reference, low)})`,
        ...(stopWord !== null ? [stopWord] : []),
        ...(targetWord !== null ? [targetWord] : []),
    ];
    const sinceLine = `  -> since: ${sinceParts.join(', ')}; now ${nowText} (${percentFrom(reference, now)})`;

    return `${headerLine}\n${sinceLine}`;
}

/**
 * @internal
 * Guardrail appended after every rendered `## Prior Analyses` section.
 *
 * Without this line the feature is a net harm rather than a help: handing the
 * model its own past verdicts primes it to anchor on them — to keep calling a
 * symbol bullish because the last three calls were bullish — instead of
 * reading the current chart on its own terms. The three clauses close that
 * off explicitly: current data overrides history on conflict, a wrong past
 * call must be named as wrong (not quietly dropped), and "the history leans
 * this way" is never itself a justification for the new verdict. Do not
 * delete this as boilerplate — it is the reason the feature is safe to ship.
 */
export const PRIOR_ANALYSIS_GUARDRAIL =
    'Prior-analysis guardrail: the history above is reference only. Where it conflicts with the current data, current data always wins. If a past call was wrong, say so explicitly and state in one line what changed since then. Do not maintain a direction, risk level, or plan because the history leans that way — the justification for your verdict is always the computed data above, never your own prior output.';

/**
 * @internal
 *
 * Renders selected prior analyses into a `## Prior Analyses` prompt section,
 * each past call scored against what price actually did afterwards (high /
 * low / now relative to the price at the time of that call, plus whether its
 * stop was breached and whether its first target was reached).
 *
 * Returns `''` when `selected` or `bars` is empty, following the same
 * "empty section is skipped by the caller" contract `buildAnalysisPrompt`
 * already uses for `positionHint` (only push a non-empty section into
 * `dynamicSections`).
 *
 * Purely a renderer over data the caller already narrowed with
 * `selectPriorAnalyses` — this function does not re-filter, re-sort, or
 * re-limit `selected`; it renders it in the order given.
 *
 * @param selected - Prior analyses to render, newest-first (as returned by `selectPriorAnalyses`).
 * @param bars - OHLCV history for the same symbol + timeframe, oldest-first.
 * @param symbol - Ticker symbol, for the section header.
 * @param timeframe - Chart timeframe, for the section header label.
 */
export function formatPriorAnalysisSection(
    selected: readonly PriorAnalysis[],
    bars: readonly Bar[],
    symbol: string,
    timeframe: Timeframe
): string {
    if (selected.length === 0 || bars.length === 0) return '';

    const entryLines = selected
        .map(entry => formatEntry(entry, bars))
        .filter((line): line is string => line !== null);
    if (entryLines.length === 0) return '';

    const header = `## Prior Analyses (${symbol} · ${TIMEFRAME_LABEL[timeframe]} · reference only)`;

    return `${[header, ...entryLines].join('\n')}\n\n${PRIOR_ANALYSIS_GUARDRAIL}`;
}
