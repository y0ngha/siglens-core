import { describe, it, expect } from 'vitest';
import { buildMacroBriefingPrompt as buildMacroBriefingPromptRaw } from '@/domain/economy/macroBriefingPrompt';
import type { EconomySnapshot } from '@/domain/types';

// `buildMacroBriefingPrompt` now returns `{ stable, dynamic }` (spec §3.4
// assembly split) — this file's call sites predate the split and assert
// against the single legacy combined string (`stable + '\n\n' + dynamic`,
// exactly the string dispatch still sends as the `prompt` fallback field).
const buildMacroBriefingPrompt = (
    ...args: Parameters<typeof buildMacroBriefingPromptRaw>
): string => {
    const { stable, dynamic } = buildMacroBriefingPromptRaw(...args);
    return `${stable}\n\n${dynamic}`;
};

// `now` is required (spec 2026-09-18 — domain must never read the
// wall clock itself); this file's date-agnostic assertions pin an arbitrary
// fixed instant rather than depending on real time.
const DEFAULT_NOW = new Date('2026-06-15T00:00:00Z');

const SNAP: EconomySnapshot = {
    indicators: [
        {
            name: 'federalFunds',
            latest: { date: '2026-05-01', value: 3.63 },
            previous: { date: '2026-04-01', value: 3.58 },
            trend: [],
            unit: '%',
        },
        {
            name: 'inflationRate',
            latest: { date: '2026-06-15', value: 2.32 },
            previous: null,
            trend: [],
            unit: '%',
        },
    ],
    treasury: { date: '2026-06-15', year2: 4.07, year10: 4.47 },
    calendar: [
        {
            date: '2026-06-17 14:00:00',
            event: 'Fed Rate Decision',
            impact: 'High',
            actual: null,
            estimate: 3.63,
            previous: 3.63,
            unit: '%',
        },
    ],
};

describe('buildMacroBriefingPrompt', () => {
    it('지표·2s10s·임박 캘린더를 프롬프트에 포함', () => {
        const p = buildMacroBriefingPrompt(SNAP, DEFAULT_NOW);
        expect(p).toContain('federalFunds');
        expect(p).toContain('3.63');
        expect(p).toContain('Fed Rate Decision');
        expect(p).toContain('0.40'); // 2s10s = 4.47 - 4.07
    });

    it('스키마(JSON 필드)·데이터 경계 지시 포함', () => {
        const p = buildMacroBriefingPrompt(SNAP, DEFAULT_NOW);
        expect(p).toContain('"regime"');
        expect(p).toContain('Data Boundary');
    });

    it('빈 스냅샷에도 throw 없이 문자열 반환', () => {
        const p = buildMacroBriefingPrompt(
            {
                indicators: [],
                treasury: null,
                calendar: [],
            },
            DEFAULT_NOW
        );
        expect(typeof p).toBe('string');
        expect(p.length).toBeGreaterThan(0);
        expect(p).toContain('(없음)');
    });

    it('latest=null 지표는 N/A, treasury=null이면 2s10s N/A', () => {
        const p = buildMacroBriefingPrompt(
            {
                indicators: [
                    { name: 'GDP', latest: null, previous: null, trend: [] },
                ],
                treasury: null,
                calendar: [],
            },
            DEFAULT_NOW
        );
        expect(p).toContain(
            'Gross domestic product [GDP] (unit: USD trillion): N/A'
        );
        expect(p).toContain('2s10s 스프레드: N/A');
    });

    it('estimate=null 캘린더 이벤트는 예상=N/A로 표기', () => {
        const p = buildMacroBriefingPrompt(
            {
                indicators: [],
                treasury: null,
                calendar: [
                    {
                        date: '2026-06-17 14:00:00',
                        event: 'Fed Rate Decision',
                        impact: 'High',
                        actual: null,
                        estimate: null,
                        previous: null,
                        unit: '%',
                    },
                ],
            },
            DEFAULT_NOW
        );
        expect(p).toContain('예상=N/A');
    });
});

