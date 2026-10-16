import { describe, expect, it } from 'vitest';
import {
    COMPOSITE_MIN_AXES,
    COMPOSITE_WEIGHTS,
    INSIDER_WINDOW_DAYS,
    INVESTOR_FLOWS_AXES,
    LARGE_HOLDER_WINDOW_DAYS,
} from '@/domain/investorFlows/constants';
import { evaluateInvestorFlows } from '@/domain/investorFlows/evaluateInvestorFlows';
import type {
    InstitutionalQuarter,
    InvestorFlowsScorecard,
    InvestorFlowsSnapshot,
} from '@/domain/types';
import {
    AS_OF,
    daysBeforeAsOf,
    emptySnapshot,
    insiderTx,
    largeHolderFiling,
    quarter,
    quarterWithHolderChange,
    shortInterestPoint,
    shortInterestSeries,
    shortVolumeSeries,
    topHolders,
} from '../../fixtures/investorFlows';

const SHARES_OUT = 1_000_000_000;

/** A complete quarter that scores 100: all four institutional signals strong or moderate. */
function accumulationQuarter(): InstitutionalQuarter {
    return quarter({
        holders: 106_000,
        newHolders: 7000,
        exited: 1000,
        netShareChange: 0.035 * SHARES_OUT,
    });
}

function snapshotWith(
    overrides: Partial<InvestorFlowsSnapshot>
): InvestorFlowsSnapshot {
    return emptySnapshot(overrides);
}

describe('evaluateInvestorFlows — accumulation archetype', () => {
    const q = accumulationQuarter();
    const card = evaluateInvestorFlows(
        snapshotWith({
            institutional: {
                quarters: [
                    q,
                    quarter({ period: '2026-03-31', holders: 99_000 }),
                ],
                topHolders: topHolders(10, 8, 0),
                topHoldersPeriod: q.period,
            },
            insider: {
                transactions: [
                    insiderTx({ name: 'CEO', value: 400_000 }),
                    insiderTx({
                        name: 'CFO',
                        value: 300_000,
                        date: daysBeforeAsOf(20),
                    }),
                    insiderTx({
                        name: 'Director',
                        role: 'director',
                        value: 350_000,
                        date: daysBeforeAsOf(25),
                    }),
                ],
            },
            largeHolders: [
                largeHolderFiling({
                    form: 'SC 13G',
                    filer: 'Vanguard',
                    percentOfClass: 8,
                }),
            ],
            shortInterest: shortInterestSeries(12_000_000, 9_000_000),
            shortVolume: shortVolumeSeries(-1.6),
        })
    );

    it('scores institutions at the cap', () => {
        expect(card.institutional.score).toBe(100);
        expect(card.institutional.label).toBe('strong_bullish');
    });

    it('reads the insider cluster', () => {
        expect(card.insider.metrics?.clusterBuy).toBe(true);
        expect(card.insider.label).toBe('strong_bullish');
    });

    it('keeps a lone 13G weak', () => {
        expect(card.largeHolders.score).toBe(15);
        expect(card.largeHolders.label).toBe('neutral');
    });

    it('reads falling short interest and a low short-volume ratio as bullish', () => {
        expect(card.short.score).toBeGreaterThan(0);
        expect(card.short.metrics.shortInterestTrend).toBe('falling');
    });

    it('rolls up to a strongly bullish composite using the four axes with data (no offerings: dilution abstains)', () => {
        expect(card.composite.axesUsed).toEqual(
            INVESTOR_FLOWS_AXES.filter(a => a !== 'dilution')
        );
        expect(card.composite.label).toBe('strong_bullish');
        expect(card.composite.score).toBeGreaterThanOrEqual(50);
    });
});

