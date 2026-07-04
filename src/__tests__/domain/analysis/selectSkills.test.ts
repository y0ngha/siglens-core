import { describe, it, expect } from 'vitest';
import {
    NO_CHART_SELECTION_CONTEXT,
    selectSkills,
} from '@/domain/analysis/selectSkills';
import type { PromptSkillContext } from '@/domain/analysis/skillWhitelist';
import { EMPTY_INDICATOR_RESULT } from '@/domain/indicators/constants';
import type {
    IndicatorResult,
    Signal,
    SignalType,
    Skill,
    SkillGating,
    SkillSelectionContext,
    SkillStatePredicate,
    Timeframe,
} from '@/domain/types';

// ── Deterministic fixtures ──────────────────────────────────────────────────

const emptyIndicators = (): IndicatorResult => ({
    ...EMPTY_INDICATOR_RESULT,
});

interface CtxOverrides {
    signalTypes?: readonly SignalType[];
    detectedCandles?: readonly string[];
    timeframe?: Timeframe;
    indicators?: IndicatorResult;
    price?: number;
    atrPercent?: number;
}

const signalOf = (type: SignalType): Signal => ({
    type,
    direction: 'bullish',
    phase: 'confirmed',
    detectedAt: 0,
});

const makeCtx = (o: CtxOverrides = {}): SkillSelectionContext => ({
    indicators: o.indicators ?? emptyIndicators(),
    signals: (o.signalTypes ?? []).map(signalOf),
    timeframe: o.timeframe ?? '1Day',
    detectedCandles: o.detectedCandles ?? [],
    price: o.price ?? 100,
    atrPercent: o.atrPercent ?? 1,
});

const baseSkill = (
    name: string,
    gating?: SkillGating,
    extra: Partial<Skill> = {}
): Skill => ({
    name,
    description: `${name} description`,
    type: 'indicator_guide',
    indicators: [],
    confidenceWeight: 1,
    content: `${name} content`,
    ...(gating ? { gating } : {}),
    ...extra,
});

const alwaysOnSkill = (name: string, extra: Partial<Skill> = {}): Skill =>
    baseSkill(name, { tier: 'always_on' }, extra);

const eventSkill = (
    name: string,
    triggers: readonly string[],
    extra: Partial<Skill> = {}
): Skill =>
    baseSkill(name, { tier: 'gated', signalKind: 'event', triggers }, extra);

const stateSkill = (name: string, state: SkillStatePredicate): Skill =>
    baseSkill(name, { tier: 'gated', signalKind: 'state', state });

const untaggedSkill = (name: string, extra: Partial<Skill> = {}): Skill =>
    baseSkill(name, undefined, extra);

const namesOf = (skills: readonly Skill[]): string[] => skills.map(s => s.name);

/** Flattened technical selection (core first, then selected) for membership checks. */
const allOf = (
    skills: readonly Skill[],
    ctx: SkillSelectionContext
): Skill[] => {
    const { core, selected } = selectSkills(skills, ctx, 'technical');
    return [...core, ...selected];
};

// A bollinger band whose %B at price 100 is > 0.98 (overbought on 1Day).
const overboughtBollingerCtx = (pctB: number): SkillSelectionContext => {
    const indicators = emptyIndicators();
    const lower = 90;
    const upper = 110;
    const price = lower + pctB * (upper - lower);
    indicators.bollinger = [{ lower, middle: 100, upper }];
    indicators.atr = [1];
    return makeCtx({ indicators, price, timeframe: '1Day' });
};

// ── Tests ───────────────────────────────────────────────────────────────────

