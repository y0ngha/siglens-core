import { describe, expect, it } from 'vitest';
import {
    DAILY_ONLY_PATTERNS,
    WEEKLY_HORIZONS,
    checkWeeklyHygiene,
    hygieneExtras,
    injectionRates,
    k1Gate,
    k2Gate,
} from '../../../../scripts/replay/htfEvalWeekly';
import {
    HTF_EVAL_CONSTANTS as C,
    aggregateWeeks,
    isoWeekStart,
    periodProgress,
    windowBars,
} from '../../../../scripts/replay/htfEvalCompute';
import type {
    HtfCaseData,
    HtfSample,
} from '../../../../scripts/replay/htfEvalGates';
import type { ReplayCase } from '../../../../scripts/replay/types';
import { promptOf, weeklyRowsSection } from './htfFixtures';
import { tradingBars } from './replayFixtures';

const NVDA = tradingBars({
    symbol: 'NVDA',
    startIso: '2020-01-02',
    count: 700,
    close: i => 100 + 0.4 * i + 8 * Math.sin(i / 11),
});
const iso = (t: number): string =>
    new Date(t * 1000).toISOString().slice(0, 10);

function dataAt(index: number): HtfCaseData {
    const asOf = iso(NVDA[index].time);
    const replayCase: ReplayCase = {
        caseId: `NVDA|${asOf}`,
        symbol: 'NVDA',
        timeframe: '1Day',
        asOf,
        regime: 'range',
        variance: false,
    };
    return { replayCase, bars: NVDA, benchmarks: new Map() };
}
const wednesday = NVDA.findIndex(
    (b, k) => k > 520 && new Date(b.time * 1000).getUTCDay() === 3
);
const data = dataAt(wednesday);

/** The pivot source: the bar before the unfinished last week. */
function pivotLines(): string {
    const weeks = aggregateWeeks(
        windowBars(NVDA, data.replayCase.asOf, C.longWindowDays)
    );
    const progress = periodProgress(NVDA, data.replayCase.asOf, isoWeekStart);
    const src = progress?.inProgress
        ? weeks[weeks.length - 2]
        : weeks[weeks.length - 1];
    const p = (src.high + src.low + src.close) / 3;
    return [
        `- ${p.toFixed(2)} (Pivot PP; 1.41% away)`,
        `- ${(2 * p - src.low).toFixed(2)} (Pivot R1; 3.00% away)`,
        `- ${(2 * p - src.high).toFixed(2)} (Pivot S1; 4.00% away)`,
    ].join('\n');
}

const FEAR = '## Fear & Greed Index (Reference)\nIndex 55 (greed)';

const weeklyText = (): string =>
    promptOf(
        'Timeframe: Weekly\nTimeframe interpretation: Weekly chart built by SIGLENS from daily bars: each bar is one ISO week (Monday start). Readings describe a multi-week picture.',
        weeklyRowsSection(data),
        `## Market Reference (deterministic · advisory)\n${WEEKLY_HORIZONS.map(h => `${h.header}\n${pivotLines()}`).join('\n')}`,
        FEAR
    );
const dailyText = (): string =>
    promptOf(
        'Timeframe: Daily\nTimeframe interpretation: Daily chart of daily bars.',
        FEAR
    );

const sample = (dynamic: string): HtfSample => ({
    caseId: data.replayCase.caseId,
    tier: 'member',
    stable: 's',
    dynamic,
});
const check = (weekly: string, daily = dailyText()) =>
    checkWeeklyHygiene(sample(weekly), sample(daily), data);