describe('evaluateInvestorFlows — distribution archetype', () => {
    const q = quarter({
        holders: 90_000,
        newHolders: 1000,
        exited: 11_000,
        netShareChange: -0.035 * SHARES_OUT,
    });
    const card = evaluateInvestorFlows(
        snapshotWith({
            institutional: {
                quarters: [q],
                topHolders: topHolders(10, 0, 8),
                topHoldersPeriod: q.period,
            },
            insider: {
                transactions: [
                    insiderTx({
                        type: 'sell',
                        name: 'CEO',
                        value: 4_000_000,
                        shares: 40_000,
                        sharesOwnedAfter: 60_000,
                    }),
                ],
            },
            largeHolders: [
                largeHolderFiling({
                    filingDate: daysBeforeAsOf(200),
                    percentOfClass: 9,
                }),
                largeHolderFiling({
                    form: 'SC 13D/A',
                    percentOfClass: 5.5,
                }),
            ],
        })
    );

    it('is strongly bearish on institutions', () => {
        expect(card.institutional.label).toBe('strong_bearish');
        expect(card.institutional.score).toBe(-100);
    });

    it('flags a large insider sale and a 13D reduction', () => {
        expect(card.insider.signals.map(s => s.id)).toContain(
            'insider_large_selling'
        );
        expect(card.largeHolders.signals[0].id).toBe('activist_13d_reduction');
    });

    it('rolls up bearish and leaves the FINRA-less short axis out', () => {
        expect(card.short.sufficiency).toBe('insufficient');
        expect(card.composite.axesUsed).toEqual([
            'institutional',
            'insider',
            'largeHolders',
        ]);
        expect(card.composite.score).toBeLessThan(0);
        expect(['bearish', 'strong_bearish']).toContain(card.composite.label);
    });
});

describe('evaluateInvestorFlows — insider cluster buy archetype', () => {
    const card = evaluateInvestorFlows(
        snapshotWith({
            institutional: {
                quarters: [quarter()],
                topHolders: [],
                topHoldersPeriod: null,
            },
            insider: {
                transactions: [
                    insiderTx({
                        name: 'A',
                        date: daysBeforeAsOf(30),
                        value: 300_000,
                    }),
                    insiderTx({
                        name: 'B',
                        date: daysBeforeAsOf(22),
                        value: 300_000,
                    }),
                    insiderTx({
                        name: 'C',
                        date: daysBeforeAsOf(15),
                        value: 300_000,
                    }),
                    insiderTx({
                        name: 'D',
                        date: daysBeforeAsOf(8),
                        value: 300_000,
                    }),
                ],
            },
        })
    );

    it('scores the insider axis 95 on a strong buy plus a moderate cluster', () => {
        expect(card.insider.score).toBe(95);
        expect(card.insider.signals.map(s => s.id)).toEqual([
            'insider_open_market_buying',
            'insider_cluster_buy',
        ]);
    });

    it('lets a neutral institutional axis pull the composite down by its weight', () => {
        const { institutional: i, insider: n } = COMPOSITE_WEIGHTS;
        expect(card.institutional.score).toBe(0);
        expect(card.composite.score).toBe(
            Math.round(((95 * n) / (i + n)) * 100) / 100
        );
    });
});

describe('evaluateInvestorFlows — squeeze risk archetype', () => {
    const card = evaluateInvestorFlows(
        snapshotWith({
            floatShares: 100_000_000,
            shortInterest: shortInterestSeries(18_000_000, 26_000_000, 9),
            shortVolume: shortVolumeSeries(1),
        })
    );

    it('flags a strong squeeze risk and a bearish short axis', () => {
        expect(card.short.metrics.squeezeRisk).toBe(true);
        expect(
            card.short.signals.find(s => s.id === 'short_squeeze_risk')
        ).toMatchObject({ strength: 'strong', direction: 'neutral' });
        expect(card.short.score).toBeLessThan(0);
    });

    it('does not pretend to have a composite from one axis', () => {
        expect(card.composite.score).toBeNull();
        expect(card.composite.label).toBe('insufficient');
        expect(card.composite.axesUsed).toEqual(['short']);
    });
});

describe('evaluateInvestorFlows — sparse data', () => {
    const card = evaluateInvestorFlows(
        snapshotWith({
            institutional: {
                quarters: [quarter({ period: '2026-09-30', complete: false })],
                topHolders: [],
                topHoldersPeriod: null,
            },
        })
    );

    it('degrades every axis to insufficient with null scores, never zero', () => {
        for (const id of INVESTOR_FLOWS_AXES) {
            expect(card[id]).toMatchObject({
                score: null,
                label: 'insufficient',
                sufficiency: 'insufficient',
            });
        }
    });

    it('has no composite', () => {
        expect(card.composite).toEqual({
            score: null,
            label: 'insufficient',
            axesUsed: [],
        });
    });

    it('still reports what it knows about the in-progress quarter', () => {
        expect(card.freshness).toMatchObject({
            institutionalPeriod: null,
            latestInstitutionalPeriod: '2026-09-30',
            latestInstitutionalPeriodComplete: false,
        });
    });
});