describe('buildMacroBriefingPrompt numeric rendering', () => {
    it('strips binary float noise from indicator values', () => {
        const [first, ...rest] = SNAP.indicators;
        const latest = first.latest!;
        const p = buildMacroBriefingPrompt(
            {
                ...SNAP,
                indicators: [
                    {
                        ...first,
                        latest: { ...latest, value: 3.4000000000000004 },
                    },
                    ...rest,
                ],
            },
            DEFAULT_NOW
        );
        expect(p).not.toContain('3.4000000000000004');
        expect(p).toContain(`: 3.4% (${latest.date})`);
    });
});

describe('buildMacroBriefingPrompt — indicator delta + calendar days-until (spec 2026-09-18 §2.10)', () => {
    const NOW = new Date('2026-06-15T00:00:00Z');

    it('renders a signed delta (latest − previous) next to the previous value, in pp for a rate-type series', () => {
        const p = buildMacroBriefingPromptRaw(SNAP, NOW).dynamic;
        // 3.63 - 3.58 = 0.05; unit '%' -> percentage-point delta, no % term (spec §B3/§B7).
        expect(p).toContain(
            'Effective federal funds rate (monthly average) [federalFunds] (unit: %): 3.63% (2026-05-01) ← 3.58% (Δ +0.05pp)'
        );
    });

    it('renders no delta when previous is null', () => {
        const p = buildMacroBriefingPromptRaw(SNAP, NOW).dynamic;
        expect(p).toContain(
            'Inflation rate (year over year) [inflationRate] (unit: %): 2.32% (2026-06-15)'
        );
        expect(p).not.toMatch(/inflationRate\]:[^\n]*Δ/);
    });

    it('renders a negative delta, in pp for a rate-type series', () => {
        const p = buildMacroBriefingPromptRaw(
            {
                ...SNAP,
                indicators: [
                    {
                        name: 'unemploymentRate',
                        latest: { date: '2026-06-01', value: 3.9 },
                        previous: { date: '2026-05-01', value: 4.1 },
                        trend: [],
                        unit: '%',
                    },
                ],
            },
            NOW
        ).dynamic;
        expect(p).toContain('(Δ -0.20pp)');
    });

    it('renders a level-type series (no unit) with both the delta and a % change', () => {
        const p = buildMacroBriefingPromptRaw(
            {
                ...SNAP,
                indicators: [
                    {
                        name: 'industrialProductionIndex',
                        latest: { date: '2026-06-01', value: 103.5 },
                        previous: { date: '2026-05-01', value: 102.0 },
                        trend: [],
                    },
                ],
            },
            NOW
        ).dynamic;
        // (103.5 - 102) = +1.5; +1.5 / 102 * 100 = +1.47%
        expect(p).toContain('(Δ +1.50, +1.47%)');
    });

    it('omits the % change term when previous <= 0 (zero-base guard, null rule §0)', () => {
        const p = buildMacroBriefingPromptRaw(
            {
                ...SNAP,
                indicators: [
                    {
                        name: 'netExports',
                        latest: { date: '2026-06-01', value: -10 },
                        previous: { date: '2026-05-01', value: 0 },
                        trend: [],
                    },
                ],
            },
            NOW
        ).dynamic;
        // both latest (-10) and previous (0) are integers -> integer-series
        // formatting (no forced 2dp, see the thousands-separator test below).
        expect(p).toContain('(Δ -10)');
        expect(p).not.toContain('(Δ -10,');
    });

    it('formats an integer-series delta with thousands separators and no decimals (spec §B3)', () => {
        const p = buildMacroBriefingPromptRaw(
            {
                ...SNAP,
                indicators: [
                    {
                        name: 'nonfarmPayrolls',
                        latest: { date: '2026-06-01', value: 150_000_000 },
                        previous: { date: '2026-05-01', value: 150_010_000 },
                        trend: [],
                    },
                ],
            },
            NOW
        ).dynamic;
        expect(p).toContain('(Δ -10,000,');
    });

    it('never renders -0.00pp for a rate-type delta that rounds to exactly zero (spec §B6)', () => {
        const p = buildMacroBriefingPromptRaw(
            {
                ...SNAP,
                indicators: [
                    {
                        name: 'federalFunds',
                        latest: { date: '2026-06-01', value: 3.5801 },
                        previous: { date: '2026-05-01', value: 3.58 },
                        trend: [],
                        unit: '%',
                    },
                ],
            },
            NOW
        ).dynamic;
        expect(p).not.toContain('-0.00pp');
        expect(p).toContain('(Δ +0.00pp)');
    });

    it('no delta when latest is null (previous still shown, delta omitted)', () => {
        const p = buildMacroBriefingPromptRaw(
            {
                ...SNAP,
                indicators: [
                    {
                        name: 'GDP',
                        latest: null,
                        previous: { date: '2026-01-01', value: 30_485 },
                        trend: [],
                    },
                ],
            },
            NOW
        ).dynamic;
        expect(p).toContain(
            '[GDP] (unit: USD trillion): N/A ← 30.49 USD trillion'
        );
        expect(p).not.toContain('N/A ← 30.49 USD trillion (Δ');
    });

    it('appends "(in N days)" to a future calendar event', () => {
        const p = buildMacroBriefingPromptRaw(
            {
                ...SNAP,
                calendar: [{ ...SNAP.calendar[0], date: '2026-06-20' }],
            },
            NOW
        ).dynamic;
        expect(p).toContain('2026-06-20 (in 5 days) Fed Rate Decision');
    });

    it('appends "(today, in Nh)" for a same-UTC-date event within 24h (spec §B3)', () => {
        const p = buildMacroBriefingPromptRaw(
            {
                ...SNAP,
                calendar: [{ ...SNAP.calendar[0], date: '2026-06-15' }],
            },
            NOW
        ).dynamic;
        expect(p).toContain('2026-06-15 (today, in <1h) Fed Rate Decision');
    });

    it('appends "(in Nh)" (no "today") for an event within 24h that falls on the next UTC date', () => {
        const lateNow = new Date('2026-06-15T20:00:00Z');
        const p = buildMacroBriefingPromptRaw(
            {
                ...SNAP,
                calendar: [
                    { ...SNAP.calendar[0], date: '2026-06-16 02:00:00' },
                ],
            },
            lateNow
        ).dynamic;
        expect(p).toContain(
            '2026-06-16 02:00:00 UTC (in 6h) Fed Rate Decision'
        );
    });

    it('parses a naive FMP datetime (no zone suffix) as UTC, not local time (spec §B3)', () => {
        // NOW is 2026-06-15T00:00:00Z; a naive '2026-06-15 12:00:00' event is
        // 12h away in UTC. Misparsing it as local time would shift the
        // computed offset by the runtime's UTC offset instead.
        const p = buildMacroBriefingPromptRaw(
            {
                ...SNAP,
                calendar: [
                    { ...SNAP.calendar[0], date: '2026-06-15 12:00:00' },
                ],
            },
            NOW
        ).dynamic;
        expect(p).toContain('(today, in 12h)');
    });

    it('renders an event earlier within 24h as "(Nh ago)", never "in 0 days" (cached snapshot)', () => {
        const lateNow = new Date('2026-06-15T20:00:00Z');
        const p = buildMacroBriefingPromptRaw(
            {
                ...SNAP,
                calendar: [
                    { ...SNAP.calendar[0], date: '2026-06-15 13:15:00' },
                ],
            },
            lateNow
        ).dynamic;
        expect(p).toContain(
            '2026-06-15 13:15:00 UTC (7h ago) Fed Rate Decision'
        );
        expect(p).not.toMatch(/in -?0 days/);
    });

    it('renders an event more than a day in the past as "(N days ago)"', () => {
        const p = buildMacroBriefingPromptRaw(
            {
                ...SNAP,
                calendar: [{ ...SNAP.calendar[0], date: '2026-06-12' }],
            },
            NOW
        ).dynamic;
        expect(p).toContain('2026-06-12 (3 days ago) Fed Rate Decision');
    });

    it('labels a naive FMP datetime with UTC but leaves a date-only row unlabelled', () => {
        const p = buildMacroBriefingPromptRaw(
            {
                ...SNAP,
                calendar: [
                    { ...SNAP.calendar[0], date: '2026-06-15 12:00:00' },
                    { ...SNAP.calendar[0], date: '2026-06-20' },
                ],
            },
            NOW
        ).dynamic;
        expect(p).toContain('2026-06-15 12:00:00 UTC (today, in 12h)');
        expect(p).toContain('2026-06-20 (in 5 days)');
        expect(p).not.toContain('2026-06-20 UTC');
    });

    it('`now` is required — domain never reads the wall clock itself (spec 2026-09-18)', () => {
        // A fixed 3-day-out date against a fixed `now`, not `Date.now()` —
        // this used to default `now` silently; that default is gone.
        const p = buildMacroBriefingPromptRaw(
            {
                ...SNAP,
                calendar: [{ ...SNAP.calendar[0], date: '2026-06-18' }],
            },
            NOW
        ).dynamic;
        expect(p).toContain('(in 3 days)');
    });
});

