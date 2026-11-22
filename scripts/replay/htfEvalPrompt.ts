/**
 * Readers of what a rendered technical prompt prints about bars, the unfinished period, the
 * higher-timeframe block and the market backdrop (WP-19). They read the prompt text only: the
 * instrument decides "printed" from the text the model is sent, never by asking the code that
 * wrote it.
 *
 * The block and backdrop forms are the pre-registered text of the design (WP-19 §3.4, §4.4).
 * A core PR that words them differently must change the readers here in the same PR; a line
 * the readers do not recognise is reported as unparsed and fails its gate, it is never skipped.
 */
import { sectionOf } from './analysisFieldsEvalPrompt';

export const RECENT_BARS_HEADER = '## Recent Bar Data';
export const MARKET_REFERENCE_HEADER = '## Market Reference';
export const FEAR_GREED_HEADER = '## Fear & Greed Index (Reference)';

/** One `## Recent Bar Data` row. Prices are kept as printed text: the precision is the claim. */
export interface PrintedBarRow {
    ts: number;
    /** `YYYY-MM-DD` */
    date: string;
    /** `HH:MM` when printed, else `null`. */
    time: string | null;
    open: string;
    high: string;
    low: string;
    close: string;
    volume: number;
    /** Text after the candle label: where the in-progress tag is printed. */
    tail: string;
}

const ROW =
    /^\[ts:(\d+)\] (\d{4}-\d{2}-\d{2})(?: (\d{2}:\d{2}))? \| O:(\S+) H:(\S+) L:(\S+) C:(\S+) V:([\d,]+)(.*)$/;

export interface PrintedRows {
    rows: readonly PrintedBarRow[];
    /** The count in `## Recent Bar Data (Last N bars)`, `null` when the header has none. */
    declared: number | null;
    /** Lines that look like rows (`[ts:`) and did not parse. */
    unparsed: number;
}

/** The rows of `## Recent Bar Data`, oldest first. */
export function printedBarRows(prompt: string): PrintedRows {
    const section = sectionOf(prompt, RECENT_BARS_HEADER);
    const lines = section.split('\n').filter(line => line.startsWith('[ts:'));
    const parsed = lines.map(line => ROW.exec(line));
    return {
        declared:
            Number(/\(Last (\d+) bars\)/.exec(section)?.[1] ?? NaN) || null,
        unparsed: parsed.filter(m => m === null).length,
        rows: parsed.flatMap(m =>
            m === null
                ? []
                : [
                      {
                          ts: Number(m[1]),
                          date: m[2],
                          time: m[3] ?? null,
                          open: m[4],
                          high: m[5],
                          low: m[6],
                          close: m[7],
                          volume: Number(m[8].replaceAll(',', '')),
                          tail: m[9],
                      },
                  ]
        ),
    };
}

export interface PrintedLongTerm {
    /** The count in `## Long-term Context (N bars total)`. */
    barsTotal: number;
    high: { price: string; date: string } | null;
    low: { price: string; date: string } | null;
    /** Percent, as printed (sign included). */
    periodReturn: string | null;
}

/**
 * `## Long-term Context`: the figures that depend on the whole series the analysis was given
 * (bar count, period extremes with their bar dates, first-to-last return), `null` when absent.
 */
export function printedLongTerm(prompt: string): PrintedLongTerm | null {
    const section = sectionOf(prompt, '## Long-term Context');
    if (section === '') return null;
    const extreme = (label: string): { price: string; date: string } | null => {
        const m = new RegExp(
            `^- Period ${label}: ([\\d,.]+) \\((\\d{4}-\\d{2}-\\d{2}) 00:00\\)`,
            'm'
        ).exec(section);
        return m === null ? null : { price: m[1], date: m[2] };
    };
    return {
        barsTotal: Number(/\((\d+) bars total\)/.exec(section)?.[1] ?? NaN),
        high: extreme('High'),
        low: extreme('Low'),
        periodReturn:
            /^- Period Return: ([+-]?[\d,.]+)%/m.exec(section)?.[1] ?? null,
    };
}

export interface PrintedProgressTag {
    sessionsSoFar: number;
    sessionsTotal: number;
}

const WEEK_TAG =
    /\(week in progress: (\d+) of (\d+) sessions so far; its close is the latest price\)/;

/**
 * The in-progress tag printed on the **last** row of `## Recent Bar Data`, and the number of
 * rows that carry one (more than the last is a defect: only one bar can be unfinished).
 */