describe('evaluateInvestorFlows — FINRA off', () => {
    const feeds = {
        shortInterest: shortInterestSeries(12_000_000, 20_000_000, 7),
        shortVolume: shortVolumeSeries(3),
    };

    it('leaves the short axis insufficient when the provider returns null feeds', () => {
        const card = evaluateInvestorFlows(emptySnapshot());
        expect(card.short.sufficiency).toBe('insufficient');
        expect(card.freshness.shortInterestSettlementDate).toBeNull();
        expect(card.freshness.shortVolumeLatestDate).toBeNull();
    });

    it('ignores feeds the snapshot carries when includeFinraData is false', () => {
        const withData = evaluateInvestorFlows(snapshotWith(feeds));
        const off = evaluateInvestorFlows(snapshotWith(feeds), {
            includeFinraData: false,
        });
        expect(withData.short.sufficiency).toBe('sufficient');
        expect(off.short.sufficiency).toBe('insufficient');
        expect(off.short.score).toBeNull();
        expect(off.freshness.shortInterestSettlementDate).toBeNull();
        expect(off.freshness.shortVolumeLatestDate).toBeNull();
    });

    it('defaults includeFinraData to true', () => {
        expect(
            evaluateInvestorFlows(snapshotWith(feeds), {
                includeFinraData: true,
            })
        ).toEqual(evaluateInvestorFlows(snapshotWith(feeds)));
    });
});

describe('evaluateInvestorFlows — composite', () => {
    const strongInstitutions = {
        quarters: [accumulationQuarter()],
        topHolders: topHolders(10, 8, 0),
        topHoldersPeriod: accumulationQuarter().period,
    };
    const quietInsider = {
        transactions: [insiderTx({ date: daysBeforeAsOf(300) })],
    };

    it('weights axes and lets an axis without data abstain instead of voting neutral', () => {
        const card = evaluateInvestorFlows(
            snapshotWith({
                institutional: strongInstitutions,
                insider: quietInsider,
            })
        );
        const { institutional: i, insider: n } = COMPOSITE_WEIGHTS;
        expect(card.institutional.score).toBe(100);
        expect(card.insider.score).toBe(0);
        expect(card.composite.score).toBe(
            Math.round(((100 * i) / (i + n)) * 100) / 100
        );
        expect(card.composite.axesUsed).toEqual(['institutional', 'insider']);
    });

    it('needs COMPOSITE_MIN_AXES axes with data', () => {
        const one = evaluateInvestorFlows(
            snapshotWith({ institutional: strongInstitutions })
        );
        expect(COMPOSITE_MIN_AXES).toBe(2);
        expect(one.composite.score).toBeNull();
        expect(one.composite.axesUsed).toEqual(['institutional']);
    });

    it('clamps to the score limit', () => {
        const card = evaluateInvestorFlows(
            snapshotWith({
                institutional: strongInstitutions,
                insider: {
                    transactions: Array.from({ length: 6 }, (_, i) =>
                        insiderTx({
                            name: `I${i}`,
                            value: 500_000,
                            date: daysBeforeAsOf(10 + i),
                        })
                    ),
                },
                largeHolders: [
                    largeHolderFiling({ filer: 'A' }),
                    largeHolderFiling({ filer: 'B' }),
                ],
                shortInterest: shortInterestSeries(10_000_000, 7_000_000),
            })
        );
        expect(card.composite.score).toBeLessThanOrEqual(100);
        expect(Number.isFinite(card.composite.score)).toBe(true);
    });
});

