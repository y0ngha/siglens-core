import { describe, expect, it } from 'vitest';
import {
    INSIDER_CLUSTER_WINDOW_DAYS,
    INSIDER_PROPOSED_SALE_CLUSTER_MIN_FILERS,
    INSIDER_PROPOSED_SALE_MODERATE_USD,
    INSIDER_PROPOSED_SALE_WEAK_USD,
    INSIDER_WINDOW_DAYS,
} from '@/domain/investorFlows/constants';
import { evaluateInsiderAxis } from '@/domain/investorFlows/insiderAxis';
import { parseDay } from '@/domain/investorFlows/scoreHelpers';
import type {
    InvestorFlowsSignal,
    InvestorFlowsSignalId,
    ProposedSale,
} from '@/domain/types';
import {
    AS_OF,
    daysBeforeAsOf,
    insiderTx,
    proposedSale,
} from '../../fixtures/investorFlows';

const AS_OF_DAY = parseDay(AS_OF);

function axisOf(...sales: ProposedSale[]) {
    return evaluateInsiderAxis({ transactions: [] }, AS_OF_DAY, sales);
}

function signalOf(
    signals: readonly InvestorFlowsSignal[],
    id: InvestorFlowsSignalId
): InvestorFlowsSignal | undefined {
    return signals.find(s => s.id === id);
}

describe('evaluateInsiderAxis — Form 144 coverage', () => {
    it('stays insufficient with neither Form 4 nor Form 144 data', () => {
        expect(axisOf().sufficiency).toBe('insufficient');
    });

    it('becomes sufficient on Form 144 notices alone', () => {
        const axis = axisOf(proposedSale());
        expect(axis.sufficiency).toBe('sufficient');
        expect(axis.metrics?.proposedSaleCount).toBe(1);
    });

    it('ignores a notice filed after the reference day', () => {
        expect(
            axisOf(proposedSale({ filingDate: '2026-10-16' })).sufficiency
        ).toBe('insufficient');
    });

    it('does not report insider_quiet when only Form 144 activity is in the window', () => {
        const axis = axisOf(proposedSale({ valueUsd: 100_000 }));
        expect(signalOf(axis.signals, 'insider_quiet')).toBeUndefined();
    });
});

describe('evaluateInsiderAxis — insider_proposed_sale', () => {
    it('reads a $2M unplanned notice as weak bearish', () => {
        // e.g. a CFO filing to sell 10,000 shares at $200 outside any plan.
        const signal = signalOf(
            axisOf(proposedSale()).signals,
            'insider_proposed_sale'
        );
        expect(signal).toEqual({
            id: 'insider_proposed_sale',
            axis: 'insider',
            direction: 'bearish',
            strength: 'weak',
            evidence: {
                valueUsd: 2_000_000,
                plannedValueUsd: 0,
                filers: 1,
                notices: 1,
            },
        });
    });

    it('stays silent below the weak threshold', () => {
        const axis = axisOf(
            proposedSale({ valueUsd: INSIDER_PROPOSED_SALE_WEAK_USD - 1 })
        );
        expect(signalOf(axis.signals, 'insider_proposed_sale')).toBeUndefined();
        expect(axis.score).toBe(0);
    });

    it('fires exactly at the weak threshold', () => {
        const axis = axisOf(
            proposedSale({ valueUsd: INSIDER_PROPOSED_SALE_WEAK_USD })
        );
        expect(signalOf(axis.signals, 'insider_proposed_sale')?.strength).toBe(
            'weak'
        );
    });

    it('reads an unplanned $12M notice as moderate and never stronger', () => {
        const moderate = axisOf(proposedSale({ valueUsd: 12_000_000 }));
        const huge = axisOf(proposedSale({ valueUsd: 400_000_000 }));
        expect(
            signalOf(moderate.signals, 'insider_proposed_sale')?.strength
        ).toBe('moderate');
        expect(signalOf(huge.signals, 'insider_proposed_sale')?.strength).toBe(
            'moderate'
        );
    });

    it('fires moderate exactly at the moderate threshold', () => {
        const axis = axisOf(
            proposedSale({ valueUsd: INSIDER_PROPOSED_SALE_MODERATE_USD })
        );
        expect(signalOf(axis.signals, 'insider_proposed_sale')?.strength).toBe(
            'moderate'
        );
    });

    it('drops a mostly 10b5-1 notice one step, from moderate to weak', () => {
        // A founder's plan sale: $12M, plan adopted months earlier.
        const axis = axisOf(
            proposedSale({
                valueUsd: 12_000_000,
                planAdoptionDate: '2026-03-02',
            })
        );
        const signal = signalOf(axis.signals, 'insider_proposed_sale');
        expect(signal?.strength).toBe('weak');
        expect(signal?.evidence.plannedValueUsd).toBe(12_000_000);
        expect(axis.metrics?.proposedSalePlannedValueUsd).toBe(12_000_000);
    });

    it('keeps a planned weak notice at weak (the floor)', () => {
        const axis = axisOf(proposedSale({ planAdoptionDate: '2026-03-02' }));
        expect(signalOf(axis.signals, 'insider_proposed_sale')?.strength).toBe(
            'weak'
        );
    });

    it('does not damp when the planned share is below half', () => {
        const axis = axisOf(
            proposedSale({ filer: 'A', valueUsd: 7_000_000 }),
            proposedSale({
                filer: 'B',
                valueUsd: 5_000_000,
                planAdoptionDate: '2026-01-15',
            })
        );
        expect(signalOf(axis.signals, 'insider_proposed_sale')?.strength).toBe(
            'moderate'
        );
    });

    it('only sums notices inside the insider window', () => {
        const axis = axisOf(
            proposedSale({
                valueUsd: 50_000_000,
                filingDate: daysBeforeAsOf(INSIDER_WINDOW_DAYS + 1),
            })
        );
        expect(signalOf(axis.signals, 'insider_proposed_sale')).toBeUndefined();
        expect(axis.metrics?.proposedSaleCount).toBe(0);
    });

    it('ignores non-finite and non-positive values', () => {
        const axis = axisOf(
            proposedSale({ valueUsd: Number.NaN }),
            proposedSale({ valueUsd: -5_000_000 })
        );
        expect(axis.metrics?.proposedSaleValueUsd).toBe(0);
    });
});

