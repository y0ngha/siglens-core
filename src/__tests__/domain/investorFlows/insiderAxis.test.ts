import { describe, expect, it } from 'vitest';
import {
    INSIDER_BUY_MODERATE_USD,
    INSIDER_BUY_STRONG_USD,
    INSIDER_BUY_WEAK_USD,
    INSIDER_CLUSTER_MIN_INSIDERS,
    INSIDER_CLUSTER_STRONG_INSIDERS,
    INSIDER_CLUSTER_WINDOW_DAYS,
    INSIDER_LARGE_SELL_FRACTION,
    INSIDER_LARGE_SELL_STRONG_INSIDERS,
    INSIDER_ROLE_WEIGHTS,
    INSIDER_SELL_MIN_USD,
    INSIDER_WINDOW_DAYS,
} from '@/domain/investorFlows/constants';
import {
    classifyInsiderRole,
    countInsiderTransactionsInWindow,
    evaluateInsiderAxis,
} from '@/domain/investorFlows/insiderAxis';
import { parseDay } from '@/domain/investorFlows/scoreHelpers';
import type {
    InsiderTransaction,
    InvestorFlowsSignal,
    InvestorFlowsSignalId,
    InvestorFlowsSignalStrength,
} from '@/domain/types';
import { AS_OF, daysBeforeAsOf, insiderTx } from '../../fixtures/investorFlows';

const AS_OF_DAY = parseDay(AS_OF);

function axisOf(...transactions: InsiderTransaction[]) {
    return evaluateInsiderAxis({ transactions }, AS_OF_DAY);
}

function signalOf(
    signals: readonly InvestorFlowsSignal[],
    id: InvestorFlowsSignalId
): InvestorFlowsSignal | undefined {
    return signals.find(s => s.id === id);
}

/** One officer buy worth `value` USD. */
function buyOf(value: number, overrides: Partial<InsiderTransaction> = {}) {
    return insiderTx({ type: 'buy', value, ...overrides });
}

/** A buy by a distinct insider `daysAgo` days before the reference date. */
function buyBy(name: string, daysAgo: number, value = 10_000) {
    return buyOf(value, { name, date: daysBeforeAsOf(daysAgo) });
}

describe('classifyInsiderRole', () => {
    it.each([
        ['officer: Chief Executive Officer', 'officerOrDirector'],
        ['director', 'officerOrDirector'],
        ['Director', 'officerOrDirector'],
        ['officer: President and CEO', 'officerOrDirector'],
        ['officer: EVP, General Counsel', 'officerOrDirector'],
        ['director, 10 percent owner', 'officerOrDirector'],
        ['10 percent owner', 'tenPercentOwner'],
        ['10% owner', 'tenPercentOwner'],
        ['ten percent owner', 'tenPercentOwner'],
        ['other', 'other'],
        ['', 'other'],
    ] as const)('%j → %s', (role, expected) => {
        expect(classifyInsiderRole(role)).toBe(expected);
    });
});

