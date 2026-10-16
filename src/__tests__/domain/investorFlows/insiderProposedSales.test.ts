import { describe, expect, it } from 'vitest';
import {
    INSIDER_CLUSTER_WINDOW_DAYS,
    INSIDER_PROPOSED_SALE_CLUSTER_MIN_FILERS,
    INSIDER_PROPOSED_SALE_MODERATE_PCT_OUTSTANDING,
    INSIDER_PROPOSED_SALE_MODERATE_USD,
    INSIDER_PROPOSED_SALE_WEAK_PCT_OUTSTANDING,
    INSIDER_PROPOSED_SALE_WEAK_USD,
    INSIDER_WINDOW_DAYS,
} from '@/domain/investorFlows/constants';
import {
    evaluateInsiderAxis,
    normalizeFilerName,
    proposedSaleFilerKeys,
} from '@/domain/investorFlows/insiderAxis';
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
                shares: 10_000,
                pctOfSharesOutstanding: null,
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
                    clusterNotices: 3,
                    clusterValueUsd: 900_000,
                    clusterPlannedValueUsd: 0,
                    clusterShares: 30_000,
                },
                subject: `${daysBeforeAsOf(25)} to ${daysBeforeAsOf(5)}`,
            }
        );
    });

    it("quotes the cluster span's own value, not the whole insider window (AAPL A/B case)", () => {
        // Three filers inside 30 days plus an older notice 60 days back: the
        // cluster's value excludes the older notice; the window total keeps it.
        const axis = axisOf(
            proposedSale({
                filer: 'Old',
                valueUsd: 2_660_900,
                filingDate: daysBeforeAsOf(70),
            }),
            ...filers.map((filer, i) =>
                proposedSale({
                    filer,
                    valueUsd: 10_000_000 + i,
                    filingDate: daysBeforeAsOf(5 + i * 10),
                })
            )
        );
        const cluster = signalOf(axis.signals, 'insider_proposed_sale_cluster');
        expect(cluster?.evidence.clusterValueUsd).toBe(30_000_003);
        expect(cluster?.evidence.clusterNotices).toBe(3);
        expect(axis.metrics?.proposedSaleValueUsd).toBe(32_660_903);
        expect(cluster?.subject).toBe(
            `${daysBeforeAsOf(25)} to ${daysBeforeAsOf(5)}`
        );
    });

    it("damps the cluster by its own members' plan share", () => {
        // An unplanned older notice outweighs the window, but the cluster is all plan sales.
        const axis = axisOf(
            proposedSale({
                filer: 'Old',
                valueUsd: 50_000_000,
                filingDate: daysBeforeAsOf(70),
            }),
            ...filers.map((filer, i) =>
                proposedSale({
                    filer,
                    filingDate: daysBeforeAsOf(5 + i * 10),
                    planAdoptionDate: '2026-02-01',
                })
            )
        );
        expect(
            signalOf(axis.signals, 'insider_proposed_sale_cluster')?.strength
        ).toBe('weak');
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

describe('Form 144 filer identity', () => {
    it('normalizes case, punctuation and spacing of a filer name', () => {
        expect(normalizeFilerName("  O'Brien,   Deirdre. ")).toBe(
            'obrien deirdre'
        );
        expect(normalizeFilerName('OBRIEN DEIRDRE')).toBe('obrien deirdre');
    });

    it('keys by CIK when present, ignoring zero padding', () => {
        expect(
            proposedSaleFilerKeys([
                proposedSale({ filer: 'A', filerCik: '0001234567' }),
                proposedSale({ filer: 'B', filerCik: '1234567' }),
            ])
        ).toEqual(['cik:1234567', 'cik:1234567']);
    });

    it('lets a notice without a CIK borrow the CIK filed under the same name', () => {
        expect(
            proposedSaleFilerKeys([
                proposedSale({ filer: 'Mark Robinson', filerCik: '42' }),
                proposedSale({ filer: 'MARK ROBINSON' }),
                proposedSale({ filer: 'Someone Else', filerCik: null }),
            ])
        ).toEqual(['cik:42', 'cik:42', 'name:someone else']);
    });

    it('does not borrow a CIK when two distinct CIKs share the name, in any order', () => {
        const a = proposedSale({ filer: 'John Smith', filerCik: '100' });
        const b = proposedSale({ filer: 'JOHN SMITH', filerCik: '200' });
        const bare = proposedSale({ filer: 'John Smith' });
        expect(proposedSaleFilerKeys([a, b, bare])).toEqual([
            'cik:100',
            'cik:200',
            'name:john smith',
        ]);
        expect(proposedSaleFilerKeys([bare, b, a])).toEqual([
            'name:john smith',
            'cik:200',
            'cik:100',
        ]);
    });

    it("still borrows when the name's notices all carry the same CIK", () => {
        expect(
            proposedSaleFilerKeys([
                proposedSale({ filer: 'Jane Roe', filerCik: '0007' }),
                proposedSale({ filer: 'JANE ROE', filerCik: '7' }),
                proposedSale({ filer: 'Jane Roe' }),
            ])
        ).toEqual(['cik:7', 'cik:7', 'cik:7']);
    });

    it('counts MARK ROBINSON and Mark Haymond Robinson with one CIK as one filer (GME A/B case)', () => {
        // GME's Form 144 window: two officers, each filing under two spellings.
        // By name that read as 3 filers and fired a 3-filer cluster.
        const axis = axisOf(
            proposedSale({
                filer: 'DANIEL MOORE',
                filerCik: '0001900001',
                filingDate: daysBeforeAsOf(2),
            }),
            proposedSale({
                filer: 'MARK ROBINSON',
                filerCik: '0001900002',
                filingDate: daysBeforeAsOf(10),
            }),
            proposedSale({
                filer: 'Mark Haymond Robinson',
                filerCik: '0001900002',
                filingDate: daysBeforeAsOf(14),
            }),
            proposedSale({
                filer: 'Daniel Moore',
                filerCik: '0001900001',
                filingDate: daysBeforeAsOf(14),
            })
        );
        expect(axis.metrics?.proposedSaleFilerCount).toBe(2);
        expect(
            signalOf(axis.signals, 'insider_proposed_sale_cluster')
        ).toBeUndefined();
    });

    it('still counts distinct names without CIKs as distinct filers', () => {
        const axis = axisOf(
            proposedSale({ filer: 'Mark Robinson' }),
            proposedSale({ filer: 'Mark Haymond Robinson' })
        );
        expect(axis.metrics?.proposedSaleFilerCount).toBe(2);
    });
});

describe('insider_proposed_sale — relative to shares outstanding', () => {
    function axisWithShares(
        sharesOutstanding: number | null,
        ...sales: ProposedSale[]
    ) {
        return evaluateInsiderAxis(
            { transactions: [] },
            AS_OF_DAY,
            sales,
            sharesOutstanding
        );
    }

    it('reads Apple-scale 10b5-1 plan sales (~$40M, ~0.002% of outstanding) as no size signal', () => {
        // AAPL A/B case: four executives, five notices, all under plans.
        const plan = { planAdoptionDate: '2026-02-01' };
        const axis = axisWithShares(
            14_800_000_000,
            proposedSale({
                filer: 'Cook Timothy D',
                filerCik: '1',
                shares: 218_078,
                valueUsd: 3_329_584,
                ...plan,
            }),
            proposedSale({
                filer: 'John Ternus',
                filerCik: '2',
                shares: 25_412,
                valueUsd: 8_479_730,
                ...plan,
            }),
            proposedSale({
                filer: "O'Brien Deirdre",
                filerCik: '3',
                shares: 46_389,
                valueUsd: 15_459_598,
                ...plan,
            }),
            proposedSale({
                filer: 'Jennifer Newstead',
                filerCik: '4',
                shares: 20_000,
                valueUsd: 6_600_000,
                ...plan,
            }),
            proposedSale({
                filer: 'Jennifer Newstead',
                filerCik: '4',
                shares: 20_000,
                valueUsd: 6_630_974,
                ...plan,
            })
        );
        expect(signalOf(axis.signals, 'insider_proposed_sale')).toBeUndefined();
        expect(axis.metrics?.proposedSalePctOutstanding).toBe(0.0022);
        // The 4-filer cluster stays, damped to weak by the plans — weak at most.
        const strengths = axis.signals
            .filter(s => s.direction === 'bearish')
            .map(s => s.strength);
        expect(strengths).toEqual(['weak']);
    });

    it('reads 1% of a small cap as moderate (the cap)', () => {
        const axis = axisWithShares(
            20_000_000,
            proposedSale({ shares: 200_000, valueUsd: 600_000 })
        );
        const signal = signalOf(axis.signals, 'insider_proposed_sale');
        expect(signal?.strength).toBe('moderate');
        expect(signal?.evidence.pctOfSharesOutstanding).toBe(1);
        expect(signal?.evidence.shares).toBe(200_000);
    });

    it('fires weak exactly at the weak share of outstanding and moderate at the moderate one', () => {
        const out = 100_000_000;
        const weak = axisWithShares(
            out,
            proposedSale({
                shares:
                    (out * INSIDER_PROPOSED_SALE_WEAK_PCT_OUTSTANDING) / 100,
            })
        );
        const moderate = axisWithShares(
            out,
            proposedSale({
                shares:
                    (out * INSIDER_PROPOSED_SALE_MODERATE_PCT_OUTSTANDING) /
                    100,
            })
        );
        const below = axisWithShares(
            out,
            proposedSale({
                // 0.049%: the share is rounded to 4 decimals before the threshold.
                shares:
                    (out * INSIDER_PROPOSED_SALE_WEAK_PCT_OUTSTANDING) / 100 -
                    1_000,
            })
        );
        expect(signalOf(weak.signals, 'insider_proposed_sale')?.strength).toBe(
            'weak'
        );
        expect(
            signalOf(moderate.signals, 'insider_proposed_sale')?.strength
        ).toBe('moderate');
        expect(
            signalOf(below.signals, 'insider_proposed_sale')
        ).toBeUndefined();
    });

    it('ignores the USD value once shares outstanding is known', () => {
        // $50M would be moderate on the USD fallback; 0.01% of outstanding is nothing.
        const axis = axisWithShares(
            1_000_000_000,
            proposedSale({ shares: 100_000, valueUsd: 50_000_000 })
        );
        expect(signalOf(axis.signals, 'insider_proposed_sale')).toBeUndefined();
    });

    it('keeps the 10b5-1 damping on the relative scale', () => {
        const axis = axisWithShares(
            20_000_000,
            proposedSale({ shares: 200_000, planAdoptionDate: '2026-02-01' })
        );
        expect(signalOf(axis.signals, 'insider_proposed_sale')?.strength).toBe(
            'weak'
        );
    });

    it('falls back to USD when the notices carry no usable share count', () => {
        const axis = axisWithShares(
            20_000_000,
            proposedSale({ shares: Number.NaN, valueUsd: 12_000_000 })
        );
        expect(signalOf(axis.signals, 'insider_proposed_sale')?.strength).toBe(
            'moderate'
        );
        expect(axis.metrics?.proposedSaleShares).toBe(0);
    });

    it('takes the stronger of the percent reading and the USD reading of the unsized notices', () => {
        // 0.06% of outstanding from the sized notice (weak) plus a $12M notice
        // with no share count (moderate on the USD fallback): moderate.
        const axis = axisWithShares(
            100_000_000,
            proposedSale({ filer: 'A', shares: 60_000, valueUsd: 500_000 }),
            proposedSale({ filer: 'B', shares: 0, valueUsd: 12_000_000 })
        );
        expect(signalOf(axis.signals, 'insider_proposed_sale')?.strength).toBe(
            'moderate'
        );
        expect(axis.metrics?.proposedSalePctOutstanding).toBe(0.06);
    });

    it('keeps the percent reading when it is the stronger one in a mixed window', () => {
        const axis = axisWithShares(
            100_000_000,
            proposedSale({ filer: 'A', shares: 300_000, valueUsd: 500_000 }),
            proposedSale({ filer: 'B', shares: 0, valueUsd: 2_000_000 })
        );
        expect(signalOf(axis.signals, 'insider_proposed_sale')?.strength).toBe(
            'moderate'
        );
    });

    it('does not apply the USD fallback to sized notices once shares outstanding is known', () => {
        const axis = axisWithShares(
            1_000_000_000,
            proposedSale({ filer: 'A', shares: 100_000, valueUsd: 50_000_000 }),
            proposedSale({ filer: 'B', shares: 0, valueUsd: 500_000 })
        );
        expect(signalOf(axis.signals, 'insider_proposed_sale')).toBeUndefined();
    });

    it('reports a null share of outstanding without shares outstanding', () => {
        const axis = axisWithShares(null, proposedSale());
        expect(axis.metrics?.proposedSalePctOutstanding).toBeNull();
        expect(axis.metrics?.proposedSaleShares).toBe(10_000);
    });
});
