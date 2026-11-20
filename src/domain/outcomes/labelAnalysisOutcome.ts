import { OUTCOME_LABEL_VERSION } from '@/domain/outcomes/constants';
import { computeForwardReturns } from '@/domain/outcomes/computeForwardReturns';
import { labelLevelOutcome } from '@/domain/outcomes/labelLevelOutcome';
import { labelPatternOutcome } from '@/domain/outcomes/labelPatternOutcome';
import { labelPlanOutcome } from '@/domain/outcomes/labelPlanOutcome';
import { labelScenarioTarget } from '@/domain/outcomes/labelScenarioTarget';
import type {
    AnalysisOutcomeLabels,
    LevelOutcomeEntry,
    LevelSide,
    OutcomeLevelRole,
    OutcomeSubject,
    OutcomeWindow,
} from '@/domain/outcomes/types';
import { scannedBars } from '@/domain/outcomes/windowSeries';

/**
 * The side a level is tested from. A `poc` takes the side it sits on: a support below the
 * reference price, a resistance at or above it (at the reference price it is `skipped`).
 */
function levelSide(
    role: OutcomeLevelRole,
    price: number,
    referencePrice: number
): LevelSide {
    if (role !== 'poc') return role;
    return price < referencePrice ? 'support' : 'resistance';
}

function labelLevel(
    level: OutcomeSubject['levels'][number],
    window: OutcomeWindow
): LevelOutcomeEntry {
    const price = level.price * window.adjFactor;
    return {
        role: level.role,
        price: level.price,
        ...labelLevelOutcome(
            {
                side: levelSide(level.role, price, window.referencePrice),
                price,
            },
            window
        ),
    };
}

function scalePlan(
    plan: OutcomeSubject['plan'],
    factor: number
): OutcomeSubject['plan'] {
    if (plan === null) return null;
    const scale = (price: number | null) =>
        price === null ? null : price * factor;
    return {
        ...plan,
        entryLow: scale(plan.entryLow),
        entryHigh: scale(plan.entryHigh),
        stop: scale(plan.stop),
        targets: plan.targets.map(price => price * factor),
    };
}

/**
 * Labels what an analysis claimed against the bars that followed it: forward returns,
 * the long plan, every key level (with placebos), scenario targets and detected patterns.
 * Pure and deterministic: the same subject and window always give the same labels, which
 * is what lets a stored subject and window be relabelled after a definition change.
 *
 * Every subject price is multiplied by `window.adjFactor` first, so a split or dividend
 * after the analysis changes no label. A `poc` level is labelled as a support when it sits
 * below the reference price and as a resistance when above (at the reference price it is
 * `skipped` as `at_price`). Outputs are in subject order; level and scenario prices are
 * reported in the subject's own basis.
 *
 * Labels are measurements with explicit not-evaluable states (`no_plan`, `skipped`,
 * `not_triggered`, `null` fields), never a pass: a plan whose stop core rejected is
 * `no_plan` / `no_stop`. They say how often something happened, not what to expect.
 *
 * @param subject - From `extractOutcomeSubject`.
 * @param window - From `buildOutcomeWindow` (or its stored JSON).
 * @returns The labels of every claim of the subject, stamped with `OUTCOME_LABEL_VERSION`.
 */
export function labelAnalysisOutcome(
    subject: OutcomeSubject,
    window: OutcomeWindow
): AnalysisOutcomeLabels {
    const factor = window.adjFactor;
    return {
        v: OUTCOME_LABEL_VERSION,
        windowBars: scannedBars(window),
        referencePrice: window.referencePrice,
        adjFactor: factor,
        anchorForming: window.anchorForming,
        anchorSource: window.anchorSource,
        atr: window.atr,
        forward: computeForwardReturns(window),
        plan: labelPlanOutcome(scalePlan(subject.plan, factor), window),
        levels: subject.levels.map(level => labelLevel(level, window)),
        scenarioTargets: subject.scenarioTargets.map(target => ({
            ...labelScenarioTarget(
                { side: target.side, price: target.price * factor },
                window
            ),
            price: target.price,
        })),
        patterns: subject.patterns.map(pattern =>
            labelPatternOutcome(pattern, window, factor)
        ),
    };
}
