import {
    INSIDER_CLUSTER_WINDOW_DAYS,
    KR_INSIDER_CLUSTER_MIN_REPORTERS,
    KR_INSIDER_NET_CHANGE_MODERATE_PCT,
    KR_INSIDER_NET_CHANGE_WEAK_PCT,
    KR_WINDOW_DAYS,
    RATIO_DECIMALS,
} from '@/domain/investorFlows/constants';
import { largestClusterSpan } from '@/domain/investorFlows/insiderAxis';
import {
    daysBetween,
    formatDay,
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
    InsiderAxis,
    InvestorFlowsSignal,
    InvestorFlowsSignalDirection,
    KrDisclosureSnapshot,
    KrInsiderMetrics,
    KrInsiderReport,
} from '@/domain/investorFlows/types';

interface DatedInsiderReport {
    readonly report: KrInsiderReport;
    readonly day: number;
}

function reporterKey(report: KrInsiderReport): string {
    return report.reporter.trim().toLowerCase();
}

/** Age of a receipt date in days when it falls inside the window; `null` otherwise. */
function windowDay(date: string, asOfDay: number): number | null {
    const day = parseDay(date);
    if (day === null) return null;
    const age = daysBetween(day, asOfDay);
    return age >= 0 && age <= KR_WINDOW_DAYS ? day : null;
}

/** Net change as % of shares outstanding, else the summed ratio change; `null` when neither is usable. */
function netChangePct(
    reports: readonly DatedInsiderReport[],
    netShares: number,
    sharesOutstanding: number | null
): number | null {
    if (isFiniteNumber(sharesOutstanding) && sharesOutstanding > 0) {
        return roundValue(
            (netShares / sharesOutstanding) * 100,
            RATIO_DECIMALS
        );
    }
    const ratios = reports.map(r => r.report.ratioChangePct);
    return ratios.every(isFiniteNumber)
        ? roundValue(
              ratios.reduce((a, b) => a + b, 0),
              RATIO_DECIMALS
          )
        : null;
}

function clusterSignal(
    reports: readonly DatedInsiderReport[],
    direction: Exclude<InvestorFlowsSignalDirection, 'neutral'>
): InvestorFlowsSignal[] {
    const side = reports.filter(r =>
        direction === 'bullish'
            ? r.report.sharesChange > 0
            : r.report.sharesChange < 0
    );
    // The sweep needs events sorted by day.
    // A copy: `toSorted` is outside the client build's lib target.
    const sorted = [...side].sort((a, b) => a.day - b.day);
    const span = largestClusterSpan(
        sorted.map(r => ({ day: r.day, key: reporterKey(r.report) }))
    );
    if (span.size < KR_INSIDER_CLUSTER_MIN_REPORTERS) return [];
    const members = sorted.slice(span.start, span.end);
    return [
        makeSignal(
            'insider',
            'kr_insider_cluster',
            direction,
            'moderate',
            {
                reporters: span.size,
                windowDays: INSIDER_CLUSTER_WINDOW_DAYS,
            },
            // The span's own dates, rendered like the US Form 144 cluster.
            `${formatDay(members[0].day)} to ${formatDay(members[members.length - 1].day)}`
        ),
    ];
}

/**
 * Korean insider axis from DART executive / major-shareholder ownership reports
 * (임원·주요주주 소유보고) and trading-plan reports (거래계획보고서) in the
 * trailing {@link KR_WINDOW_DAYS} days. Fills the `insider` slot.
 *
 * The US insider rules do not transfer: they threshold USD values and match
 * English job titles, so Korean data would never fire a signal and the axis
 * would read as a fake zero. Here thresholds are on shares and ratios:
 *
 * - `kr_insider_net_change`: net shares changed across the window's reports as
 *   % of shares outstanding (else the summed ratio change). Capped at moderate
 *   because the report carries no cause — open-market trades, gifts,
 *   inheritance and option exercise look alike — and netting is what keeps a
 *   gift between family members from reading as two moves.
 * - `kr_insider_cluster`: {@link KR_INSIDER_CLUSTER_MIN_REPORTERS} or more
 *   distinct reporters moving the same way within one cluster span (moderate).
 * - `kr_trading_plan`: neutral context — a pre-announced trade, direction unknown.
 *
 * **Sufficient means at least one directional signal**; trading plans alone or
 * reports that net to nothing leave the axis insufficient (`krMetrics` still
 * counts them). Rows dated after the reference day, outside the window or with
 * a non-finite share change are dropped.
 */
export function evaluateKrInsiderAxis(
    kr: Pick<KrDisclosureSnapshot, 'insiders' | 'tradingPlans'>,
    sharesOutstanding: number | null,
    asOfDay: number | null
): InsiderAxis {
    const reports: DatedInsiderReport[] =
        asOfDay === null
            ? []
            : kr.insiders
                  .flatMap(report => {
                      const day = windowDay(report.receiptDate, asOfDay);
                      return day === null ||
                          !isFiniteNumber(report.sharesChange)
                          ? []
                          : [{ report, day }];
                  })
                  .sort((a, b) => a.day - b.day);
    const plans =
        asOfDay === null
            ? 0
            : kr.tradingPlans.filter(
                  p => windowDay(p.receiptDate, asOfDay) !== null
              ).length;

    const netShares = reports.reduce(
        (sum, r) => sum + r.report.sharesChange,
        0
    );
    const pct = netChangePct(reports, netShares, sharesOutstanding);
    const reporters = new Set(reports.map(r => reporterKey(r.report))).size;
    const signals: InvestorFlowsSignal[] = [];
    const netStrength =
        pct === null
            ? null
            : strengthOf(Math.abs(pct), {
                  weak: KR_INSIDER_NET_CHANGE_WEAK_PCT,
                  moderate: KR_INSIDER_NET_CHANGE_MODERATE_PCT,
              });
    if (pct !== null && netStrength !== null) {
        signals.push(
            makeSignal(
                'insider',
                'kr_insider_net_change',
                pct > 0 ? 'bullish' : 'bearish',
                netStrength,
                {
                    netSharesChange: netShares,
                    netChangePct: pct,
                    reporters,
                    reports: reports.length,
                }
            )
        );
    }
    signals.push(
        ...clusterSignal(reports, 'bullish'),
        ...clusterSignal(reports, 'bearish')
    );
    const directional = signals.length > 0;
    if (plans > 0) {
        signals.push(
            makeSignal('insider', 'kr_trading_plan', 'neutral', 'weak', {
                plans,
                windowDays: KR_WINDOW_DAYS,
            })
        );
    }

    const krMetrics: KrInsiderMetrics | undefined =
        reports.length === 0 && plans === 0
            ? undefined
            : {
                  reports: reports.length,
                  reporters,
                  netSharesChange: netShares,
                  netChangePct: pct,
                  tradingPlans: plans,
              };
    const base = krMetrics === undefined ? {} : { krMetrics };
    if (!directional) {
        return {
            id: 'insider',
            score: null,
            label: 'insufficient',
            sufficiency: 'insufficient',
            signals: sortSignals(signals),
            metrics: null,
            ...base,
        };
    }
    const score = scoreFromSignals(signals);
    return {
        id: 'insider',
        score,
        label: labelForScore(score),
        sufficiency: 'sufficient',
        signals: sortSignals(signals),
        metrics: null,
        ...base,
    };
}
