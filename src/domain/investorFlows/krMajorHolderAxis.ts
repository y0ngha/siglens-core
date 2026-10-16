import {
    KR_MAJOR_HOLDER_CHANGE_MODERATE_PCT,
    KR_MAJOR_HOLDER_CHANGE_STRONG_PCT,
    KR_MAJOR_HOLDER_CHANGE_WEAK_PCT,
    KR_MAJOR_HOLDER_THRESHOLD_PCT,
    KR_WINDOW_DAYS,
} from '@/domain/investorFlows/constants';
import {
    daysBetween,
    groupByKey,
    isFiniteNumber,
    labelForScore,
    makeSignal,
    parseDay,
    roundValue,
    scoreFromSignals,
    sortSignals,
    strengthOf,
} from '@/domain/investorFlows/scoreHelpers';
import type {
    InvestorFlowsSignal,
    InvestorFlowsSignalDirection,
    InvestorFlowsSignalId,
    KrMajorHolderMetrics,
    KrMajorHolderReport,
    LargeHolderAxis,
} from '@/domain/investorFlows/types';

type KrHolderEvent = 'new' | 'increase' | 'reduction' | 'exit';

interface DatedReport {
    readonly report: KrMajorHolderReport;
    readonly day: number;
}

const EVENT_SIGNAL: Readonly<Record<KrHolderEvent, InvestorFlowsSignalId>> = {
    new: 'kr_major_holder_new',
    increase: 'kr_major_holder_increase',
    reduction: 'kr_major_holder_reduction',
    exit: 'kr_major_holder_exit',
};

const EVENT_DIRECTION: Readonly<
    Record<KrHolderEvent, InvestorFlowsSignalDirection>
> = {
    new: 'bullish',
    increase: 'bullish',
    reduction: 'bearish',
    exit: 'bearish',
};

function reporterKey(report: KrMajorHolderReport): string {
    return report.reporter.trim().toLowerCase();
}

/** Crossing the 5% line is an event in itself; inside it, the net ratio change decides. */
function classify(
    priorRatio: number,
    latestRatio: number,
    netChange: number
): KrHolderEvent | null {
    if (
        priorRatio < KR_MAJOR_HOLDER_THRESHOLD_PCT &&
        latestRatio >= KR_MAJOR_HOLDER_THRESHOLD_PCT
    ) {
        return 'new';
    }
    if (
        priorRatio >= KR_MAJOR_HOLDER_THRESHOLD_PCT &&
        latestRatio < KR_MAJOR_HOLDER_THRESHOLD_PCT
    ) {
        return 'exit';
    }
    if (netChange > 0) return 'increase';
    if (netChange < 0) return 'reduction';
    return null;
}

/** One signal for one reporter's reports in the window (oldest first). */
function reporterSignal(
    reports: readonly DatedReport[]
): InvestorFlowsSignal[] {
    const latest = reports[reports.length - 1].report;
    const netChange = roundValue(
        reports.reduce((sum, r) => sum + r.report.ratioChangePct, 0)
    );
    const priorRatio = roundValue(latest.ratioPct - netChange);
    const event = classify(priorRatio, latest.ratioPct, netChange);
    if (event === null) return [];
    const magnitude = strengthOf(Math.abs(netChange), {
        weak: KR_MAJOR_HOLDER_CHANGE_WEAK_PCT,
        moderate: KR_MAJOR_HOLDER_CHANGE_MODERATE_PCT,
        strong: KR_MAJOR_HOLDER_CHANGE_STRONG_PCT,
    });
    // Crossing 5% is reportable however small the step; a change inside the band below 1%p is not a move.
    const strength =
        magnitude ?? (event === 'new' || event === 'exit' ? 'weak' : null);
    if (strength === null) return [];
    return [
        makeSignal(
            'largeHolders',
            EVENT_SIGNAL[event],
            EVENT_DIRECTION[event],
            strength,
            {
                ratioPct: latest.ratioPct,
                priorRatioPct: priorRatio,
                ratioChangePct: netChange,
                sharesChange: reports.reduce(
                    (sum, r) =>
                        sum +
                        (isFiniteNumber(r.report.sharesChange)
                            ? r.report.sharesChange
                            : 0),
                    0
                ),
                reports: reports.length,
                detailedReports: reports.filter(
                    r => r.report.reportForm === 'detailed'
                ).length,
            },
            latest.reporter
        ),
    ];
}

/**
 * Korean 5%+ major-holder axis from DART 대량보유 reports in the trailing
 * {@link KR_WINDOW_DAYS} days. Fills the `largeHolders` slot so the UI, the
 * response schema and the composite weights stay the same across markets.
 *
 * Each reporter's reports in the window net into one signal: crossing 5% up is
 * `kr_major_holder_new`, crossing down `kr_major_holder_exit`, otherwise the net
 * ratio change is an increase or reduction. Strength comes from the size of
 * the net ratio change (percentage points) only — **never from the report
 * form**: 약식 is used both for simple investment and for a professional
 * investor's general investment, and the reports carry no holding purpose.
 *
 * Unlike the US axes, **sufficient means at least one directional signal**.
 * Reports that moved nothing (a re-filing, a sub-1%p change inside the band)
 * leave the axis insufficient instead of reading as a zero; `krMetrics` still
 * counts them. Reports dated after the reference day, outside the window or
 * with non-finite ratios are dropped.
 */
export function evaluateKrMajorHolderAxis(
    reports: readonly KrMajorHolderReport[],
    asOfDay: number | null
): LargeHolderAxis {
    const inWindow: DatedReport[] =
        asOfDay === null
            ? []
            : reports
                  .flatMap(report => {
                      const day = parseDay(report.receiptDate);
                      if (
                          day === null ||
                          !isFiniteNumber(report.ratioPct) ||
                          !isFiniteNumber(report.ratioChangePct)
                      ) {
                          return [];
                      }
                      const age = daysBetween(day, asOfDay);
                      return age >= 0 && age <= KR_WINDOW_DAYS
                          ? [{ report, day }]
                          : [];
                  })
                  .sort((a, b) => a.day - b.day);
    const byReporter = groupByKey(inWindow, r => reporterKey(r.report));
    const signals = [...byReporter.values()].flatMap(reporterSignal);
    const krMetrics: KrMajorHolderMetrics | undefined =
        inWindow.length === 0
            ? undefined
            : {
                  reports: inWindow.length,
                  reporters: byReporter.size,
                  detailedReports: inWindow.filter(
                      r => r.report.reportForm === 'detailed'
                  ).length,
              };
    const base = krMetrics === undefined ? {} : { krMetrics };
    if (signals.length === 0) {
        return {
            id: 'largeHolders',
            score: null,
            label: 'insufficient',
            sufficiency: 'insufficient',
            signals: [],
            metrics: null,
            ...base,
        };
    }
    const score = scoreFromSignals(signals);
    return {
        id: 'largeHolders',
        score,
        label: labelForScore(score),
        sufficiency: 'sufficient',
        signals: sortSignals(signals),
        metrics: null,
        ...base,
    };
}
