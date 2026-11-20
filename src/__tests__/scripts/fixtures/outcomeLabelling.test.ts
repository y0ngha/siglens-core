import { describe, expect, it } from 'vitest';
import { buildOutcomeWindow } from '@/domain/outcomes/buildOutcomeWindow';
import { extractOutcomeSubject } from '@/domain/outcomes/extractOutcomeSubject';
import { labelAnalysisOutcome } from '@/domain/outcomes/labelAnalysisOutcome';
import type { Bar } from '@/domain/types';
import {
    evaluateAnalysisExchange,
    type AnalysisExchangeFixture,
} from '../../../../scripts/fixtures/evaluateAnalysisExchange';
import { SECONDS_PER_DAY } from '../../helpers/outcomeWindows';
import { ANALYSIS_EXCHANGE_FIXTURES } from './loadAnalysisExchanges';

/**
 * The outcome labeller on the real stored analyses (see
 * `fixtures/analysisExchanges/README.md`). The files carry the prompt the model was sent and
 * the text it answered, not the bars that followed: subjects are real, the bars that label
 * them are constructed. Lives under `scripts/` because it imports the fixture evaluator,
 * which the main tsconfig does not include.
 */

const ANCHOR_BAR_TIME = 101 * SECONDS_PER_DAY;

const FIXTURES = ANALYSIS_EXCHANGE_FIXTURES.map(
    fixture => [fixture.id, fixture] as const
);

/** The stored shape: `runAnalysis` adds `dataAsOf`, the jsonb round trip drops `undefined`. */
function storedRow(
    fixture: AnalysisExchangeFixture,
    patch: (row: Record<string, unknown>) => Record<string, unknown> = row =>
        row
): unknown {
    const evaluation = evaluateAnalysisExchange(fixture);
    return JSON.parse(
        JSON.stringify(
            patch({
                ...evaluation.result,
                dataAsOf: {
                    barTime: ANCHOR_BAR_TIME,
                    close: fixture.lastClose,
                },
            })
        )
    );
}

/** The same stored row with the stop refused by core: no stop, the model's value must not come back. */
function withRejectedStop(
    row: Record<string, unknown>
): Record<string, unknown> {
    const rec = row.actionRecommendation as Record<string, unknown>;
    const reconciled = (rec.reconciledLevels ?? {}) as Record<string, unknown>;
    return {
        ...row,
        actionRecommendation: {
            ...rec,
            reconciledLevels: {
                ...reconciled,
                stopLoss: undefined,
                stopLossRejected: true,
            },
        },
    };
}

/**
 * 100 bars of a constant range of `atr` around the close (so ATR = atr), then 20 bars rising
 * in a straight line to `top`.
 */
function constructedBars(lastClose: number, atr: number, top: number): Bar[] {
    const history: Bar[] = Array.from({ length: 101 }, (_, i) => ({
        time: (i + 1) * SECONDS_PER_DAY,
        open: lastClose,
        high: lastClose + atr / 2,
        low: lastClose - atr / 2,
        close: lastClose,
        volume: 1,
    }));
    const future: Bar[] = Array.from({ length: 20 }, (_, i) => {
        const close = lastClose + ((top - lastClose) * (i + 1)) / 20;
        const open = lastClose + ((top - lastClose) * i) / 20;
        return {
            time: (102 + i) * SECONDS_PER_DAY,
            open,
            high: Math.max(open, close) + atr / 4,
            low: Math.min(open, close) - atr / 4,
            close,
            volume: 1,
        };
    });
    return [...history, ...future];
}

/** Subject, window and labels of one stored row; throws when the row cannot be labelled. */
function labelStored(fixture: AnalysisExchangeFixture, row: unknown) {
    const subject = extractOutcomeSubject(row, fixture.dynamic);
    if (subject === null) throw new Error(`${fixture.id}: not extractable`);
    const atr = fixture.atr ?? fixture.lastClose * 0.01;
    const top = Math.max(fixture.lastClose, ...(subject.plan?.targets ?? []));
    const built = buildOutcomeWindow(
        constructedBars(fixture.lastClose, atr, top),
        {
            barTime: ANCHOR_BAR_TIME,
            closeAtAnalysis: fixture.lastClose,
            closedAtAnalysis: true,
        }
    );
    if (built.status !== 'ok') {
        throw new Error(`${fixture.id}: window ${built.status}`);
    }
    return {
        subject,
        atr,
        top,
        window: built.window,
        labels: labelAnalysisOutcome(subject, built.window),
    };
}

