import { describe, expect, it } from 'vitest';
import {
    candleHitObservations,
    candleObservations,
    candlePoolEvents,
    candleReport,
    caseLinesReport,
    deltaStat,
    edgeStat,
    g1Report,
    isCandleEvent,
    isPatternEvent,
    labelReport,
    makeResamplings,
    patternObservations,
    patternReport,
    placeboZ,
    summarizeArm,
    toBlocks,
    widerInterval,
} from '../../../../scripts/replay/engineEvalCompute';
import { blockOfWeek } from '../../../../scripts/replay/engineEvalStats';
import { EVAL_CONSTANTS } from '../../../../scripts/replay/engineEvalTypes';
import {
    candleEvent,
    flat,
    patternEvent,
    placebo,
    spread,
} from './engineEvalFixtures';

const weeks = (n: number): string[] =>
    Array.from(
        { length: n },
        (_, i) => `2021-W${String(i + 1).padStart(2, '0')}`
    );

const untested = (event: ReturnType<typeof candleEvent>) => ({
    ...event,
    y: null,
    pct: null,
    matched: null,
    unmatched: null,
});

describe('edgeStat', () => {
    const { weeks: resampling } = makeResamplings(weeks(8));

    it('collapses the interval on a constant excess and reports n', () => {
        const stat = edgeStat(
            weeks(8).map(week => ({ week, value: 0.5 })),
            resampling
        );
        expect(stat.n).toBe(8);
        expect(stat.mean).toBeCloseTo(0.5, 12);
        expect(stat.low).toBeCloseTo(0.5, 12);
        expect(stat.high).toBeCloseTo(0.5, 12);
        expect(stat.droppedReplicates).toBe(0);
    });

    it('is empty for no observations, never 0, and reports every replicate as dropped', () => {
        expect(edgeStat([], resampling)).toEqual({
            n: 0,
            mean: null,
            low: null,
            high: null,
            p: null,
            droppedReplicates: EVAL_CONSTANTS.bootstrapReplicates,
        });
    });

    it('counts the resamples that never drew the weeks holding the pool', () => {
        const stat = edgeStat([{ week: '2021-W01', value: 1 }], resampling);
        expect(stat.droppedReplicates).toBe(
            resampling.multiplicities.filter(m => m[0] === 0).length
        );
        expect(stat.droppedReplicates).toBeGreaterThan(0);
    });

    it('is deterministic', () => {
        const obs = weeks(8).map((week, i) => ({ week, value: i }));
        expect(edgeStat(obs, resampling)).toEqual(edgeStat(obs, resampling));
    });
});

describe('deltaStat', () => {
    const before = weeks(10).map(week => ({ week, value: 1 }));
    const after = weeks(10).map(week => ({ week, value: 3 }));
    const { weeks: resampling } = makeResamplings(weeks(10));

    it('is after minus before with an interval taken inside each resample', () => {
        const delta = deltaStat(before, after, resampling);
        expect(delta.nBefore).toBe(10);
        expect(delta.nAfter).toBe(10);
        expect(delta.delta).toBeCloseTo(2, 12);
        expect(delta.low).toBeCloseTo(2, 12);
        expect(delta.high).toBeCloseTo(2, 12);
    });

    it('is null when either arm has no observation', () => {
        expect(deltaStat([], after, resampling).delta).toBeNull();
        expect(deltaStat(before, [], resampling).delta).toBeNull();
        expect(deltaStat([], [], resampling).low).toBeNull();
    });
});

