import { describe, expect, it } from 'vitest';
import {
    inferPromptPriceDecimals,
    parsePromptReferenceLevels,
    promptNumberPattern,
} from '@/domain/analysis/promptNumbers';
import { checkPriceProvenance } from '@/domain/analysis/priceProvenance';
import { priceQuoting } from '@/domain/analysis/promptFormat';
import {
    evaluateAnalysisExchange,
    falseGroundingRate,
    type AnalysisExchangeFixture,
} from '../../../../scripts/fixtures/evaluateAnalysisExchange';
import {
    ANALYSIS_EXCHANGE_FIXTURES,
    ANALYSIS_EXCHANGES_BYTES,
    EXPECTED_EXCHANGES,
} from './loadAnalysisExchanges';

/**
 * Twelve real stored exchanges (prompt version p32): the prompt the model was sent and
 * the text it answered. They pin the deterministic checks and the normalizer against the
 * real shapes of model output; they say nothing about how good current model output is.
 * Provenance of each file: `fixtures/analysisExchanges/README.md`.
 */

const SIZE_BUDGET_BYTES = 400 * 1024;
const EXCHANGE_COUNT = 12;
const PRICE_TOLERANCE_UNITS = 0.6;

const byId = ANALYSIS_EXCHANGE_FIXTURES.map(
    fixture => [fixture.id, fixture] as const
);

/** The model's own plan prices of an evaluated result, as `[field, value]`. */
function planValues(
    evaluation: ReturnType<typeof evaluateAnalysisExchange>
): readonly number[] {
    const rec = evaluation.modelOutput.actionRecommendation;
    return [
        ...(rec?.entryPrices ?? []),
        ...(rec?.stopLoss === undefined ? [] : [rec.stopLoss]),
        ...(rec?.takeProfitPrices ?? []),
    ].filter(value => Number.isFinite(value) && value > 0);
}

/** `dynamic` with every printed number within rounding distance of `value` deleted. */
function withoutPrintedPrice(
    dynamic: string,
    value: number,
    decimals: number
): string {
    const tolerance = PRICE_TOLERANCE_UNITS * 10 ** -decimals;
    return dynamic.replace(promptNumberPattern(), token => {
        const printed = Number(token.replaceAll(',', ''));
        const written = token.split('.')[1]?.length ?? 0;
        return written === decimals && Math.abs(printed - value) <= tolerance
            ? ''
            : token;
    });
}

describe('analysis exchange fixtures — inventory', () => {
    it('holds the twelve exchanges and an expected entry for each', () => {
        expect(ANALYSIS_EXCHANGE_FIXTURES).toHaveLength(EXCHANGE_COUNT);
        expect(Object.keys(EXPECTED_EXCHANGES).toSorted()).toEqual(
            ANALYSIS_EXCHANGE_FIXTURES.map(fixture => fixture.id).toSorted()
        );
    });

    it('stays within the size budget', () => {
        expect(ANALYSIS_EXCHANGES_BYTES).toBeLessThanOrEqual(SIZE_BUDGET_BYTES);
    });

    it('covers each selection class with its quota', () => {
        const counts = Object.values(EXPECTED_EXCHANGES).reduce(
            (acc, entry) =>
                acc.set(entry.class, (acc.get(entry.class) ?? 0) + 1),
            new Map<string, number>()
        );
        expect(Object.fromEntries(counts)).toEqual({
            salvage: 1,
            reversed_entry: 1,
            stop_not_below_zone: 2,
            target_not_above_zone: 2,
            ungrounded_plan_price: 2,
            clean: 4,
        });
    });
});

