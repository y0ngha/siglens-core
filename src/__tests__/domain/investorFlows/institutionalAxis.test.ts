import { describe, expect, it } from 'vitest';
import {
    HOLDER_COUNT_CHANGE_MODERATE_PCT,
    HOLDER_COUNT_CHANGE_STRONG_PCT,
    HOLDER_COUNT_CHANGE_WEAK_PCT,
    INSTITUTIONAL_MAX_AGE_DAYS,
    INSTITUTIONAL_MIN_HOLDERS,
    INSTITUTIONAL_MIN_PRIOR_HOLDERS,
    NET_SHARES_VS_HOLDINGS_MODERATE_PCT,
    NET_SHARES_VS_HOLDINGS_STRONG_PCT,
    NET_SHARES_VS_HOLDINGS_WEAK_PCT,
    NET_SHARES_VS_OUTSTANDING_MODERATE_PCT,
    NET_SHARES_VS_OUTSTANDING_STRONG_PCT,
    NET_SHARES_VS_OUTSTANDING_WEAK_PCT,
    NEW_VS_EXITED_MIN_EVENTS,
    NEW_VS_EXITED_MODERATE_BALANCE,
    NEW_VS_EXITED_STRONG_BALANCE,
    NEW_VS_EXITED_WEAK_BALANCE,
    SIGNAL_POINTS,
    TOP_HOLDER_CONSENSUS_MODERATE,
    TOP_HOLDER_CONSENSUS_STRONG,
    TOP_HOLDER_CONSENSUS_WEAK,
    TOP_HOLDER_MIN_COUNT,
} from '@/domain/investorFlows/constants';
import {
    evaluateInstitutionalAxis,
    isUsableQuarter,
} from '@/domain/investorFlows/institutionalAxis';
import { parseDay } from '@/domain/investorFlows/scoreHelpers';
import type {
    InstitutionalSnapshot,
    InvestorFlowsSignal,
    InvestorFlowsSignalId,
    InvestorFlowsSignalStrength,
} from '@/domain/types';
import {
    AS_OF,
    daysBeforeAsOf,
    quarter,
    quarterWithHolderChange,
    quarterWithNewExitedBalance,
    topHolders,
} from '../../fixtures/investorFlows';

const SHARES_OUTSTANDING = 1_000_000_000;

function snapshotOf(
    ...quarters: ReturnType<typeof quarter>[]
): InstitutionalSnapshot {
    return { quarters, topHolders: [], topHoldersPeriod: null };
}

function signalOf(
    signals: readonly InvestorFlowsSignal[],
    id: InvestorFlowsSignalId
): InvestorFlowsSignal | undefined {
    return signals.find(s => s.id === id);
}

describe('evaluateInstitutionalAxis — holder-count change', () => {
    const cases: ReadonlyArray<
        [string, number, InvestorFlowsSignalStrength | null]
    > = [
        ['just below weak', HOLDER_COUNT_CHANGE_WEAK_PCT - 0.01, null],
        ['at weak', HOLDER_COUNT_CHANGE_WEAK_PCT, 'weak'],
        [
            'just below moderate',
            HOLDER_COUNT_CHANGE_MODERATE_PCT - 0.01,
            'weak',
        ],
        ['at moderate', HOLDER_COUNT_CHANGE_MODERATE_PCT, 'moderate'],
        [
            'just below strong',
            HOLDER_COUNT_CHANGE_STRONG_PCT - 0.01,
            'moderate',
        ],
        ['at strong', HOLDER_COUNT_CHANGE_STRONG_PCT, 'strong'],
    ];

    it.each(cases)('%s (bullish)', (_name, pct, strength) => {
        const axis = evaluateInstitutionalAxis(
            snapshotOf(quarterWithHolderChange(pct)),
            SHARES_OUTSTANDING
        );
        const signal = signalOf(
            axis.signals,
            'institutional_holder_count_change'
        );
        expect(signal?.strength).toBe(strength ?? undefined);
        if (signal !== undefined) expect(signal.direction).toBe('bullish');
    });

    it('reads a shrinking holder base as bearish with the same thresholds', () => {
        const prior = 100_000;
        const exited = HOLDER_COUNT_CHANGE_STRONG_PCT * 1000;
        const axis = evaluateInstitutionalAxis(
            snapshotOf(
                quarter({
                    holders: prior - exited,
                    newHolders: 0,
                    exited,
                    increased: 0,
                    decreased: 0,
                })
            ),
            SHARES_OUTSTANDING
        );
        const signal = signalOf(
            axis.signals,
            'institutional_holder_count_change'
        );
        expect(signal).toMatchObject({
            direction: 'bearish',
            strength: 'strong',
        });
        expect(axis.metrics.holderCountChangePct).toBe(
            -HOLDER_COUNT_CHANGE_STRONG_PCT
        );
    });

    it('reports the derived prior holder count as evidence', () => {
        const axis = evaluateInstitutionalAxis(
            snapshotOf(quarterWithHolderChange(HOLDER_COUNT_CHANGE_STRONG_PCT)),
            SHARES_OUTSTANDING
        );
        expect(
            signalOf(axis.signals, 'institutional_holder_count_change')
                ?.evidence
        ).toEqual({
            holders: 110_000,
            priorHolders: 100_000,
            changePct: HOLDER_COUNT_CHANGE_STRONG_PCT,
        });
    });
});

