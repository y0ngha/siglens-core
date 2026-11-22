import { postProcessRawAnalysis } from '@/application/market/postProcessRawAnalysis';
import type { ActionRecommendation, AnalysisResponse } from '@/domain/types';

/**
 * Synthetic raw trade plans for the plan-invariant grid. Every axis is enumerated, no
 * randomness, so a failing case is reproducible from its printed name.
 */

export const GRID_LAST_CLOSE = 100;
export const GRID_ATR = 2;

export type StopKind = 'missing' | 'below' | 'inside' | 'above';
export type TargetsKind =
    | 'ascending'
    | 'descending'
    | 'one_inside_zone'
    | 'one_non_positive'
    | 'duplicate'
    | 'empty';
export type EntriesKind = 'single' | 'range' | 'reversed' | 'empty';
export type Verdict = 'enter' | 'wait' | 'avoid';
export type AtrKind = 'usable' | 'undefined';

export interface GridCase {
    readonly stop: StopKind;
    readonly targets: TargetsKind;
    readonly entries: EntriesKind;
    readonly verdict: Verdict;
    readonly atr: AtrKind;
}

const STOPS: readonly StopKind[] = ['missing', 'below', 'inside', 'above'];
const TARGETS: readonly TargetsKind[] = [
    'ascending',
    'descending',
    'one_inside_zone',
    'one_non_positive',
    'duplicate',
    'empty',
];
const ENTRIES: readonly EntriesKind[] = [
    'single',
    'range',
    'reversed',
    'empty',
];
const VERDICTS: readonly Verdict[] = ['enter', 'wait', 'avoid'];
const ATRS: readonly AtrKind[] = ['usable', 'undefined'];

/** The full cartesian product, in a fixed order. */
export const PLAN_GRID: readonly GridCase[] = STOPS.flatMap(stop =>
    TARGETS.flatMap(targets =>
        ENTRIES.flatMap(entries =>
            VERDICTS.flatMap(verdict =>
                ATRS.map(atr => ({ stop, targets, entries, verdict, atr }))
            )
        )
    )
);

/** The ATR the case's chain runs with; `null` when the case has none. */
export const gridAtr = (c: GridCase): number | null =>
    c.atr === 'usable' ? GRID_ATR : null;

export const gridName = (c: GridCase): string =>
    `stop=${c.stop} targets=${c.targets} entries=${c.entries} verdict=${c.verdict} atr=${c.atr}`;

function entryPrices(kind: EntriesKind): number[] {
    switch (kind) {
        case 'single':
            return [GRID_LAST_CLOSE];
        case 'range':
            return [98, 102];
        case 'reversed':
            return [102, 98];
        case 'empty':
            return [];
    }
}

/** Zone edges the stop and target axes are placed against (`empty` falls back to the close). */
function zoneEdges(kind: EntriesKind): { low: number; high: number } {
    const prices = entryPrices(kind);
    return prices.length === 0
        ? { low: GRID_LAST_CLOSE, high: GRID_LAST_CLOSE }
        : { low: Math.min(...prices), high: Math.max(...prices) };
}

function stopLoss(
    kind: StopKind,
    low: number,
    high: number
): number | undefined {
    switch (kind) {
        case 'missing':
            return undefined;
        case 'below':
            return low * 0.9;
        case 'inside':
            return (low + high) / 2;
        case 'above':
            return high * 1.1;
    }
}

function takeProfitPrices(
    kind: TargetsKind,
    low: number,
    high: number
): number[] {
    const near = high * 1.05;
    const far = high * 1.1;
    switch (kind) {
        case 'ascending':
            return [near, far];
        case 'descending':
            return [far, near];
        case 'one_inside_zone':
            return [(low + high) / 2, near];
        case 'one_non_positive':
            return [near, 0];
        case 'duplicate':
            return [near, near];
        case 'empty':
            return [];
    }
}

/** The raw model recommendation for one grid case (a stored-JSON shape, no reconciliation). */
export function rawRecommendation(c: GridCase): ActionRecommendation {
    const { low, high } = zoneEdges(c.entries);
    const stop = stopLoss(c.stop, low, high);
    return {
        positionAnalysis: 'synthetic',
        entry: 'synthetic',
        exit: 'synthetic',
        riskReward: 'synthetic',
        entryRecommendation: c.verdict,
        entryPrices: entryPrices(c.entries),
        ...(stop === undefined ? {} : { stopLoss: stop }),
        takeProfitPrices: takeProfitPrices(c.targets, low, high),
    };
}