describe('evaluateInsiderAxis — open-market buying', () => {
    const cases: ReadonlyArray<
        [string, number, InvestorFlowsSignalStrength | null]
    > = [
        ['just below weak', INSIDER_BUY_WEAK_USD - 1, null],
        ['at weak', INSIDER_BUY_WEAK_USD, 'weak'],
        ['just below moderate', INSIDER_BUY_MODERATE_USD - 1, 'weak'],
        ['at moderate', INSIDER_BUY_MODERATE_USD, 'moderate'],
        ['just below strong', INSIDER_BUY_STRONG_USD - 1, 'moderate'],
        ['at strong', INSIDER_BUY_STRONG_USD, 'strong'],
    ];

    it.each(cases)('officer buy %s', (_name, value, strength) => {
        const signal = signalOf(
            axisOf(buyOf(value)).signals,
            'insider_open_market_buying'
        );
        expect(signal?.strength).toBe(strength ?? undefined);
        if (signal !== undefined) expect(signal.direction).toBe('bullish');
    });

    it('weights a 10% owner buy at half, so it needs twice the value for the same strength', () => {
        const owner = (value: number) =>
            buyOf(value, { role: '10 percent owner' });
        const weight = INSIDER_ROLE_WEIGHTS.tenPercentOwner;
        expect(
            signalOf(
                axisOf(owner(INSIDER_BUY_WEAK_USD / weight)).signals,
                'insider_open_market_buying'
            )?.strength
        ).toBe('weak');
        expect(
            signalOf(
                axisOf(owner(INSIDER_BUY_WEAK_USD / weight - 2)).signals,
                'insider_open_market_buying'
            )
        ).toBeUndefined();
    });

    it('reports raw and weighted buy value separately', () => {
        const axis = axisOf(
            buyOf(100_000, { name: 'A' }),
            buyOf(100_000, { name: 'B', role: '10 percent owner' })
        );
        expect(axis.metrics).toMatchObject({
            buyValueUsd: 200_000,
            weightedBuyValueUsd: 150_000,
            buyerCount: 2,
            buyCount: 2,
        });
    });

    it('derives the value from shares x price when no value was reported', () => {
        const axis = axisOf(
            buyOf(0, { value: null, shares: 5000, price: 100, name: 'A' })
        );
        expect(axis.metrics?.buyValueUsd).toBe(500_000);
    });

    it.each([
        ['zero', 0],
        ['negative', -250],
        ['NaN', Number.NaN],
    ])(
        'falls back to shares x price when the reported value is %s',
        (_name, value) => {
            const axis = axisOf(
                buyOf(0, { value, shares: 5000, price: 100, name: 'A' })
            );
            expect(axis.metrics?.buyValueUsd).toBe(500_000);
        }
    );

    it('counts a buy with no value and no price toward buyers but not toward value', () => {
        const axis = axisOf(buyOf(0, { value: null, price: null, name: 'A' }));
        expect(axis.metrics).toMatchObject({ buyCount: 1, buyValueUsd: 0 });
    });

    it('ignores transactions typed other', () => {
        const axis = axisOf(
            insiderTx({ type: 'other', value: 5_000_000 }),
            buyOf(100_000)
        );
        expect(axis.metrics).toMatchObject({ buyCount: 1, sellCount: 0 });
    });
});

describe('evaluateInsiderAxis — window', () => {
    it('includes a transaction exactly INSIDER_WINDOW_DAYS old and excludes the day after', () => {
        const inside = axisOf(
            buyOf(INSIDER_BUY_STRONG_USD, {
                date: daysBeforeAsOf(INSIDER_WINDOW_DAYS),
            })
        );
        const outside = axisOf(
            buyOf(INSIDER_BUY_STRONG_USD, {
                date: daysBeforeAsOf(INSIDER_WINDOW_DAYS + 1),
            })
        );
        expect(inside.metrics?.buyCount).toBe(1);
        expect(outside.metrics?.buyCount).toBe(0);
    });

    it('ignores transactions dated after the reference date', () => {
        const axis = axisOf(
            buyOf(INSIDER_BUY_STRONG_USD, { date: daysBeforeAsOf(-1) }),
            buyOf(100_000, { name: 'A' })
        );
        expect(axis.metrics?.buyCount).toBe(1);
    });

    it('counts only in-window transactions for the freshness metadata', () => {
        expect(
            countInsiderTransactionsInWindow(
                {
                    transactions: [
                        buyOf(1, { date: daysBeforeAsOf(INSIDER_WINDOW_DAYS) }),
                        buyOf(1, {
                            date: daysBeforeAsOf(INSIDER_WINDOW_DAYS + 1),
                        }),
                        buyOf(1, { date: 'not-a-date' }),
                    ],
                },
                AS_OF_DAY
            )
        ).toBe(1);
        expect(
            countInsiderTransactionsInWindow({ transactions: [buyOf(1)] }, null)
        ).toBe(0);
    });
});

