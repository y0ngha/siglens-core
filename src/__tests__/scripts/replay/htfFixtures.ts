/**
 * Synthetic prompt text in the pre-registered WP-19 forms (design §3.4 and §4.4), built from the
 * instrument's own recomputation so a test can print what a correct core would print and then
 * damage one figure. Nothing here is market data.
 */
import {
    HTF_EVAL_CONSTANTS as C,
    aggregateMonths,
    aggregateWeeks,
    backdropReading,
    higherReading,
    isoWeekStart,
    monthStart,
    periodProgress,
    roundToKrxTick,
    trendOf,
    windowBars,
    type HtfTimeframe,
} from '../../../../scripts/replay/htfEvalCompute';
import {
    benchmarkOf,
    marketOfSymbol,
} from '../../../../scripts/replay/markets';
import type { HtfCaseData } from '../../../../scripts/replay/htfEvalGates';

const fixed = (n: number, d = 2): string => n.toFixed(d);
/** A price as the prompt prints it: a Korean one at its KRX tick, whole won. */
const quoted = (symbol: string, n: number): string =>
    marketOfSymbol(symbol) === 'kr' ? String(roundToKrxTick(n)) : fixed(n);
const signed = (n: number, d: number): string =>
    `${n >= 0 ? '+' : ''}${n.toFixed(d)}`;
const grouped = (n: number): string =>
    Math.round(n)
        .toString()
        .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const dateOf = (t: number): string =>
    new Date(t * 1000).toISOString().slice(0, 10);

/** `## Recent Bar Data` rows of the last 26 weekly bars with the in-progress tag when the week is unfinished. */
export function weeklyRowsSection(data: HtfCaseData): string {
    const symbol = data.replayCase.symbol;
    const all = aggregateWeeks(
        windowBars(data.bars, data.replayCase.asOf, C.longWindowDays)
    );
    const weeks = all.slice(-C.weeklyRecentBars);
    const progress = periodProgress(
        data.bars,
        data.replayCase.asOf,
        isoWeekStart
    );
    const high = Math.max(...all.map(w => w.high));
    const low = Math.min(...all.map(w => w.low));
    const first = all[0];
    const last = all[all.length - 1];
    const longTerm = [
        `## Long-term Context (${all.length} bars total)`,
        `- Period High: ${quoted(symbol, high)} (${dateOf(all.findLast(w => w.high === high)?.time ?? 0)} 00:00)`,
        `- Period Low: ${quoted(symbol, low)} (${dateOf(all.findLast(w => w.low === low)?.time ?? 0)} 00:00)`,
        `- Price Range: ${quoted(symbol, high)} ~ ${quoted(symbol, low)}`,
        `- Period Return: ${fixed(((last.close - first.close) / first.close) * 100)}%`,
    ].join('\n');
    const rows = [
        `## Recent Bar Data (Last ${weeks.length} bars)`,
        'Format: Date/Time(UTC) | O:Open H:High L:Low C:Close V:Volume [CandlePattern]',
        ...weeks.map((w, i) => {
            const tag =
                i === weeks.length - 1 && progress?.inProgress
                    ? ` (week in progress: ${progress.sessionsSoFar} of ${progress.sessionsTotal} sessions so far; its close is the latest price)`
                    : '';
            return `[ts:${w.time}] ${dateOf(w.time)} 00:00 | O:${quoted(symbol, w.open)} H:${quoted(symbol, w.high)} L:${quoted(symbol, w.low)} C:${quoted(symbol, w.close)} V:${grouped(w.volume)} [음봉]${tag}`;
        }),
    ].join('\n');
    return `${longTerm}\n\n${rows}`;
}