describe('selectSkills — core/selected split', () => {
    it('routes always_on skills to core regardless of context', () => {
        const { core, selected } = selectSkills(
            [alwaysOnSkill('chart-pattern-x')],
            makeCtx(),
            'technical'
        );
        expect(namesOf(core)).toEqual(['chart-pattern-x']);
        expect(selected).toEqual([]);
    });

    it('routes fired gated skills to selected, never core', () => {
        const { core, selected } = selectSkills(
            [eventSkill('rsi', ['rsi_oversold'])],
            makeCtx({ signalTypes: ['rsi_oversold'] }),
            'technical'
        );
        expect(core).toEqual([]);
        expect(namesOf(selected)).toEqual(['rsi']);
    });

    it('splits a mixed catalog into core and selected correctly', () => {
        const skills = [
            eventSkill('fired-event', ['rsi_oversold']),
            alwaysOnSkill('always-b'),
            eventSkill('quiet-event', ['death_cross']),
            alwaysOnSkill('always-a'),
            stateSkill('fired-state', {
                feature: 'bollinger',
                predicate: 'pctB',
            }),
        ];
        const base = overboughtBollingerCtx(0.99);
        const ctx: SkillSelectionContext = {
            ...base,
            signals: [signalOf('rsi_oversold')],
        };
        const { core, selected } = selectSkills(skills, ctx, 'technical');
        expect(namesOf(core)).toEqual(['always-a', 'always-b']);
        expect(namesOf(selected)).toEqual(['fired-event', 'fired-state']);
    });
});

describe('selectSkills — event-gated', () => {
    it('selects only when a trigger signal is present', () => {
        const rsiGuide = eventSkill('rsi', ['rsi_oversold']);
        expect(
            selectSkills(
                [rsiGuide],
                makeCtx({ signalTypes: ['rsi_oversold'] }),
                'technical'
            ).selected.length
        ).toBe(1);
        expect(
            selectSkills([rsiGuide], makeCtx({ signalTypes: [] }), 'technical')
                .selected.length
        ).toBe(0);
    });
    it('matches any one of several triggers', () => {
        const rsiGuide = eventSkill('rsi', ['rsi_oversold', 'rsi_overbought']);
        expect(
            selectSkills(
                [rsiGuide],
                makeCtx({ signalTypes: ['rsi_overbought'] }),
                'technical'
            ).selected.length
        ).toBe(1);
    });
    it('drops an event skill whose triggers array is empty', () => {
        const empty = eventSkill('empty', []);
        expect(
            selectSkills(
                [empty],
                makeCtx({ signalTypes: ['rsi_oversold'] }),
                'technical'
            ).selected.length
        ).toBe(0);
    });
});

describe('selectSkills — state-gated', () => {
    it('selects only when the textbook predicate fires', () => {
        const bb = stateSkill('bollinger', {
            feature: 'bollinger',
            predicate: 'pctB',
        });
        expect(
            selectSkills([bb], overboughtBollingerCtx(0.99), 'technical')
                .selected.length
        ).toBe(1);
        expect(
            selectSkills([bb], overboughtBollingerCtx(0.5), 'technical')
                .selected.length
        ).toBe(0);
    });
});

describe('selectSkills — candle-gated', () => {
    it('selects a candle guide only when that candle is detected', () => {
        const hammer = eventSkill('hammer-guide', ['hammer'], {
            type: 'candlestick',
        });
        expect(
            selectSkills(
                [hammer],
                makeCtx({ detectedCandles: ['hammer'] }),
                'technical'
            ).selected.length
        ).toBe(1);
        expect(
            selectSkills(
                [hammer],
                makeCtx({ detectedCandles: ['doji'] }),
                'technical'
            ).selected.length
        ).toBe(0);
    });
});

describe('selectSkills — fail-closed gating', () => {
    it('throws on an untagged skill that passes the whitelist', () => {
        expect(() =>
            selectSkills([untaggedSkill('legacy')], makeCtx(), 'technical')
        ).toThrow(/gating/);
        expect(() =>
            selectSkills([untaggedSkill('legacy')], makeCtx(), 'technical')
        ).toThrow(/legacy/);
    });

    it('does not throw on an untagged skill filtered out by the whitelist', () => {
        // An untagged fundamental skill belongs to another prompt's contract;
        // the TECHNICAL whitelist drops it before the fail-closed check.
        const foreign = untaggedSkill('value-investing', {
            type: undefined,
            category: 'fundamental',
        });
        expect(() =>
            selectSkills([foreign], makeCtx(), 'technical')
        ).not.toThrow();
    });
});

