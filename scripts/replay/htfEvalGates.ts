/**
 * The `htf` mode of the analysis-fields evaluation (WP-19): the weekly-bars and
 * higher-timeframe gates read off rendered technical prompts and recomputed from the set's
 * stored bars with `htfEvalCompute.ts` (never from core).
 *
 *   W1  the weekly rows a `1Week` prompt prints equal the instrument's own ISO-week aggregation
 *   W2  the printed in-progress tag and session counts equal the recomputation
 *   H1  the printed higher-timeframe block equals the recomputation (every printed figure)
 *   H2a a render is byte-identical to an earlier render (a `1Day` render against `main`)
 *   H2b a render with the two registered blocks cut is byte-identical to an earlier render
 *   H4  the printed US market backdrop equals the recomputation from the stored SPY bars
 *   H4k the same for the Korean indices, computable only with their stored bars
 *
 * A gate over a population is computable only when every sampled case is covered: a case the
 * instrument cannot judge (no bars, no readable block, an `asOf` with no later bar) makes the
 * gate `null`, never a pass (TE-16).
 */
import type { GateResult, TrendLabel } from './analysisFieldsEvalTypes';
import {
    HTF_EVAL_CONSTANTS as C,
    aggregateMonths,
    aggregateWeeks,
    backdropReading,
    hasHolidayCalendar,
    higherReading,
    holidayAffectedWeek,
    isoWeekStart,
    roundToKrxTick,
    matchesPrinted,
    monthStart,
    periodProgress,
    trendOf,
    weekdayOf,
    windowBars,
    type HigherKind,
    type HtfTimeframe,
} from './htfEvalCompute';
import {
    printedBackdrop,
    printedBarRows,
    printedHigherBlock,
    printedLongTerm,
    printedWeekTag,
    withoutHtfBlocks,
} from './htfEvalPrompt';
import { sha256Hex } from './fsUtil';
import { benchmarkOf, marketOfSymbol } from './markets';
import type { ReplayCase } from './types';
import type { Bar } from '@/domain/types';

export type HtfTier = 'free' | 'member';

export interface HtfSample {
    caseId: string;
    tier: HtfTier;
    stable: string;
    dynamic: string;
}

/** What the instrument holds for a case: its stored bars and the benchmark bars by symbol. */
export interface HtfCaseData {
    replayCase: ReplayCase;
    bars: readonly Bar[];
    benchmarks: ReadonlyMap<string, readonly Bar[]>;
}

/** The result of one check on one sample: `null` is "could not be judged". */
export interface Check {
    /** Names of the figures that disagreed; empty when the check passed. */
    failures: readonly string[];
    /** The check could not be computed for this sample (and why). */
    notComputable: string | null;
    /** Weekly hygiene: how many printed pivot values the check compared (0 makes K1 vacuous). */
    pivotsChecked?: number;
}

/** A check that does not apply to the rendered timeframe: not computable, never a pass. */
export const notApplicable = (why: string): Check => ({
    failures: [],
    notComputable: why,
});

const ok: Check = { failures: [], notComputable: null };
const cannot = (why: string): Check => ({ failures: [], notComputable: why });
const failed = (failures: readonly string[]): Check => ({
    failures,
    notComputable: null,
});

/**
 * A printed price against the recomputed one. A Korean price is printed at its KRX tick, so
 * it must equal the instrument's own tick-rounded value exactly, not lie within a tick of it.
 */
const priceMatches = (
    symbol: string,
    printed: string,
    value: number | null
): boolean =>
    value !== null &&
    matchesPrinted(
        printed,
        marketOfSymbol(symbol) === 'kr' ? roundToKrxTick(value) : value
    );

/**
 * W1: the weekly series a `1Week` prompt analyses against the instrument's own ISO-week
 * aggregation. The printed rows cover the last 26 weeks; the rest of the series is checked
 * through the figures that depend on all of it in `## Long-term Context` (bar count, period
 * high and low with their bar dates, first-to-last return).
 */