describe('buildMacroBriefingPrompt — unit registry rows (UX audit 2026-10-05 §C1)', () => {
    const NOW = new Date('2026-06-15T00:00:00Z');
    const rowsFor = (indicators: EconomySnapshot['indicators']): string =>
        buildMacroBriefingPromptRaw(
            { indicators, treasury: null, calendar: [] },
            NOW
        ).dynamic;

    it('prints only the monthly payroll change in persons — no level to rescale', () => {
        const p = rowsFor([
            {
                name: 'totalNonfarmPayroll',
                latest: { date: '2026-09-01', value: 159_044 },
                previous: { date: '2026-08-01', value: 159_015 },
                trend: [],
            },
        ]);
        expect(p).toContain('(unit: persons;');
        expect(p).toContain('monthly change: +29,000 persons (2026-09-01)');
        // The employment level (the figure the model misread as "15만" / "15,904만") is not printed.
        expect(p).not.toContain('159,044,000');
        expect(p).not.toContain('159,015,000');
        expect(p).not.toContain('159044');
        expect(p).not.toContain('thousand persons');
        expect(p).not.toContain('persons, +');
        expect(p).not.toMatch(/payroll[^\n]*←/i);
    });

    it('prints a payroll loss as a negative monthly change, a flat month as +0, never -0', () => {
        const row = (latest: number): string =>
            rowsFor([
                {
                    name: 'totalNonfarmPayroll',
                    latest: { date: '2026-09-01', value: latest },
                    previous: { date: '2026-08-01', value: 159_015 },
                    trend: [],
                },
            ]);
        expect(row(158_990)).toContain('monthly change: -25,000 persons');
        expect(row(159_015)).toContain('monthly change: +0 persons');
        expect(row(159_015)).not.toContain('-0 persons');
    });

    it('prints monthly change: N/A when either payroll release is missing', () => {
        const noPrevious = rowsFor([
            {
                name: 'totalNonfarmPayroll',
                latest: { date: '2026-09-01', value: 159_044 },
                previous: null,
                trend: [],
            },
        ]);
        expect(noPrevious).toContain('monthly change: N/A');
        expect(noPrevious).not.toContain('159');
        const noLatest = rowsFor([
            {
                name: 'totalNonfarmPayroll',
                latest: null,
                previous: { date: '2026-08-01', value: 159_015 },
                trend: [],
            },
        ]);
        expect(noLatest).toContain('monthly change: N/A');
    });

    it('pre-converts GDP from USD billions to USD trillion and keeps weekly claims as grouped persons', () => {
        const p = rowsFor([
            {
                name: 'GDP',
                latest: { date: '2026-06-30', value: 30_485 },
                previous: { date: '2026-03-31', value: 30_140 },
                trend: [],
            },
            {
                name: 'initialClaims',
                latest: { date: '2026-09-27', value: 230_000 },
                previous: { date: '2026-09-20', value: 225_000 },
                trend: [],
            },
        ]);
        expect(p).toContain(
            '30.49 USD trillion (2026-06-30) ← 30.14 USD trillion (Δ +0.35 USD trillion, +1.14%)'
        );
        expect(p).toContain(
            '230,000 persons per week (2026-09-27) ← 225,000 persons per week (Δ +5,000 persons per week, +2.22%)'
        );
    });

    it('prints the inflation rate as its latest value only: no ← previous and no Δ (its previous is the previous day)', () => {
        const p = rowsFor([
            {
                name: 'inflationRate',
                latest: { date: '2026-10-02', value: 2.36 },
                previous: { date: '2026-10-01', value: 2.36 },
                trend: [],
            },
        ]);
        const row = p
            .split('\n')
            .find(line => line.includes('[inflationRate]'));
        expect(row).toBe(
            'Inflation rate (year over year) [inflationRate] (unit: %): 2.36% (2026-10-02)'
        );
        expect(row).not.toContain('←');
        expect(row).not.toContain('Δ');
    });

    it('prints a recession probability as a percentage, not a fraction', () => {
        const p = rowsFor([
            {
                name: 'smoothedUSRecessionProbabilities',
                latest: { date: '2026-08-01', value: 0.62 },
                previous: { date: '2026-07-01', value: 0.5 },
                trend: [],
            },
        ]);
        expect(p).toContain('0.62% (2026-08-01)');
        expect(p).toContain('already a percentage, not a 0-1 fraction');
        expect(p).toContain('(Δ +0.12pp)');
    });

    it('uses the registry unit over the caller unit and renders a rate delta in pp', () => {
        const p = rowsFor([
            {
                name: 'federalFunds',
                latest: { date: '2026-09-01', value: 3.75 },
                previous: { date: '2026-08-01', value: 3.63 },
                trend: [],
            },
        ]);
        expect(p).toContain(
            'Effective federal funds rate (monthly average) [federalFunds] (unit: %): 3.75% (2026-09-01) ← 3.63% (Δ +0.12pp)'
        );
    });

    it('labels an index series with index points', () => {
        const p = rowsFor([
            {
                name: 'CPI',
                latest: { date: '2026-08-01', value: 333.9 },
                previous: { date: '2026-07-01', value: 333 },
                trend: [],
            },
        ]);
        expect(p).toContain('[CPI] (unit: index points): 333.9 index points');
        expect(p).toContain('(Δ +0.90 index points,');
    });

    it('keeps the legacy unit-less row for an unknown indicator name', () => {
        const p = rowsFor([
            {
                name: 'someNewSeries',
                latest: { date: '2026-06-01', value: 103.5 },
                previous: { date: '2026-05-01', value: 102 },
                trend: [],
            },
        ]);
        expect(p).toContain(
            'someNewSeries: 103.5 (2026-06-01) ← 102 (Δ +1.50, +1.47%)'
        );
        expect(p).not.toContain('(unit:');
    });

    it('does not treat a prototype key as a registered indicator', () => {
        const p = rowsFor([
            {
                name: 'constructor',
                latest: { date: '2026-06-01', value: 1 },
                previous: null,
                trend: [],
            },
        ]);
        expect(p).toContain('constructor: 1 (2026-06-01)');
        expect(p).not.toContain('(unit:');
    });

    it('forbids restating calendar relative times because the briefing is cached for a day', () => {
        const p = buildMacroBriefingPromptRaw(SNAP, NOW).dynamic;
        expect(p).toContain('relative-time suffix');
        expect(p).toContain('never restate it');
        expect(p).toContain('refer to a scheduled event by its date instead');
        // The suffix itself is still printed — it is the rule that keeps it out of the prose.
        expect(p).toMatch(/Fed Rate Decision/);
    });

    describe('computed regime line (UX audit 2026-10-05 A/B follow-up)', () => {
        const promptFor = (snapshot: EconomySnapshot): string =>
            buildMacroBriefingPromptRaw(snapshot, NOW).dynamic;

        it('prints the code-derived regime and the signals that held, after the spread line', () => {
            const p = promptFor({
                indicators: [
                    {
                        name: 'unemploymentRate',
                        latest: { date: '2026-09-01', value: 4.2 },
                        previous: { date: '2026-08-01', value: 4.1 },
                        trend: [],
                    },
                    {
                        name: 'totalNonfarmPayroll',
                        latest: { date: '2026-09-01', value: 159_044 },
                        previous: { date: '2026-08-01', value: 159_015 },
                        trend: [],
                    },
                ],
                treasury: { date: '2026-10-05', year2: 4, year10: 4.45 },
                calendar: [],
            });
            expect(p).toContain(
                'Regime (computed): slowdown — because: unemployment rate rising; monthly job gains weak'
            );
            expect(p.lastIndexOf('Regime (computed)')).toBeGreaterThan(
                p.indexOf('2s10s 스프레드')
            );
        });

        it('tells the model to use exactly that regime, agree with it and never restate thresholds or rule wording', () => {
            const p = promptFor(SNAP);
            expect(p).toContain(
                'Set the regime field to exactly that value, write the summary and highlights so they agree with it'
            );
            expect(p).toContain(
                'Never restate thresholds, cutoffs or rule wording, never pick a different regime'
            );
            // The rule list that the model used to apply (and misapplied) is gone from the prompt.
            expect(p).not.toContain('FIRST value below');
            expect(p).not.toContain('50,000 persons');
            expect(p).not.toContain('2s10s spread below zero');
            expect(p).not.toContain('prior distress');
        });

        it('the printed reason carries no thresholds', () => {
            const p = promptFor(SNAP);
            const line = p
                .split('\n')
                .find(l => l.startsWith('Regime (computed)'));
            expect(line).toBeDefined();
            expect(line).not.toMatch(/\d/);
        });

        it('an empty snapshot still prints a neutral computed line', () => {
            const p = promptFor({
                indicators: [],
                treasury: null,
                calendar: [],
            });
            expect(p).toContain(
                'Regime (computed): neutral — because: rows are mixed or incomplete'
            );
        });
    });

    it('forbids stating a policy direction without a rate-decision row, and changes for series that print no change figure', () => {
        const p = buildMacroBriefingPromptRaw(SNAP, NOW).dynamic;
        expect(p).toContain(
            'Never state a policy direction (tightening, easing, 긴축, 완화) unless a rate-decision row is present in the calendar rows below'
        );
        expect(p).toContain(
            'Never describe a change for a series whose row prints no change figure'
        );
        // The change-only payroll row is itself a change, so the rule must exempt it explicitly.
        expect(p).toContain(
            "A 'monthly change: <figure>' row is itself a change and may be described as one; 'monthly change: N/A' is not."
        );
        expect(p).not.toContain('no previous value');
        expect(p).toContain(
            'The inflation rate is a daily reading, not a month-over-month change'
        );
        // The federal-funds threshold wording invited "0.25pp 기준" quotes.
        expect(p).not.toContain('0.25pp');
    });

    it('asks for %p in Korean and keeps prompt jargon out of the prose', () => {
        const p = buildMacroBriefingPromptRaw(SNAP, NOW).dynamic;
        expect(p).toContain(
            'write a percentage-point change with the unit %p, never pp or %포인트'
        );
        expect(p).toContain('do not use the words drift or 드리프트');
        // The rules themselves must not carry the word they ban, except to ban it.
        const rules = p.slice(
            p.indexOf('## Interpretation Rules'),
            p.indexOf('Schema (string fields')
        );
        expect(rules.match(/drift/gi)).toHaveLength(1);
    });

    it('adds an Interpretation Rules block after the data boundary with category rules and no example sentences', () => {
        const p = buildMacroBriefingPromptRaw(SNAP, NOW).dynamic;
        const boundary = p.indexOf('## Data Boundary');
        const rules = p.indexOf('## Interpretation Rules');
        expect(boundary).toBeGreaterThan(-1);
        expect(rules).toBeGreaterThan(boundary);
        expect(p.indexOf('Schema (string fields')).toBeGreaterThan(rules);
        expect(p).toContain('never rescale it');
        expect(p).toContain(
            'Recession probability is a percentage, not a fraction'
        );
        expect(p).toContain('exactly as printed');
        expect(p).toContain('Regime (computed)');
        // Prompt-example leaks: the rules block must not carry sample sentences.
        const rulesBlock = p.slice(rules, p.indexOf('Schema (string fields'));
        // The regime is computed in code and the prompt forbids restating cutoffs, so the rules
        // themselves must not print any: no digits at all, no "above/below N%".
        expect(rulesBlock).not.toMatch(/\d/);
        expect(rulesBlock).not.toMatch(/(?:above|below|under|over)\s+\S*\d/i);
        expect(rulesBlock).not.toMatch(/e\.g\.|for example|예:|"[^"]{20,}"/i);
    });
});