describe('evaluateInvestorFlows — freshness', () => {
    const q = quarter({ period: '2026-06-30' });
    const card = evaluateInvestorFlows(
        snapshotWith({
            institutional: {
                quarters: [
                    quarter({ period: '2026-09-30', complete: false }),
                    q,
                ],
                topHolders: [],
                topHoldersPeriod: null,
            },
            insider: {
                transactions: [
                    insiderTx({ date: daysBeforeAsOf(5) }),
                    insiderTx({ date: daysBeforeAsOf(400) }),
                ],
            },
            shortInterest: [...shortInterestSeries(10_000_000, 11_000_000)],
            shortVolume: shortVolumeSeries(0),
        })
    );

    it('names the scored and the latest 13F quarter and whether the latest is complete', () => {
        expect(card.freshness.institutionalPeriod).toBe('2026-06-30');
        expect(card.freshness.latestInstitutionalPeriod).toBe('2026-09-30');
        expect(card.freshness.latestInstitutionalPeriodComplete).toBe(false);
    });

    it('reports the latest settlement and short-volume dates', () => {
        expect(card.freshness.shortInterestSettlementDate).toBe(
            daysBeforeAsOf(10)
        );
        expect(card.freshness.shortVolumeLatestDate).toBe(daysBeforeAsOf(0));
    });

    it('reports the windows and the in-window insider count', () => {
        expect(card.freshness.asOf).toBe(AS_OF);
        expect(card.freshness.insiderWindow).toEqual({
            from: daysBeforeAsOf(INSIDER_WINDOW_DAYS),
            to: AS_OF,
            days: INSIDER_WINDOW_DAYS,
        });
        expect(card.freshness.largeHolderWindow).toEqual({
            from: daysBeforeAsOf(LARGE_HOLDER_WINDOW_DAYS),
            to: AS_OF,
            days: LARGE_HOLDER_WINDOW_DAYS,
        });
        expect(card.freshness.insiderTransactionsInWindow).toBe(1);
    });

    it('has no 13F dates without 13F data', () => {
        const none = evaluateInvestorFlows(emptySnapshot());
        expect(none.freshness).toMatchObject({
            institutionalPeriod: null,
            latestInstitutionalPeriod: null,
            latestInstitutionalPeriodComplete: null,
        });
    });
});

describe('evaluateInvestorFlows — reference date', () => {
    const snapshot = snapshotWith({
        insider: {
            transactions: [
                insiderTx({ date: daysBeforeAsOf(10), value: 1_000_000 }),
            ],
        },
    });

    it('measures windows from options.asOf when given', () => {
        const later = evaluateInvestorFlows(snapshot, { asOf: '2027-01-15' });
        expect(later.insider.metrics?.buyCount).toBe(0);
        expect(later.freshness.asOf).toBe('2027-01-15');
        expect(evaluateInvestorFlows(snapshot).insider.metrics?.buyCount).toBe(
            1
        );
    });

    it('accepts a datetime asOf', () => {
        const card = evaluateInvestorFlows(
            snapshotWith({ ...snapshot, asOf: '2026-10-15T23:30:00Z' })
        );
        expect(card.freshness.asOf).toBe(AS_OF);
    });

    it('degrades the windowed axes, not the whole evaluation, when asOf is unusable', () => {
        const card: InvestorFlowsScorecard = evaluateInvestorFlows(
            snapshotWith({
                asOf: 'garbage',
                institutional: {
                    quarters: [quarterWithHolderChange(10)],
                    topHolders: [],
                    topHoldersPeriod: null,
                },
                insider: snapshot.insider,
                largeHolders: [largeHolderFiling()],
            })
        );
        expect(card.insider.sufficiency).toBe('insufficient');
        expect(card.largeHolders.sufficiency).toBe('insufficient');
        expect(card.institutional.sufficiency).toBe('sufficient');
        expect(card.freshness.asOf).toBeNull();
        expect(card.freshness.insiderWindow).toEqual({
            from: null,
            to: null,
            days: INSIDER_WINDOW_DAYS,
        });
    });
});