export function checkWeeklyRows(sample: HtfSample, data: HtfCaseData): Check {
    const weeks = aggregateWeeks(
        windowBars(data.bars, data.replayCase.asOf, C.longWindowDays)
    );
    const printed = printedBarRows(sample.dynamic);
    if (printed.rows.length === 0) return cannot('no bar row could be read');
    const expected = weeks.slice(-C.weeklyRecentBars);
    const symbol = data.replayCase.symbol;
    const longTerm = printedLongTerm(sample.dynamic);
    const first = weeks[0];
    const last = weeks[weeks.length - 1];
    const extreme = (field: 'high' | 'low') => {
        const value = weeks.reduce(
            (m, w) =>
                field === 'high'
                    ? Math.max(m, w[field])
                    : Math.min(m, w[field]),
            weeks[0][field]
        );
        return {
            value,
            date: dateOfSeconds(
                weeks.findLast(w => w[field] === value)?.time ?? NaN
            ),
        };
    };
    const high = extreme('high');
    const low = extreme('low');
    const wholeSeries =
        longTerm === null
            ? ['longTermMissing']
            : [
                  ...(longTerm.barsTotal === weeks.length
                      ? []
                      : ['seriesLength']),
                  ...(longTerm.high !== null &&
                  priceMatches(symbol, longTerm.high.price, high.value) &&
                  longTerm.high.date === high.date
                      ? []
                      : ['periodHigh']),
                  ...(longTerm.low !== null &&
                  priceMatches(symbol, longTerm.low.price, low.value) &&
                  longTerm.low.date === low.date
                      ? []
                      : ['periodLow']),
                  ...(longTerm.periodReturn !== null &&
                  matchesPrinted(
                      longTerm.periodReturn,
                      ((last.close - first.close) / first.close) * 100
                  )
                      ? []
                      : ['periodReturn']),
              ];
    const failures = [
        ...wholeSeries,
        ...(printed.unparsed > 0 ? ['unparsedRows'] : []),
        ...(printed.rows.length !== expected.length ? ['rowCount'] : []),
        ...(printed.declared !== expected.length ? ['declaredCount'] : []),
        ...printed.rows.flatMap((row, i) => {
            const own = expected[i];
            if (own === undefined) return [];
            return [
                ...(row.ts === own.time ? [] : ['time']),
                ...(priceMatches(symbol, row.open, own.open) ? [] : ['open']),
                ...(priceMatches(symbol, row.high, own.high) ? [] : ['high']),
                ...(priceMatches(symbol, row.low, own.low) ? [] : ['low']),
                ...(priceMatches(symbol, row.close, own.close)
                    ? []
                    : ['close']),
                ...(row.volume === Math.round(own.volume) ? [] : ['volume']),
            ];
        }),
    ];
    return failed([...new Set(failures)]);
}

/** What W2 recomputes for a case: whether its last week is unfinished and the session counts. */
export function weekProgressOf(data: HtfCaseData) {
    return periodProgress(data.bars, data.replayCase.asOf, isoWeekStart);
}

/**
 * Why the status of the last period cannot be judged, `null` when it can: no later bar is
 * stored, or the period is still open at the end of the stored bars (its total is unknown).
 */
export function progressUnknown(
    progress: ReturnType<typeof periodProgress>
): string | null {
    if (progress === null) return 'asOf is the last stored bar';
    if (progress.inProgress && !progress.totalKnown) {
        return 'the period is open at the end of the stored bars: its session total is unknown';
    }
    return null;
}

