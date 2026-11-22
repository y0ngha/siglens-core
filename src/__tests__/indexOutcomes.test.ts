import { describe, expect, it } from 'vitest';
import * as clientApi from '@/index.client';
import {
    buildOutcomeWindow,
    computeForwardReturns,
    extractOutcomeSubject,
    labelAnalysisOutcome,
    labelLevelOutcome,
    OUTCOME_LABEL_VERSION,
    OUTCOME_SUBJECT_VERSION,
    outcomeEarliestLabelTime,
    summarizeOutcomeRecord,
} from '@/index';
import type {
    AnalysisOutcomeLabels,
    ForwardReturnLabel,
    LevelOutcomeEntry,
    LevelOutcomeLabel,
    OutcomeAnchor,
    OutcomeRecordRow,
    OutcomeRecordSummary,
    OutcomeShareRecord,
    OutcomeSubject,
    OutcomeWindow,
    OutcomeWindowResult,
    PatternOutcomeLabel,
    PlanOutcomeLabel,
    ScenarioTargetLabel,
} from '@/index';
import { risingBars } from './helpers/outcomeWindows';

/**
 * The outcome labeller runs in a server job, so its functions and version constants are
 * on the server entrypoint only; the types a consumer stores and passes back are on both
 * (`PUBLIC_API.md#API-1`, `#API-3`).
 */
describe('outcome labeller public surface', () => {
    it('exports the labeller functions and version constants from the server entrypoint', () => {
        expect(typeof extractOutcomeSubject).toBe('function');
        expect(typeof buildOutcomeWindow).toBe('function');
        expect(typeof labelAnalysisOutcome).toBe('function');
        expect(typeof labelLevelOutcome).toBe('function');
        expect(typeof computeForwardReturns).toBe('function');
        expect(typeof outcomeEarliestLabelTime).toBe('function');
        expect(typeof summarizeOutcomeRecord).toBe('function');
        expect(OUTCOME_LABEL_VERSION).toBe(1);
        expect(OUTCOME_SUBJECT_VERSION).toBe(1);
    });

    it('keeps the functions and constants off the browser entrypoint', () => {
        [
            'extractOutcomeSubject',
            'buildOutcomeWindow',
            'labelAnalysisOutcome',
            'labelLevelOutcome',
            'computeForwardReturns',
            'outcomeEarliestLabelTime',
            'summarizeOutcomeRecord',
            'OUTCOME_LABEL_VERSION',
            'OUTCOME_SUBJECT_VERSION',
        ].forEach(name => expect(name in clientApi).toBe(false));
    });

    it('keeps the label constants internal', () => {
        expect('OUTCOME_WINDOW_BARS' in clientApi).toBe(false);
        expect('LEVEL_BARRIER_ATR' in clientApi).toBe(false);
    });

    it('runs the whole path through the public entrypoint, with every type nameable', () => {
        const bars = risingBars(100);
        const anchor: OutcomeAnchor = {
            barTime: bars[70].time,
            closeAtAnalysis: bars[70].close,
            closedAtAnalysis: true,
        };
        const built: OutcomeWindowResult = buildOutcomeWindow(bars, anchor);
        const subject: OutcomeSubject | null = extractOutcomeSubject(
            {
                trend: 'bullish',
                riskLevel: 'low',
                keyLevels: { support: [{ price: 90 }] },
            },
            null
        );
        if (built.status !== 'ok') throw new Error(built.status);
        if (subject === null) throw new Error('subject is null');
        const window: OutcomeWindow = built.window;
        const labels: AnalysisOutcomeLabels = labelAnalysisOutcome(
            subject,
            window
        );
        const forward: ForwardReturnLabel[] = computeForwardReturns(window);
        const level: LevelOutcomeLabel = labelLevelOutcome(
            { side: 'support', price: 90 },
            window
        );
        const entry: LevelOutcomeEntry = labels.levels[0];
        const plan: PlanOutcomeLabel = labels.plan;
        const targets: ScenarioTargetLabel[] = labels.scenarioTargets;
        const patterns: PatternOutcomeLabel[] = labels.patterns;
        expect(labels.v).toBe(OUTCOME_LABEL_VERSION);
        expect(forward).toEqual(labels.forward);
        expect(entry.outcome).toBe(level.outcome);
        expect(plan.outcome).toBe('no_plan');
        expect([targets, patterns]).toEqual([[], []]);
    });

    it('aggregates stored rows through the public entrypoint, with the record types nameable', () => {
        const rows: OutcomeRecordRow[] = [];
        const summary: OutcomeRecordSummary = summarizeOutcomeRecord(rows, {
            seed: 1,
        });
        const plans: OutcomeShareRecord = summary.plans;
        expect(plans.verdict).toBe('insufficient_sample');
        expect(summary.labelVersion).toBe(OUTCOME_LABEL_VERSION);
    });
});