describe('evaluateInvestorFlows — purity', () => {
    it('is deterministic and does not mutate the snapshot', () => {
        const snapshot = snapshotWith({
            institutional: {
                quarters: [
                    quarter({ period: '2026-03-31' }),
                    quarter({ period: '2026-06-30' }),
                ],
                topHolders: topHolders(10, 5, 2),
                topHoldersPeriod: '2026-06-30',
            },
            shortInterest: shortInterestSeries(
                10_000_000,
                12_000_000
            ).toReversed(),
            shortVolume: shortVolumeSeries(2),
        });
        const before = structuredClone(snapshot);
        const first = evaluateInvestorFlows(snapshot);
        const second = evaluateInvestorFlows(snapshot);
        expect(snapshot).toEqual(before);
        expect(second).toEqual(first);
    });
});

describe('evaluateInvestorFlows — directional-input sufficiency (reviewer probe)', () => {
    const accumulation = {
        quarters: [accumulationQuarter()],
        topHolders: topHolders(10, 8, 0),
        topHoldersPeriod: accumulationQuarter().period,
    };

    it('does not let a days-to-cover-only short axis join the composite as a zero', () => {
        const card = evaluateInvestorFlows(
            snapshotWith({
                floatShares: null,
                institutional: accumulation,
                shortInterest: [shortInterestPoint({ daysToCover: 6 })],
            })
        );
        expect(card.institutional.score).toBe(100);
        expect(card.short).toMatchObject({
            score: null,
            sufficiency: 'insufficient',
        });
        expect(card.composite).toEqual({
            score: null,
            label: 'insufficient',
            axesUsed: ['institutional'],
        });
    });

    it('does count the short axis once it has a directional input', () => {
        const card = evaluateInvestorFlows(
            snapshotWith({
                institutional: accumulation,
                shortInterest: [
                    shortInterestPoint({
                        shortQty: 200_000_000,
                        daysToCover: 6,
                    }),
                ],
            })
        );
        expect(card.composite.axesUsed).toEqual(['institutional', 'short']);
    });
});

describe('evaluateInvestorFlows — reference date normalization', () => {
    const asOfOf = (asOf: string, options = {}) =>
        evaluateInvestorFlows(emptySnapshot({ asOf }), options).freshness.asOf;

    it.each([
        ['a date', '2026-10-15', '2026-10-15'],
        ['a UTC datetime', '2026-10-15T23:30:00Z', '2026-10-15'],
        [
            'a datetime without an offset (read as UTC)',
            '2026-10-15T23:30:00',
            '2026-10-15',
        ],
        [
            'a datetime west of UTC that crosses midnight',
            '2026-10-15T23:30:00-05:00',
            '2026-10-16',
        ],
        [
            'a datetime east of UTC that crosses midnight',
            '2026-10-16T05:00:00+09:00',
            '2026-10-15',
        ],
        ['a compact offset', '2026-10-16T05:00:00+0900', '2026-10-15'],
    ])('%s', (_name, asOf, expected) => {
        expect(asOfOf(asOf)).toBe(expected);
    });

    it('normalizes options.asOf the same way', () => {
        expect(
            asOfOf('2020-01-01', { asOf: '2026-10-15T23:30:00-05:00' })
        ).toBe('2026-10-16');
    });

    it('measures the insider window from the normalized day', () => {
        const snapshot = snapshotWith({
            asOf: '2026-10-15T23:30:00-05:00',
            insider: {
                transactions: [
                    insiderTx({
                        date: daysBeforeAsOf(INSIDER_WINDOW_DAYS + 1),
                    }),
                ],
            },
        });
        // normalized to 2026-10-16, so a transaction 91 days before 10-15 is 92 days old
        expect(
            evaluateInvestorFlows(snapshot).freshness
                .insiderTransactionsInWindow
        ).toBe(0);
        expect(evaluateInvestorFlows(snapshot).freshness.insiderWindow.to).toBe(
            '2026-10-16'
        );
    });

    it('treats an unparsable datetime with an offset as unusable', () => {
        expect(asOfOf('2026-10-15T99:99:00Z')).toBeNull();
    });
});

