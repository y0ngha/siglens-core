import { describe, expect, it } from 'vitest';
import { buildOutcomeWindow } from '@/domain/outcomes/buildOutcomeWindow';
import {
    OUTCOME_HORIZON_BARS,
    OUTCOME_LABEL_VERSION,
    OUTCOME_WINDOW_BARS,
} from '@/domain/outcomes/constants';
import { labelAnalysisOutcome } from '@/domain/outcomes/labelAnalysisOutcome';
import type {
    AnalysisOutcomeLabels,
    OutcomeSubject,
    OutcomeWindow,
} from '@/domain/outcomes/types';
import type { Bar } from '@/domain/types';
import { makeWindow, walkBars, type Ohlc } from '../../helpers/outcomeWindows';

/**
 * Reference price 100, ATR 2. The forward bars walk the whole subject:
 *  1. touches the zone (fill 99),
 *  2. touches the support at 95 and holds it,
 *  5. reaches the first target (105),
 *  6. reaches the pattern target (110) and closes through the resistance at 105.
 */
const FORWARD: readonly Ohlc[] = [
    [100, 100, 98, 99],
    [99, 99.5, 95.1, 96.6],
    [97, 97.5, 96.5, 97],
    [97, 97.5, 96.5, 97],
    [97, 106, 97, 105],
    [105, 111, 104, 110],
];

const PLAN = {
    recommendation: 'enter',
    entryLow: 97,
    entryHigh: 99,
    stop: 95,
    targets: [105, 110],
    reconciled: false,
} satisfies NonNullable<OutcomeSubject['plan']>;

const SUBJECT: OutcomeSubject = {
    v: 1,
    anchor: { barTime: 1_700_000_000, close: 100 },
    trend: 'bullish',
    riskLevel: 'medium',
    plan: PLAN,
    levels: [
        { role: 'support', price: 95, refLabels: ['Fib 38.2%'] },
        { role: 'resistance', price: 105, refLabels: [] },
        { role: 'poc', price: 95, refLabels: [] },
    ],
    scenarioTargets: [
        { side: 'bullish', price: 105 },
        { side: 'bearish', price: 90 },
    ],
    patterns: [
        {
            name: 'double_bottom',
            candidateId: 'c1',
            breakout: 100,
            extreme: 90,
            direction: 'up',
            invalidation: 95,
        },
    ],
};

/** The labels with every price removed: what a rescaled or adjusted copy must keep. */
function categories(labels: AnalysisOutcomeLabels) {
    const { plan } = labels;
    return {
        plan: [
            plan.outcome,
            plan.reason,
            plan.approach,
            plan.entryOffset,
            plan.exitOffset,
            plan.holdBars,
            plan.gap,
        ],
        levels: labels.levels.map(level => [
            level.role,
            level.outcome,
            level.skipReason,
            level.touchOffset,
            level.resolveOffset,
            level.gap,
            level.placebo.map(p => [
                p.shiftAtr,
                p.outcome,
                p.skipReason,
                p.touchOffset,
            ]),
        ]),
        scenarioTargets: labels.scenarioTargets.map(target => [
            target.side,
            target.touched,
            target.touchOffset,
        ]),
        patterns: labels.patterns.map(pattern => [
            pattern.outcome,
            pattern.skipReason,
            pattern.alreadyBroken,
            pattern.breakoutOffset,
            pattern.resolveOffset,
            pattern.gap,
        ]),
    };
}

const base = labelAnalysisOutcome(SUBJECT, makeWindow({ forward: FORWARD }));