/** W2: the in-progress tag on the last weekly row against the stored bars of the week. */
export function checkWeekTag(sample: HtfSample, data: HtfCaseData): Check {
    const progress = weekProgressOf(data);
    const unknown = progressUnknown(progress);
    if (unknown !== null || progress === null) {
        return cannot(unknown ?? 'unfinished-period status unknown');
    }
    const rows = printedBarRows(sample.dynamic).rows;
    if (rows.length === 0) return cannot('no bar row could be read');
    const tag = printedWeekTag(rows);
    const symbol = sample.caseId.split('|')[0];
    const calendar = hasHolidayCalendar(symbol);
    const expectedTag = progress.inProgress
        ? {
              sessionsSoFar: progress.sessionsSoFar,
              // No holiday data: core prints no total, so none is expected (N only).
              sessionsTotal: calendar ? progress.sessionsTotal : null,
          }
        : null;
    // A week the stored bars show cut short (holiday, closure) in a market with no holiday
    // calendar: core cannot know the week ended, so a tag with the observed N is accepted too.
    const mayBeTagged = holidayAffectedWeek(symbol, progress);
    const tagOk =
        JSON.stringify(tag.onLastRow) === JSON.stringify(expectedTag) ||
        (mayBeTagged &&
            !progress.inProgress &&
            JSON.stringify(tag.onLastRow) ===
                JSON.stringify({
                    sessionsSoFar: progress.sessionsSoFar,
                    sessionsTotal: null,
                }));
    const failures = [
        ...(tagOk ? [] : ['lastRowTag']),
        ...(tag.rowsWithTag === (progress.inProgress ? 1 : 0) ||
        (mayBeTagged && tag.rowsWithTag <= 1)
            ? []
            : ['taggedRows']),
    ];
    return failed(failures);
}

const dateOfSeconds = (unixSeconds: number): string =>
    new Date(unixSeconds * 1000).toISOString().slice(0, 10);

const HIGHER_OF: Partial<Record<HtfTimeframe, HigherKind>> = {
    '1Day': 'weekly',
    '1Week': 'monthly',
};

/** The bars the analysis is given and the aggregated higher series, from the stored bars. */
function higherInputs(timeframe: HtfTimeframe, data: HtfCaseData) {
    const asOf = data.replayCase.asOf;
    const long = windowBars(data.bars, asOf, C.longWindowDays);
    if (timeframe === '1Week') {
        return {
            analysisBars: aggregateWeeks(long),
            higherBars: aggregateMonths(long),
            startOf: monthStart,
        };
    }
    return {
        analysisBars: windowBars(data.bars, asOf, C.dailyWindowDays),
        higherBars: aggregateWeeks(long),
        startOf: isoWeekStart,
    };
}

const signed = (value: number, decimals: number): string =>
    `${value >= 0 ? '+' : ''}${value.toFixed(decimals)}`;

/** H1: every figure of the printed `### Higher Timeframe` block against the recomputation. */
export function checkHigherBlock(
    sample: HtfSample,
    data: HtfCaseData,
    timeframe: HtfTimeframe
): Check {
    const kind = HIGHER_OF[timeframe];
    if (kind === undefined)
        return cannot(`no higher timeframe for ${timeframe}`);
    const block = printedHigherBlock(sample.dynamic);
    if (block === null) return failed(['blockMissing']);
    const { analysisBars, higherBars, startOf } = higherInputs(timeframe, data);
    const status = periodProgress(data.bars, data.replayCase.asOf, startOf);
    const unknown = progressUnknown(status);
    if (unknown !== null) return cannot(unknown);
    const own = higherReading({
        kind,
        analysisBars,
        higherBars,
        progress: status,
    });
    const symbol = data.replayCase.symbol;
    const t = own.trend;
    const analysisTrend: TrendLabel | null =
        trendOf(analysisBars)?.trend ?? null;
    const failures = [
        ...(block.kind === kind ? [] : ['kind']),
        ...(block.unparsed.length === 0 ? [] : ['unparsedLines']),
        ...(t === null
            ? [
                  ...(block.trend === null
                      ? []
                      : ['trendPrintedButNotMeasurable']),
                  ...(block.receivedBars === own.bars ? [] : ['receivedBars']),
              ]
            : block.trend === null
              ? ['trendMissing']
              : [
                    ...(block.trend.label === t.trend ? [] : ['trend']),
                    ...(block.trend.slopeAtr === signed(t.slopeAtr, 2)
                        ? []
                        : ['slopeAtr']),
                    ...(priceMatches(symbol, block.trend.emaFrom, t.emaFrom)
                        ? []
                        : ['emaFrom']),
                    ...(priceMatches(symbol, block.trend.emaLast, t.emaLast)
                        ? []
                        : ['emaLast']),
                    ...(priceMatches(symbol, block.trend.close, t.close)
                        ? []
                        : ['close']),
                    ...(block.trend.closeVsEma ===
                    (t.close > t.emaLast
                        ? 'above'
                        : t.close < t.emaLast
                          ? 'below'
                          : 'equal to')
                        ? []
                        : ['closeVsEma']),
                ]),
        ...(own.rsi14 === null
            ? block.rsi14 === null
                ? []
                : ['rsiPrintedButNull']
            : block.rsi14 !== null && matchesPrinted(block.rsi14, own.rsi14)
              ? []
              : ['rsi14']),
        ...(own.closeVsMa50Pct === null
            ? block.closeVsMa50 === null
                ? []
                : ['ma50PrintedButNull']
            : block.closeVsMa50 !== null &&
                matchesPrinted(
                    block.closeVsMa50.pct.replace(/^[+-]/, ''),
                    Math.abs(own.closeVsMa50Pct)
                ) &&
                block.closeVsMa50.side ===
                    (own.closeVsMa50Pct >= 0 ? 'above' : 'below')
              ? []
              : ['closeVsMa50']),
        ...progressFailures(
            block.progress,
            own.lastBarProgress,
            hasHolidayCalendar(symbol)
        ),
        ...(own.alignment === null
            ? block.alignment === null
                ? []
                : ['alignmentPrintedButNull']
            : block.alignment !== null &&
                block.alignment.label === own.alignment &&
                block.alignment.analysisTrend === analysisTrend
              ? []
              : ['alignment']),
    ];
    return failed(failures);
}