describe('evaluateInstitutionalAxis — net share change vs shares outstanding', () => {
    const net = (pct: number) =>
        quarter({ netShareChange: (pct / 100) * SHARES_OUTSTANDING });
    const cases: ReadonlyArray<
        [string, number, InvestorFlowsSignalStrength | null]
    > = [
        ['just below weak', NET_SHARES_VS_OUTSTANDING_WEAK_PCT - 0.01, null],
        ['at weak', NET_SHARES_VS_OUTSTANDING_WEAK_PCT, 'weak'],
        [
            'just below moderate',
            NET_SHARES_VS_OUTSTANDING_MODERATE_PCT - 0.01,
            'weak',
        ],
        ['at moderate', NET_SHARES_VS_OUTSTANDING_MODERATE_PCT, 'moderate'],
        [
            'just below strong',
            NET_SHARES_VS_OUTSTANDING_STRONG_PCT - 0.01,
            'moderate',
        ],
        ['at strong', NET_SHARES_VS_OUTSTANDING_STRONG_PCT, 'strong'],
    ];

    it.each(cases)('%s', (_name, pct, strength) => {
        const axis = evaluateInstitutionalAxis(
            snapshotOf(net(pct)),
            SHARES_OUTSTANDING
        );
        expect(
            signalOf(axis.signals, 'institutional_net_share_change')?.strength
        ).toBe(strength ?? undefined);
    });

    it('is bearish for net selling and names the basis it used', () => {
        const axis = evaluateInstitutionalAxis(
            snapshotOf(net(-NET_SHARES_VS_OUTSTANDING_STRONG_PCT)),
            SHARES_OUTSTANDING
        );
        const signal = signalOf(axis.signals, 'institutional_net_share_change');
        expect(signal).toMatchObject({
            direction: 'bearish',
            strength: 'strong',
        });
        expect(signal?.evidence).toHaveProperty('pctOfSharesOutstanding');
        expect(axis.metrics.netShareChangeBasis).toBe('sharesOutstanding');
    });
});

describe('evaluateInstitutionalAxis — net share change fallback to prior holdings', () => {
    const PRIOR_SHARES = 1_000_000_000;
    const net = (pct: number) =>
        quarter({
            shares: PRIOR_SHARES + (pct / 100) * PRIOR_SHARES,
            netShareChange: (pct / 100) * PRIOR_SHARES,
        });
    const cases: ReadonlyArray<
        [string, number, InvestorFlowsSignalStrength | null]
    > = [
        ['just below weak', NET_SHARES_VS_HOLDINGS_WEAK_PCT - 0.01, null],
        ['at weak', NET_SHARES_VS_HOLDINGS_WEAK_PCT, 'weak'],
        ['at moderate', NET_SHARES_VS_HOLDINGS_MODERATE_PCT, 'moderate'],
        [
            'just below strong',
            NET_SHARES_VS_HOLDINGS_STRONG_PCT - 0.01,
            'moderate',
        ],
        ['at strong', NET_SHARES_VS_HOLDINGS_STRONG_PCT, 'strong'],
    ];

    it.each(cases)(
        'uses the holdings thresholds when shares outstanding is unknown: %s',
        (_name, pct, strength) => {
            const axis = evaluateInstitutionalAxis(snapshotOf(net(pct)), null);
            expect(
                signalOf(axis.signals, 'institutional_net_share_change')
                    ?.strength
            ).toBe(strength ?? undefined);
            expect(axis.metrics.netShareChangeBasis).toBe('priorHoldings');
        }
    );

    it('uses the outstanding thresholds, not the holdings ones, when shares outstanding is known', () => {
        // 1% of prior holdings is weak on the holdings basis but only 0.01% of 1e9... of
        // outstanding it is below the outstanding weak threshold.
        const axis = evaluateInstitutionalAxis(
            snapshotOf(quarter({ netShareChange: 1_000_000 })),
            SHARES_OUTSTANDING
        );
        expect(
            signalOf(axis.signals, 'institutional_net_share_change')
        ).toBeUndefined();
    });

    it('has no net-share figure without shares outstanding or prior holdings', () => {
        const axis = evaluateInstitutionalAxis(
            snapshotOf(quarter({ shares: 100, netShareChange: 100 })),
            null
        );
        expect(axis.metrics.netShareChangePct).toBeNull();
        expect(axis.metrics.netShareChangeBasis).toBeNull();
    });

    it.each([0, -1, Number.NaN])(
        'treats shares outstanding %s as unknown and falls back',
        shares => {
            const axis = evaluateInstitutionalAxis(
                snapshotOf(quarter({ netShareChange: 0 })),
                shares
            );
            expect(axis.metrics.netShareChangeBasis).toBe('priorHoldings');
        }
    );
});