describe('labelAnalysisOutcome', () => {
    it('stamps the label version, window size and the window facts', () => {
        expect(base).toMatchObject({
            v: OUTCOME_LABEL_VERSION,
            windowBars: OUTCOME_WINDOW_BARS,
            referencePrice: 100,
            adjFactor: 1,
            anchorForming: false,
            atr: 2,
        });
        expect(base.forward.map(label => label.h)).toEqual([
            ...OUTCOME_HORIZON_BARS,
        ]);
    });

    it('labels the plan against the bars', () => {
        expect(base.plan).toMatchObject({
            outcome: 'target_first',
            approach: 'from_above',
            entryOffset: 1,
            exitOffset: 5,
            fill: 99,
            exit: 105,
        });
    });

    it('labels every level in subject order, in the subject price basis', () => {
        expect(
            base.levels.map(level => [
                level.role,
                level.price,
                level.outcome,
                level.resolveOffset,
            ])
        ).toEqual([
            ['support', 95, 'respected', 2],
            ['resistance', 105, 'broken', 6],
            ['poc', 95, 'respected', 2],
        ]);
    });

    it('labels the scenario targets', () => {
        expect(base.scenarioTargets).toEqual([
            {
                side: 'bullish',
                price: 105,
                distanceAtr: 2.5,
                touched: true,
                touchOffset: 5,
            },
            {
                side: 'bearish',
                price: 90,
                distanceAtr: 5,
                touched: false,
                touchOffset: null,
            },
        ]);
    });

    it('labels the detected patterns', () => {
        expect(base.patterns).toHaveLength(1);
        expect(base.patterns[0]).toMatchObject({
            name: 'double_bottom',
            outcome: 'target_first',
            breakoutOffset: 5,
            resolveOffset: 6,
            measuredTarget: 110,
        });
    });

    it('labels a subject with nothing in it as no plan and empty lists', () => {
        const empty = labelAnalysisOutcome(
            {
                ...SUBJECT,
                plan: null,
                levels: [],
                scenarioTargets: [],
                patterns: [],
            },
            makeWindow()
        );
        expect(empty.plan).toMatchObject({
            outcome: 'no_plan',
            reason: 'none',
        });
        expect(empty.levels).toEqual([]);
        expect(empty.scenarioTargets).toEqual([]);
        expect(empty.patterns).toEqual([]);
    });

    it('labels a plan whose stop core rejected as no_plan, never with a guessed stop', () => {
        const rejected = labelAnalysisOutcome(
            { ...SUBJECT, plan: { ...PLAN, stop: null, reconciled: true } },
            makeWindow({ forward: FORWARD })
        );
        expect(rejected.plan).toMatchObject({
            outcome: 'no_plan',
            reason: 'no_stop',
            fill: null,
        });
    });

    it('carries the anchor source and the verdict through', () => {
        const fromTime = labelAnalysisOutcome(
            SUBJECT,
            makeWindow({ forward: FORWARD, anchorSource: 'generated_at' })
        );
        expect(fromTime.anchorSource).toBe('generated_at');
        expect(base.anchorSource).toBe('prompt_bar');
        expect(base.plan.recommendation).toBe('enter');
    });

    it('carries a forming anchor flag through', () => {
        expect(
            labelAnalysisOutcome(
                SUBJECT,
                makeWindow({ forward: FORWARD, anchorForming: true })
            ).anchorForming
        ).toBe(true);
    });

    it('does not modify its inputs', () => {
        const subject = structuredClone(SUBJECT);
        const window = makeWindow({ forward: FORWARD });
        const windowBefore = structuredClone(window);
        labelAnalysisOutcome(subject, window);
        expect(subject).toEqual(SUBJECT);
        expect(window).toEqual(windowBefore);
    });
});

describe('labelAnalysisOutcome — poc', () => {
    const labelPoc = (price: number) =>
        labelAnalysisOutcome(
            { ...SUBJECT, levels: [{ role: 'poc', price, refLabels: [] }] },
            makeWindow({ forward: FORWARD })
        ).levels[0];

    it('is a support below the reference price', () => {
        const { role: _r, price: _p, ...poc } = labelPoc(95);
        const { role: _r2, price: _p2, ...support } = base.levels[0];
        expect(poc).toEqual(support);
    });

    it('is a resistance above the reference price', () => {
        const { role: _r, price: _p, ...poc } = labelPoc(105);
        const { role: _r2, price: _p2, ...resistance } = base.levels[1];
        expect(poc).toEqual(resistance);
    });

    it('is skipped as at_price at the reference price', () => {
        expect(labelPoc(100)).toMatchObject({
            outcome: 'skipped',
            skipReason: 'at_price',
        });
    });
});

