import {
    COMPOSITE_MIN_AXES,
    COMPOSITE_WEIGHTS,
    DILUTION_WINDOW_DAYS,
    INSIDER_WINDOW_DAYS,
    KR_WINDOW_DAYS,
    LARGE_HOLDER_WINDOW_DAYS,
    INVESTOR_FLOWS_AXES,
} from '@/domain/investorFlows/constants';
import { evaluateDilutionAxis } from '@/domain/investorFlows/dilutionAxis';
import { evaluateKrInsiderAxis } from '@/domain/investorFlows/krInsiderAxis';
import { evaluateKrMajorHolderAxis } from '@/domain/investorFlows/krMajorHolderAxis';
import { evaluateSqueezeRisk } from '@/domain/investorFlows/squeezeRisk';
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
    daysBetween,
    formatDay,
    isVisibleAsOf,
    labelForScore,
    parseAsOfDay,
    parseDay,
} from '@/domain/investorFlows/scoreHelpers';
import { evaluateShortAxis } from '@/domain/investorFlows/shortAxis';
import type {
    EvaluateInvestorFlowsOptions,
    InsiderAxis,
    InvestorFlowsAxisBase,
    InvestorFlowsComposite,
    InvestorFlowsFreshness,
    InvestorFlowsScorecard,
    InvestorFlowsSnapshot,
    InvestorFlowsWindow,
    KrDisclosureSnapshot,
    LargeHolderAxis,
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

const EMPTY_KR: KrDisclosureSnapshot = {
    majorHolders: [],
    insiders: [],
    tradingPlans: [],
};

/** Newest DART receipt date on or before the reference day. */
function krLatestDate(
    kr: KrDisclosureSnapshot,
    asOfDay: number | null
): string | null {
    return latestDate(
        [
            ...kr.majorHolders.map(r => r.receiptDate),
            ...kr.insiders.map(r => r.receiptDate),
            ...kr.tradingPlans.map(r => r.receiptDate),
        ],
        asOfDay
    );
}

/** Number of KR insider reports and trading plans inside the window (freshness metadata). */
function countKrInsiderRowsInWindow(
    kr: KrDisclosureSnapshot,
    asOfDay: number | null
): number {
    if (asOfDay === null) return 0;
    return [...kr.insiders, ...kr.tradingPlans].filter(r => {
        const day = parseDay(r.receiptDate);
        if (day === null) return false;
        const age = daysBetween(day, asOfDay);
        return age >= 0 && age <= KR_WINDOW_DAYS;
    }).length;
}

/**
 * Korean scorecard: DART reports fill the `largeHolders` and `insider` slots;
 * the US-only axes (13F, FINRA / SEC short, SEC offerings) have no Korean
 * source and are insufficient, so they abstain from the composite.
 */
function evaluateKrScorecard(
    snapshot: InvestorFlowsSnapshot,
    asOfDay: number | null
): InvestorFlowsScorecard {
    const kr = snapshot.kr ?? EMPTY_KR;
    const largeHolders: LargeHolderAxis = evaluateKrMajorHolderAxis(
        kr.majorHolders,
        asOfDay
    );
    const insider: InsiderAxis = evaluateKrInsiderAxis(
        kr,
        snapshot.sharesOutstanding,
        asOfDay
    );
    const institutional = evaluateInstitutionalAxis(
        { quarters: [], topHolders: [], topHoldersPeriod: null },
        null,
        asOfDay
    );
    const short = evaluateShortAxis(null, null, null, asOfDay);
    const dilution = evaluateDilutionAxis(undefined, asOfDay);
    const freshness: InvestorFlowsFreshness = {
        asOf: asOfDay === null ? null : formatDay(asOfDay),
        institutionalPeriod: null,
        latestInstitutionalPeriod: null,
        latestInstitutionalPeriodComplete: null,
        shortInterestSettlementDate: null,
        shortVolumeLatestDate: null,
        insiderWindow: windowOf(asOfDay, KR_WINDOW_DAYS),
        insiderTransactionsInWindow: countKrInsiderRowsInWindow(kr, asOfDay),
        largeHolderWindow: windowOf(asOfDay, KR_WINDOW_DAYS),
        failsToDeliverLatestDate: null,
        dilutionWindow: windowOf(asOfDay, DILUTION_WINDOW_DAYS),
        krDisclosureLatestDate: krLatestDate(kr, asOfDay),
    };
    return {
        institutional,
        insider,
        largeHolders,
        short,
        dilution,
        market: 'kr',
        squeezeRisk: null,
        composite: compositeOf([
            institutional,
            insider,
            largeHolders,
            short,
            dilution,
        ]),
        freshness,
    };
}

/**
 * Turn an investor flows snapshot into the deterministic investor-flows scorecard.
 *
 * Five axes (13F institutional, Form 4 / Form 144 insider, 13D/G large holders,
 * FINRA / SEC short, SEC offering dilution) each get a -100..100 score, a label, a sufficiency flag and signals
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
 * **Korean snapshots** (`market: 'kr'`) are scored from `snapshot.kr` only:
 * DART major-holder reports fill `largeHolders`, executive / major-shareholder
 * and trading-plan reports fill `insider` (share- and ratio-based thresholds,
 * `kr_*` signals), and institutional, short and dilution are insufficient. No
 * squeeze score is computed for them.
 *
 * **Squeeze score:** with `options.squeezeContext` the scorecard carries
 * `evaluateSqueezeRisk`'s result and the `short_squeeze_risk` signal follows
 * it; without it `squeezeRisk` is `null` and the signal keeps the price-free rule.
 *
 * @param snapshot - InvestorFlows data assembled by the consumer's provider.
 * @param options - Reference-date override, data switches and squeeze context.
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
    if (snapshot.market === 'kr') return evaluateKrScorecard(snapshot, asOfDay);
    const includeFinra = options.includeFinraData ?? true;
    const includeLists = options.includeExchangeLists ?? true;
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
    const insider = evaluateInsiderAxis(
        snapshot.insider,
        asOfDay,
        snapshot.proposedSales ?? []
    );
    const largeHolders = evaluateLargeHolderAxis(
        snapshot.largeHolders,
        asOfDay
    );
    const squeezeRisk =
        options.squeezeContext === undefined
            ? null
            : evaluateSqueezeRisk(snapshot, options.squeezeContext, {
                  asOf,
                  includeFinraData: includeFinra,
                  includeExchangeLists: includeLists,
              });
    const short = evaluateShortAxis(
        shortInterest,
        shortVolume,
        snapshot.floatShares,
        asOfDay,
        {
            failsToDeliver: snapshot.failsToDeliver ?? null,
            sharesOutstanding: snapshot.sharesOutstanding,
            thresholdList: includeLists
                ? (snapshot.thresholdList ?? null)
                : null,
            ...(squeezeRisk === null ? {} : { squeeze: squeezeRisk }),
        }
    );
    const dilution = evaluateDilutionAxis(snapshot.offerings, asOfDay);

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
        failsToDeliverLatestDate: latestDate(
            (snapshot.failsToDeliver ?? []).map(p => p.settlementDate),
            asOfDay
        ),
        dilutionWindow: windowOf(asOfDay, DILUTION_WINDOW_DAYS),
        krDisclosureLatestDate: null,
    };

    return {
        institutional,
        insider,
        largeHolders,
        short,
        dilution,
        market: 'us',
        squeezeRisk,
        composite: compositeOf([
            institutional,
            insider,
            largeHolders,
            short,
            dilution,
        ]),
        freshness,
    };
}