function progressFailures(
    printed: { sessionsSoFar: number; sessionsTotal: number | null } | null,
    own: ReturnType<typeof periodProgress>,
    calendar: boolean
): readonly string[] {
    if (own === null || !own.inProgress) {
        return printed === null ? [] : ['progressPrintedButFinished'];
    }
    return printed !== null &&
        printed.sessionsSoFar === own.sessionsSoFar &&
        printed.sessionsTotal === (calendar ? own.sessionsTotal : null)
        ? []
        : ['progress'];
}

/** H4 and H4k: the printed market backdrop of a daily analysis against the recomputation. */
export function checkBackdrop(sample: HtfSample, data: HtfCaseData): Check {
    const { replayCase } = data;
    const benchmark = benchmarkOf(replayCase.symbol);
    const benchBars = data.benchmarks.get(benchmark.symbol);
    if (benchBars === undefined) {
        return cannot(`no stored bars of ${benchmark.symbol}`);
    }
    const block = printedBackdrop(sample.dynamic);
    if (replayCase.symbol === benchmark.symbol) {
        return block === null ? ok : failed(['backdropOnItself']);
    }
    if (block === null) return failed(['blockMissing']);
    const own = backdropReading({
        symbolDaily: windowBars(data.bars, replayCase.asOf, C.dailyWindowDays),
        benchmarkDaily: windowBars(
            benchBars,
            replayCase.asOf,
            C.dailyWindowDays
        ),
    });
    const ownTrend = own.trend?.trend ?? 'not measurable';
    const failures = [
        ...(block.label === benchmark.label ? [] : ['label']),
        ...(block.unparsed.length === 0 ? [] : ['unparsedLines']),
        ...(block.unitlessNumbers.length === 0 ? [] : ['indexPrice']),
        ...(block.trend === ownTrend ? [] : ['trend']),
        ...(own.closeVsMa200Pct === null
            ? block.closeVsMa200 === null
                ? []
                : ['ma200PrintedButNull']
            : block.closeVsMa200 !== null &&
                matchesPrinted(
                    block.closeVsMa200.pct.replace(/^[+-]/, ''),
                    Math.abs(own.closeVsMa200Pct)
                ) &&
                block.closeVsMa200.side ===
                    (own.closeVsMa200Pct >= 0 ? 'above' : 'below')
              ? []
              : ['closeVsMa200']),
        ...(block.endDate === own.endDate ? [] : ['endDate']),
        ...own.relative.flatMap(r => {
            const printed = block.relative.find(p => p.sessions === r.sessions);
            const same = (
                text: string | undefined,
                v: number | null
            ): boolean =>
                v === null
                    ? text === 'n/a'
                    : text !== undefined && matchesPrinted(text, v);
            return printed !== undefined &&
                printed.symbol === replayCase.symbol &&
                same(printed.symbolPct, r.symbolPct) &&
                same(printed.benchmarkPct, r.benchmarkPct)
                ? []
                : [`relative${r.sessions}`];
        }),
    ];
    return failed(failures);
}