describe('K1: weekly hygiene', () => {
    it('passes a clean weekly prompt', () => {
        expect(check(weeklyText())).toEqual({
            failures: [],
            notComputable: null,
            pivotsChecked: 3 * WEEKLY_HORIZONS.length,
        });
    });

    it('names a VWAP line and a VWAP level', () => {
        expect(check(`${weeklyText()}\n- VWAP: 12.30`).failures).toContain(
            'vwapLine'
        );
        expect(
            check(weeklyText().replace('(Pivot PP;', '(VWAP; Pivot PP;'))
                .failures
        ).toContain('vwapLevel');
    });

    it('does not mistake an anchored VWAP level or skill prose for the session VWAP and the pullback block', () => {
        const text = weeklyText().replace(
            '(Pivot PP;',
            '(AVWAP (swing high); Pivot PP;'
        );
        const withProse = `On daily charts, ## Deterministic Metrics prints a \`### Short-term sell-off check (computed, 1Day bars)\` block; intraday caveat.\n${text}`;
        expect(check(withProse).failures).toEqual([]);
    });

    it('names each registered daily-only sentence', () => {
        const samples: Record<string, string> = {
            candleReliability:
                'Descriptive only: on daily bars, candle labels showed no forward edge over matched random dates',
            stopSpacingBacktest:
                'Measured in a two-year daily backtest of this prompt (10 U.S. large caps)',
            dailyConfluenceReliability:
                'Daily, descriptive only — measured 2000–2026, days',
            pullbackBlock:
                '### Short-term sell-off check (computed, 1Day bars)',
            dailyIntervalLabel: 'Timeframe: Daily',
            baseRateEngineLine:
                '- Measured on this engine (65 symbols, daily 2018–2026): the target came first',
            baseRateLabel:
                '### Double Top [Measured: no edge over placebo, n=612]',
            baseRatePooledLabel:
                '### Doji [Measured over every candle: no edge, n=1,000]',
            baseRateNotMeasuredLabel:
                '### Doji [Not measured on intraday bars]',
            baseRateNotMeasuredLine: '- Not measured on intraday bars.',
            baseRateWritingRuleMeasured:
                "; when you mention reliability, cite the Measured label in its guide's header instead.",
            baseRateWritingRuleNotMeasured:
                '; reliability was not measured on intraday bars, so do not state any.',
            levelHoldMeasured:
                'Measured on 65 symbols (U.S. and Korean), daily bars 2018–2026: after price',
            levelHoldNotMeasured:
                'Not measured on intraday bars. Treat these levels as a map',
            intradayConfluenceReliability:
                'Intraday, descriptive only — the rule has no measured forward edge',
            unmeasuredNamesOtherBars: 'This is Not measured on daily bars.',
        };
        expect(Object.keys(samples).toSorted()).toEqual(
            DAILY_ONLY_PATTERNS.map(p => p.name).toSorted()
        );
        DAILY_ONLY_PATTERNS.forEach(({ name }) => {
            expect(
                check(`${weeklyText()}\n${samples[name]}`).failures
            ).toContain(`dailyOnly:${name}`);
        });
    });

    it('flags the daily interpretation line even without the Timeframe: Daily label', () => {
        expect(
            check(
                `${weeklyText()}\nTimeframe interpretation: Daily chart of daily bars: each bar is one full session.`
            ).failures
        ).toContain('dailyOnly:dailyIntervalLabel');
    });

    it('accepts the weekly wording of the unmeasured sentences', () => {
        const text = `- Not measured on weekly bars.\n### Doji [Not measured on weekly bars]\n; reliability was not measured on weekly bars, so do not state any.\nNot measured on weekly bars. Treat these levels as a map\n${weeklyText()}`;
        expect(check(text).failures).toEqual([]);
    });

    it('requires the weekly label and context, the weekly horizons and no daily horizon', () => {
        expect(
            check(weeklyText().replace('Timeframe: Weekly', 'Timeframe: Wk'))
                .failures
        ).toContain('weeklyLabel');
        expect(
            check(
                weeklyText().replace(
                    'Weekly chart built by SIGLENS from daily bars',
                    'Weekly chart'
                )
            ).failures
        ).toContain('weeklyContext');
        expect(
            check(
                weeklyText().replace(
                    '~5 months (20 bars)',
                    '~1 month (20 bars)'
                )
            ).failures
        ).toEqual(
            expect.arrayContaining([
                'dailyHorizon:### Short-term — ~1 month (20 bars)',
                'weeklyHorizonMissing:20',
            ])
        );
    });

    it('requires Monday date rows', () => {
        const text = weeklyText().replace(
            /(\[ts:)(\d+)(\])/,
            (_, a: string, t: string, c: string) =>
                `${a}${Number(t) + 86_400}${c}`
        );
        expect(check(text).failures).toContain('rowNotMondayDate');
        expect(
            check(
                weeklyText()
                    .replace('2020', '2020')
                    .replace(/ 00:00 \|/, ' 09:30 |')
            ).failures
        ).toContain('rowNotMondayDate');
        expect(
            check(
                weeklyText().replace(
                    /## Recent Bar Data[\s\S]*?\n## Market/,
                    '## Market'
                )
            ).failures
        ).toContain('noRows');
    });

    it('checks every printed pivot against the last finished week and ignores a list without pivots', () => {
        const wrong = weeklyText()
            .replace(/\((Pivot PP);/g, '($1;')
            .replace(/- (\d+\.\d\d) \(Pivot PP/g, '- 1.00 (Pivot PP');
        expect(check(wrong).failures).toContain('pivot:PP');
        const previousWeek = weeklyText().replace(
            /- \d+\.\d\d \(Pivot R1/g,
            '- 2.00 (Pivot R1'
        );
        expect(check(previousWeek).failures).toContain('pivot:R1');
        const noPivots = weeklyText().replace(/- \S+ \(Pivot [^\n]*\n?/g, '');
        expect(check(noPivots).failures).toEqual([]);
    });

    it("requires the Fear & Greed section to equal the daily render's", () => {
        expect(
            check(weeklyText(), dailyText().replace('Index 55', 'Index 20'))
                .failures
        ).toContain('fearGreedDiffers');
        expect(
            check(weeklyText().replace(FEAR, ''), dailyText()).failures
        ).toContain('fearGreedDiffers');
    });

    it('lets both renders omit Fear & Greed only where the daily history is too short to compute it', () => {
        const both = (d: HtfCaseData) =>
            checkWeeklyHygiene(
                sample(weeklyText().replace(FEAR, '')),
                sample(dailyText().replace(FEAR, '')),
                d
            ).failures;
        expect(both(data)).toContain('fearGreedAbsentUnexplained');
        const short = dataAt(200);
        expect(both(short)).not.toContain('fearGreedAbsentUnexplained');
        expect(both(short)).not.toContain('fearGreedDiffers');
    });

    it('counts the pivots it compared, and K1 is not computable when none was printed', () => {
        const printed = check(weeklyText());
        expect(printed.pivotsChecked).toBe(3 * WEEKLY_HORIZONS.length);
        const none = check(
            weeklyText().replace(/- \S+ \(Pivot [^\n]*\n?/g, '')
        );
        expect(none.pivotsChecked).toBe(0);
        const row = (check: typeof none) => ({
            caseId: 'c',
            tier: 'member' as const,
            check,
        });
        expect(k1Gate([row(printed)]).pass).toBe(true);
        expect(k1Gate([row(printed)]).value).toMatch(/9 pivot values compared/);
        expect(k1Gate([row(none)]).pass).toBeNull();
        expect(k1Gate([row({ ...none, failures: ['x'] })]).pass).toBe(false);
    });

    it('is not computable on the last stored bar', () => {
        const last = dataAt(NVDA.length - 1);
        expect(
            checkWeeklyHygiene(sample(weeklyText()), sample(dailyText()), last)
                .notComputable
        ).toMatch(/last stored bar/);
    });

    it('skips a horizon the weekly history is too short for', () => {
        const short = dataAt(160);
        const text = promptOf(
            'Timeframe: Weekly\nWeekly chart built by SIGLENS from daily bars: each bar is one ISO week',
            weeklyRowsSection(short),
            `## Market Reference (x)\n${WEEKLY_HORIZONS[0].header}`,
            FEAR
        );
        const result = checkWeeklyHygiene(
            sample(text),
            sample(dailyText()),
            short
        );
        expect(result.failures).not.toContain('weeklyHorizonMissing:156');
    });
});

describe('reported extras', () => {
    it('counts samples without a pivot, the absent Fear & Greed, the size ratio, Not measurable and a short weekly history', () => {
        const weekly = sample(
            `${weeklyText()
                .replace(FEAR, '')
                .replace(/- \S+ \(Pivot [^\n]*\n?/g, '')}\nNot measurable x`
        );
        const daily = sample(dailyText().replace(FEAR, ''));
        const extras = hygieneExtras([{ weekly, daily, data }]);
        expect(extras.noPivotPrinted).toBe(1);
        expect(extras.fearGreedAbsentBoth).toBe(1);
        expect(extras.notMeasurableWeekly).toBe(1);
        expect(extras.notMeasurableDaily).toBe(0);
        expect(extras.charsRatioMedian).toBeGreaterThan(1);
        expect(extras.weeklyMa200Null).toBe(
            aggregateWeeks(
                windowBars(NVDA, data.replayCase.asOf, C.longWindowDays)
            ).length < 200
                ? 1
                : 0
        );
        expect(hygieneExtras([]).charsRatioMedian).toBeNull();
    });
});

describe('K3: injection rates', () => {
    it('counts guides per sample and the mean qualified patterns', () => {
        const s1 = {
            caseId: 'a',
            tier: 'member' as const,
            stable: '',
            dynamic:
                '## Chart Pattern Candidates (computed)\n### double_top (confirmed)\n- Candidate id: x\n',
        };
        const s2 = {
            caseId: 'b',
            tier: 'member' as const,
            stable: '',
            dynamic: '',
        };
        const skills = new Map<string, readonly string[]>([
            ['a#member', ['RSI', 'MACD']],
            ['b#member', ['RSI']],
        ]);
        expect(injectionRates(skills, [s1, s2])).toEqual({
            n: 2,
            perGuide: { RSI: 2, MACD: 1 },
            meanQualifiedPatterns: 0.5,
        });
        expect(injectionRates(new Map(), []).meanQualifiedPatterns).toBeNull();
    });
});

describe('K2', () => {
    it('passes equal risk levels over the whole population', () => {
        expect(
            k2Gate(
                [
                    { caseId: 'a', weekly: 'high', daily: 'high' },
                    { caseId: 'b', weekly: 'low', daily: 'low' },
                ],
                2
            ).pass
        ).toBe(true);
    });

    it('fails a difference, and is not computable without runs or with a missing case or level', () => {
        expect(
            k2Gate([{ caseId: 'a', weekly: 'high', daily: 'low' }], 1).pass
        ).toBe(false);
        expect(k2Gate(null, 1).pass).toBeNull();
        expect(
            k2Gate([{ caseId: 'a', weekly: 'high', daily: 'high' }], 2).pass
        ).toBeNull();
        expect(
            k2Gate([{ caseId: 'a', weekly: undefined, daily: 'high' }], 1).pass
        ).toBeNull();
    });
});
