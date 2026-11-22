import { describe, expect, it } from 'vitest';
import {
    checkAttachedReading,
    checkBackdrop,
    checkGate,
    checkHigherBlock,
    checkWeekTag,
    checkWeeklyRows,
    compareIdentity,
    hashRowOf,
    identityGate,
    summarizeChecks,
    weekProgressOf,
    type Check,
    type HtfCaseData,
    type HtfSample,
} from '../../../../scripts/replay/htfEvalGates';
import {
    HTF_EVAL_CONSTANTS as C,
    aggregateWeeks,
    higherReading,
    isoWeekStart,
    monthStart,
    periodProgress,
    windowBars,
} from '../../../../scripts/replay/htfEvalCompute';
import type { ReplayCase } from '../../../../scripts/replay/types';
import {
    backdropBlockText,
    higherBlockText,
    promptOf,
    weeklyRowsSection,
} from './htfFixtures';
import { tradingBars } from './replayFixtures';

const wave = (base: number) => (i: number) =>
    base + 0.4 * i + 8 * Math.sin(i / 11);
const NVDA = tradingBars({
    symbol: 'NVDA',
    startIso: '2020-01-02',
    count: 700,
    close: wave(100),
});
const SPY = tradingBars({
    symbol: 'SPY',
    startIso: '2020-01-02',
    count: 700,
    close: wave(300),
});
const KR = tradingBars({
    symbol: '005930.KS',
    startIso: '2020-01-02',
    count: 700,
    close: i => 60_000 + 90 * i + 2_000 * Math.sin(i / 11),
});
const iso = (t: number): string =>
    new Date(t * 1000).toISOString().slice(0, 10);

function dataOf(symbol: string, bars: typeof NVDA, index: number): HtfCaseData {
    const asOf = iso(bars[index].time);
    const replayCase: ReplayCase = {
        caseId: `${symbol}|${asOf}`,
        symbol,
        timeframe: '1Day',
        asOf,
        regime: 'range',
        variance: false,
    };
    return {
        replayCase,
        bars,
        benchmarks: new Map([
            ['SPY', SPY],
            ['KS11', SPY],
        ]),
    };
}

const sample = (
    data: HtfCaseData,
    dynamic: string,
    tier: 'free' | 'member' = 'member'
): HtfSample => ({
    caseId: data.replayCase.caseId,
    tier,
    stable: 'stable',
    dynamic,
});

/** A case mid-week (a later session of its week is stored) and one on the week's last session. */
const midWeek = (() => {
    const i = NVDA.findIndex(
        (b, k) => k > 520 && new Date(b.time * 1000).getUTCDay() === 3
    );
    return dataOf('NVDA', NVDA, i);
})();
const fridayCase = (() => {
    const i = NVDA.findIndex(
        (b, k) => k > 520 && new Date(b.time * 1000).getUTCDay() === 5
    );
    return dataOf('NVDA', NVDA, i);
})();

