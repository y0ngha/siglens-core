import { isPatternTargetLabel } from '@/domain/analysis/ai-levels';
import { extractGroundingNumbers } from '@/domain/analysis/promptNumbers';
import type { AnalysisResponse } from '@/domain/types';

/**
 * Which model-authored price field a checked value came from. `entryPrices`, `stopLoss`
 * and `takeProfitPrices` are the trade plan; `keyPrices` are the labelled prices inside
 * pattern cards (a class of their own, reported separately from the plan); the rest are
 * the other structured price fields the prompt also restricts to printed numbers.
 *
 * @internal
 */
export type ProvenanceField =
    | 'entryPrices'
    | 'stopLoss'
    | 'takeProfitPrices'
    | 'keyLevels.support'
    | 'keyLevels.resistance'
    | 'keyLevels.poc'
    | 'priceTargets'
    | 'patternGeometry'
    | 'keyPrices';

/**
 * @internal
 * One price that no number of the prompt grounds.
 */
export interface ProvenanceFinding {
    readonly field: ProvenanceField;
    readonly value: number;
}

/**
 * @internal
 * `checked` counts the values looked at (grounded or not), so a rate is
 * `findings / checked`; `plan`, `other` and `keyPrices` are the ungrounded ones of each
 * class. The classes are never mixed: the plan rate is the one that matters to a reader.
 */
export interface PriceProvenanceReport {
    readonly checked: {
        readonly plan: number;
        readonly other: number;
        readonly keyPrices: number;
    };
    readonly plan: readonly ProvenanceFinding[];
    readonly other: readonly ProvenanceFinding[];
    readonly keyPrices: readonly ProvenanceFinding[];
}

/**
 * Slack, in units of the last printed digit, between a checked price and the printed
 * number that grounds it. Half a unit is rounding; the remaining tenth absorbs floating
 * point error in the subtraction.
 */
const GROUNDING_TOLERANCE_UNITS = 0.6;

type ValueClass = keyof PriceProvenanceReport['checked'];

interface CheckedValue {
    readonly group: ValueClass;
    readonly finding: ProvenanceFinding;
}

