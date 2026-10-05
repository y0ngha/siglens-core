/**
 * How a macro-briefing indicator row should be read.
 *
 * - `rate` / `probability` — a percentage; its delta is a percentage-point
 *   (`pp`) move.
 * - `level` — an absolute total (jobs, claims, dollars); the delta is a
 *   change in that same unit.
 * - `index` — a unitless-index reading rebased to a reference period; the
 *   delta is a change in index points.
 */
export type MacroIndicatorKind = 'rate' | 'probability' | 'level' | 'index';

/** Prompt-side metadata for one FMP economic-indicator series. */
export interface MacroIndicatorPromptMeta {
    /** Human-readable English label printed in front of the FMP key. */
    label: string;
    /** Unit the raw `value` is already expressed in. `'%'` is attached to the number without a space. */
    unit: string;
    kind: MacroIndicatorKind;
    /** Extra reading hint printed next to the unit; must not contain example sentences or sample values. */
    note?: string;
    /** `false` drops the `±x.xx%` change term from the delta (default shown) — for a total whose percent change misleads. */
    showPercentChange?: boolean;
}

/**
 * @internal Unit / label registry for the macro briefing prompt, keyed by the
 * FMP economic-indicators `name` that `EconomicIndicatorSeries.name` carries
 * (the same identifiers siglens' `ECONOMY_INDICATORS` registry requests).
 *
 * Why it exists: the raw FMP series name says nothing about the unit, so the
 * model had to guess — e.g. it read the nonfarm-payroll level (thousands of
 * persons) as a rate, or a recession probability of `0.62` as 62%. Unknown
 * names are not an error: the prompt builder falls back to the legacy
 * unit-less row for them.
 */
export const MACRO_INDICATOR_PROMPT_META: Readonly<
    Record<string, MacroIndicatorPromptMeta>
> = {
    federalFunds: {
        label: 'Effective federal funds rate (monthly average)',
        unit: '%',
        kind: 'rate',
    },
    inflationRate: {
        label: 'Inflation rate (year over year)',
        unit: '%',
        kind: 'rate',
    },
    unemploymentRate: {
        label: 'Unemployment rate',
        unit: '%',
        kind: 'rate',
    },
    smoothedUSRecessionProbabilities: {
        label: 'Smoothed US recession probability',
        unit: '%',
        kind: 'probability',
        note: 'the value is already a percentage, not a 0-1 fraction',
    },
    totalNonfarmPayroll: {
        label: 'Total nonfarm payroll employment',
        unit: 'thousand persons',
        kind: 'level',
        note: 'total employment level; the change between releases is the monthly job gain or loss in thousands',
        showPercentChange: false,
    },
    initialClaims: {
        label: 'Initial jobless claims',
        unit: 'persons per week',
        kind: 'level',
    },
    GDP: {
        label: 'Gross domestic product',
        unit: 'USD billions',
        kind: 'level',
    },
    CPI: {
        label: 'Consumer price index',
        unit: 'index points',
        kind: 'index',
    },
    industrialProductionTotalIndex: {
        label: 'Industrial production index',
        unit: 'index points',
        kind: 'index',
    },
};

/** Registry lookup that never trusts a prototype key (`constructor`, `__proto__`) as an indicator name. */
export function getMacroIndicatorPromptMeta(
    name: string
): MacroIndicatorPromptMeta | null {
    return Object.hasOwn(MACRO_INDICATOR_PROMPT_META, name)
        ? MACRO_INDICATOR_PROMPT_META[name]
        : null;
}