describe('evaluateInstitutionalAxis — new vs exited', () => {
    const cases: ReadonlyArray<
        [string, number, InvestorFlowsSignalStrength | null]
    > = [
        ['just below weak', NEW_VS_EXITED_WEAK_BALANCE - 0.01, null],
        ['at weak', NEW_VS_EXITED_WEAK_BALANCE, 'weak'],
        ['just below moderate', NEW_VS_EXITED_MODERATE_BALANCE - 0.01, 'weak'],
        ['at moderate', NEW_VS_EXITED_MODERATE_BALANCE, 'moderate'],
        ['just below strong', NEW_VS_EXITED_STRONG_BALANCE - 0.01, 'moderate'],
        ['at strong', NEW_VS_EXITED_STRONG_BALANCE, 'strong'],
    ];

    it.each(cases)('%s (more new than exited)', (_name, balance, strength) => {
        const axis = evaluateInstitutionalAxis(
            snapshotOf(quarterWithNewExitedBalance(balance)),
            SHARES_OUTSTANDING
        );
        const signal = signalOf(axis.signals, 'institutional_new_vs_exited');
        expect(signal?.strength).toBe(strength ?? undefined);
        if (signal !== undefined) expect(signal.direction).toBe('bullish');
    });

    it('is bearish when more institutions exit than arrive', () => {
        const axis = evaluateInstitutionalAxis(
            snapshotOf(
                quarterWithNewExitedBalance(-NEW_VS_EXITED_MODERATE_BALANCE)
            ),
            SHARES_OUTSTANDING
        );
        expect(
            signalOf(axis.signals, 'institutional_new_vs_exited')
        ).toMatchObject({ direction: 'bearish', strength: 'moderate' });
        expect(axis.metrics.newVsExitedBalance).toBe(
            -NEW_VS_EXITED_MODERATE_BALANCE
        );
    });

    it('needs the minimum number of new + exited events', () => {
        const atMinimum = quarter({
            newHolders: NEW_VS_EXITED_MIN_EVENTS,
            exited: 0,
        });
        const belowMinimum = quarter({
            newHolders: NEW_VS_EXITED_MIN_EVENTS - 1,
            exited: 0,
        });
        expect(
            evaluateInstitutionalAxis(snapshotOf(atMinimum), SHARES_OUTSTANDING)
                .metrics.newVsExitedBalance
        ).toBe(1);
        expect(
            evaluateInstitutionalAxis(
                snapshotOf(belowMinimum),
                SHARES_OUTSTANDING
            ).metrics.newVsExitedBalance
        ).toBeNull();
    });
});