describe('selectSkills — category whitelist (spec §3.2 invariants)', () => {
    const catalogWithAllCategories: Skill[] = [
        alwaysOnSkill('indicator-core', { type: 'indicator_guide' }),
        alwaysOnSkill('candle-primer', {
            type: 'candlestick',
            category: 'neutral',
        }),
        alwaysOnSkill('head-and-shoulders', {
            type: 'pattern',
            category: 'reversal_bearish',
        }),
        alwaysOnSkill('breakout', { type: 'strategy' }),
        alwaysOnSkill('pivot-points', { type: 'support_resistance' }),
        alwaysOnSkill('value-investing', {
            type: undefined,
            category: 'fundamental',
        }),
        alwaysOnSkill('event-driven', { type: undefined, category: 'news' }),
        alwaysOnSkill('congress-flow', {
            type: undefined,
            category: 'congress',
        }),
    ];

    it('TECHNICAL selection excludes fundamental/news/congress category skills', () => {
        const cats = allOf(catalogWithAllCategories, makeCtx()).map(
            s => s.category
        );
        expect(cats).not.toContain('fundamental');
        expect(cats).not.toContain('news');
        expect(cats).not.toContain('congress');
    });

    it('TECHNICAL selection includes every chart skill type (indicator_guide regression guard)', () => {
        const names = namesOf(
            selectSkills(catalogWithAllCategories, makeCtx(), 'technical').core
        );
        expect(names).toEqual([
            'breakout',
            'candle-primer',
            'head-and-shoulders',
            'indicator-core',
            'pivot-points',
        ]);
    });

    it('TECHNICAL excludes a mis-tagged skill declaring both a chart type and a non-chart category', () => {
        const misTagged = alwaysOnSkill('sneaky-news', {
            type: 'strategy',
            category: 'news',
        });
        expect(namesOf(allOf([misTagged], makeCtx()))).not.toContain(
            'sneaky-news'
        );
    });

    it.each([
        ['fundamental', 'value-investing'],
        ['news', 'event-driven'],
    ] as const)(
        '%s context selects only its own category',
        (promptContext: PromptSkillContext, expected: string) => {
            const { core, selected } = selectSkills(
                catalogWithAllCategories,
                NO_CHART_SELECTION_CONTEXT,
                promptContext
            );
            expect(namesOf([...core, ...selected])).toEqual([expected]);
        }
    );

    it('no context selects a congress-category skill', () => {
        const congress = alwaysOnSkill('congress-flow', {
            type: undefined,
            category: 'congress',
        });
        for (const promptContext of [
            'technical',
            'fundamental',
            'news',
        ] as const) {
            expect(
                selectSkills([congress], makeCtx(), promptContext).core
            ).toEqual([]);
        }
    });
});

describe('selectSkills — chartless context (fundamental/news builders)', () => {
    it('always_on skills qualify; chart-gated skills can never fire', () => {
        const skills = [
            alwaysOnSkill('quality-investing', {
                type: undefined,
                category: 'fundamental',
            }),
            eventSkill('gated-fundamental', ['rsi_oversold'], {
                type: undefined,
                category: 'fundamental',
            }),
        ];
        const { core, selected } = selectSkills(
            skills,
            NO_CHART_SELECTION_CONTEXT,
            'fundamental'
        );
        expect(namesOf(core)).toEqual(['quality-investing']);
        expect(selected).toEqual([]);
    });
});