/** The `### Higher Timeframe` block a correct core prints for `timeframe` (`1Day` or `1Week`). */
export function higherBlockText(
    data: HtfCaseData,
    timeframe: HtfTimeframe
): string {
    const asOf = data.replayCase.asOf;
    const long = windowBars(data.bars, asOf, C.longWindowDays);
    const weekly = timeframe === '1Week';
    const kind = weekly ? 'monthly' : 'weekly';
    const K = weekly ? 'Monthly' : 'Weekly';
    const word = weekly ? 'month' : 'week';
    const analysisBars = weekly
        ? aggregateWeeks(long)
        : windowBars(data.bars, asOf, C.dailyWindowDays);
    const higherBars = weekly ? aggregateMonths(long) : aggregateWeeks(long);
    const progress = periodProgress(
        data.bars,
        asOf,
        weekly ? monthStart : isoWeekStart
    );
    const r = higherReading({ kind, analysisBars, higherBars, progress });
    const lines = [
        `### Higher Timeframe (computed, ${kind} bars built from daily history)`,
        r.trend === null
            ? `${K} trend: Not measurable: the rule needs at least 40 bars; received ${r.bars} bars.`
            : `${K} trend: ${r.trend.trend}. EMA20 moved ${signed(r.trend.slopeAtr, 2)} ATR(14) over the last 20 ${kind} bars (from ${quoted(data.replayCase.symbol, r.trend.emaFrom)} to ${quoted(data.replayCase.symbol, r.trend.emaLast)}) and the ${kind} close ${quoted(data.replayCase.symbol, r.trend.close)} is ${r.trend.close > r.trend.emaLast ? 'above' : r.trend.close < r.trend.emaLast ? 'below' : 'equal to'} EMA20.`,
        ...(r.rsi14 === null
            ? []
            : [
                  `${K} RSI(14) ${fixed(r.rsi14, 1)}${
                      r.closeVsMa50Pct === null
                          ? '.'
                          : `; ${kind} close ${fixed(Math.abs(r.closeVsMa50Pct), 1)}% ${r.closeVsMa50Pct >= 0 ? 'above' : 'below'} its 50-${word} average.`
                  }`,
              ]),
        ...(progress?.inProgress
            ? [
                  `The last ${kind} bar is the current ${word} (${progress.sessionsSoFar} of ${progress.sessionsTotal} sessions so far).`,
              ]
            : []),
        ...(r.alignment === null
            ? []
            : [
                  `Alignment with this chart's trend (${trendOf(analysisBars)?.trend ?? 'neutral'}): ${r.alignment}.`,
              ]),
        'Descriptive only. It does not change the top-level trend, the plan or the entry zone.',
    ];
    return lines.join('\n');
}

/** The `### Market Backdrop` block of a case, or `''` for the benchmark itself. */
export function backdropBlockText(data: HtfCaseData): string {
    const { replayCase } = data;
    const benchmark = benchmarkOf(replayCase.symbol);
    const benchBars = data.benchmarks.get(benchmark.symbol) ?? [];
    if (replayCase.symbol === benchmark.symbol) return '';
    const r = backdropReading({
        symbolDaily: windowBars(data.bars, replayCase.asOf, C.dailyWindowDays),
        benchmarkDaily: windowBars(
            benchBars,
            replayCase.asOf,
            C.dailyWindowDays
        ),
    });
    const pct = (v: number | null): string =>
        v === null ? 'n/a' : `${signed(v, 1)}`;
    return [
        '### Market Backdrop (computed, daily bars)',
        `${benchmark.label}: trend ${r.trend?.trend ?? 'not measurable'} (same rule as above)${
            r.closeVsMa200Pct === null
                ? ''
                : `; close ${fixed(Math.abs(r.closeVsMa200Pct), 1)}% ${r.closeVsMa200Pct >= 0 ? 'above' : 'below'} its 200-day average`
        }.`,
        `${replayCase.symbol} vs ${benchmark.label}, last 20 sessions: ${pct(r.relative[0].symbolPct)}% vs ${pct(r.relative[0].benchmarkPct)}%; last 60 sessions: ${pct(r.relative[1].symbolPct)}% vs ${pct(r.relative[1].benchmarkPct)}% (both to ${r.endDate}).`,
    ].join('\n');
}

/** A dynamic prompt of `sections` joined the way the prompt joins them. */
export const promptOf = (...sections: readonly string[]): string =>
    sections.filter(s => s !== '').join('\n\n');