export function printedWeekTag(rows: readonly PrintedBarRow[]): {
    onLastRow: PrintedProgressTag | null;
    rowsWithTag: number;
} {
    const last = rows[rows.length - 1];
    const match = last === undefined ? null : WEEK_TAG.exec(last.tail);
    return {
        onLastRow:
            match === null
                ? null
                : {
                      sessionsSoFar: Number(match[1]),
                      sessionsTotal: Number(match[2]),
                  },
        rowsWithTag: rows.filter(row => WEEK_TAG.test(row.tail)).length,
    };
}

/** The lines of the `### <heading...>` block (heading line included), `null` when absent. */
export function blockOf(
    text: string,
    headingPrefix: string
): readonly string[] | null {
    const lines = text.split('\n');
    const start = lines.findIndex(line => line.startsWith(headingPrefix));
    if (start < 0) return null;
    const rest = lines.slice(start + 1);
    const end = rest.findIndex(
        line => line.startsWith('### ') || line.startsWith('## ')
    );
    return [lines[start], ...(end < 0 ? rest : rest.slice(0, end))];
}

export type HigherKindWord = 'daily' | 'weekly' | 'monthly';

export interface PrintedHigherBlock {
    kind: HigherKindWord;
    /** `null` when the block says `Not measurable`. */
    trend: {
        label: string;
        slopeAtr: string;
        emaFrom: string;
        emaLast: string;
        close: string;
        closeVsEma: string;
    } | null;
    /** Bars received, printed in the `Not measurable` form. */
    receivedBars: number | null;
    rsi14: string | null;
    /** Signed distance (percent) from the 50-bar average, `null` when not printed. */
    closeVsMa50: { pct: string; side: string } | null;
    progress: PrintedProgressTag | null;
    alignment: {
        analysisTrend: string;
        label: string;
    } | null;
    /** Lines of the block no reader recognised (the heading and the descriptive-only line excluded). */
    unparsed: readonly string[];
}

const KINDS: readonly HigherKindWord[] = ['daily', 'weekly', 'monthly'];
const cap = (word: string): string => word[0].toUpperCase() + word.slice(1);
const NUM = '[+-]?[\\d,]+(?:\\.\\d+)?';

/** The `### Higher Timeframe (computed, ...)` block, `null` when the prompt has none. */
export function printedHigherBlock(prompt: string): PrintedHigherBlock | null {
    const lines = blockOf(prompt, '### Higher Timeframe (computed');
    if (lines === null) return null;
    const kind = KINDS.find(k => lines[0].includes(`(computed, ${k} bars`));
    if (kind === undefined) {
        return {
            kind: 'daily',
            trend: null,
            receivedBars: null,
            rsi14: null,
            closeVsMa50: null,
            progress: null,
            alignment: null,
            unparsed: lines,
        };
    }
    const K = cap(kind);
    const trendRe = new RegExp(
        `^${K} trend: (bullish|bearish|neutral)\\. EMA20 moved (${NUM}) ATR\\(14\\) over the last 20 ${kind} bars \\(from (${NUM}) to (${NUM})\\) and the ${kind} close (${NUM}) is (above|below|equal to) EMA20\\.`
    );
    const missingRe = new RegExp(
        `^${K} trend: Not measurable[^\\n]*?received (\\d+) bars`
    );
    const rsiRe = new RegExp(`${K} RSI\\(14\\) (${NUM})`);
    const maRe = new RegExp(
        `${kind} close (${NUM})% (above|below) its 50-(?:week|month|day) average`
    );
    const progressRe =
        /The last \w+ bar is the current \w+ \((\d+) of (\d+) sessions so far\)/;
    const alignRe =
        /^Alignment with this chart's trend \((bullish|bearish|neutral)\): (aligned|opposed|mixed)\./;
    const body = lines.slice(1);
    const read = <T>(re: RegExp, pick: (m: RegExpExecArray) => T): T | null => {
        const m = body.map(line => re.exec(line)).find(x => x !== null);
        return m === undefined || m === null ? null : pick(m);
    };
    const trend = read(trendRe, m => ({
        label: m[1],
        slopeAtr: m[2],
        emaFrom: m[3],
        emaLast: m[4],
        close: m[5],
        closeVsEma: m[6],
    }));
    const receivedBars = read(missingRe, m => Number(m[1]));
    const known = (line: string): boolean =>
        [trendRe, missingRe, rsiRe, maRe, progressRe, alignRe].some(re =>
            re.test(line)
        ) ||
        line.startsWith('Descriptive only') ||
        line.startsWith('Rule:') ||
        line.trim() === '';
    return {
        kind,
        trend,
        receivedBars,
        rsi14: read(rsiRe, m => m[1]),
        closeVsMa50: read(maRe, m => ({ pct: m[1], side: m[2] })),
        progress: read(progressRe, m => ({
            sessionsSoFar: Number(m[1]),
            sessionsTotal: Number(m[2]),
        })),
        alignment: read(alignRe, m => ({ analysisTrend: m[1], label: m[2] })),
        unparsed: body.filter(line => !known(line)),
    };
}