function isCheckable(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function valuesOf(
    group: ValueClass,
    field: ProvenanceField,
    values: readonly unknown[]
): readonly CheckedValue[] {
    return values
        .filter(isCheckable)
        .map(value => ({ group, finding: { field, value } }));
}

/**
 * The model's own price fields of `result`. Code-derived values are never listed:
 * `reconciledLevels`, `planCheck`, and the pattern-target `keyPrices` the domain appends
 * come from arithmetic, not from the model reading the prompt. Non-finite and
 * non-positive values are skipped here — the plan invariants own those.
 *
 * A stored or hand-edited result can lack `priceTargets` (or one scenario, `keyLevels`,
 * `patternSummaries`); the missing part simply contributes no values instead of throwing.
 * The type says these fields are always present, but replay feeds results read back from
 * stored files that the type never checked, hence the optional access below.
 */
function collectCheckedValues(
    result: AnalysisResponse
): readonly CheckedValue[] {
    const rec = result.actionRecommendation;
    const { keyLevels, priceTargets, patternSummaries } = result;
    return [
        ...valuesOf('plan', 'entryPrices', rec?.entryPrices ?? []),
        ...valuesOf('plan', 'stopLoss', [rec?.stopLoss]),
        ...valuesOf('plan', 'takeProfitPrices', rec?.takeProfitPrices ?? []),
        ...valuesOf(
            'other',
            'keyLevels.support',
            (keyLevels?.support ?? []).map(level => level.price)
        ),
        ...valuesOf(
            'other',
            'keyLevels.resistance',
            (keyLevels?.resistance ?? []).map(level => level.price)
        ),
        ...valuesOf('other', 'keyLevels.poc', [keyLevels?.poc?.price]),
        ...valuesOf(
            'other',
            'priceTargets',
            [priceTargets?.bullish, priceTargets?.bearish].flatMap(
                scenario => scenario?.targets?.map(target => target.price) ?? []
            )
        ),
        ...valuesOf(
            'other',
            'patternGeometry',
            (patternSummaries ?? []).flatMap(pattern => [
                pattern.geometry?.breakoutLevel,
                pattern.geometry?.extremeLevel,
                pattern.geometry?.invalidationLevel,
            ])
        ),
        ...valuesOf(
            'keyPrices',
            'keyPrices',
            (patternSummaries ?? []).flatMap(pattern =>
                (pattern.keyPrices ?? [])
                    .filter(keyPrice => !isPatternTargetLabel(keyPrice.label))
                    .map(keyPrice => keyPrice.price)
            )
        ),
    ];
}

/** Index of the first element of the ascending `sorted` that is `>= target` (its length when none). */
function lowerBound(
    sorted: readonly number[],
    target: number,
    low = 0,
    high = sorted.length
): number {
    if (low >= high) return low;
    const mid = Math.floor((low + high) / 2);
    return sorted[mid] >= target
        ? lowerBound(sorted, target, low, mid)
        : lowerBound(sorted, target, mid + 1, high);
}

/**
 * @internal
 *
 * A predicate telling whether a price is printed in `promptDynamic` at the prompt's price
 * precision: some grounding number (see `extractGroundingNumbers`) written with exactly
 * `priceDecimals` fractional digits lies within `0.6 × 10^(-priceDecimals)` of it. Built
 * once and queried by binary search, so measuring many candidate prices stays cheap.
 */
export function createPriceGrounding(
    promptDynamic: string,
    priceDecimals: number
): (value: number) => boolean {
    const tolerance = GROUNDING_TOLERANCE_UNITS * 10 ** -priceDecimals;
    const printed = extractGroundingNumbers(promptDynamic)
        .filter(token => token.decimals === priceDecimals)
        .map(token => token.value)
        .sort((a, b) => a - b);
    return value => {
        // First printed number >= value - tolerance; grounded when it is not above value + tolerance.
        const first = lowerBound(printed, value - tolerance);
        return first < printed.length && printed[first] <= value + tolerance;
    };
}

/**
 * @internal
 *
 * Which prices the model wrote are not printed anywhere in the computed data of the
 * dynamic prompt.
 *
 * The prompt tells the model that every structured price must appear in the data; a
 * price it derived or recalled is a number nobody computed. A price is **grounded** when
 * {@link createPriceGrounding} finds it printed at the prompt's precision. There is no
 * exemption for round numbers: a model answering `190` must have been shown `190.00`.
 *
 * Pass the analysis **as the model wrote it** (`postProcessRawAnalysis().modelOutput`),
 * not the post-processed one: KRX rounding snaps every price to its tick, which is where
 * the prompt prints them, so a made-up `55,234` would become the printed-looking
 * `55,200` and pass. Which prompt text counts as data, and which tokens are excluded
 * (dates, times, percentages, negatives), is `extractGroundingNumbers`. Limits: the
 * sections are told apart by their `## ` headings, so a prompt version with a new
 * guidance section keeps its example numbers as "data" until it is listed; and with few
 * decimals (KRW, whole units) any printed integer can coincide with a price. Callers that
 * report a rate should print the false-grounding rate of the prompt as a control.
 *
 * Pure measurement — nothing is corrected or dropped.
 *
 * @param input.promptDynamic - The dynamic prompt the analysis was generated from.
 * @param input.result - The analysis as the model wrote it (`reconciledLevels` and
 *   `planCheck` are ignored by design).
 * @param input.priceDecimals - Fractional digits the prompt prints prices with
 *   (`priceQuoting(lastClose).dp` or `inferPromptPriceDecimals`).
 */
export function checkPriceProvenance(input: {
    promptDynamic: string;
    result: AnalysisResponse;
    priceDecimals: number;
}): PriceProvenanceReport {
    const { promptDynamic, result, priceDecimals } = input;
    const isGrounded = createPriceGrounding(promptDynamic, priceDecimals);
    const checked = collectCheckedValues(result);
    const ungrounded = (group: ValueClass) =>
        checked
            .filter(entry => entry.group === group)
            .map(entry => entry.finding)
            .filter(finding => !isGrounded(finding.value));
    const count = (group: ValueClass) =>
        checked.filter(entry => entry.group === group).length;

    return {
        checked: {
            plan: count('plan'),
            other: count('other'),
            keyPrices: count('keyPrices'),
        },
        plan: ungrounded('plan'),
        other: ungrounded('other'),
        keyPrices: ungrounded('keyPrices'),
    };
}