describe('labelAnalysisOutcome — adjustment', () => {
    /** The subject as the analysis saw it before a corporate action: every price × `1 / factor`. */
    function inAnalysisBasis(factor: number): OutcomeSubject {
        const up = (price: number) => price / factor;
        return {
            ...SUBJECT,
            plan: {
                ...PLAN,
                entryLow: up(PLAN.entryLow),
                entryHigh: up(PLAN.entryHigh),
                stop: up(PLAN.stop),
                targets: PLAN.targets.map(up),
            },
            levels: SUBJECT.levels.map(level => ({
                ...level,
                price: up(level.price),
            })),
            scenarioTargets: SUBJECT.scenarioTargets.map(target => ({
                ...target,
                price: up(target.price),
            })),
            patterns: SUBJECT.patterns.map(pattern => ({
                ...pattern,
                breakout: up(pattern.breakout),
                extreme: up(pattern.extreme),
                invalidation:
                    pattern.invalidation === null
                        ? null
                        : up(pattern.invalidation),
            })),
        };
    }

    it.each([
        ['a 4:1 split', 0.25],
        ['a dividend adjustment', 0.994],
        ['a reverse split', 8],
    ])(
        'gives the same labels after %s as on the unadjusted series',
        (_name, adjFactor) => {
            const adjusted = labelAnalysisOutcome(
                inAnalysisBasis(adjFactor),
                makeWindow({ forward: FORWARD, adjFactor })
            );
            expect(categories(adjusted)).toEqual(categories(base));
            expect(adjusted.adjFactor).toBe(adjFactor);
            expect(adjusted.plan.fill).toBeCloseTo(
                base.plan.fill ?? Number.NaN,
                9
            );
            // The stored target was rounded at the precision of the stored geometry, so a factor
            // that is not a power of two leaves float-level noise.
            expect(adjusted.patterns[0].measuredTarget).toBeCloseTo(110, 6);
        }
    );

    it('reports level and scenario prices in the subject basis', () => {
        const adjusted = labelAnalysisOutcome(
            inAnalysisBasis(0.25),
            makeWindow({ forward: FORWARD, adjFactor: 0.25 })
        );
        expect(adjusted.levels.map(level => level.price)).toEqual([
            380, 420, 380,
        ]);
        expect(adjusted.scenarioTargets.map(target => target.price)).toEqual([
            420, 360,
        ]);
    });

    it('would read the unadjusted subject wrongly without the factor (the factor is what keeps the labels)', () => {
        const unadjustedRead = labelAnalysisOutcome(
            inAnalysisBasis(0.25),
            makeWindow({ forward: FORWARD, adjFactor: 1 })
        );
        expect(categories(unadjustedRead)).not.toEqual(categories(base));
    });
});

describe('labelAnalysisOutcome — relabelling from storage', () => {
    it('gives deep-equal labels from the stored JSON of the window', () => {
        const window = makeWindow({ forward: FORWARD });
        const stored: OutcomeWindow = JSON.parse(JSON.stringify(window));
        expect(labelAnalysisOutcome(SUBJECT, stored)).toStrictEqual(
            labelAnalysisOutcome(SUBJECT, window)
        );
    });

    it('gives labels that survive a JSON round trip', () => {
        expect(JSON.parse(JSON.stringify(base))).toStrictEqual(base);
    });

    it('is deterministic', () => {
        expect(
            labelAnalysisOutcome(SUBJECT, makeWindow({ forward: FORWARD }))
        ).toStrictEqual(base);
    });
});

describe('labelAnalysisOutcome — a window shorter than the horizon', () => {
    it('scans only the bars it has and says how many', () => {
        const full = makeWindow({ forward: FORWARD });
        const short = { ...full, forward: full.forward.slice(0, 3) };
        const labels = labelAnalysisOutcome(SUBJECT, short);
        expect(labels.windowBars).toBe(3);
        expect(labels.forward[0].returnPct).toBeCloseTo(-1, 9);
        expect(labels.forward.slice(1).map(label => label.returnPct)).toEqual([
            null,
            null,
            null,
        ]);
    });
});

// ---------------------------------------------------------------------------
// Properties, on pseudo-random walks (seeded: the same walks every run).
// ---------------------------------------------------------------------------

const ANCHOR_INDEX = 70;
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];