export interface PrintedBackdrop {
    label: string;
    /** `not measurable` or a trend label. */
    trend: string;
    closeVsMa200: { pct: string; side: string } | null;
    relative: {
        symbol: string;
        sessions: number;
        symbolPct: string;
        benchmarkPct: string;
    }[];
    endDate: string | null;
    /** Numbers in the block that are neither percentages, dates, session counts nor a window length. */
    unitlessNumbers: readonly string[];
    unparsed: readonly string[];
}

/** The `### Market Backdrop (computed, ...)` block, `null` when the prompt has none. */
export function printedBackdrop(prompt: string): PrintedBackdrop | null {
    const lines = blockOf(prompt, '### Market Backdrop (computed');
    if (lines === null) return null;
    const body = lines.slice(1).filter(line => line.trim() !== '');
    const head = body
        .map(line =>
            new RegExp(
                `^(.+?): trend (bullish|bearish|neutral|not measurable)[^;]*?(?:; close (${NUM})% (above|below) its 200-day average)?\\.`
            ).exec(line)
        )
        .find(m => m !== null);
    const relRe = new RegExp(
        `^(\\S+) vs (.+?), last 20 sessions: (${NUM}|n/a)% vs (${NUM}|n/a)%; last 60 sessions: (${NUM}|n/a)% vs (${NUM}|n/a)% \\(both to (\\d{4}-\\d{2}-\\d{2})\\)`
    );
    const rel = body.map(line => relRe.exec(line)).find(m => m !== null);
    // The benchmark's name ("S&P 500") and the symbol ("005930.KS") may carry digits; they are
    // names, not figures of the block.
    const names = [head?.[1], rel?.[1]].filter(
        (name): name is string => name !== undefined && name !== ''
    );
    const stripped = names
        .reduce((text, name) => text.replaceAll(name, ' '), lines.join('\n'))
        .replace(/\d{4}-\d{2}-\d{2}/g, ' ')
        .replace(/\d+-day|\d+ sessions?|\(\d+\)/g, ' ');
    return {
        label: head?.[1] ?? '',
        trend: head?.[2] ?? '',
        closeVsMa200:
            head?.[3] === undefined || head[3] === ''
                ? null
                : { pct: head[3], side: head[4] },
        relative:
            rel === undefined || rel === null
                ? []
                : [
                      {
                          symbol: rel[1],
                          sessions: 20,
                          symbolPct: rel[3],
                          benchmarkPct: rel[4],
                      },
                      {
                          symbol: rel[1],
                          sessions: 60,
                          symbolPct: rel[5],
                          benchmarkPct: rel[6],
                      },
                  ],
        endDate: rel?.[7] ?? null,
        unitlessNumbers: [...stripped.matchAll(/-?\d[\d,]*(?:\.\d+)?%?/g)]
            .map(m => m[0])
            .filter(token => !token.endsWith('%')),
        unparsed: body.filter(
            line =>
                !(
                    line === head?.input ||
                    line === rel?.input ||
                    line.startsWith('Descriptive only')
                )
        ),
    };
}

/**
 * The prompt with the two WP-19 core-2 blocks (`### Higher Timeframe (computed` and
 * `### Market Backdrop (computed`) cut out: the registered parts the scoped identity gate
 * (H2b) strips. Nothing else is touched; a block is cut from its heading to the line before
 * the next `##` or `###` heading, with the blank line that followed it.
 */
export function withoutHtfBlocks(dynamic: string): string {
    return [
        '### Higher Timeframe (computed',
        '### Market Backdrop (computed',
    ].reduce((text, prefix) => {
        const lines = text.split('\n');
        const start = lines.findIndex(line => line.startsWith(prefix));
        if (start < 0) return text;
        const rest = lines.slice(start + 1);
        const end = rest.findIndex(
            line => line.startsWith('### ') || line.startsWith('## ')
        );
        const stop = end < 0 ? lines.length : start + 1 + end;
        return [...lines.slice(0, start), ...lines.slice(stop)].join('\n');
    }, dynamic);
}

/** Section text helpers re-exported for the gates: one place that knows the header strings. */
export function marketReferenceOf(prompt: string): string {
    return sectionOf(prompt, MARKET_REFERENCE_HEADER);
}

export function fearGreedOf(prompt: string): string {
    return sectionOf(prompt, FEAR_GREED_HEADER);
}