describe('selectSkills — relevance ordering', () => {
    it('orders selected by trigger-match count desc, then name asc', () => {
        const skills = [
            // 1 match (signal)
            eventSkill('one-match', ['rsi_oversold']),
            // 2 matches (signal + candle)
            eventSkill('two-match', ['macd_bullish_cross', 'hammer']),
            // 1 match (candle) — ties with one-match, name tie-break applies
            eventSkill('a-candle', ['hammer']),
        ];
        const ctx = makeCtx({
            signalTypes: ['rsi_oversold', 'macd_bullish_cross'],
            detectedCandles: ['hammer'],
        });
        const { selected } = selectSkills(skills, ctx, 'technical');
        expect(namesOf(selected)).toEqual([
            'two-match',
            'a-candle',
            'one-match',
        ]);
    });

    it('counts every matching signal and candle occurrence toward the score', () => {
        // 'z-multi' would sort LAST on the name tie-break, so it can only come
        // first if its two signal matches genuinely outscore the single candle.
        const skills = [
            eventSkill('z-multi', ['rsi_oversold']),
            eventSkill('a-single', ['hammer']),
        ];
        // Two rsi_oversold signals (e.g. differing phases) outrank one candle.
        const ctx = makeCtx({
            signalTypes: ['rsi_oversold', 'rsi_oversold'],
            detectedCandles: ['hammer'],
        });
        expect(
            namesOf(selectSkills(skills, ctx, 'technical').selected)
        ).toEqual(['z-multi', 'a-single']);
    });

    it('scores a fired state-gated skill as 1 (ties with 1-match event skills, name tie-break)', () => {
        const skills = [
            stateSkill('z-state', { feature: 'bollinger', predicate: 'pctB' }),
            eventSkill('a-event', ['rsi_oversold']),
        ];
        const base = overboughtBollingerCtx(0.99);
        const ctx: SkillSelectionContext = {
            ...base,
            signals: [signalOf('rsi_oversold')],
        };
        expect(
            namesOf(selectSkills(skills, ctx, 'technical').selected)
        ).toEqual(['a-event', 'z-state']);
    });
});

describe('selectSkills — determinism', () => {
    it('sorts core by name (locale-pinned total order)', () => {
        const skills = [
            alwaysOnSkill('zebra'),
            alwaysOnSkill('alpha'),
            alwaysOnSkill('mike'),
        ];
        expect(
            namesOf(selectSkills(skills, makeCtx(), 'technical').core)
        ).toEqual(['alpha', 'mike', 'zebra']);
    });
    it('is stable under input shuffle', () => {
        const skills = [
            alwaysOnSkill('a'),
            eventSkill('b', ['rsi_oversold']),
            eventSkill('c', ['rsi_oversold', 'hammer']),
            alwaysOnSkill('d'),
        ];
        const ctx = makeCtx({
            signalTypes: ['rsi_oversold'],
            detectedCandles: ['hammer'],
        });
        const reversed = [...skills].toReversed();
        const a = selectSkills(skills, ctx, 'technical');
        const b = selectSkills(reversed, ctx, 'technical');
        expect(namesOf(a.core)).toEqual(namesOf(b.core));
        expect(namesOf(a.selected)).toEqual(namesOf(b.selected));
    });
    it('does not mutate the input array', () => {
        const skills = [alwaysOnSkill('zebra'), alwaysOnSkill('alpha')];
        const snapshot = namesOf(skills);
        selectSkills(skills, makeCtx(), 'technical');
        expect(namesOf(skills)).toEqual(snapshot);
    });
});

describe('selectSkills — worst cases', () => {
    it('returns empty core and selected for an empty skill list', () => {
        expect(selectSkills([], makeCtx(), 'technical')).toEqual({
            core: [],
            selected: [],
        });
    });
    it('returns every skill in core when all are always_on', () => {
        const skills = [alwaysOnSkill('a'), alwaysOnSkill('b')];
        expect(
            namesOf(selectSkills(skills, makeCtx(), 'technical').core)
        ).toEqual(['a', 'b']);
    });
    it('drops every gated skill when no signal/state fires', () => {
        const skills = [
            eventSkill('e', ['rsi_oversold']),
            stateSkill('s', { feature: 'bollinger', predicate: 'pctB' }),
        ];
        expect(selectSkills(skills, makeCtx(), 'technical')).toEqual({
            core: [],
            selected: [],
        });
    });
});