describe('evaluateInsiderAxis — cluster buy', () => {
    const cluster = (count: number, spanDays: number) =>
        Array.from({ length: count }, (_, i) =>
            buyBy(
                `Insider ${i}`,
                60 - Math.round((spanDays * i) / Math.max(count - 1, 1))
            )
        );

    it('flags INSIDER_CLUSTER_MIN_INSIDERS distinct insiders within the window', () => {
        const axis = axisOf(
            ...cluster(
                INSIDER_CLUSTER_MIN_INSIDERS,
                INSIDER_CLUSTER_WINDOW_DAYS
            )
        );
        expect(axis.metrics).toMatchObject({
            clusterBuy: true,
            largestBuyCluster: INSIDER_CLUSTER_MIN_INSIDERS,
        });
        expect(signalOf(axis.signals, 'insider_cluster_buy')).toMatchObject({
            direction: 'bullish',
            strength: 'moderate',
        });
    });

    it('does not flag one fewer insider', () => {
        const axis = axisOf(
            ...cluster(
                INSIDER_CLUSTER_MIN_INSIDERS - 1,
                INSIDER_CLUSTER_WINDOW_DAYS
            )
        );
        expect(axis.metrics?.clusterBuy).toBe(false);
        expect(signalOf(axis.signals, 'insider_cluster_buy')).toBeUndefined();
    });

    it('does not flag a span one day wider than the cluster window', () => {
        const axis = axisOf(
            ...cluster(
                INSIDER_CLUSTER_MIN_INSIDERS,
                INSIDER_CLUSTER_WINDOW_DAYS + 1
            )
        );
        expect(axis.metrics?.largestBuyCluster).toBe(
            INSIDER_CLUSTER_MIN_INSIDERS - 1
        );
        expect(axis.metrics?.clusterBuy).toBe(false);
    });

    it('is strong from INSIDER_CLUSTER_STRONG_INSIDERS, moderate one below', () => {
        const strong = axisOf(
            ...cluster(
                INSIDER_CLUSTER_STRONG_INSIDERS,
                INSIDER_CLUSTER_WINDOW_DAYS
            )
        );
        const moderate = axisOf(
            ...cluster(
                INSIDER_CLUSTER_STRONG_INSIDERS - 1,
                INSIDER_CLUSTER_WINDOW_DAYS
            )
        );
        expect(signalOf(strong.signals, 'insider_cluster_buy')?.strength).toBe(
            'strong'
        );
        expect(
            signalOf(moderate.signals, 'insider_cluster_buy')?.strength
        ).toBe('moderate');
    });

    it('counts distinct people: one insider buying three times is not a cluster', () => {
        const axis = axisOf(
            buyBy('Same Person', 40),
            buyBy('Same Person', 30),
            buyBy('same person ', 20)
        );
        expect(axis.metrics).toMatchObject({
            largestBuyCluster: 1,
            clusterBuy: false,
            buyerCount: 1,
            buyCount: 3,
        });
    });

    it('finds the cluster inside a longer buying history', () => {
        const axis = axisOf(
            buyBy('Early', 85),
            buyBy('A', 20),
            buyBy('B', 15),
            buyBy('C', 10)
        );
        expect(axis.metrics?.largestBuyCluster).toBe(3);
    });
});

describe('evaluateInsiderAxis — selling', () => {
    const sellOf = (
        value: number,
        overrides: Partial<InsiderTransaction> = {}
    ) =>
        insiderTx({
            type: 'sell',
            value,
            shares: 1000,
            sharesOwnedAfter: 1_000_000,
            ...overrides,
        });

    it('reports routine selling as weak, at the minimum value and not below it', () => {
        const at = axisOf(sellOf(INSIDER_SELL_MIN_USD));
        const below = axisOf(sellOf(INSIDER_SELL_MIN_USD - 1));
        expect(signalOf(at.signals, 'insider_routine_selling')).toMatchObject({
            direction: 'bearish',
            strength: 'weak',
        });
        expect(
            signalOf(below.signals, 'insider_routine_selling')
        ).toBeUndefined();
    });

    it('never lets routine selling exceed weak however large it is', () => {
        const axis = axisOf(sellOf(500_000_000));
        expect(
            signalOf(axis.signals, 'insider_routine_selling')?.strength
        ).toBe('weak');
        expect(axis.score).toBe(-15);
        expect(axis.label).toBe('neutral');
    });

    it('treats a sale of at least INSIDER_LARGE_SELL_FRACTION of the position as large', () => {
        const sold = INSIDER_LARGE_SELL_FRACTION * 100;
        const large = axisOf(
            sellOf(INSIDER_SELL_MIN_USD, {
                shares: sold,
                sharesOwnedAfter: 100 - sold,
            })
        );
        const justBelow = axisOf(
            sellOf(INSIDER_SELL_MIN_USD, {
                shares: sold - 1,
                sharesOwnedAfter: 100 - sold + 1,
            })
        );
        expect(signalOf(large.signals, 'insider_large_selling')).toMatchObject({
            direction: 'bearish',
            strength: 'moderate',
        });
        expect(large.metrics?.largeSellCount).toBe(1);
        expect(
            signalOf(justBelow.signals, 'insider_large_selling')
        ).toBeUndefined();
        expect(
            signalOf(justBelow.signals, 'insider_routine_selling')
        ).toBeDefined();
    });

    it('does not report a large sale that moved less than the minimum value', () => {
        const axis = axisOf(
            sellOf(INSIDER_SELL_MIN_USD - 1, {
                shares: 50,
                sharesOwnedAfter: 50,
            })
        );
        expect(signalOf(axis.signals, 'insider_large_selling')).toBeUndefined();
    });

    it('cannot call a sale large without knowing the holdings', () => {
        const axis = axisOf(
            sellOf(5_000_000, { sharesOwnedAfter: null, shares: 1_000_000 })
        );
        expect(signalOf(axis.signals, 'insider_large_selling')).toBeUndefined();
        expect(signalOf(axis.signals, 'insider_routine_selling')).toBeDefined();
    });

    it('is strong when INSIDER_LARGE_SELL_STRONG_INSIDERS distinct insiders sold large, moderate one below', () => {
        const largeBy = (n: number) =>
            Array.from({ length: n }, (_, i) =>
                sellOf(INSIDER_SELL_MIN_USD, {
                    name: `Seller ${i}`,
                    shares: 50,
                    sharesOwnedAfter: 50,
                })
            );
        expect(
            signalOf(
                axisOf(...largeBy(INSIDER_LARGE_SELL_STRONG_INSIDERS)).signals,
                'insider_large_selling'
            )?.strength
        ).toBe('strong');
        expect(
            signalOf(
                axisOf(...largeBy(INSIDER_LARGE_SELL_STRONG_INSIDERS - 1))
                    .signals,
                'insider_large_selling'
            )?.strength
        ).toBe('moderate');
    });

    it('nets sells against buys in the headline figure', () => {
        const axis = axisOf(
            buyOf(300_000, { name: 'A' }),
            sellOf(100_000, { name: 'B' })
        );
        expect(axis.metrics?.netValueUsd).toBe(200_000);
    });
});