describe('evaluateInstitutionalAxis — top-holder consensus', () => {
    const withTop = (
        n: number,
        up: number,
        down: number,
        period: string | null = '2026-06-30'
    ): InstitutionalSnapshot => ({
        quarters: [quarter()],
        topHolders: topHolders(n, up, down),
        topHoldersPeriod: period,
    });
    const cases: ReadonlyArray<
        [string, number, number, InvestorFlowsSignalStrength | null]
    > = [
        ['just below weak', 3, 0, null],
        ['at weak', 4, 0, 'weak'],
        ['just below moderate', 5, 0, 'weak'],
        ['at moderate', 6, 0, 'moderate'],
        ['just below strong', 7, 0, 'moderate'],
        ['at strong', 8, 0, 'strong'],
    ];

    it('uses the documented thresholds', () => {
        expect([
            TOP_HOLDER_CONSENSUS_WEAK,
            TOP_HOLDER_CONSENSUS_MODERATE,
            TOP_HOLDER_CONSENSUS_STRONG,
        ]).toEqual([0.4, 0.6, 0.8]);
    });

    it.each(cases)('%s with 10 holders', (_name, up, down, strength) => {
        const axis = evaluateInstitutionalAxis(
            withTop(10, up, down),
            SHARES_OUTSTANDING
        );
        const signal = signalOf(
            axis.signals,
            'institutional_top_holder_consensus'
        );
        expect(signal?.strength).toBe(strength ?? undefined);
        if (signal !== undefined) expect(signal.direction).toBe('bullish');
    });

    it('nets sellers against buyers and goes bearish when sellers dominate', () => {
        const axis = evaluateInstitutionalAxis(
            withTop(10, 1, 9),
            SHARES_OUTSTANDING
        );
        expect(axis.metrics.topHolderConsensus).toBe(-0.8);
        expect(
            signalOf(axis.signals, 'institutional_top_holder_consensus')
        ).toMatchObject({ direction: 'bearish', strength: 'strong' });
    });

    it('counts new holders as buyers and exited holders as sellers', () => {
        const holders = topHolders(10, 0, 0).map((h, i) => ({
            ...h,
            change: i < 8 ? ('new' as const) : ('exited' as const),
        }));
        const axis = evaluateInstitutionalAxis(
            {
                quarters: [quarter()],
                topHolders: holders,
                topHoldersPeriod: '2026-06-30',
            },
            SHARES_OUTSTANDING
        );
        expect(axis.metrics.topHolderConsensus).toBe(0.6);
    });

    it('only looks at the first TOP_HOLDER_COUNT holders', () => {
        const axis = evaluateInstitutionalAxis(
            withTop(15, 15, 0),
            SHARES_OUTSTANDING
        );
        expect(axis.metrics.topHolderCount).toBe(10);
    });

    it('needs at least TOP_HOLDER_MIN_COUNT holders', () => {
        const enough = evaluateInstitutionalAxis(
            withTop(TOP_HOLDER_MIN_COUNT, TOP_HOLDER_MIN_COUNT, 0),
            SHARES_OUTSTANDING
        );
        const tooFew = evaluateInstitutionalAxis(
            withTop(TOP_HOLDER_MIN_COUNT - 1, TOP_HOLDER_MIN_COUNT - 1, 0),
            SHARES_OUTSTANDING
        );
        expect(enough.metrics.topHolderConsensus).toBe(1);
        expect(tooFew.metrics.topHolderConsensus).toBeNull();
    });

    it('ignores top holders compared in a different quarter than the scored one', () => {
        const axis = evaluateInstitutionalAxis(
            withTop(10, 10, 0, '2026-09-30'),
            SHARES_OUTSTANDING
        );
        expect(axis.metrics.topHolderConsensus).toBeNull();
        const unknown = evaluateInstitutionalAxis(
            withTop(10, 10, 0, null),
            SHARES_OUTSTANDING
        );
        expect(unknown.metrics.topHolderConsensus).toBeNull();
    });
});