/** A subject placed around the anchor close `c`: zone just under it, levels and a pattern around it. */
function subjectAround(c: number): OutcomeSubject {
    return {
        ...SUBJECT,
        plan: {
            recommendation: 'enter',
            entryLow: c * 0.97,
            entryHigh: c * 0.99,
            stop: c * 0.93,
            targets: [c * 1.04, c * 1.08],
            reconciled: false,
        },
        levels: [
            { role: 'support', price: c * 0.96, refLabels: [] },
            { role: 'support', price: c * 0.9, refLabels: [] },
            { role: 'resistance', price: c * 1.03, refLabels: [] },
            { role: 'resistance', price: c * 1.1, refLabels: [] },
            { role: 'poc', price: c * 0.98, refLabels: [] },
        ],
        scenarioTargets: [
            { side: 'bullish', price: c * 1.05 },
            { side: 'bearish', price: c * 0.94 },
        ],
        patterns: [
            {
                name: 'a',
                candidateId: null,
                breakout: c * 1.01,
                extreme: c * 0.93,
                direction: 'up',
                invalidation: c * 0.96,
            },
            {
                name: 'b',
                candidateId: null,
                breakout: c * 0.99,
                extreme: c * 1.06,
                direction: 'down',
                invalidation: c * 1.03,
            },
        ],
    };
}

function windowOf(bars: readonly Bar[]): OutcomeWindow {
    const result = buildOutcomeWindow(bars, {
        barTime: bars[ANCHOR_INDEX].time,
        closeAtAnalysis: bars[ANCHOR_INDEX].close,
        closedAtAnalysis: true,
    });
    if (result.status !== 'ok') throw new Error(result.status);
    return result.window;
}

describe.each(SEEDS)('labelAnalysisOutcome — properties on walk %i', seed => {
    const bars = walkBars(110, seed);
    const subject = subjectAround(bars[ANCHOR_INDEX].close);
    const labels = labelAnalysisOutcome(subject, windowOf(bars));

    it('ignores bars beyond the horizon', () => {
        const tail = bars.slice(ANCHOR_INDEX + OUTCOME_WINDOW_BARS + 1);
        const shuffled: Bar[] = [
            ...bars.slice(0, ANCHOR_INDEX + OUTCOME_WINDOW_BARS + 1),
            ...tail.map((bar, i) => ({
                ...bar,
                open: tail[tail.length - 1 - i].open * 2,
                high: tail[tail.length - 1 - i].high * 2,
                low: tail[tail.length - 1 - i].low / 2,
                close: tail[tail.length - 1 - i].close * 0.5,
            })),
        ];
        expect(windowOf(shuffled)).toStrictEqual(windowOf(bars));
        expect(labelAnalysisOutcome(subject, windowOf(shuffled))).toStrictEqual(
            labels
        );
    });

    it('ignores bars up to the horizon being the last ones present', () => {
        const exact = bars.slice(0, ANCHOR_INDEX + OUTCOME_WINDOW_BARS + 1);
        expect(labelAnalysisOutcome(subject, windowOf(exact))).toStrictEqual(
            labels
        );
    });

    it.each([3, 0.01, 250])(
        'keeps every categorical label when all prices are scaled by %f',
        k => {
            const scaledBars = bars.map(bar => ({
                ...bar,
                open: bar.open * k,
                high: bar.high * k,
                low: bar.low * k,
                close: bar.close * k,
            }));
            const scaledSubject = subjectAround(bars[ANCHOR_INDEX].close * k);
            const scaled = labelAnalysisOutcome(
                scaledSubject,
                windowOf(scaledBars)
            );
            expect(categories(scaled)).toEqual(categories(labels));
            scaled.forward.forEach((label, i) => {
                expect(label.returnPct).toBeCloseTo(
                    labels.forward[i].returnPct ?? Number.NaN,
                    8
                );
            });
        }
    );
});

describe('labelAnalysisOutcome — the walks are not vacuous', () => {
    it('produce a spread of plan, level and pattern outcomes', () => {
        const all = SEEDS.map(seed => {
            const bars = walkBars(110, seed);
            return labelAnalysisOutcome(
                subjectAround(bars[ANCHOR_INDEX].close),
                windowOf(bars)
            );
        });
        const outcomes = (pick: (labels: AnalysisOutcomeLabels) => string[]) =>
            new Set(all.flatMap(pick));
        expect(outcomes(labels => [labels.plan.outcome]).size).toBeGreaterThan(
            1
        );
        expect(
            outcomes(labels => labels.levels.map(level => level.outcome)).size
        ).toBeGreaterThan(2);
        expect(
            outcomes(labels => labels.patterns.map(pattern => pattern.outcome))
                .size
        ).toBeGreaterThan(1);
    });
});