describe('blocks and the wider interval', () => {
    it('clusters weeks into blocks, keeping the value', () => {
        const blocked = toBlocks([{ week: '2021-W05', value: 2 }]);
        expect(blocked).toEqual([
            {
                week: blockOfWeek('2021-W05', EVAL_CONSTANTS.blockWeeks),
                value: 2,
            },
        ]);
    });

    it('takes the lower low and the higher high, and none when either is missing', () => {
        expect(
            widerInterval({ low: -0.1, high: 0.2 }, { low: -0.3, high: 0.1 })
        ).toEqual({ low: -0.3, high: 0.2 });
        expect(
            widerInterval({ low: null, high: 0.2 }, { low: -0.3, high: 0.1 })
        ).toEqual({ low: null, high: 0.2 });
        expect(
            widerInterval({ low: -0.1, high: 0.2 }, { low: -0.3, high: null })
        ).toEqual({ low: -0.3, high: null });
    });

    it('builds a block resampling with fewer clusters than weeks', () => {
        const { weeks: w, blocks } = makeResamplings(weeks(30));
        expect(w.keys).toHaveLength(30);
        expect(blocks.keys.length).toBeLessThan(30);
        expect(blocks.keys.length).toBeGreaterThanOrEqual(2);
    });
});

describe('candle pools and observations', () => {
    const events = [
        candleEvent({ direction: 1, y: 2, placeboY: 0.5 }),
        candleEvent({ direction: -1, y: 1, placeboY: 0.25 }),
        untested(candleEvent({ status: 'neutral', direction: 0 })),
        untested(candleEvent({ status: 'dropped' })),
    ];

    it('keeps tested events only and splits by direction', () => {
        expect(candlePoolEvents(events, 'bullish')).toHaveLength(1);
        expect(candlePoolEvents(events, 'bearish')).toHaveLength(1);
        expect(candlePoolEvents(events, 'pooled')).toHaveLength(2);
    });

    it('subtracts the chosen placebo from the outcome', () => {
        const pool = candlePoolEvents(events, 'pooled');
        expect(
            candleObservations(pool, 'y', 'h5', 'matched').map(o => o.value)
        ).toEqual([1.5, 0.75]);
        expect(
            candleObservations(pool, 'pct', 'h1', 'unmatched').map(o => o.value)
        ).toEqual([1.5, 0.75]);
    });

    it('takes the hit share against the placebo share', () => {
        const pool = candlePoolEvents(
            [candleEvent({ y: 1 }), candleEvent({ y: -1 })],
            'pooled'
        );
        expect(candleHitObservations(pool, 'h5').map(o => o.value)).toEqual([
            0.5, -0.5,
        ]);
    });
});