/** The post-processed analysis for one grid case, through the production chain. */
export function postProcessGridCase(c: GridCase): AnalysisResponse {
    const { reconciled } = postProcessRawAnalysis({
        rawResult: {
            summary: 'synthetic',
            trend: 'bullish',
            indicatorResults: [],
            riskLevel: 'medium',
            keyLevels: { support: [], resistance: [] },
            priceTargets: { bullish: null, bearish: null },
            patternSummaries: [],
            strategyResults: [],
            candlePatterns: [],
            trendlines: [],
            actionRecommendation: rawRecommendation(c),
        },
        skills: [],
        overlayCandidates: [],
        patternGeometries: new Map(),
        lastClose: GRID_LAST_CLOSE,
        atr: gridAtr(c) ?? undefined,
        stopCandidates: [],
        currency: 'USD',
    });
    return reconciled;
}

export interface EdgePlan {
    readonly name: string;
    readonly recommendation: ActionRecommendation;
    readonly atr: number | undefined;
}

const edge = (
    name: string,
    overrides: Partial<ActionRecommendation>,
    atr: number | undefined = GRID_ATR
): EdgePlan => ({
    name,
    atr,
    recommendation: {
        positionAnalysis: 'synthetic',
        entry: 'synthetic',
        exit: 'synthetic',
        riskReward: 'synthetic',
        entryRecommendation: 'enter',
        entryPrices: [98, 102],
        stopLoss: 90,
        takeProfitPrices: [105, 110],
        ...overrides,
    },
});

/** Boundary plans the axis grid does not reach, each judged on its own. */
export const EDGE_PLANS: readonly EdgePlan[] = [
    edge('stop equal to the zone low, ATR usable', { stopLoss: 98 }),
    edge('stop equal to the zone low, no ATR', { stopLoss: 98 }, undefined),
    edge(
        'stop just below the zone low, no ATR',
        { stopLoss: 97.99 },
        undefined
    ),
    edge('first target equal to the zone high', {
        takeProfitPrices: [102, 110],
    }),
    edge('every target equal to the zone high', {
        takeProfitPrices: [102, 102],
    }),
    edge('first target beyond the ATR cap', { takeProfitPrices: [130, 105] }),
    edge('only target beyond the ATR cap', { takeProfitPrices: [130] }),
    edge('NaN and Infinity entry prices', {
        entryPrices: [Number.NaN, 98, Number.POSITIVE_INFINITY],
    }),
    edge('NaN and Infinity targets', {
        takeProfitPrices: [Number.NaN, 105, Number.POSITIVE_INFINITY, 110],
    }),
    edge('negative and zero targets', { takeProfitPrices: [-1, 0, 105] }),
    edge(
        'descending targets, no ATR',
        { takeProfitPrices: [110, 105] },
        undefined
    ),
    edge(
        'duplicate targets, no ATR',
        { takeProfitPrices: [105, 105] },
        undefined
    ),
    edge(
        'invalid stop, no ATR, single entry',
        {
            entryPrices: [100],
            stopLoss: 100,
        },
        undefined
    ),
    edge('no stop, no ATR', { stopLoss: undefined }, undefined),
    edge('three-point entry array', { entryPrices: [102, 98, 100] }),
];

/** Post-processes one edge plan through the production chain. */
export function postProcessEdgePlan(plan: EdgePlan): AnalysisResponse {
    return postProcessRawAnalysis({
        rawResult: {
            summary: 'synthetic',
            trend: 'bullish',
            indicatorResults: [],
            riskLevel: 'medium',
            keyLevels: { support: [], resistance: [] },
            priceTargets: { bullish: null, bearish: null },
            patternSummaries: [],
            strategyResults: [],
            candlePatterns: [],
            trendlines: [],
            actionRecommendation: plan.recommendation,
        },
        skills: [],
        overlayCandidates: [],
        patternGeometries: new Map(),
        lastClose: GRID_LAST_CLOSE,
        atr: plan.atr,
        stopCandidates: [],
        currency: 'USD',
    }).reconciled;
}
