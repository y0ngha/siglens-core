import { describe, it, expect } from 'vitest';
import { selectSkills } from '@/domain/analysis/selectSkills';
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

const baseSkill = (name: string, gating?: SkillGating): Skill => ({
    name,
    description: `${name} description`,
    indicators: [],
    confidenceWeight: 1,
    content: `${name} content`,
    ...(gating ? { gating } : {}),
});

const alwaysOnSkill = (name: string): Skill =>
    baseSkill(name, { tier: 'always_on' });

const eventSkill = (name: string, triggers: readonly string[]): Skill =>
    baseSkill(name, { tier: 'gated', signalKind: 'event', triggers });

const stateSkill = (name: string, state: SkillStatePredicate): Skill =>
    baseSkill(name, { tier: 'gated', signalKind: 'state', state });

const untaggedSkill = (name: string): Skill => baseSkill(name);

const namesOf = (skills: readonly Skill[]): string[] => skills.map(s => s.name);

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

describe('selectSkills — always_on', () => {
    it('always returns an always_on skill regardless of context', () => {
        const out = selectSkills([alwaysOnSkill('chart-pattern-x')], makeCtx());
        expect(namesOf(out)).toContain('chart-pattern-x');
    });
});

describe('selectSkills — event-gated', () => {
    it('loads only when a trigger signal is present', () => {
        const rsiGuide = eventSkill('rsi', ['rsi_oversold']);
        expect(
            selectSkills([rsiGuide], makeCtx({ signalTypes: ['rsi_oversold'] }))
                .length
        ).toBe(1);
        expect(
            selectSkills([rsiGuide], makeCtx({ signalTypes: [] })).length
        ).toBe(0);
    });
    it('matches any one of several triggers', () => {
        const rsiGuide = eventSkill('rsi', ['rsi_oversold', 'rsi_overbought']);
        expect(
            selectSkills(
                [rsiGuide],
                makeCtx({ signalTypes: ['rsi_overbought'] })
            ).length
        ).toBe(1);
    });
    it('drops an event skill whose triggers array is empty', () => {
        const empty = eventSkill('empty', []);
        expect(
            selectSkills([empty], makeCtx({ signalTypes: ['rsi_oversold'] }))
                .length
        ).toBe(0);
    });
});

describe('selectSkills — state-gated', () => {
    it('loads only when the textbook predicate fires', () => {
        const bb = stateSkill('bollinger', {
            feature: 'bollinger',
            predicate: 'pctB',
        });
        expect(selectSkills([bb], overboughtBollingerCtx(0.99)).length).toBe(1);
        expect(selectSkills([bb], overboughtBollingerCtx(0.5)).length).toBe(0);
    });
});

describe('selectSkills — candle-gated', () => {
    it('loads a candle guide only when that candle is detected', () => {
        const hammer = eventSkill('hammer-guide', ['hammer']);
        expect(
            selectSkills([hammer], makeCtx({ detectedCandles: ['hammer'] }))
                .length
        ).toBe(1);
        expect(
            selectSkills([hammer], makeCtx({ detectedCandles: ['doji'] }))
                .length
        ).toBe(0);
    });
});

describe('selectSkills — fail-open', () => {
    it('includes an untagged skill (never silently dropped)', () => {
        const out = selectSkills([untaggedSkill('x')], makeCtx());
        expect(namesOf(out)).toContain('x');
    });
});

describe('selectSkills — determinism', () => {
    it('sorts output by name (total order tie-break)', () => {
        const skills = [
            alwaysOnSkill('zebra'),
            alwaysOnSkill('alpha'),
            alwaysOnSkill('mike'),
        ];
        expect(namesOf(selectSkills(skills, makeCtx()))).toEqual([
            'alpha',
            'mike',
            'zebra',
        ]);
    });
    it('is stable under input shuffle', () => {
        const skills = [
            alwaysOnSkill('a'),
            eventSkill('b', ['rsi_oversold']),
            untaggedSkill('c'),
            alwaysOnSkill('d'),
        ];
        const ctx = makeCtx({ signalTypes: ['rsi_oversold'] });
        const reversed = [...skills].toReversed();
        expect(namesOf(selectSkills(skills, ctx))).toEqual(
            namesOf(selectSkills(reversed, ctx))
        );
    });
    it('does not mutate the input array', () => {
        const skills = [alwaysOnSkill('zebra'), alwaysOnSkill('alpha')];
        const snapshot = namesOf(skills);
        selectSkills(skills, makeCtx());
        expect(namesOf(skills)).toEqual(snapshot);
    });
});

describe('selectSkills — worst cases', () => {
    it('returns an empty array for an empty skill list', () => {
        expect(selectSkills([], makeCtx())).toEqual([]);
    });
    it('returns every skill when all are always_on', () => {
        const skills = [alwaysOnSkill('a'), alwaysOnSkill('b')];
        expect(namesOf(selectSkills(skills, makeCtx()))).toEqual(['a', 'b']);
    });
    it('returns every skill when all are untagged (fail-open)', () => {
        const skills = [untaggedSkill('a'), untaggedSkill('b')];
        expect(namesOf(selectSkills(skills, makeCtx()))).toEqual(['a', 'b']);
    });
    it('drops every gated skill when no signal/state fires', () => {
        const skills = [
            eventSkill('e', ['rsi_oversold']),
            stateSkill('s', { feature: 'bollinger', predicate: 'pctB' }),
        ];
        expect(selectSkills(skills, makeCtx())).toEqual([]);
    });
    it('mixes always_on, fired-event, fired-state, and untagged correctly', () => {
        const skills = [
            alwaysOnSkill('always'),
            eventSkill('fired-event', ['rsi_oversold']),
            eventSkill('quiet-event', ['death_cross']),
            stateSkill('fired-state', {
                feature: 'bollinger',
                predicate: 'pctB',
            }),
            untaggedSkill('untagged'),
        ];
        const base = overboughtBollingerCtx(0.99);
        const ctx: SkillSelectionContext = {
            ...base,
            signals: [signalOf('rsi_oversold')],
        };
        expect(namesOf(selectSkills(skills, ctx))).toEqual([
            'always',
            'fired-event',
            'fired-state',
            'untagged',
        ]);
    });
});