describe('evaluateInstitutionalAxis — complete vs in-progress quarters', () => {
    const inProgress = quarter({
        period: '2026-09-30',
        complete: false,
        holders: 400,
        newHolders: 390,
        exited: 0,
        netShareChange: 900_000_000,
    });

    it('scores the latest complete quarter, not the in-progress one', () => {
        const complete = quarterWithHolderChange(
            HOLDER_COUNT_CHANGE_STRONG_PCT
        );
        const axis = evaluateInstitutionalAxis(
            snapshotOf(inProgress, complete),
            SHARES_OUTSTANDING
        );
        expect(axis.metrics.scoredPeriod).toBe(complete.period);
        expect(axis.metrics.holders).toBe(complete.holders);
        expect(axis.sufficiency).toBe('sufficient');
    });

    it('reports the in-progress quarter as partial with a neutral signal that carries no points', () => {
        const axis = evaluateInstitutionalAxis(
            snapshotOf(inProgress, quarter()),
            SHARES_OUTSTANDING
        );
        expect(axis.metrics.partialQuarter).toEqual({
            period: '2026-09-30',
            holders: 400,
            shares: inProgress.shares,
            netShareChange: 900_000_000,
        });
        const partial = signalOf(axis.signals, 'institutional_partial_quarter');
        expect(partial).toMatchObject({
            direction: 'neutral',
            subject: '2026-09-30',
        });
        expect(axis.score).toBe(0);
    });

    it('does not let the partial quarter leak into the scored figures', () => {
        const axis = evaluateInstitutionalAxis(
            snapshotOf(inProgress, quarter()),
            SHARES_OUTSTANDING
        );
        expect(axis.metrics.netShareChangePct).toBe(0);
        expect(axis.metrics.newHolders).toBe(100);
    });

    it('is insufficient when only an in-progress quarter exists, but still reports it', () => {
        const axis = evaluateInstitutionalAxis(
            snapshotOf(inProgress),
            SHARES_OUTSTANDING
        );
        expect(axis).toMatchObject({
            score: null,
            label: 'insufficient',
            sufficiency: 'insufficient',
        });
        expect(axis.metrics.scoredPeriod).toBeNull();
        expect(axis.metrics.partialQuarter?.period).toBe('2026-09-30');
        expect(axis.signals.map(s => s.id)).toEqual([
            'institutional_partial_quarter',
        ]);
    });

    it('has no partial quarter when the latest quarter is complete', () => {
        const axis = evaluateInstitutionalAxis(
            snapshotOf(quarter()),
            SHARES_OUTSTANDING
        );
        expect(axis.metrics.partialQuarter).toBeNull();
    });

    it('sorts quarters itself, so input order does not matter', () => {
        const older = quarter({ period: '2026-03-31', holders: 1400 });
        const newer = quarter({ period: '2026-06-30', holders: 1500 });
        const axis = evaluateInstitutionalAxis(
            snapshotOf(older, newer),
            SHARES_OUTSTANDING
        );
        expect(axis.metrics.scoredPeriod).toBe('2026-06-30');
    });
});

describe('evaluateInstitutionalAxis — sufficiency guards', () => {
    it('is insufficient with no quarters at all', () => {
        const axis = evaluateInstitutionalAxis(
            snapshotOf(),
            SHARES_OUTSTANDING
        );
        expect(axis.score).toBeNull();
        expect(axis.signals).toEqual([]);
    });

    it('requires INSTITUTIONAL_MIN_HOLDERS holders in the scored quarter', () => {
        const atMinimum = quarter({
            holders: INSTITUTIONAL_MIN_HOLDERS,
            newHolders: 0,
            exited: 0,
        });
        const below = quarter({
            holders: INSTITUTIONAL_MIN_HOLDERS - 1,
            newHolders: 0,
            exited: 0,
        });
        expect(
            evaluateInstitutionalAxis(snapshotOf(atMinimum), SHARES_OUTSTANDING)
                .sufficiency
        ).toBe('sufficient');
        const insufficient = evaluateInstitutionalAxis(
            snapshotOf(below),
            SHARES_OUTSTANDING
        );
        expect(insufficient.sufficiency).toBe('insufficient');
        expect(insufficient.metrics.holders).toBe(
            INSTITUTIONAL_MIN_HOLDERS - 1
        );
        expect(insufficient.metrics.holderCountChangePct).toBeNull();
    });

    it('requires INSTITUTIONAL_MIN_PRIOR_HOLDERS holders in the prior quarter (a backfill that marks everyone new is not a comparison)', () => {
        const atMinimum = quarter({
            holders: 500,
            newHolders: 500 - INSTITUTIONAL_MIN_PRIOR_HOLDERS,
            exited: 0,
        });
        const below = quarter({
            holders: 500,
            newHolders: 500 - INSTITUTIONAL_MIN_PRIOR_HOLDERS + 1,
            exited: 0,
        });
        expect(
            evaluateInstitutionalAxis(snapshotOf(atMinimum), SHARES_OUTSTANDING)
                .sufficiency
        ).toBe('sufficient');
        expect(
            evaluateInstitutionalAxis(snapshotOf(below), SHARES_OUTSTANDING)
                .sufficiency
        ).toBe('insufficient');
    });

    it('drops quarters with non-finite figures instead of scoring NaN', () => {
        const axis = evaluateInstitutionalAxis(
            snapshotOf(quarter({ netShareChange: Number.NaN })),
            SHARES_OUTSTANDING
        );
        expect(axis.sufficiency).toBe('insufficient');
        expect(axis.score).toBeNull();
    });
});