describe('candleReport', () => {
    const resamplings = makeResamplings(weeks(6));

    it('counts statuses, patterns and violations and fills the three pools', () => {
        const tested = spread(6, 6, () => candleEvent());
        const events = [
            ...tested,
            candleEvent({
                pattern: 'tweezers_top',
                violations: ['context', 'tweezersClose'],
                direction: -1,
            }),
            untested(
                candleEvent({
                    status: 'neutral',
                    direction: 0,
                    pattern: 'on_neck',
                })
            ),
            untested(candleEvent({ status: 'dropped' })),
        ];
        const report = candleReport(events, resamplings);
        expect(report.events).toBe(9);
        expect(report.tested).toBe(7);
        expect(report.neutral).toBe(1);
        expect(report.dropped).toBe(1);
        expect(report.byPattern.hammer).toBe(7);
        expect(report.violations).toEqual({
            context: 1,
            setupBody: 0,
            dojiSetup: 0,
            tweezersClose: 1,
        });
        expect(report.violationsByPattern).toEqual({
            tweezers_top: { context: 1, tweezersClose: 1 },
        });
        expect(report.pools.pooled.n).toBe(7);
        expect(report.pools.bullish.n).toBe(6);
        expect(report.pools.bearish.n).toBe(1);
        expect(report.pools.bullish.eventHitShare).toBe(1);
        expect(report.pools.bullish.placeboHitShare).toBe(0.5);
        expect(report.pools.bullish.byMarket.us.n).toBe(6);
        expect(report.pools.bullish.byMarket.kr.n).toBe(0);
        expect(report.pools.bullish.byHalf.early.n).toBe(6);
        expect(report.pools.bullish.byHalf.late.n).toBe(0);
    });

    it('adjusts the three primary p-values together (Holm)', () => {
        const events = spread(12, 6, () => candleEvent({ y: 2 }));
        const report = candleReport(events, resamplings);
        const p = report.pools.bullish.primary.p;
        expect(p).not.toBeNull();
        // Bullish and pooled hold the same events (two testable, equal p-values), the
        // bearish pool is empty (null p): each testable p is multiplied by 2.
        expect(report.pools.bullish.primaryPHolm).toBeCloseTo(2 * (p ?? 0), 12);
        expect(report.pools.pooled.primaryPHolm).toBeCloseTo(2 * (p ?? 0), 12);
        expect(report.pools.bearish.primaryPHolm).toBeNull();
    });

    it('reports a family edge, splits and Holm only from minFamilyN events', () => {
        const n = EVAL_CONSTANTS.minFamilyN;
        const small = candleReport(
            spread(n - 1, 6, () => candleEvent({ pattern: 'hammer' })),
            resamplings
        ).families[0];
        expect(small).toEqual({
            family: 'hammer',
            n: n - 1,
            primary: null,
            primaryBlock: null,
            primaryPHolm: null,
            byMarket: null,
            byHalf: null,
        });
        const [big] = candleReport(
            spread(n, 6, () =>
                candleEvent({ pattern: 'hammer', market: 'kr' })
            ),
            resamplings
        ).families;
        expect(big.primary?.n).toBe(n);
        expect(big.primaryBlock).toBeNull();
        expect(big.byMarket?.kr.n).toBe(n);
        expect(big.byMarket?.us.n).toBe(0);
        expect(big.byHalf?.early.n).toBe(n);
        expect(big.byHalf?.late.n).toBe(0);
    });

    it('adjusts family p-values across the qualifying families', () => {
        const n = EVAL_CONSTANTS.minFamilyN;
        const events = [
            ...spread(n, 6, i =>
                candleEvent({ pattern: 'hammer', y: 2 + (i % 2) })
            ),
            ...spread(n, 6, i =>
                candleEvent({ pattern: 'doji_star', y: 2 + (i % 2) })
            ),
            ...spread(3, 3, () => candleEvent({ pattern: 'rare' })),
        ];
        const { families } = candleReport(events, resamplings);
        const qualifying = families.filter(f => f.primary !== null);
        expect(qualifying).toHaveLength(2);
        qualifying.forEach(f =>
            expect(f.primaryPHolm).toBeCloseTo(2 * (f.primary?.p ?? 0), 12)
        );
        expect(
            families.find(f => f.family === 'rare')?.primaryPHolm
        ).toBeNull();
    });

    it('reports the robustness variants without touching the primary', () => {
        const withRobust = (
            over: Partial<ReturnType<typeof candleEvent>['robust']>,
            y: number
        ) => {
            const event = candleEvent({ y, week: '2021-W01' });
            return { ...event, robust: { ...event.robust, ...over } };
        };
        const events = [
            withRobust(
                {
                    contextViolation: { a05: true, a15: false },
                    setupBodyViolation: { f01: false, f05: true },
                    matched: { a05: placebo(0.5), a15: null },
                },
                2
            ),
            withRobust(
                {
                    contextViolation: { a05: true, a15: true },
                    setupBodyViolation: { f01: true, f05: true },
                    matched: { a05: placebo(1), a15: placebo(0) },
                },
                3
            ),
            untested(candleEvent({ status: 'neutral', direction: 0 })),
        ].map((e, i) =>
            i === 2
                ? {
                      ...e,
                      robust: {
                          ...e.robust,
                          contextViolation: { a05: true, a15: false },
                      },
                  }
                : e
        );
        const { robustness } = candleReport(events, resamplings);
        expect(robustness.priorMove.a05).toMatchObject({
            threshold: 0.5,
            contextViolations: 3,
        });
        expect(robustness.priorMove.a05.pooled.n).toBe(2);
        expect(robustness.priorMove.a05.pooled.mean).toBeCloseTo(1.75, 12);
        // The a15 placebo is missing for the first event: only the second counts.
        expect(robustness.priorMove.a15.contextViolations).toBe(1);
        expect(robustness.priorMove.a15.pooled.n).toBe(1);
        expect(robustness.priorMove.a15.pooled.mean).toBeCloseTo(3, 12);
        expect(robustness.bodyFloor.f01).toEqual({
            floor: 0.1,
            setupBodyViolations: 1,
        });
        expect(robustness.bodyFloor.f05).toEqual({
            floor: 0.5,
            setupBodyViolations: 2,
        });
    });
});

