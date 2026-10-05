import { MACRO_INDICATOR_PROMPT_META } from './indicatorPromptMeta';
import { computeYieldSpread } from './normalizeTreasuryRates';
import type {
    EconomicIndicatorSeries,
    EconomySnapshot,
    MacroBriefingResponse,
    MacroRegime,
} from './types';

/** Recession probability (percent) above which the regime is a contraction. */
const RECESSION_CONTRACTION_PERCENT = 50;
/** Recession probability (percent) at or above which it counts as elevated. */
const RECESSION_ELEVATED_PERCENT = 10;
/** Unemployment-rate move (percentage points) that counts as rising/falling. */
const UNEMPLOYMENT_MOVE_PP = 0.1;
/** Monthly payroll gain (persons) below which job growth counts as weak. */
const PAYROLL_WEAK_PERSONS = 50_000;
/** Slowdown signals needed for a slowdown when payrolls are not shrinking. */
const SLOWDOWN_SIGNALS_REQUIRED = 2;
/** Percentage-point deltas are compared after rounding to this many decimals (4.5 − 4.4 is 0.0999…). */
const PP_COMPARE_DECIMALS = 2;

const FALLBACK_PAYROLL_SCALE = 1000;

/** Which rule decided the regime — finer than the regime itself. */
export type MacroRegimeRule =
    | 'contraction:recessionHigh'
    | 'contraction:jobLossRisingUnemployment'
    | 'recovery'
    | 'slowdown:payrollShrinking'
    | 'slowdown:multipleSignals'
    | 'expansion'
    | 'neutral';

export interface DerivedMacroRegime {
    regime: MacroRegime;
    firedRule: MacroRegimeRule;
    /**
     * Plain-language signals that held, in a fixed order, WITHOUT thresholds or
     * rule wording — they are printed to the model as the reason and must not
     * invite it to restate cutoffs.
     */
    signals: string[];
}

interface PairedSeries {
    latest: number;
    previous: number;
}

function findSeries(
    snapshot: EconomySnapshot,
    name: string
): EconomicIndicatorSeries | undefined {
    return snapshot.indicators.find(i => i.name === name);
}