describe('W1: the printed weekly rows', () => {
    it('passes when every row equals the own aggregation', () => {
        expect(
            checkWeeklyRows(
                sample(midWeek, weeklyRowsSection(midWeek)),
                midWeek
            )
        ).toEqual({
            failures: [],
            notComputable: null,
        });
    });

    it('names each figure that differs, the count and an unparsed row', () => {
        const section = weeklyRowsSection(midWeek);
        const rows = section.split('\n');
        const last = rows.length - 1;
        const open = (r: string): string => r.replace(/O:\S+/, 'O:1.00');
        const mutated = (edit: (r: string) => string): readonly string[] =>
            checkWeeklyRows(
                sample(
                    midWeek,
                    [...rows.slice(0, last), edit(rows[last])].join('\n')
                ),
                midWeek
            ).failures;
        expect(mutated(open)).toEqual(['open']);
        expect(mutated(r => r.replace(/H:\S+/, 'H:1.00'))).toEqual(['high']);
        expect(mutated(r => r.replace(/L:\S+/, 'L:99999.00'))).toEqual(['low']);
        expect(mutated(r => r.replace(/C:\S+/, 'C:1.00'))).toEqual(['close']);
        expect(mutated(r => r.replace(/V:[\d,]+/, 'V:1'))).toEqual(['volume']);
        expect(mutated(r => r.replace(/\[ts:\d+\]/, '[ts:86400]'))).toEqual([
            'time',
        ]);
        expect(mutated(r => r.replace('[ts:', '[ts:x'))).toEqual(
            expect.arrayContaining(['unparsedRows', 'rowCount'])
        );
        const fewer = checkWeeklyRows(
            sample(midWeek, rows.slice(0, -2).join('\n')),
            midWeek
        );
        expect(fewer.failures).toEqual(['rowCount']);
        const redeclared = rows
            .slice(0, -2)
            .join('\n')
            .replace(/Last \d+ bars/, 'Last 24 bars');
        expect(
            checkWeeklyRows(sample(midWeek, redeclared), midWeek).failures
        ).toEqual(['rowCount', 'declaredCount']);
    });

    it('is not computable when no row can be read', () => {
        expect(
            checkWeeklyRows(sample(midWeek, '## nothing'), midWeek)
                .notComputable
        ).toMatch(/no bar row/);
    });

    it('accepts a Korean price at its tick and refuses one a tick away', () => {
        const kr = dataOf('005930.KS', KR, 560);
        const section = weeklyRowsSection(kr);
        expect(checkWeeklyRows(sample(kr, section), kr).failures).toEqual([]);
        const moved = section.replace(
            /(\[ts:\d+\][^\n]*? O:)(\d+)/,
            (_, head: string, n: string) => `${head}${Number(n) + 100}`
        );
        expect(checkWeeklyRows(sample(kr, moved), kr).failures).toEqual([
            'open',
        ]);
    });

    it('checks the figures that depend on the whole series, not only the printed rows', () => {
        const section = weeklyRowsSection(midWeek);
        const failuresOf = (edit: (s: string) => string) =>
            checkWeeklyRows(sample(midWeek, edit(section)), midWeek).failures;
        expect(
            failuresOf(s => s.replace(/\((\d+) bars total\)/, '(9 bars total)'))
        ).toEqual(['seriesLength']);
        expect(
            failuresOf(s => s.replace(/Period High: \S+/, 'Period High: 1.00'))
        ).toEqual(['periodHigh']);
        expect(
            failuresOf(s =>
                s.replace(/(Period Low: \S+ \()\d{4}-\d\d-\d\d/, '$12000-01-03')
            )
        ).toEqual(['periodLow']);
        expect(
            failuresOf(s =>
                s.replace(/Period Return: \S+%/, 'Period Return: 9999.00%')
            )
        ).toEqual(['periodReturn']);
        expect(
            failuresOf(s => s.replace(/## Long-term Context[\s\S]*?\n\n/, ''))
        ).toEqual(['longTermMissing']);
    });
});

describe('W2: the unfinished week', () => {
    it("passes with the tag mid-week and without it on the week's last session", () => {
        expect(weekProgressOf(midWeek)?.inProgress).toBe(true);
        expect(
            checkWeekTag(sample(midWeek, weeklyRowsSection(midWeek)), midWeek)
                .failures
        ).toEqual([]);
        expect(weekProgressOf(fridayCase)?.inProgress).toBe(false);
        expect(
            checkWeekTag(
                sample(fridayCase, weeklyRowsSection(fridayCase)),
                fridayCase
            ).failures
        ).toEqual([]);
    });

    it('fails a missing tag, a wrong count and a tag on a finished week', () => {
        const section = weeklyRowsSection(midWeek);
        const stripped = section.replace(/ \(week in progress[^)]*\)/, '');
        expect(
            checkWeekTag(sample(midWeek, stripped), midWeek).failures
        ).toContain('lastRowTag');
        const wrong = section.replace(
            /(\d+) of (\d+) sessions/,
            '9 of 9 sessions'
        );
        expect(
            checkWeekTag(sample(midWeek, wrong), midWeek).failures
        ).toContain('lastRowTag');
        const tagged = weeklyRowsSection(fridayCase).replace(
            '[음봉]',
            '[음봉] (week in progress: 5 of 5 sessions so far; its close is the latest price)'
        );
        expect(
            checkWeekTag(sample(fridayCase, tagged), fridayCase).failures
        ).toEqual(expect.arrayContaining(['taggedRows']));
    });

    it('is not computable when the week is still open at the end of the stored bars', () => {
        const i = NVDA.findIndex(
            (b, k) => k > 520 && new Date(b.time * 1000).getUTCDay() === 2
        );
        const open: HtfCaseData = {
            ...dataOf('NVDA', NVDA, i),
            bars: NVDA.slice(0, i + 2),
        };
        expect(weekProgressOf(open)).toMatchObject({
            inProgress: true,
            totalKnown: false,
        });
        expect(
            checkWeekTag(sample(open, weeklyRowsSection(open)), open)
                .notComputable
        ).toMatch(/total is unknown/);
        expect(
            checkHigherBlock(
                sample(open, higherBlockText(open, '1Week')),
                open,
                '1Week'
            ).notComputable
        ).toMatch(/total is unknown/);
        expect(
            checkAttachedReading({ kind: 'monthly' }, open, '1Week')
                .notComputable
        ).toMatch(/total is unknown/);
    });

    it('is not computable on the last stored bar or without rows', () => {
        const last = dataOf('NVDA', NVDA, NVDA.length - 1);
        expect(
            checkWeekTag(sample(last, weeklyRowsSection(last)), last)
                .notComputable
        ).toMatch(/last stored bar/);
        expect(
            checkWeekTag(sample(midWeek, '## x'), midWeek).notComputable
        ).toMatch(/no bar row/);
    });
});

describe('H1: the printed higher-timeframe block', () => {
    it('passes a correct weekly block on a daily prompt and a monthly block on a weekly prompt, mid-week and on the last session', () => {
        [midWeek, fridayCase].forEach(data => {
            expect(
                checkHigherBlock(
                    sample(data, higherBlockText(data, '1Day')),
                    data,
                    '1Day'
                ).failures
            ).toEqual([]);
            expect(
                checkHigherBlock(
                    sample(data, higherBlockText(data, '1Week')),
                    data,
                    '1Week'
                ).failures
            ).toEqual([]);
        });
    });

    const block = higherBlockText(midWeek, '1Day');
    const failuresOf = (text: string) =>
        checkHigherBlock(sample(midWeek, text), midWeek, '1Day').failures;

    it('names the figure that differs', () => {
        expect(
            failuresOf(block.replace(/EMA20 moved \S+/, 'EMA20 moved +9.99'))
        ).toContain('slopeAtr');
        expect(failuresOf(block.replace(/\(from \S+/, '(from 1.00'))).toContain(
            'emaFrom'
        );
        expect(failuresOf(block.replace(/ to \S+\)/, ' to 1.00)'))).toContain(
            'emaLast'
        );
        expect(
            failuresOf(
                block.replace(/weekly close [\d.]+ is/, 'weekly close 1.00 is')
            )
        ).toContain('close');
        expect(
            failuresOf(block.replace(/RSI\(14\) \S+/, 'RSI(14) 1.0;'))
        ).toContain('rsi14');
        expect(
            failuresOf(
                block.replace(/close [\d.]+% (above|below)/, 'close 99.9% $1')
            )
        ).toContain('closeVsMa50');
        expect(
            failuresOf(
                block.replace(/\((\d+) of (\d+) sessions/, '(9 of 9 sessions')
            )
        ).toContain('progress');
        expect(
            failuresOf(
                block
                    .replace(/: (aligned|opposed|mixed)\./, ': mixed.')
                    .replace(': mixed.: mixed.', ': mixed.')
            )
        ).toEqual(expect.any(Array));
    });

    it('fails a trend label, an alignment and the wrong kind', () => {
        const label = /Weekly trend: (bullish|bearish|neutral)/.exec(
            block
        )?.[1];
        const other = label === 'bullish' ? 'bearish' : 'bullish';
        expect(
            failuresOf(
                block.replace(
                    `Weekly trend: ${label}`,
                    `Weekly trend: ${other}`
                )
            )
        ).toContain('trend');
        const align = /: (aligned|opposed|mixed)\./.exec(block)?.[1];
        const otherAlign = align === 'aligned' ? 'opposed' : 'aligned';
        expect(
            failuresOf(block.replace(`: ${align}.`, `: ${otherAlign}.`))
        ).toContain('alignment');
        expect(failuresOf(higherBlockText(midWeek, '1Week'))).toContain('kind');
    });

    it('fails a missing block, a line it cannot read, and a progress sentence on a finished week', () => {
        expect(failuresOf('## nothing')).toEqual(['blockMissing']);
        expect(failuresOf(`${block}\nA surprise line.`)).toContain(
            'unparsedLines'
        );
        const friday = checkHigherBlock(
            sample(
                fridayCase,
                `${higherBlockText(fridayCase, '1Day')}\nThe last weekly bar is the current week (4 of 5 sessions so far).`
            ),
            fridayCase,
            '1Day'
        );
        expect(friday.failures).toContain('progressPrintedButFinished');
    });

    it('matches the not-measurable form against the bars received, and fails a trend printed where the own one is null', () => {
        const short = dataOf('NVDA', NVDA, 150);
        const text = higherBlockText(short, '1Day');
        expect(text).toContain('Not measurable');
        expect(
            checkHigherBlock(sample(short, text), short, '1Day').failures
        ).toEqual([]);
        const wrongCount = text.replace(/received \d+ bars/, 'received 3 bars');
        expect(
            checkHigherBlock(sample(short, wrongCount), short, '1Day').failures
        ).toContain('receivedBars');
        const printed = checkHigherBlock(
            sample(short, higherBlockText(midWeek, '1Day')),
            short,
            '1Day'
        );
        expect(printed.failures).toContain('trendPrintedButNotMeasurable');
    });

    it('is not computable for a timeframe without a higher one', () => {
        expect(
            checkHigherBlock(sample(midWeek, block), midWeek, '1Hour')
                .notComputable
        ).toMatch(/no higher timeframe/);
    });
});

describe('H4: the printed market backdrop', () => {
    const text = backdropBlockText(midWeek);
    const failuresOf = (t: string, data: HtfCaseData = midWeek) =>
        checkBackdrop(sample(data, t), data).failures;

    it('passes a correct block', () => {
        expect(text).toContain('Market Backdrop');
        expect(failuresOf(text)).toEqual([]);
    });

    it('names the figure that differs', () => {
        expect(
            failuresOf(
                text.replace(
                    /trend (bullish|bearish|neutral)/,
                    'trend not measurable'
                )
            )
        ).toContain('trend');
        expect(
            failuresOf(
                text.replace(/close [\d.]+% (above|below)/, 'close 99.9% $1')
            )
        ).toContain('closeVsMa200');
        expect(
            failuresOf(
                text.replace(
                    /last 20 sessions: \S+%/,
                    'last 20 sessions: +99.9%'
                )
            )
        ).toContain('relative20');
        expect(
            failuresOf(
                text.replace(
                    /last 60 sessions: \S+% vs \S+%/,
                    'last 60 sessions: +1.0% vs +1.0%'
                )
            )
        ).toContain('relative60');
        expect(
            failuresOf(text.replace(/both to \S+\)/, 'both to 2020-01-01)'))
        ).toContain('endDate');
        expect(
            failuresOf(text.replace('S&P 500 (SPY)', 'The Index'))
        ).toContain('label');
        expect(failuresOf(`${text}\nIndex level 5,432.10`)).toEqual(
            expect.arrayContaining(['unparsedLines', 'indexPrice'])
        );
    });

    it('fails a missing block, and a backdrop of the benchmark on itself', () => {
        expect(failuresOf('## nothing')).toEqual(['blockMissing']);
        const spy = dataOf('SPY', SPY, 560);
        expect(failuresOf('## nothing', spy)).toEqual([]);
        expect(failuresOf(text, spy)).toEqual(['backdropOnItself']);
    });

    it('is not computable without the benchmark bars', () => {
        const kr = {
            ...dataOf('005930.KS', KR, 560),
            benchmarks: new Map<string, typeof SPY>(),
        };
        expect(checkBackdrop(sample(kr, text), kr).notComputable).toMatch(
            /KS11/
        );
    });
});

describe('H1: a week or month a closure cut short, in a market with no holiday calendar', () => {
    /** KR bars with one weekday removed (a closure the stored bars show and core cannot know). */
    const withoutDay = (removeAt: number): typeof KR =>
        KR.filter((_, k) => k !== removeAt);

    // The Friday of a week is closed: the case is that week's Thursday, its stored week has four sessions.
    const week = (() => {
        const thursday = KR.findIndex(
            (b, k) => k > 520 && new Date(b.time * 1000).getUTCDay() === 4
        );
        const bars = withoutDay(thursday + 1);
        return dataOf('005930.KS', bars, thursday);
    })();
    const weekText = higherBlockText(week, '1Day');
    const failuresOfWeek = (line: string) =>
        checkHigherBlock(sample(week, `${weekText}\n${line}`), week, '1Day')
            .failures;

    it('accepts the observed count with no total, which is what core prints without a calendar', () => {
        expect(
            failuresOfWeek(
                'The last weekly bar is the current week (4 sessions so far).'
            )
        ).toEqual([]);
    });

    it('still fails a count that is not the observed one, and a total core cannot prove', () => {
        expect(
            failuresOfWeek(
                'The last weekly bar is the current week (3 sessions so far).'
            )
        ).toContain('progressPrintedButFinished');
        expect(
            failuresOfWeek(
                'The last weekly bar is the current week (4 of 4 sessions so far).'
            )
        ).toContain('progressPrintedButFinished');
    });

    it('does not excuse a market with a calendar', () => {
        const printed = checkHigherBlock(
            sample(
                fridayCase,
                `${higherBlockText(fridayCase, '1Day')}\nThe last weekly bar is the current week (5 sessions so far).`
            ),
            fridayCase,
            '1Day'
        );
        expect(printed.failures).toContain('progressPrintedButFinished');
    });

    it('does not excuse a full week of a market with no calendar', () => {
        const friday = KR.findIndex(
            (b, k) => k > 520 && new Date(b.time * 1000).getUTCDay() === 5
        );
        const full = dataOf('005930.KS', KR, friday);
        const printed = checkHigherBlock(
            sample(
                full,
                `${higherBlockText(full, '1Day')}\nThe last weekly bar is the current week (5 sessions so far).`
            ),
            full,
            '1Day'
        );
        expect(printed.failures).toContain('progressPrintedButFinished');
    });

    it('lets the attached reading say the cut-short week is forming, and fails it for a market with a calendar', () => {
        const long = windowBars(
            week.bars,
            week.replayCase.asOf,
            C.longWindowDays
        );
        const own = higherReading({
            kind: 'weekly',
            analysisBars: windowBars(
                week.bars,
                week.replayCase.asOf,
                C.dailyWindowDays
            ),
            higherBars: aggregateWeeks(long),
            progress: periodProgress(
                week.bars,
                week.replayCase.asOf,
                isoWeekStart
            ),
        });
        const reading = {
            kind: 'weekly',
            trend: own.trend?.trend ?? null,
            slopeAtr: own.trend?.slopeAtr ?? null,
            rsi14: Math.round((own.rsi14 ?? 0) * 10) / 10,
            closeVsMa50Pct: Math.round((own.closeVsMa50Pct ?? 0) * 10) / 10,
            bars: own.bars,
            alignment: own.alignment,
        };
        expect(
            checkAttachedReading(
                { ...reading, lastBarInProgress: true },
                week,
                '1Day'
            ).failures
        ).toEqual([]);
        expect(
            checkAttachedReading(
                { ...reading, lastBarInProgress: false },
                week,
                '1Day'
            ).failures
        ).toEqual([]);
        // A calendar market's finished week is never forming.
        expect(
            checkAttachedReading(
                { ...reading, lastBarInProgress: true },
                fridayCase,
                '1Day'
            ).failures
        ).toContain('lastBarInProgress');
    });

    it('applies to a month the closure cut short, on a weekly chart', () => {
        // The last weekday of a month is closed; the case is the session before it.
        const lastWeekday = KR.findIndex((b, k) => {
            const d = new Date(b.time * 1000);
            const next = KR[k + 1];
            return (
                k > 520 &&
                next !== undefined &&
                new Date(next.time * 1000).getUTCMonth() !== d.getUTCMonth()
            );
        });
        const bars = withoutDay(lastWeekday);
        const month = dataOf('005930.KS', bars, lastWeekday - 1);
        const text = higherBlockText(month, '1Week');
        const sessions = periodProgress(
            bars,
            month.replayCase.asOf,
            monthStart
        )?.sessionsSoFar;
        expect(
            checkHigherBlock(
                sample(
                    month,
                    `${text}\nThe last monthly bar is the current month (${sessions} sessions so far).`
                ),
                month,
                '1Week'
            ).failures
        ).toEqual([]);
    });
});

describe('H1b: the attached reading', () => {
    const asOf = midWeek.replayCase.asOf;
    const long = windowBars(NVDA, asOf, C.longWindowDays);
    const own = higherReading({
        kind: 'weekly',
        analysisBars: windowBars(NVDA, asOf, C.dailyWindowDays),
        higherBars: aggregateWeeks(long),
        progress: periodProgress(NVDA, asOf, isoWeekStart),
    });
    const reading = {
        kind: 'weekly',
        trend: own.trend?.trend ?? null,
        slopeAtr: own.trend?.slopeAtr ?? null,
        rsi14: Math.round((own.rsi14 ?? 0) * 10) / 10,
        closeVsMa50Pct: Math.round((own.closeVsMa50Pct ?? 0) * 10) / 10,
        lastBarInProgress: true,
        bars: own.bars,
        alignment: own.alignment,
    };

    it('passes the reading code attached', () => {
        expect(checkAttachedReading(reading, midWeek, '1Day').failures).toEqual(
            []
        );
    });

    it('names each figure that differs and fails a missing reading', () => {
        const failures = checkAttachedReading(
            {
                ...reading,
                kind: 'daily',
                trend: 'x',
                slopeAtr: 99,
                rsi14: 1,
                closeVsMa50Pct: 1000,
                lastBarInProgress: false,
                bars: 1,
                alignment: 'nope',
            },
            midWeek,
            '1Day'
        ).failures;
        expect(failures).toEqual([
            'kind',
            'trend',
            'slopeAtr',
            'rsi14',
            'closeVsMa50Pct',
            'lastBarInProgress',
            'bars',
            'alignment',
        ]);
        expect(checkAttachedReading(null, midWeek, '1Day').failures).toEqual([
            'readingMissing',
        ]);
        expect(
            checkAttachedReading(reading, midWeek, '1Hour').notComputable
        ).toMatch(/no higher timeframe/);
    });

    it('reads a null figure as null', () => {
        const short = dataOf('NVDA', NVDA, 150);
        const shortLong = windowBars(
            NVDA,
            short.replayCase.asOf,
            C.longWindowDays
        );
        const shortOwn = higherReading({
            kind: 'weekly',
            analysisBars: windowBars(
                NVDA,
                short.replayCase.asOf,
                C.dailyWindowDays
            ),
            higherBars: aggregateWeeks(shortLong),
            progress: null,
        });
        expect(shortOwn.trend).toBeNull();
        const nullReading = {
            kind: 'weekly',
            trend: null,
            slopeAtr: null,
            rsi14: Math.round((shortOwn.rsi14 ?? 0) * 10) / 10,
            closeVsMa50Pct: shortOwn.closeVsMa50Pct,
            lastBarInProgress:
                periodProgress(NVDA, short.replayCase.asOf, isoWeekStart)
                    ?.inProgress ?? false,
            bars: shortOwn.bars,
            alignment: null,
        };
        expect(
            checkAttachedReading(nullReading, short, '1Day').failures
        ).toEqual([]);
    });
});

describe('identity against an earlier render', () => {
    const a = sample(
        midWeek,
        promptOf('## A\nx', higherBlockText(midWeek, '1Day'), '## B\ny')
    );
    const withoutBlock = sample(midWeek, promptOf('## A\nx', '## B\ny'));

    it('compares raw and stripped hashes beside each other', () => {
        const before = [hashRowOf(withoutBlock)];
        const identity = compareIdentity([hashRowOf(a)], before);
        expect(identity.rawEqual).toBe(0);
        expect(identity.strippedEqual).toBe(1);
        expect(identity.stableEqual).toBe(1);
        expect(identity.firstDifferences).toEqual([`${a.caseId}#member`]);
        expect(identityGate('H2a', 'raw', identity, 1).pass).toBe(false);
        expect(identityGate('H2b', 'stripped', identity, 1).pass).toBe(true);
    });

    it('passes both when nothing changed and fails closed on an unmatched population or no baseline', () => {
        const same = compareIdentity(
            [hashRowOf(withoutBlock)],
            [hashRowOf(withoutBlock)]
        );
        expect(identityGate('H2a', 'raw', same, 1).pass).toBe(true);
        const missing = compareIdentity(
            [hashRowOf(withoutBlock), hashRowOf(sample(midWeek, 'x', 'free'))],
            [hashRowOf(withoutBlock)]
        );
        expect(missing.unmatched).toBe(1);
        expect(identityGate('H2a', 'raw', missing, 2).pass).toBeNull();
        expect(identityGate('H2a', 'raw', null, 1).pass).toBeNull();
        const changedStable = compareIdentity(
            [{ ...hashRowOf(withoutBlock), stableSha256: 'z' }],
            [hashRowOf(withoutBlock)]
        );
        expect(identityGate('H2a', 'raw', changedStable, 1).pass).toBe(false);
    });
});

describe('gates over a population', () => {
    const pass: Check = { failures: [], notComputable: null };
    const row = (check: Check, caseId = 'c') => ({
        caseId,
        tier: 'member' as const,
        check,
    });

    it('passes only when every sample passed', () => {
        expect(checkGate('X', 'd', [row(pass), row(pass)]).pass).toBe(true);
    });

    it('fails on a failure, and is not computable when a sample could not be judged or none exist', () => {
        expect(
            checkGate('X', 'd', [
                row(pass),
                row({ failures: ['a'], notComputable: null }),
            ]).pass
        ).toBe(false);
        expect(
            checkGate('X', 'd', [
                row(pass),
                row({ failures: [], notComputable: 'why' }),
            ]).pass
        ).toBeNull();
        expect(
            checkGate('X', 'd', [
                row({ failures: ['a'], notComputable: null }),
                row({ failures: [], notComputable: 'why' }),
            ]).pass
        ).toBe(false);
        expect(checkGate('X', 'd', []).pass).toBeNull();
    });

    it('summarizes by figure with examples', () => {
        const s = summarizeChecks([
            row(pass),
            row({ failures: ['a', 'b'], notComputable: null }, 'c2'),
            row({ failures: ['a'], notComputable: null }, 'c3'),
        ]);
        expect(s).toMatchObject({
            samples: 3,
            passed: 1,
            failed: 2,
            byFigure: { a: 2, b: 1 },
        });
        expect(s.examples[0]).toBe('c2#member: a,b');
    });
});