describe('pattern pools', () => {
    it('is the target-first indicator minus the placebo share', () => {
        const events = [
            patternEvent({ target60: 'hit', placeboTargetHit: 0.25 }),
            patternEvent({ target60: 'inval', placeboTargetHit: 0.5 }),
            patternEvent({
                target60: 'open',
                cons60: 'inval',
                placeboConsHit: 0.5,
            }),
        ];
        expect(patternObservations(events, 'target').map(o => o.value)).toEqual(
            [0.75, -0.5, -0.25]
        );
        expect(patternObservations(events, 'cons').map(o => o.value)).toEqual([
            0.5, 0.5, -0.5,
        ]);
    });

    it('computes the audit z against the pooled placebo share', () => {
        const events = spread(4, 4, i =>
            patternEvent({
                target60: i < 3 ? 'hit' : 'inval',
                placeboTargetHit: 0.25,
            })
        );
        expect(placeboZ(events, 'target')).toBeCloseTo(
            0.5 / Math.sqrt((0.25 * 0.75) / 4),
            12
        );
        const cons = events.map(e => ({
            ...e,
            cons60: 'hit' as const,
            placeboConsHit: 0.5,
        }));
        expect(placeboZ(cons, 'cons')).toBeCloseTo(
            0.5 / Math.sqrt((0.5 * 0.5) / 4),
            12
        );
    });

    it('has no z for an empty pool or a degenerate placebo share', () => {
        expect(placeboZ([], 'target')).toBeNull();
        expect(placeboZ([patternEvent({ placeboN: 0 })], 'target')).toBeNull();
        expect(
            placeboZ([patternEvent({ placeboTargetHit: 0 })], 'target')
        ).toBeNull();
        expect(
            placeboZ([patternEvent({ placeboTargetHit: 1 })], 'target')
        ).toBeNull();
    });

    it('reports the directed pool with a block interval and the wider of the two', () => {
        const events = spread(40, 20, i =>
            patternEvent({ target60: i % 2 === 0 ? 'hit' : 'inval' })
        );
        const resamplings = makeResamplings(weeks(20));
        const { directed } = patternReport(events, {}, resamplings);
        expect(directed.n).toBe(40);
        expect(directed.targetWider.low).toBe(
            Math.min(
                directed.target.low ?? Infinity,
                directed.targetBlock.low ?? Infinity
            )
        );
        expect(directed.targetWider.high).toBe(
            Math.max(
                directed.target.high ?? -Infinity,
                directed.targetBlock.high ?? -Infinity
            )
        );
        expect(directed.targetBlock.n).toBe(40);
    });

    it('reports families gated by n, with block intervals, splits and Holm', () => {
        const n = EVAL_CONSTANTS.minFamilyN;
        const events = [
            ...spread(n, 8, () => patternEvent({ id: 'bull_flag' })),
            ...spread(3, 3, () =>
                patternEvent({ id: 'bear_flag', market: 'kr', half: 'late' })
            ),
        ];
        const resamplings = makeResamplings(weeks(8));
        const report = patternReport(events, { instances: 9 }, resamplings);
        expect(report.events).toBe(n + 3);
        expect(report.counters).toEqual({ instances: 9 });
        expect(report.directed.byMarket.kr.n).toBe(3);
        expect(report.directed.byHalf.late.n).toBe(3);
        expect(report.directed.eventTargetShare).toBe(1);
        expect(report.directed.placeboTargetShare).toBe(0.25);
        const [bear, bull] = report.families;
        expect([bear.family, bear.n, bear.primary, bear.byMarket]).toEqual([
            'bear_flag',
            3,
            null,
            null,
        ]);
        expect(bull.primary?.n).toBe(n);
        expect(bull.primaryBlock?.n).toBe(n);
        expect(bull.byMarket?.us.n).toBe(n);
        expect(bull.byHalf?.early.n).toBe(n);
        expect(bull.primaryPHolm).toBeCloseTo(bull.primary?.p ?? 0, 12);
    });
});