function latestValue(
    series: EconomicIndicatorSeries | undefined
): number | null {
    const value = series?.latest?.value;
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function previousValue(
    series: EconomicIndicatorSeries | undefined
): number | null {
    const value = series?.previous?.value;
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Both releases of a series, or `null` when either is missing / non-finite. */
function pairOf(
    series: EconomicIndicatorSeries | undefined
): PairedSeries | null {
    const latest = latestValue(series);
    const previous = previousValue(series);
    return latest === null || previous === null ? null : { latest, previous };
}

function roundPp(n: number): number {
    const factor = 10 ** PP_COMPARE_DECIMALS;
    return Math.round(n * factor) / factor;
}

/**
 * @internal The macro regime, decided in code from the snapshot rows.
 *
 * The model used to pick the regime from a rule list and mislabelled it across
 * runs (and contradicted its own summary), so the rules live here and the
 * result overrides the model's `regime` field. Rules, first match wins:
 *
 * 1. **contraction** — recession probability above 50%; or payroll change
 *    below zero together with unemployment up 0.1pp or more.
 * 2. **recovery** — prior distress (recession probability, latest or previous
 *    value, at 10% or higher) together with payroll change above zero,
 *    unemployment down 0.1pp or more, and recession probability below its
 *    previous value.
 * 3. **slowdown** — payroll change below zero is by itself enough; otherwise
 *    two or more slowdown signals: unemployment up 0.1pp or more; payroll
 *    change below 50,000 persons; industrial production below its previous
 *    value; 2s10s spread below zero; recession probability at 10% or higher.
 * 4. **expansion** — payroll change of 50,000 persons or more and no slowdown
 *    signal.
 * 5. **neutral** — anything else, including exactly one slowdown signal.
 *
 * **Missing data:** a missing / N/A row (or a series with no previous value)
 * makes every condition that needs it unmet. A condition phrased negatively
 * (expansion's "no slowdown signal") is evaluated on the rows that ARE present
 * — an absent row neither triggers nor blocks it.
 *
 * No inflation guard: FMP's `inflationRate.previous` is the previous DAY, not
 * the previous month, so its delta says nothing about the month's trend.
 */
export function deriveMacroRegime(
    snapshot: EconomySnapshot
): DerivedMacroRegime {
    const recession = findSeries(snapshot, 'smoothedUSRecessionProbabilities');
    const recessionLatest = latestValue(recession);
    const recessionPrevious = previousValue(recession);
    const unemployment = pairOf(findSeries(snapshot, 'unemploymentRate'));
    const unemploymentDelta =
        unemployment === null
            ? null
            : roundPp(unemployment.latest - unemployment.previous);
    const payroll = pairOf(findSeries(snapshot, 'totalNonfarmPayroll'));
    const payrollScale =
        MACRO_INDICATOR_PROMPT_META.totalNonfarmPayroll?.rawScale ??
        FALLBACK_PAYROLL_SCALE;
    const payrollChange =
        payroll === null
            ? null
            : (payroll.latest - payroll.previous) * payrollScale;
    const production = pairOf(
        findSeries(snapshot, 'industrialProductionTotalIndex')
    );
    const spread = computeYieldSpread(snapshot.treasury);

    const unemploymentRising =
        unemploymentDelta !== null && unemploymentDelta >= UNEMPLOYMENT_MOVE_PP;
    const unemploymentFalling =
        unemploymentDelta !== null &&
        unemploymentDelta <= -UNEMPLOYMENT_MOVE_PP;
    const payrollShrinking = payrollChange !== null && payrollChange < 0;
    const payrollGrowing = payrollChange !== null && payrollChange > 0;
    const recessionElevated =
        recessionLatest !== null &&
        recessionLatest >= RECESSION_ELEVATED_PERCENT;

    // 1. contraction
    if (
        recessionLatest !== null &&
        recessionLatest > RECESSION_CONTRACTION_PERCENT
    ) {
        return {
            regime: 'contraction',
            firedRule: 'contraction:recessionHigh',
            signals: ['recession probability high'],
        };
    }
    if (payrollShrinking && unemploymentRising) {
        return {
            regime: 'contraction',
            firedRule: 'contraction:jobLossRisingUnemployment',
            signals: ['payrolls shrinking', 'unemployment rate rising'],
        };
    }

    // 2. recovery
    const priorDistress =
        recessionElevated ||
        (recessionPrevious !== null &&
            recessionPrevious >= RECESSION_ELEVATED_PERCENT);
    const recessionFalling =
        recessionLatest !== null &&
        recessionPrevious !== null &&
        recessionLatest < recessionPrevious;
    if (
        priorDistress &&
        payrollGrowing &&
        unemploymentFalling &&
        recessionFalling
    ) {
        return {
            regime: 'recovery',
            firedRule: 'recovery',
            signals: [
                'recession probability recently elevated and now falling',
                'payrolls growing',
                'unemployment rate falling',
            ],
        };
    }

    // 3. slowdown — held signals in a fixed order
    const heldSignals = [
        unemploymentRising && 'unemployment rate rising',
        payrollChange !== null &&
            payrollChange < PAYROLL_WEAK_PERSONS &&
            (payrollShrinking
                ? 'payrolls shrinking'
                : 'monthly job gains weak'),
        production !== null &&
            production.latest < production.previous &&
            'industrial production falling',
        spread !== null && spread < 0 && 'yield curve inverted',
        recessionElevated && 'recession probability elevated',
    ].filter((signal): signal is string => typeof signal === 'string');

    if (payrollShrinking) {
        return {
            regime: 'slowdown',
            firedRule: 'slowdown:payrollShrinking',
            signals: heldSignals,
        };
    }
    if (heldSignals.length >= SLOWDOWN_SIGNALS_REQUIRED) {
        return {
            regime: 'slowdown',
            firedRule: 'slowdown:multipleSignals',
            signals: heldSignals,
        };
    }

    // 4. expansion
    if (
        payrollChange !== null &&
        payrollChange >= PAYROLL_WEAK_PERSONS &&
        heldSignals.length === 0
    ) {
        return {
            regime: 'expansion',
            firedRule: 'expansion',
            signals: [
                'monthly job gains solid',
                'no slowdown signal on the available rows',
            ],
        };
    }

    // 5. neutral
    return {
        regime: 'neutral',
        firedRule: 'neutral',
        signals:
            heldSignals.length > 0
                ? heldSignals
                : ['rows are mixed or incomplete'],
    };
}

/**
 * @internal The briefing with its `regime` replaced by the one computed from
 * `snapshot` ({@link deriveMacroRegime}). Applied on every path that returns a
 * briefing (fresh, cache hit, peek) so the stored and the served regime always
 * agree with the rows, whatever the model wrote.
 */
export function withComputedRegime(
    briefing: MacroBriefingResponse,
    snapshot: EconomySnapshot
): MacroBriefingResponse {
    return { ...briefing, regime: deriveMacroRegime(snapshot).regime };
}