// ─── Identity against an earlier render ───────────────────────────────────────

export interface HashRow {
    caseId: string;
    tier: HtfTier;
    stableSha256: string;
    dynamicSha256: string;
    /** The dynamic hash with the registered blocks cut; equal to `dynamicSha256` when there were none. */
    strippedSha256?: string;
}

export function hashRowOf(sample: HtfSample): HashRow & {
    strippedSha256: string;
} {
    return {
        caseId: sample.caseId,
        tier: sample.tier,
        stableSha256: sha256Hex(sample.stable),
        dynamicSha256: sha256Hex(sample.dynamic),
        strippedSha256: sha256Hex(withoutHtfBlocks(sample.dynamic)),
    };
}

export interface IdentityResult {
    /** Samples with an earlier row. */
    compared: number;
    /** Samples without one, plus earlier rows no sample matches. */
    unmatched: number;
    rawEqual: number;
    strippedEqual: number;
    stableEqual: number;
    /** The unnormalized hash comparison beside the normalized one (TE-16). */
    firstDifferences: readonly string[];
}

/** Compares current rows with the earlier render's rows, case by case and tier by tier. */
export function compareIdentity(
    current: readonly ReturnType<typeof hashRowOf>[],
    baseline: readonly HashRow[]
): IdentityResult {
    const key = (r: { caseId: string; tier: string }): string =>
        `${r.caseId}#${r.tier}`;
    const byKey = new Map(baseline.map(r => [key(r), r]));
    const pairs = current.flatMap(row => {
        const before = byKey.get(key(row));
        return before === undefined ? [] : [{ row, before }];
    });
    const rawEqual = pairs.filter(
        p => p.row.dynamicSha256 === p.before.dynamicSha256
    );
    return {
        compared: pairs.length,
        unmatched:
            current.length - pairs.length + (baseline.length - pairs.length),
        rawEqual: rawEqual.length,
        strippedEqual: pairs.filter(
            p => p.row.strippedSha256 === p.before.dynamicSha256
        ).length,
        stableEqual: pairs.filter(
            p => p.row.stableSha256 === p.before.stableSha256
        ).length,
        firstDifferences: pairs
            .filter(p => p.row.dynamicSha256 !== p.before.dynamicSha256)
            .slice(0, 5)
            .map(p => key(p.row)),
    };
}

// ─── Gates ────────────────────────────────────────────────────────────────────

export interface CheckRow {
    caseId: string;
    tier: HtfTier;
    check: Check;
}

export interface CheckSummary {
    samples: number;
    passed: number;
    failed: number;
    notComputable: number;
    byFigure: Record<string, number>;
    examples: readonly string[];
}

export function summarizeChecks(rows: readonly CheckRow[]): CheckSummary {
    const failedRows = rows.filter(r => r.check.failures.length > 0);
    return {
        samples: rows.length,
        passed: rows.filter(
            r => r.check.failures.length === 0 && r.check.notComputable === null
        ).length,
        failed: failedRows.length,
        notComputable: rows.filter(r => r.check.notComputable !== null).length,
        byFigure: failedRows
            .flatMap(r => r.check.failures)
            .reduce<Record<string, number>>(
                (acc, f) => ({ ...acc, [f]: (acc[f] ?? 0) + 1 }),
                {}
            ),
        examples: failedRows
            .slice(0, 5)
            .map(r => `${r.caseId}#${r.tier}: ${r.check.failures.join(',')}`),
    };
}