describe('labelReport', () => {
    it('counts outcomes and skips, and the share of races won', () => {
        const label = (
            outcome: string,
            skipReason: string | null,
            rw: number | null
        ) =>
            patternEvent({
                label20: {
                    outcome: outcome as 'target_first',
                    skipReason,
                    rwNullTargetFirst: rw,
                },
            });
        const report = labelReport([
            label('target_first', null, 0.4),
            label('invalidation_first', null, 0.6),
            label('open_at_horizon', null, null),
            label('skipped', 'geometry_invalid', null),
            label('no_breakout', null, null),
        ]);
        expect(report.events).toBe(5);
        expect(report.byOutcome).toEqual({
            target_first: 1,
            invalidation_first: 1,
            open_at_horizon: 1,
            skipped: 1,
            no_breakout: 1,
        });
        expect(report.skipReasons).toEqual({ geometry_invalid: 1 });
        expect(report.raced).toBe(3);
        expect(report.targetFirstShare).toBeCloseTo(1 / 3, 12);
        expect(report.meanRwNullTargetFirst).toBeCloseTo(0.5, 12);
    });

    it('has no share or mean without races or null-hypothesis values', () => {
        const report = labelReport([]);
        expect(report.targetFirstShare).toBeNull();
        expect(report.meanRwNullTargetFirst).toBeNull();
    });
});

describe('g1Report', () => {
    const zeroCandle = {
        context: 0,
        setupBody: 0,
        dojiSetup: 0,
        tweezersClose: 0,
    };

    it('scores nothing without a gate but still lists every counter', () => {
        const report = g1Report(null, null, null);
        expect(report.pass).toBeNull();
        expect(report.scored).toEqual({});
        expect(report.candle).toEqual(zeroCandle);
        expect(report.patterns.wrongSideDays).toBe(0);
    });

    it('c9 scores the four candle counters and needs the candle half', () => {
        const nonzero = { ...zeroCandle, setupBody: 2 };
        expect(g1Report(nonzero, {}, 'c9')).toMatchObject({
            scored: nonzero,
            pass: false,
        });
        expect(g1Report(zeroCandle, { wrongSideDays: 9 }, 'c9').pass).toBe(
            true
        );
        const missing = g1Report(null, {}, 'c9');
        expect(missing.scoredHalfMeasured).toBe(false);
        expect(missing.pass).toBe(false);
    });

    it('pivots scores the proof and repaint counters only, and needs the pattern half', () => {
        expect(
            g1Report(null, { selfConfirmedNotCloseProvenPivots: 1 }, 'pivots')
        ).toMatchObject({
            scored: { selfConfirmedNotCloseProvenPivots: 1, pivotRepaints: 0 },
            pass: false,
        });
        expect(g1Report(null, { pivotRepaints: 2 }, 'pivots').pass).toBe(false);
        expect(g1Report(null, { wrongSideDays: 9 }, 'pivots').pass).toBe(true);
        expect(g1Report(zeroCandle, null, 'pivots')).toMatchObject({
            scoredHalfMeasured: false,
            pass: false,
        });
    });

    it('geometry scores wrong side, non-positive, moving, status and repaints, not the proof counter', () => {
        const key = (name: string): boolean | null =>
            g1Report(null, { [name]: 1 }, 'geometry').pass;
        [
            'wrongSideDays',
            'nonPositiveDays',
            'movingPostBreakDays',
            'unexplainedStatusFlips',
            'failedBreakoutDisagreeDays',
            'pivotRepaints',
        ].forEach(name => expect(key(name)).toBe(false));
        expect(key('selfConfirmedNotCloseProvenPivots')).toBe(true);
        expect(g1Report(null, {}, 'geometry').pass).toBe(true);
    });
});