describe('extractOutcomeSubject — real stored analyses', () => {
    describe.each(FIXTURES)('%s', (_id, fixture) => {
        const evaluation = evaluateAnalysisExchange(fixture);
        const subject = extractOutcomeSubject(
            storedRow(fixture),
            fixture.dynamic
        );

        it('is extractable', () => {
            expect(subject).not.toBeNull();
        });

        it('survives a JSON round trip unchanged', () => {
            expect(JSON.parse(JSON.stringify(subject))).toEqual(subject);
        });

        it('keeps the anchor it was given', () => {
            expect(subject?.anchor).toEqual({
                barTime: ANCHOR_BAR_TIME,
                close: fixture.lastClose,
            });
        });

        it('reads a plan with a zone whose targets all sit above it, ascending and unique', () => {
            const read = subject?.plan;
            expect(read?.entryLow).toEqual(expect.any(Number));
            expect(read?.entryLow).toBeLessThanOrEqual(
                read?.entryHigh ?? Number.NEGATIVE_INFINITY
            );
            expect(
                (read?.targets ?? []).filter(
                    price => price <= (read?.entryHigh ?? Infinity)
                )
            ).toEqual([]);
            expect(read?.targets).toEqual(
                [...new Set(read?.targets)].toSorted((a, b) => a - b)
            );
        });

        it('reads the stop the plan check measured against', () => {
            const rec = evaluation.result.actionRecommendation;
            const rejected = rec?.reconciledLevels?.stopLossRejected === true;
            expect(subject?.plan?.stop).toBe(
                rejected
                    ? null
                    : (rec?.reconciledLevels?.stopLoss ?? rec?.stopLoss ?? null)
            );
        });

        it('marks reconciliation exactly when core wrote reconciledLevels', () => {
            expect(subject?.plan?.reconciled).toBe(
                evaluation.result.actionRecommendation?.reconciledLevels !==
                    undefined
            );
        });

        it('reads key levels and tags some from the prompt', () => {
            expect(subject?.levels.length).toBeGreaterThan(0);
            expect(
                subject?.levels.some(level => level.refLabels.length > 0)
            ).toBe(true);
        });
    });

    it('reads a stored row without dataAsOf as having no anchor', () => {
        const fixture = ANALYSIS_EXCHANGE_FIXTURES[0];
        const row: unknown = JSON.parse(
            JSON.stringify(evaluateAnalysisExchange(fixture).result)
        );
        expect(extractOutcomeSubject(row, fixture.dynamic)?.anchor).toBeNull();
    });

    it('reads some rows as reconciled and some plans as having targets', () => {
        const plans = ANALYSIS_EXCHANGE_FIXTURES.map(
            fixture =>
                extractOutcomeSubject(storedRow(fixture), fixture.dynamic)?.plan
        );
        expect(plans.map(plan => plan?.reconciled)).toContain(true);
        expect(
            plans.filter(plan => (plan?.targets.length ?? 0) > 0)
        ).not.toEqual([]);
    });
});

describe('labelAnalysisOutcome — subjects of the real stored analyses', () => {
    describe.each(FIXTURES)('%s', (_id, fixture) => {
        const { subject, atr, window, labels } = labelStored(
            fixture,
            storedRow(fixture)
        );

        it('measures an ATR equal to the stored one', () => {
            expect(labels.atr).toBeCloseTo(atr, 6);
        });

        it('labels every level, scenario target and pattern of the subject, in order', () => {
            expect(
                labels.levels.map(level => [level.role, level.price])
            ).toEqual(subject.levels.map(level => [level.role, level.price]));
            expect(labels.scenarioTargets.map(target => target.price)).toEqual(
                subject.scenarioTargets.map(target => target.price)
            );
            expect(labels.patterns.map(pattern => pattern.name)).toEqual(
                subject.patterns.map(pattern => pattern.name)
            );
        });

        it('carries the verdict of the stored plan on the plan label', () => {
            expect(labels.plan.recommendation).toBe(
                subject.plan?.recommendation
            );
        });

        it('relabels identically from the stored window', () => {
            expect(
                labelAnalysisOutcome(
                    subject,
                    JSON.parse(JSON.stringify(window))
                )
            ).toStrictEqual(labels);
        });
    });

    it('touches every bullish scenario target that lies between the close and the highest plan target', () => {
        const reachable = ANALYSIS_EXCHANGE_FIXTURES.flatMap(fixture => {
            const { labels, atr, top } = labelStored(
                fixture,
                storedRow(fixture)
            );
            return labels.scenarioTargets.filter(
                target =>
                    target.side === 'bullish' &&
                    target.price > fixture.lastClose + atr / 4 &&
                    target.price <= top
            );
        });
        expect(reachable).not.toEqual([]);
        expect(reachable.filter(target => !target.touched)).toEqual([]);
    });

    it('never evaluates a plan whose stop core refused, and never reads the model stop instead', () => {
        const refused = ANALYSIS_EXCHANGE_FIXTURES.map(fixture =>
            labelStored(fixture, storedRow(fixture, withRejectedStop))
        );
        expect(refused).toHaveLength(ANALYSIS_EXCHANGE_FIXTURES.length);
        expect(
            refused.filter(({ subject }) => subject.plan?.stop !== null)
        ).toEqual([]);
        expect(
            refused.filter(
                ({ labels }) =>
                    labels.plan.outcome !== 'no_plan' ||
                    labels.plan.fill !== null
            )
        ).toEqual([]);
        expect(refused.map(({ labels }) => labels.plan.reason)).toContain(
            'no_stop'
        );
    });
});