/** A gate over a population of checks: all computed and all passed, `null` when any was not computable. */
export function checkGate(
    id: string,
    description: string,
    rows: readonly CheckRow[]
): GateResult {
    const s = summarizeChecks(rows);
    const computable = s.samples > 0 && s.notComputable === 0;
    return {
        id,
        description,
        pass: computable ? s.failed === 0 : s.failed > 0 ? false : null,
        value: `${s.passed}/${s.samples} samples${s.notComputable > 0 ? `, ${s.notComputable} not computable` : ''}`,
        threshold: '100% of the population',
    };
}

/** An identity gate (H2a raw, H2b stripped) against an earlier render. */
export function identityGate(
    id: 'H2a' | 'H2b',
    description: string,
    identity: IdentityResult | null,
    samples: number,
    identityNote = '',
    baselineCarriesBlocks = false
): GateResult {
    if (identity === null) {
        return {
            id,
            description,
            pass: null,
            value: 'no --baseline',
            threshold: '100% byte-identical',
        };
    }
    if (id === 'H2b' && baselineCarriesBlocks) {
        return {
            id,
            description,
            pass: null,
            value: `baseline already carries the registered blocks, so a cut render cannot equal it [${identityNote}]`,
            threshold: '100% byte-identical',
        };
    }
    const equal = id === 'H2a' ? identity.rawEqual : identity.strippedEqual;
    const covered = identity.compared === samples && identity.unmatched === 0;
    return {
        id,
        description,
        pass: covered
            ? equal === samples && identity.stableEqual === samples
            : equal < identity.compared
              ? false
              : null,
        value: `${equal}/${samples} dynamic and ${identity.stableEqual}/${samples} stable identical (raw dynamic ${identity.rawEqual}), ${identity.unmatched} unmatched [${identityNote}]`,
        threshold: '100% byte-identical, every case and tier covered',
    };
}

/** The weekday of a weekly row in UTC, for the Monday check shared with weekly hygiene. */
export const isMonday = (unixSeconds: number): boolean =>
    weekdayOf(unixSeconds) === 1;

const near = (
    printed: unknown,
    value: number | null,
    decimals: number
): boolean =>
    value === null
        ? printed === null
        : typeof printed === 'number' &&
          Math.abs(printed - value) <= 0.5 * 10 ** -decimals + 1e-9;

/**
 * H1b: a result's attached `higherTimeframe` reading against the recomputation. The reading
 * carries the printed precision (slope 2 dp, RSI and distance 1 dp), so each figure is compared
 * at its own precision. A result without the reading (an old row, a fallback) is a failure:
 * the field is attached to every real analysis.
 */
export function checkAttachedReading(
    reading: Record<string, unknown> | null,
    data: HtfCaseData,
    timeframe: HtfTimeframe
): Check {
    const kind = HIGHER_OF[timeframe];
    if (kind === undefined)
        return cannot(`no higher timeframe for ${timeframe}`);
    if (reading === null) return failed(['readingMissing']);
    const { analysisBars, higherBars, startOf } = higherInputs(timeframe, data);
    const status = periodProgress(data.bars, data.replayCase.asOf, startOf);
    const unknown = progressUnknown(status);
    if (unknown !== null) return cannot(unknown);
    const own = higherReading({
        kind,
        analysisBars,
        higherBars,
        progress: status,
    });
    const progress = own.lastBarProgress;
    const failures = [
        ...(reading.kind === kind ? [] : ['kind']),
        ...((own.trend?.trend ?? null) === (reading.trend ?? null)
            ? []
            : ['trend']),
        ...(near(reading.slopeAtr, own.trend?.slopeAtr ?? null, 2)
            ? []
            : ['slopeAtr']),
        ...(near(reading.rsi14, own.rsi14, 1) ? [] : ['rsi14']),
        ...(near(reading.closeVsMa50Pct, own.closeVsMa50Pct, 1)
            ? []
            : ['closeVsMa50Pct']),
        ...(reading.lastBarInProgress === (progress?.inProgress ?? false)
            ? []
            : ['lastBarInProgress']),
        ...(reading.bars === own.bars ? [] : ['bars']),
        ...((own.alignment ?? null) === (reading.alignment ?? null)
            ? []
            : ['alignment']),
    ];
    return failed(failures);
}