describe('evaluateInsiderAxis — sufficiency', () => {
    it('is insufficient with no transactions at all, and not a fake zero', () => {
        const axis = axisOf();
        expect(axis).toMatchObject({
            score: null,
            label: 'insufficient',
            sufficiency: 'insufficient',
            metrics: null,
            signals: [],
        });
    });

    it('is insufficient when EVERY transaction is dated after the reference date (no neutral vote)', () => {
        const axis = axisOf(
            buyOf(INSIDER_BUY_STRONG_USD, { date: daysBeforeAsOf(-1) }),
            buyOf(100_000, { date: daysBeforeAsOf(-30), name: 'B' })
        );
        expect(axis).toMatchObject({
            score: null,
            label: 'insufficient',
            sufficiency: 'insufficient',
            metrics: null,
            signals: [],
        });
    });

    it('still counts a transaction dated on the reference date', () => {
        const axis = axisOf(buyOf(100_000, { date: daysBeforeAsOf(0) }));
        expect(axis.sufficiency).toBe('sufficient');
        expect(axis.metrics?.buyCount).toBe(1);
    });

    it('is insufficient when the reference date is unusable', () => {
        const axis = evaluateInsiderAxis({ transactions: [buyOf(1)] }, null);
        expect(axis.sufficiency).toBe('insufficient');
    });

    it('is insufficient when no transaction has a usable date', () => {
        const axis = axisOf(buyOf(1, { date: 'garbage' }));
        expect(axis.sufficiency).toBe('insufficient');
    });

    it('reads an empty window with older history as quiet, scored neutral at zero', () => {
        const axis = axisOf(buyOf(100_000, { date: daysBeforeAsOf(200) }));
        expect(axis).toMatchObject({
            score: 0,
            label: 'neutral',
            sufficiency: 'sufficient',
        });
        expect(axis.signals.map(s => s.id)).toEqual(['insider_quiet']);
        expect(axis.signals[0].direction).toBe('neutral');
    });

    it('is not quiet when the window holds only unscored transactions', () => {
        const axis = axisOf(insiderTx({ type: 'other' }));
        expect(signalOf(axis.signals, 'insider_quiet')).toBeUndefined();
    });
});

describe('evaluateInsiderAxis — score', () => {
    it('adds the buy and cluster signals and labels the result', () => {
        const axis = axisOf(
            ...Array.from({ length: 4 }, (_, i) =>
                buyBy(`Insider ${i}`, 40 - i * 5, 300_000)
            )
        );
        // 4 x 300k = 1.2M weighted -> strong buy (60) + moderate cluster (35)
        expect(axis.score).toBe(95);
        expect(axis.label).toBe('strong_bullish');
        expect(axis.signals.map(s => s.id)).toEqual([
            'insider_open_market_buying',
            'insider_cluster_buy',
        ]);
    });

    it('nets buying signals against large selling', () => {
        const axis = axisOf(
            buyOf(INSIDER_BUY_STRONG_USD, { name: 'A' }),
            insiderTx({
                type: 'sell',
                name: 'B',
                value: INSIDER_SELL_MIN_USD,
                shares: 50,
                sharesOwnedAfter: 50,
            })
        );
        expect(axis.score).toBe(25);
    });
});