describe('evaluateInstitutionalAxis — score', () => {
    it('sums signal points, clamped to 100, and labels the result', () => {
        const strongEverything = quarter({
            holders: 110_000,
            newHolders: 10_000 + 1000,
            exited: 1000,
            netShareChange: 0.05 * SHARES_OUTSTANDING,
        });
        const axis = evaluateInstitutionalAxis(
            {
                quarters: [strongEverything],
                topHolders: topHolders(10, 9, 0),
                topHoldersPeriod: strongEverything.period,
            },
            SHARES_OUTSTANDING
        );
        const raw = axis.signals.reduce(
            (sum, s) => sum + SIGNAL_POINTS[s.strength],
            0
        );
        expect(raw).toBeGreaterThan(100);
        expect(axis.score).toBe(100);
        expect(axis.label).toBe('strong_bullish');
    });

    it('stays at zero and neutral when nothing is unusual', () => {
        const axis = evaluateInstitutionalAxis(
            snapshotOf(quarter()),
            SHARES_OUTSTANDING
        );
        expect(axis.score).toBe(0);
        expect(axis.label).toBe('neutral');
        expect(axis.signals).toEqual([]);
    });

    it('lists the strongest signal first', () => {
        const axis = evaluateInstitutionalAxis(
            snapshotOf(
                quarter({
                    holders: 105_000,
                    newHolders: 5000 + 1000,
                    exited: 1000,
                    netShareChange: 0.03 * SHARES_OUTSTANDING,
                })
            ),
            SHARES_OUTSTANDING
        );
        const strengths = axis.signals.map(s => s.strength);
        expect(strengths[0]).toBe('strong');
        expect(strengths).toEqual(
            strengths.toSorted(
                (a, b) =>
                    ['weak', 'moderate', 'strong'].indexOf(b) -
                    ['weak', 'moderate', 'strong'].indexOf(a)
            )
        );
    });
});

describe('isUsableQuarter', () => {
    it('accepts a normal quarter', () => {
        expect(isUsableQuarter(quarter())).toBe(true);
    });

    it.each([
        ['holders', { holders: Number.NaN }],
        ['shares', { shares: Number.POSITIVE_INFINITY }],
        ['newHolders', { newHolders: Number.NaN }],
        ['exited', { exited: Number.NaN }],
        ['netShareChange', { netShareChange: Number.NaN }],
        ['period (empty)', { period: '' }],
        ['period (unparsable)', { period: 'Q2-2026' }],
    ])('rejects a quarter with a bad %s', (_name, overrides) => {
        expect(isUsableQuarter(quarter(overrides))).toBe(false);
    });
});

describe('evaluateInstitutionalAxis — unusable newest quarter', () => {
    const usable = quarter({ period: '2026-06-30' });
    const broken = quarter({
        period: '2026-09-30',
        complete: false,
        holders: Number.NaN,
    });

    it('ignores it entirely: no partial quarter, and the older usable one is scored', () => {
        const axis = evaluateInstitutionalAxis(
            snapshotOf(broken, usable),
            SHARES_OUTSTANDING
        );
        expect(axis.metrics.scoredPeriod).toBe('2026-06-30');
        expect(axis.metrics.partialQuarter).toBeNull();
        expect(axis.signals.map(s => s.id)).not.toContain(
            'institutional_partial_quarter'
        );
    });
});