describe('caseLinesReport', () => {
    it('is empty for no cases', () => {
        expect(caseLinesReport([])).toEqual({
            cases: 0,
            skipped: 0,
            meanLines: null,
            byLineCount: {},
            shareBothDirections: null,
        });
    });

    it('counts lines and the analyses carrying both directions', () => {
        const report = caseLinesReport([
            { lines: 2, bullish: true, bearish: true },
            { lines: 1, bullish: true, bearish: false },
            { lines: 0, bullish: false, bearish: false },
            { lines: 2, bullish: false, bearish: true },
        ]);
        expect(report.cases).toBe(4);
        expect(report.skipped).toBe(0);
        expect(caseLinesReport([], 3).skipped).toBe(3);
        expect(report.meanLines).toBe(1.25);
        expect(report.byLineCount).toEqual({ '0': 1, '1': 1, '2': 2 });
        expect(report.shareBothDirections).toBe(0.25);
    });
});

describe('summarizeArm and the event guards', () => {
    it('leaves the parts that were not measured null and the week list as given', () => {
        const summary = summarizeArm({
            arm: 'x',
            weeks: weeks(3),
            gate: 'c9',
            candleEvents: null,
            patternEvents: null,
            patternCounters: null,
            caseLines: null,
        });
        expect(summary).toMatchObject({
            arm: 'x',
            weeks: weeks(3),
            candles: null,
            patterns: null,
            caseLines: null,
        });
        expect(summary.g1.pass).toBe(false);
    });

    it('summarises both halves and scores the gate of the arm', () => {
        const summary = summarizeArm({
            arm: 'y',
            weeks: weeks(4),
            gate: 'c9',
            candleEvents: spread(4, 4, () =>
                candleEvent({ violations: ['context'] })
            ),
            patternEvents: spread(4, 4, () => patternEvent()),
            patternCounters: { wrongSideDays: 3 },
            caseLines: [{ lines: 1, bullish: true, bearish: false }],
        });
        expect(summary.candles?.tested).toBe(4);
        expect(summary.patterns?.events).toBe(4);
        expect(summary.caseLines?.cases).toBe(1);
        expect(summary.g1.candle.context).toBe(4);
        expect(summary.g1.patterns.wrongSideDays).toBe(3);
        expect(summary.g1.pass).toBe(false);
    });

    it('resamples the same weeks whichever half was run', () => {
        const events = spread(8, 8, () => candleEvent({ y: 2 }));
        const both = summarizeArm({
            arm: 'a',
            weeks: weeks(8),
            gate: null,
            candleEvents: events,
            patternEvents: spread(8, 8, () => patternEvent()),
            patternCounters: {},
            caseLines: null,
        });
        const only = summarizeArm({
            arm: 'a',
            weeks: weeks(8),
            gate: null,
            candleEvents: events,
            patternEvents: null,
            patternCounters: null,
            caseLines: null,
        });
        expect(only.candles?.pools.pooled.primary).toEqual(
            both.candles?.pools.pooled.primary
        );
    });

    it('tells the two event kinds apart', () => {
        expect(isCandleEvent(candleEvent())).toBe(true);
        expect(isCandleEvent(patternEvent())).toBe(false);
        expect(isPatternEvent(patternEvent())).toBe(true);
        expect(isPatternEvent(candleEvent())).toBe(false);
        expect(flat(1).h5).toBe(1);
        expect(placebo(1).n).toBe(20);
    });
});
