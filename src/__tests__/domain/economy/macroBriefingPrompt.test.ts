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
            'Gross domestic product [GDP] (unit: USD billions): N/A'
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
                        previous: { date: '2026-01-01', value: 2.5 },
                        trend: [],
                    },
                ],
            },
            NOW
        ).dynamic;
        expect(p).toContain(
            '[GDP] (unit: USD billions): N/A ← 2.5 USD billions'
        );
        expect(p).not.toContain('N/A ← 2.5 USD billions (Δ');
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

    it('prints the unit on both values and a unit-bearing delta for a level series (payroll)', () => {
        const p = rowsFor([
            {
                name: 'totalNonfarmPayroll',
                latest: { date: '2026-09-01', value: 159_500 },
                previous: { date: '2026-08-01', value: 159_471 },
                trend: [],
            },
        ]);
        expect(p).toContain('(unit: thousand persons');
        expect(p).toContain('159500 thousand persons (2026-09-01)');
        expect(p).toContain('← 159471 thousand persons');
        // A percent change of a jobs total misleads, so payroll shows the job change only.
        expect(p).toContain('(Δ +29 thousand persons)');
        expect(p).not.toContain('thousand persons, +');
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

    it('adds an Interpretation Rules block after the data boundary with category rules and no example sentences', () => {
        const p = buildMacroBriefingPromptRaw(SNAP, NOW).dynamic;
        const boundary = p.indexOf('## Data Boundary');
        const rules = p.indexOf('## Interpretation Rules');
        expect(boundary).toBeGreaterThan(-1);
        expect(rules).toBeGreaterThan(boundary);
        expect(p.indexOf('Schema (string fields')).toBeGreaterThan(rules);
        expect(p).toContain('never rescale it');
        expect(p).toContain(
            'below 10% is a low reading, above 50% is a recession signal'
        );
        expect(p).toContain(
            'a move under 0.25pp is drift inside the target range'
        );
        expect(p).toContain('thousands of jobs added or lost');
        for (const regime of [
            'expansion =',
            'slowdown =',
            'contraction =',
            'recovery =',
            'neutral =',
        ]) {
            expect(p).toContain(regime);
        }
        // Prompt-example leaks: the rules block must not carry sample sentences.
        const rulesBlock = p.slice(rules, p.indexOf('Schema (string fields'));
        expect(rulesBlock).not.toMatch(/e\.g\.|for example|예:|"[^"]{20,}"/i);
    });
});