describe('evaluateInsiderAxis — insider_proposed_sale_cluster', () => {
    const filers = ['CEO', 'CFO', 'COO'];

    it('flags three filers inside 30 days as a moderate bearish cluster', () => {
        const axis = axisOf(
            ...filers.map((filer, i) =>
                proposedSale({
                    filer,
                    valueUsd: 300_000,
                    filingDate: daysBeforeAsOf(5 + i * 10),
                })
            )
        );
        expect(signalOf(axis.signals, 'insider_proposed_sale_cluster')).toEqual(
            {
                id: 'insider_proposed_sale_cluster',
                axis: 'insider',
                direction: 'bearish',
                strength: 'moderate',
                evidence: {
                    filers: INSIDER_PROPOSED_SALE_CLUSTER_MIN_FILERS,
                    windowDays: INSIDER_CLUSTER_WINDOW_DAYS,
                    valueUsd: 900_000,
                },
            }
        );
    });

    it('does not count filers spread wider than the cluster span', () => {
        const axis = axisOf(
            ...filers.map((filer, i) =>
                proposedSale({
                    filer,
                    filingDate: daysBeforeAsOf(5 + i * 20),
                })
            )
        );
        expect(
            signalOf(axis.signals, 'insider_proposed_sale_cluster')
        ).toBeUndefined();
    });

    it('counts one person filing twice as one filer', () => {
        const axis = axisOf(
            proposedSale({ filer: 'CEO' }),
            proposedSale({ filer: 'ceo ', filingDate: daysBeforeAsOf(12) }),
            proposedSale({ filer: 'CFO', filingDate: daysBeforeAsOf(14) })
        );
        expect(
            signalOf(axis.signals, 'insider_proposed_sale_cluster')
        ).toBeUndefined();
        expect(axis.metrics?.proposedSaleFilerCount).toBe(2);
    });

    it('drops a planned cluster to weak', () => {
        const axis = axisOf(
            ...filers.map((filer, i) =>
                proposedSale({
                    filer,
                    filingDate: daysBeforeAsOf(5 + i * 5),
                    planAdoptionDate: '2026-02-01',
                })
            )
        );
        expect(
            signalOf(axis.signals, 'insider_proposed_sale_cluster')?.strength
        ).toBe('weak');
    });
});

describe('evaluateInsiderAxis — Form 144 next to Form 4', () => {
    it('adds the proposed-sale signal to an open-market buy reading', () => {
        const axis = evaluateInsiderAxis(
            { transactions: [insiderTx({ value: 300_000 })] },
            AS_OF_DAY,
            [proposedSale()]
        );
        // moderate buy (+35) and weak proposed sale (-15).
        expect(axis.score).toBe(20);
    });
});