describe.each(byId)('analysis exchange fixture %s', (id, fixture) => {
    const expected = EXPECTED_EXCHANGES[id];
    const evaluation = evaluateAnalysisExchange(fixture);
    const priceDecimals = priceQuoting(fixture.lastClose).dp;

    it('keeps the stored shape and carries no field beyond what the checks need', () => {
        expect(Object.keys(fixture).toSorted()).toEqual(
            [
                'atr',
                'date',
                'dynamic',
                'id',
                'lastClose',
                'promptVersion',
                'rawText',
                'source',
                'ticker',
            ].toSorted()
        );
        expect(fixture.source).toBe('backtest-2026-11-daily-ai');
        expect(fixture.promptVersion).toBe('p32');
    });

    it('prints the market reference in the format the parsers read', () => {
        expect(
            parsePromptReferenceLevels(fixture.dynamic).length
        ).toBeGreaterThan(0);
        expect(inferPromptPriceDecimals(fixture.dynamic)).toBe(priceDecimals);
    });

    it('breaks no plan invariant after post-processing', () => {
        expect(evaluation.invariants).toEqual([]);
    });

    it('measures the pinned false-grounding rate of its prompt', () => {
        expect(
            falseGroundingRate(
                fixture.dynamic,
                fixture.lastClose,
                priceDecimals
            )
        ).toBe(expected.falseGroundingRate);
    });

    it('reports the pinned price provenance', () => {
        expect(evaluation.provenance).toEqual(expected.provenance);
    });

    it('belongs to the class it was chosen for', () => {
        const raw = evaluation.rawRecommendation;
        const entries = (raw?.entryPrices ?? []).filter(price => price > 0);
        const zoneLow = Math.min(...entries);
        const zoneHigh = Math.max(...entries);
        const byClass = {
            salvage: () => evaluation.needsTrailingContentSalvage,
            reversed_entry: () =>
                (raw?.entryPrices?.[0] ?? 0) > (raw?.entryPrices?.[1] ?? 0),
            stop_not_below_zone: () => (raw?.stopLoss ?? 0) >= zoneLow,
            target_not_above_zone: () =>
                (raw?.takeProfitPrices?.[0] ?? Infinity) <= zoneHigh,
            ungrounded_plan_price: () => evaluation.provenance.plan.length > 0,
            clean: () =>
                evaluation.provenance.plan.length === 0 &&
                evaluation.invariants.length === 0 &&
                !evaluation.needsTrailingContentSalvage,
        } satisfies Record<typeof expected.class, () => boolean>;
        expect(byClass[expected.class]()).toBe(true);
    });

    const ungrounded = new Set(
        evaluation.provenance.plan.map(finding => finding.value)
    );
    const groundedValues = [...new Set(planValues(evaluation))].filter(
        value => !ungrounded.has(value)
    );

    it.each(groundedValues)(
        'falsification: deleting the printed %s from the prompt makes exactly that price ungrounded',
        value => {
            const report = checkPriceProvenance({
                promptDynamic: withoutPrintedPrice(
                    fixture.dynamic,
                    value,
                    priceDecimals
                ),
                result: evaluation.modelOutput,
                priceDecimals,
            });
            const findings = [
                ...new Set(report.plan.map(finding => finding.value)),
            ].toSorted((a, b) => a - b);
            const nearValue = (other: number) =>
                Math.abs(other - value) <=
                PRICE_TOLERANCE_UNITS * 10 ** -priceDecimals;
            expect(findings).toEqual(
                [
                    ...new Set([
                        ...ungrounded,
                        ...planValues(evaluation).filter(nearValue),
                    ]),
                ].toSorted((a, b) => a - b)
            );
        }
    );
});

describe('analysis exchange fixtures — provenance control', () => {
    it('finds more ungrounded plan prices against another case’s prompt than against its own', () => {
        const ownFindings = ANALYSIS_EXCHANGE_FIXTURES.reduce(
            (total, fixture) =>
                total +
                evaluateAnalysisExchange(fixture).provenance.plan.length,
            0
        );
        const controlFindings = ANALYSIS_EXCHANGE_FIXTURES.reduce(
            (total, fixture, i, all) => {
                const other = all[
                    (i + 1) % all.length
                ] as AnalysisExchangeFixture;
                return (
                    total +
                    checkPriceProvenance({
                        promptDynamic: other.dynamic,
                        result: evaluateAnalysisExchange(fixture).modelOutput,
                        priceDecimals: priceQuoting(fixture.lastClose).dp,
                    }).plan.length
                );
            },
            0
        );
        expect(controlFindings).toBeGreaterThan(ownFindings);
    });
});