describe('evaluateInstitutionalAxis — freshness gate', () => {
    const AS_OF_DAY = parseDay(AS_OF);
    const aged = (age: number) =>
        snapshotOf(quarter({ period: daysBeforeAsOf(age) }));

    it('scores a quarter exactly INSTITUTIONAL_MAX_AGE_DAYS old', () => {
        const axis = evaluateInstitutionalAxis(
            aged(INSTITUTIONAL_MAX_AGE_DAYS),
            SHARES_OUTSTANDING,
            AS_OF_DAY
        );
        expect(axis.sufficiency).toBe('sufficient');
        expect(axis.signals.map(s => s.id)).not.toContain('data_stale');
    });

    it('does not score a quarter one day older and reports a neutral stale signal with the period', () => {
        const period = daysBeforeAsOf(INSTITUTIONAL_MAX_AGE_DAYS + 1);
        const axis = evaluateInstitutionalAxis(
            aged(INSTITUTIONAL_MAX_AGE_DAYS + 1),
            SHARES_OUTSTANDING,
            AS_OF_DAY
        );
        expect(axis).toMatchObject({
            score: null,
            label: 'insufficient',
            sufficiency: 'insufficient',
        });
        expect(axis.metrics.scoredPeriod).toBe(period);
        expect(axis.signals).toEqual([
            {
                id: 'data_stale',
                axis: 'institutional',
                direction: 'neutral',
                strength: 'weak',
                evidence: {
                    ageDays: INSTITUTIONAL_MAX_AGE_DAYS + 1,
                    maxAgeDays: INSTITUTIONAL_MAX_AGE_DAYS,
                },
                subject: period,
            },
        ]);
    });

    it('applies no freshness gate without a reference date', () => {
        const axis = evaluateInstitutionalAxis(
            aged(INSTITUTIONAL_MAX_AGE_DAYS + 500),
            SHARES_OUTSTANDING
        );
        expect(axis.sufficiency).toBe('sufficient');
    });

    it('keeps the partial-quarter signal next to the stale one', () => {
        const axis = evaluateInstitutionalAxis(
            snapshotOf(
                quarter({ period: daysBeforeAsOf(1), complete: false }),
                quarter({
                    period: daysBeforeAsOf(INSTITUTIONAL_MAX_AGE_DAYS + 1),
                })
            ),
            SHARES_OUTSTANDING,
            AS_OF_DAY
        );
        expect(axis.signals.map(s => s.id).toSorted()).toEqual([
            'data_stale',
            'institutional_partial_quarter',
        ]);
    });
});

describe('evaluateInstitutionalAxis — prior-holdings basis guard', () => {
    it.each([
        ['exactly zero', 100, 100],
        ['negative', 100, 150],
    ])(
        'has no net-share figure when prior holdings are %s',
        (_name, shares, net) => {
            const axis = evaluateInstitutionalAxis(
                snapshotOf(quarter({ shares, netShareChange: net })),
                null
            );
            expect(axis.metrics.netShareChangePct).toBeNull();
            expect(axis.metrics.netShareChangeBasis).toBeNull();
        }
    );
});

describe('evaluateInstitutionalAxis — quarters dated after the reference date', () => {
    const AS_OF_DAY = parseDay(AS_OF);
    const future = (days: number) => daysBeforeAsOf(-days);

    it('is insufficient when every quarter is in the future, with no stale signal', () => {
        const axis = evaluateInstitutionalAxis(
            snapshotOf(
                quarter({ period: future(30) }),
                quarter({ period: future(120) })
            ),
            SHARES_OUTSTANDING,
            AS_OF_DAY
        );
        expect(axis).toMatchObject({
            score: null,
            label: 'insufficient',
            signals: [],
        });
        expect(axis.metrics.scoredPeriod).toBeNull();
        expect(axis.metrics.partialQuarter).toBeNull();
    });

    it('scores the newest quarter on or before the reference date and ignores later ones', () => {
        const axis = evaluateInstitutionalAxis(
            snapshotOf(
                quarter({ period: future(30), complete: false }),
                quarter({ period: '2026-06-30' })
            ),
            SHARES_OUTSTANDING,
            AS_OF_DAY
        );
        expect(axis.metrics.scoredPeriod).toBe('2026-06-30');
        expect(axis.metrics.partialQuarter).toBeNull();
    });

    it('treats a quarter ending exactly on the reference day as visible', () => {
        const axis = evaluateInstitutionalAxis(
            snapshotOf(quarter({ period: AS_OF })),
            SHARES_OUTSTANDING,
            AS_OF_DAY
        );
        expect(axis.metrics.scoredPeriod).toBe(AS_OF);
    });

    it('does not mistake a future quarter for the freshest data in the stale gate', () => {
        const old = quarter({
            period: daysBeforeAsOf(INSTITUTIONAL_MAX_AGE_DAYS + 1),
        });
        const axis = evaluateInstitutionalAxis(
            snapshotOf(old, quarter({ period: future(10) })),
            SHARES_OUTSTANDING,
            AS_OF_DAY
        );
        expect(axis.signals.map(s => s.id)).toContain('data_stale');
        expect(axis.sufficiency).toBe('insufficient');
    });
});
