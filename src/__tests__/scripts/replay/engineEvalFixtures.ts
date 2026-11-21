/** Event factories for the engine-evaluation tests. Nothing here is market data. */
import type {
    CandleEvent,
    PatternEvent,
    PerHorizon,
    PlaceboSummary,
} from '../../../../scripts/replay/engineEvalTypes';

export const flat = (value: number): PerHorizon<number> => ({
    h1: value,
    h5: value,
    h10: value,
});

export function placebo(y: number, hit = 0.5, n = 20): PlaceboSummary {
    return { n, y: flat(y), pct: flat(y), hit: flat(hit) };
}

/** A tested directional candle event: outcome `y`, matched placebo mean `placeboY`. */
export function candleEvent(
    overrides: Omit<Partial<CandleEvent>, 'y'> & {
        y?: number;
        placeboY?: number;
    } = {}
): CandleEvent {
    const { y = 1, placeboY = 0, ...rest } = overrides;
    return {
        kind: 'candle',
        symbol: 'AAA',
        market: 'us',
        index: 300,
        date: '2021-03-01',
        week: '2021-W09',
        half: 'early',
        pattern: 'hammer',
        patternType: 'single',
        barCount: 1,
        direction: 1,
        bucket: 'decline',
        violations: [],
        robust: {
            contextViolation: { a05: false, a15: false },
            setupBodyViolation: { f01: false, f05: false },
            matched: { a05: placebo(placeboY), a15: placebo(placeboY) },
        },
        status: 'tested',
        y: flat(y),
        pct: flat(y),
        matched: placebo(placeboY),
        unmatched: placebo(placeboY),
        ...rest,
    };
}

export function patternEvent(
    overrides: Partial<PatternEvent> = {}
): PatternEvent {
    return {
        kind: 'pattern',
        symbol: 'AAA',
        market: 'us',
        index: 600,
        date: '2021-03-01',
        week: '2021-W09',
        half: 'early',
        id: 'bull_flag',
        direction: 'up',
        bucket: 'none',
        close: 100,
        breakout: 101,
        target: 110,
        conservativeTarget: 105,
        invalidation: 95,
        target60: 'hit',
        cons60: 'hit',
        placeboTargetHit: 0.25,
        placeboConsHit: 0.5,
        placeboN: 20,
        label20: {
            outcome: 'target_first',
            skipReason: null,
            rwNullTargetFirst: 0.5,
        },
        ...overrides,
    };
}

/** `count` events spread over `weeks` consecutive weeks. */
export function spread<T extends { week: string }>(
    count: number,
    weeks: number,
    make: (i: number) => T
): T[] {
    return Array.from({ length: count }, (_, i) => ({
        ...make(i),
        week: `2021-W${String((i % weeks) + 1).padStart(2, '0')}`,
    }));
}