describe('evaluateInvestorFlows — freshness uses the same usable-quarter rule as the axis', () => {
    it('does not report an unusable newest quarter as the latest 13F quarter', () => {
        const card = evaluateInvestorFlows(
            snapshotWith({
                institutional: {
                    quarters: [
                        quarter({
                            period: '2026-09-30',
                            complete: false,
                            holders: Number.NaN,
                        }),
                        quarter({ period: '2026-06-30' }),
                    ],
                    topHolders: [],
                    topHoldersPeriod: null,
                },
            })
        );
        expect(card.freshness).toMatchObject({
            institutionalPeriod: '2026-06-30',
            latestInstitutionalPeriod: '2026-06-30',
            latestInstitutionalPeriodComplete: true,
        });
        expect(card.institutional.metrics.partialQuarter).toBeNull();
    });

    it('reports no latest quarter when none is usable', () => {
        const card = evaluateInvestorFlows(
            snapshotWith({
                institutional: {
                    quarters: [quarter({ period: 'garbage' })],
                    topHolders: [],
                    topHoldersPeriod: null,
                },
            })
        );
        expect(card.freshness.latestInstitutionalPeriod).toBeNull();
        expect(card.freshness.latestInstitutionalPeriodComplete).toBeNull();
    });
});

describe('evaluateInvestorFlows — latest source dates ignore unparsable entries', () => {
    it('reports the newest valid settlement and short-volume date', () => {
        const card = evaluateInvestorFlows(
            snapshotWith({
                shortInterest: [
                    ...shortInterestSeries(10_000_000, 11_000_000),
                    shortInterestPoint({ settlementDate: 'garbage' }),
                ],
                shortVolume: [
                    ...shortVolumeSeries(0),
                    {
                        date: 'zzz-not-a-date',
                        shortVolume: 1,
                        totalVolume: 2,
                    },
                ],
            })
        );
        expect(card.freshness.shortInterestSettlementDate).toBe(
            daysBeforeAsOf(10)
        );
        expect(card.freshness.shortVolumeLatestDate).toBe(daysBeforeAsOf(0));
    });
});

describe('evaluateInvestorFlows — one "as of" rule for every source', () => {
    it('leaves every axis insufficient when every row in the snapshot is future-dated', () => {
        const card = evaluateInvestorFlows(
            snapshotWith({
                institutional: {
                    quarters: [quarter({ period: daysBeforeAsOf(-30) })],
                    topHolders: [],
                    topHoldersPeriod: null,
                },
                insider: {
                    transactions: [insiderTx({ date: daysBeforeAsOf(-2) })],
                },
                largeHolders: [
                    largeHolderFiling({ filingDate: daysBeforeAsOf(-2) }),
                ],
                shortInterest: shortInterestSeries(1, 2, 6).map(p => ({
                    ...p,
                    settlementDate: daysBeforeAsOf(-9),
                })),
                shortVolume: shortVolumeSeries(1).map(p => ({
                    ...p,
                    date: daysBeforeAsOf(-9),
                })),
            })
        );
        for (const id of INVESTOR_FLOWS_AXES) {
            expect(card[id].sufficiency).toBe('insufficient');
        }
        expect(card.composite).toEqual({
            score: null,
            label: 'insufficient',
            axesUsed: [],
        });
        expect(card.freshness).toMatchObject({
            latestInstitutionalPeriod: null,
            shortInterestSettlementDate: null,
            shortVolumeLatestDate: null,
        });
    });

    it('reports the newest source dates on or before the reference date, not later ones', () => {
        const card = evaluateInvestorFlows(
            snapshotWith({
                institutional: {
                    quarters: [
                        quarter({
                            period: daysBeforeAsOf(-30),
                            complete: false,
                        }),
                        quarter({ period: '2026-06-30' }),
                    ],
                    topHolders: [],
                    topHoldersPeriod: null,
                },
                shortInterest: [
                    ...shortInterestSeries(10_000_000, 11_000_000),
                    shortInterestPoint({ settlementDate: daysBeforeAsOf(-5) }),
                ],
                shortVolume: [
                    ...shortVolumeSeries(0),
                    {
                        date: daysBeforeAsOf(-1),
                        shortVolume: 1,
                        totalVolume: 2,
                    },
                ],
            })
        );
        expect(card.freshness.latestInstitutionalPeriod).toBe('2026-06-30');
        expect(card.freshness.shortInterestSettlementDate).toBe(
            daysBeforeAsOf(10)
        );
        expect(card.freshness.shortVolumeLatestDate).toBe(daysBeforeAsOf(0));
    });
});
