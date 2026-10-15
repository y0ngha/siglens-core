import {
    COMPOSITE_MIN_AXES,
    COMPOSITE_WEIGHTS,
    INSIDER_WINDOW_DAYS,
    LARGE_HOLDER_WINDOW_DAYS,
    INVESTOR_FLOWS_AXES,
} from '@/domain/investorFlows/constants';
import {
    evaluateInstitutionalAxis,
    usableQuarters,
} from '@/domain/investorFlows/institutionalAxis';
import {
    countInsiderTransactionsInWindow,
    evaluateInsiderAxis,
} from '@/domain/investorFlows/insiderAxis';
import { evaluateLargeHolderAxis } from '@/domain/investorFlows/largeHolderAxis';
import {
    clampScore,
    formatDay,
    isVisibleAsOf,
    labelForScore,
    parseAsOfDay,
    parseDay,
} from '@/domain/investorFlows/scoreHelpers';
import { evaluateShortAxis } from '@/domain/investorFlows/shortAxis';
import type {
    EvaluateInvestorFlowsOptions,
    InvestorFlowsAxisBase,
    InvestorFlowsComposite,
    InvestorFlowsFreshness,
    InvestorFlowsScorecard,
    InvestorFlowsSnapshot,
    InvestorFlowsWindow,
    ShortInterestPoint,
    ShortVolumePoint,
} from '@/domain/investorFlows/types';
import { MS_PER_DAY } from '@/domain/constants/time';

function windowOf(asOfDay: number | null, days: number): InvestorFlowsWindow {
    return asOfDay === null
        ? { from: null, to: null, days }
        : {
              from: formatDay(asOfDay - days * MS_PER_DAY),
              to: formatDay(asOfDay),
              days,
          };
}

function compositeOf(
    axes: readonly InvestorFlowsAxisBase[]
): InvestorFlowsComposite {
    const used = INVESTOR_FLOWS_AXES.flatMap(id => {
        const axis = axes.find(a => a.id === id);
        return axis !== undefined && axis.score !== null
            ? [{ id, score: axis.score, weight: COMPOSITE_WEIGHTS[id] }]
            : [];
    });
    if (used.length < COMPOSITE_MIN_AXES) {
        return {
            score: null,
            label: 'insufficient',
            axesUsed: used.map(u => u.id),
        };
    }
    // An axis without data abstains (weight 0, out of the denominator); it does not vote neutral.
    const totalWeight = used.reduce((sum, u) => sum + u.weight, 0);
    const score = clampScore(
        used.reduce((sum, u) => sum + u.score * u.weight, 0) / totalWeight
    );
    return {
        score,
        label: labelForScore(score),
        axesUsed: used.map(u => u.id),
    };
}

function latestDate(
    dates: readonly string[],
    asOfDay: number | null
): string | null {
    const valid = dates.filter(d => {
        const day = parseDay(d);
        return day !== null && isVisibleAsOf(day, asOfDay);
    });
    return valid.length === 0
        ? null
        : valid.reduce((a, b) => (b > a ? b : a)).slice(0, 10);
}

/**
 * Turn an investor flows snapshot into the deterministic investor-flows scorecard.
 *
 * Four axes (13F institutional, Form 4 insider, 13D/G large holders, FINRA
 * short) each get a -100..100 score, a label, a sufficiency flag and signals
 * with numeric evidence; a composite averages the axes that had data. Missing
 * data degrades an axis to `insufficient` with a `null` score — it is never
 * scored as zero — and an insufficient axis abstains from the composite.
 *
 * Pure and deterministic: windows are measured from `snapshot.asOf` (or
 * `options.asOf`), never from the wall clock. The reference date is normalized to
 * its UTC calendar day: a date-only string is that day, a datetime with an
 * explicit offset is converted to UTC first (`2026-10-15T23:30:00-05:00` is
 * 2026-10-16), and a datetime without an offset is read as UTC.
 *
 * **One "as of" rule for every source:** a row dated after the reference day
 * (age < 0) is dropped — a 13F quarter, an insider transaction, a 13D/G filing,
 * a short-interest settlement or a short-volume day — so it never counts toward
 * sufficiency, freshness or scoring. A snapshot whose rows are all future-dated
 * therefore leaves that axis `insufficient`.
 *
 * An axis is `sufficient` only when at least one directional input exists and
 * its data is fresh enough (see the freshness constants); otherwise it is
 * `insufficient`, and an insufficient axis abstains from the composite. Every threshold is a named
 * constant in `domain/investorFlows/constants.ts`.
 *
 * @param snapshot - InvestorFlows data assembled by the consumer's provider.
 * @param options - Optional reference-date override and FINRA switch.
 * @returns The scorecard to inject into prompts and render in UIs.
 * @example
 * ```ts
 * const card = evaluateInvestorFlows(snapshot);
 * card.composite.label; // 'bullish' | ... | 'insufficient'
 * ```
 */
export function evaluateInvestorFlows(
    snapshot: InvestorFlowsSnapshot,
    options: EvaluateInvestorFlowsOptions = {}
): InvestorFlowsScorecard {
    const asOf = options.asOf ?? snapshot.asOf;
    const asOfDay = parseAsOfDay(asOf);
    const includeFinra = options.includeFinraData ?? true;
    const shortInterest: readonly ShortInterestPoint[] | null = includeFinra
        ? snapshot.shortInterest
        : null;
    const shortVolume: readonly ShortVolumePoint[] | null = includeFinra
        ? snapshot.shortVolume
        : null;

    const institutional = evaluateInstitutionalAxis(
        snapshot.institutional,
        snapshot.sharesOutstanding,
        asOfDay
    );
    const insider = evaluateInsiderAxis(snapshot.insider, asOfDay);
    const largeHolders = evaluateLargeHolderAxis(
        snapshot.largeHolders,
        asOfDay
    );
    const short = evaluateShortAxis(
        shortInterest,
        shortVolume,
        snapshot.floatShares,
        asOfDay
    );

    // The same usable-quarter predicate the axis uses, so both agree on "latest".
    const latestQuarter = usableQuarters(
        snapshot.institutional.quarters,
        asOfDay
    ).at(0);
    const freshness: InvestorFlowsFreshness = {
        asOf: asOfDay === null ? null : formatDay(asOfDay),
        institutionalPeriod: institutional.metrics.scoredPeriod,
        latestInstitutionalPeriod: latestQuarter?.period ?? null,
        latestInstitutionalPeriodComplete: latestQuarter?.complete ?? null,
        shortInterestSettlementDate: latestDate(
            (shortInterest ?? []).map(p => p.settlementDate),
            asOfDay
        ),
        shortVolumeLatestDate: latestDate(
            (shortVolume ?? []).map(p => p.date),
            asOfDay
        ),
        insiderWindow: windowOf(asOfDay, INSIDER_WINDOW_DAYS),
        insiderTransactionsInWindow: countInsiderTransactionsInWindow(
            snapshot.insider,
            asOfDay
        ),
        largeHolderWindow: windowOf(asOfDay, LARGE_HOLDER_WINDOW_DAYS),
    };

    return {
        institutional,
        insider,
        largeHolders,
        short,
        composite: compositeOf([institutional, insider, largeHolders, short]),
        freshness,
    };
}
