import { DILUTION_WINDOW_DAYS } from '@/domain/investorFlows/constants';
import {
    daysBetween,
    isVisibleAsOf,
    labelForScore,
    makeSignal,
    parseDay,
    scoreFromSignals,
    sortSignals,
} from '@/domain/investorFlows/scoreHelpers';
import type {
    DilutionAxis,
    DilutionMetrics,
    InvestorFlowsEvidence,
    InvestorFlowsSignal,
    InvestorFlowsSignalId,
    InvestorFlowsSignalStrength,
    OfferingFiling,
    OfferingKind,
} from '@/domain/investorFlows/types';

interface DatedOffering {
    readonly filing: OfferingFiling;
    readonly age: number;
}

interface DilutionRule {
    readonly id: InvestorFlowsSignalId;
    readonly strength: InvestorFlowsSignalStrength;
    readonly kinds: readonly OfferingKind[];
}

/**
 * One rule per signal. An ATM program or a marketed (underwritten or
 * placement-agent) offering sells new shares now, so it is moderate; a shelf,
 * a full registration or a Form D only makes a sale possible or is small and
 * private, so it is weak. `prospectus` and `other` filings carry no signal.
 * Best-efforts placements share the marketed-offering signal: they are priced
 * offerings of new shares like an underwritten deal, only without a firm commitment.
 */
const DILUTION_RULES: readonly DilutionRule[] = [
    { id: 'atm_offering_active', strength: 'moderate', kinds: ['atm'] },
    {
        id: 'underwritten_offering',
        strength: 'moderate',
        kinds: ['underwritten', 'best_efforts'],
    },
    { id: 'shelf_registration_new', strength: 'weak', kinds: ['shelf'] },
    { id: 'registration_new', strength: 'weak', kinds: ['registration'] },
    { id: 'private_placement', strength: 'weak', kinds: ['private_placement'] },
];

function countKind(
    items: readonly DatedOffering[],
    kind: OfferingKind
): number {
    return items.filter(o => o.filing.kind === kind).length;
}

function ruleSignal(
    rule: DilutionRule,
    inWindow: readonly DatedOffering[]
): InvestorFlowsSignal[] {
    const matched = inWindow.filter(o => rule.kinds.includes(o.filing.kind));
    if (matched.length === 0) return [];
    const latestDaysAgo = Math.min(...matched.map(o => o.age));
    const split: InvestorFlowsEvidence =
        rule.id === 'underwritten_offering'
            ? {
                  underwritten: countKind(matched, 'underwritten'),
                  bestEfforts: countKind(matched, 'best_efforts'),
              }
            : {};
    return [
        makeSignal('dilution', rule.id, 'bearish', rule.strength, {
            filings: matched.length,
            latestDaysAgo,
            ...split,
        }),
    ];
}

/**
 * Dilution axis: registration and offering filings in the trailing
 * {@link DILUTION_WINDOW_DAYS} days. Every signal is bearish — a filing that
 * registers or sells new shares adds supply — and each kind emits at most one
 * signal however often it was filed (an ATM program files a 424B5 every few
 * weeks, which is one program, not many).
 *
 * Coverage follows the 13D/13G axis: `undefined` (a snapshot built before the
 * field existed) or no usable filing at all is insufficient; any filing dated on
 * or before the reference day — even outside the window — means the issuer is
 * covered, so a quiet window scores 0. Filings dated after the reference day
 * are dropped.
 */
export function evaluateDilutionAxis(
    offerings: readonly OfferingFiling[] | undefined,
    asOfDay: number | null
): DilutionAxis {
    const visible = (offerings ?? []).flatMap(filing => {
        const day = parseDay(filing.filingDate);
        return day === null || !isVisibleAsOf(day, asOfDay)
            ? []
            : [{ filing, day }];
    });
    if (asOfDay === null || visible.length === 0) {
        return {
            id: 'dilution',
            score: null,
            label: 'insufficient',
            sufficiency: 'insufficient',
            signals: [],
            metrics: null,
        };
    }
    const inWindow: DatedOffering[] = visible.flatMap(({ filing, day }) => {
        const age = daysBetween(day, asOfDay);
        return age <= DILUTION_WINDOW_DAYS ? [{ filing, age }] : [];
    });
    const signals = DILUTION_RULES.flatMap(rule => ruleSignal(rule, inWindow));
    const latest = inWindow.reduce<DatedOffering | null>(
        (best, o) => (best === null || o.age < best.age ? o : best),
        null
    );
    const metrics: DilutionMetrics = {
        filingsInWindow: inWindow.length,
        atmFilings: countKind(inWindow, 'atm'),
        marketedOfferingFilings:
            countKind(inWindow, 'underwritten') +
            countKind(inWindow, 'best_efforts'),
        shelfFilings: countKind(inWindow, 'shelf'),
        registrationFilings: countKind(inWindow, 'registration'),
        privatePlacementFilings: countKind(inWindow, 'private_placement'),
        latestFilingDate: latest?.filing.filingDate.slice(0, 10) ?? null,
    };
    const score = scoreFromSignals(signals);
    return {
        id: 'dilution',
        score,
        label: labelForScore(score),
        sufficiency: 'sufficient',
        signals: sortSignals(signals),
        metrics,
    };
}
