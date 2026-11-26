import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import {
    anchorBarIndexOf,
    changeReferenceOf,
    technicalChangesBetween,
    TECHNICAL_CHANGES_MAX_SESSIONS,
    type ChangeReference,
    type TechnicalChange,
    type TechnicalChangesResult,
} from '@/domain/analysis/technicalChanges';
import { buildPlanCheck } from '@/domain/analysis/planCheck';
import { buildPlanState } from '@/domain/analysis/planState';
import { planEntryPrice } from '@/domain/analysis/ai-levels';
import { calculateIndicators } from '@/domain/indicators';
import { filterAnalysisResult } from '@/domain/analysis/filterAnalysisResult';
import { detectNewConfirmedSignals } from '@/domain/signals/newSignals';
import { TIER_CONFIG } from '@/domain/tier';
import type {
    ActionRecommendation,
    AnalysisResponse,
    Bar,
    PlanState,
    Tier,
} from '@/domain/types';
import { TEST_TIER_CONFIG } from '../../helpers/testTierConfig';

// Each case runs several indicator suites; a loaded CI worker needs more than the 5 s default.
vi.setConfig({ testTimeout: 60_000 });

const DAY = 86_400;
const T0 = 1_700_000_000;

const mkBars = (closes: readonly number[]): Bar[] =>
    closes.map((close, i) => ({
        time: T0 + i * DAY,
        open: close,
        high: close + 1,
        low: close - 1,
        close,
        volume: 1000,
    }));

/** 60 flat sessions (neutral trend) followed by a steady climb (bullish within a few bars). */
const FLAT_THEN_UP = [
    ...Array.from({ length: 60 }, (_, i) => 100 + (i % 2 ? 0.5 : -0.5)),
    ...Array.from({ length: 25 }, (_, i) => 100 + (i + 1) * 3),
];
const FLAT_THEN_DOWN = [
    ...Array.from({ length: 60 }, (_, i) => 200 + (i % 2 ? 0.5 : -0.5)),
    ...Array.from({ length: 25 }, (_, i) => 200 - (i + 1) * 3),
];

function seededCloses(seed: number, length: number): number[] {
    const state = { s: seed, price: 100 };
    return Array.from({ length }, () => {
        state.s = (state.s * 1664525 + 1013904223) % 4294967296;
        state.price *= 1 + (state.s / 4294967296 - 0.5) * 0.05;
        return state.price;
    });
}

const ref = (over: Partial<ChangeReference> = {}): ChangeReference => ({
    analyzedAt: '2026-11-01T00:00:00.000Z',
    supports: [],
    resistances: [],
    plan: null,
    ...over,
});

const plan = (
    over: Partial<ActionRecommendation> = {}
): ActionRecommendation => ({
    positionAnalysis: '',
    entry: '',
    exit: '',
    riskReward: '',
    entryPrices: [100, 110],
    stopLoss: 90,
    takeProfitPrices: [140],
    ...over,
});

const okResult = (
    result: TechnicalChangesResult
): Extract<TechnicalChangesResult, { ok: true }> => {
    if (!result.ok) throw new Error(`expected ok, got ${result.reason}`);
    return result;
};

const ofKind = <K extends TechnicalChange['kind']>(
    result: TechnicalChangesResult,
    kind: K
): Extract<TechnicalChange, { kind: K }>[] =>
    okResult(result).changes.filter(
        (c): c is Extract<TechnicalChange, { kind: K }> => c.kind === kind
    );

describe('technicalChangesBetween: guards', () => {
    it('reports too_short for fewer than two bars', () => {
        expect(
            technicalChangesBetween(mkBars([100]), { fromIndex: 0 })
        ).toEqual({ ok: false, reason: 'too_short' });
        expect(technicalChangesBetween([], { fromIndex: 0 })).toEqual({
            ok: false,
            reason: 'too_short',
        });
    });

    it.each([-1, 1.5, NaN, 3, 99])(
        'reports invalid for fromIndex %s',
        index => {
            expect(
                technicalChangesBetween(mkBars([100, 101, 102]), {
                    fromIndex: index,
                })
            ).toEqual({ ok: false, reason: 'invalid' });
        }
    );

    it('reports same_session when the baseline is the last bar', () => {
        expect(
            technicalChangesBetween(mkBars([100, 101, 102]), { fromIndex: 2 })
        ).toEqual({ ok: false, reason: 'same_session' });
    });

    it('measures at the session limit and reports too_old one session further', () => {
        const bars = mkBars(
            Array.from(
                { length: TECHNICAL_CHANGES_MAX_SESSIONS + 2 },
                () => 100
            )
        );
        const last = bars.length - 1;
        expect(
            technicalChangesBetween(bars, {
                fromIndex: last - TECHNICAL_CHANGES_MAX_SESSIONS,
            }).ok
        ).toBe(true);
        expect(
            technicalChangesBetween(bars, {
                fromIndex: last - TECHNICAL_CHANGES_MAX_SESSIONS - 1,
            })
        ).toEqual({ ok: false, reason: 'too_old' });
    });

    it('reports too_old when the baseline is more than the limit back', () => {
        const bars = mkBars(
            Array.from(
                { length: TECHNICAL_CHANGES_MAX_SESSIONS + 5 },
                () => 100
            )
        );
        expect(technicalChangesBetween(bars, { fromIndex: 1 })).toEqual({
            ok: false,
            reason: 'too_old',
        });
    });

    it('reports invalid when a measured close is not a finite positive number', () => {
        expect(
            technicalChangesBetween(mkBars([0, 100, 101]), { fromIndex: 0 })
        ).toEqual({ ok: false, reason: 'invalid' });
        expect(
            technicalChangesBetween(mkBars([100, 101, NaN]), { fromIndex: 0 })
        ).toEqual({ ok: false, reason: 'invalid' });
    });

    it('returns the baseline and last bar times and closes', () => {
        const bars = mkBars([100, 101, 102]);
        const result = okResult(
            technicalChangesBetween(bars, { fromIndex: 1 })
        );
        expect(result).toMatchObject({
            fromTime: bars[1].time,
            toTime: bars[2].time,
            closeFrom: 101,
            closeTo: 102,
        });
    });
});

describe('technicalChangesBetween: what could not be read', () => {
    it('states that every end was read on clean bars', () => {
        const result = okResult(
            technicalChangesBetween(mkBars(FLAT_THEN_UP.slice(0, 66)), {
                fromIndex: 62,
            })
        );
        expect(result).toMatchObject({
            trendMeasured: true,
            unevaluatedSignalDays: 0,
            skippedCloses: 0,
        });
    });

    it('reports trendMeasured false when the rule is not measurable, apart from "unchanged"', () => {
        const short = okResult(
            technicalChangesBetween(mkBars([100, 101, 102]), { fromIndex: 1 })
        );
        expect(short.trendMeasured).toBe(false);
        const oneEnd = okResult(
            technicalChangesBetween(mkBars(FLAT_THEN_UP.slice(0, 66)), {
                fromIndex: 30,
            })
        );
        expect(oneEnd.trendMeasured).toBe(false);
        const unchanged = okResult(
            technicalChangesBetween(mkBars(FLAT_THEN_UP.slice(0, 60)), {
                fromIndex: 58,
            })
        );
        expect(unchanged.trendMeasured).toBe(true);
        expect(unchanged.changes.map(c => c.kind)).not.toContain(
            'trend_changed'
        );
    });

    it('counts the closes the level crossings skipped', () => {
        const result = okResult(
            technicalChangesBetween(mkBars([100, 0, 101, NaN, 98]), {
                fromIndex: 0,
                reference: ref({ supports: [99] }),
            })
        );
        expect(result.skippedCloses).toBe(2);
        // A bad close at or before the baseline is not "after the baseline".
        expect(
            okResult(
                technicalChangesBetween(mkBars([NaN, 100, 101]), {
                    fromIndex: 1,
                })
            ).skippedCloses
        ).toBe(0);
    });

    it('counts sessions whose new-signal question could not be answered', () => {
        // A non-finite close inside the window makes every later day in it unevaluable.
        const bad = mkBars([100, NaN, 101, 102]);
        expect(
            okResult(technicalChangesBetween(bad, { fromIndex: 2 }))
                .unevaluatedSignalDays
        ).toBe(1);
        expect(
            okResult(technicalChangesBetween(bad, { fromIndex: 0 }))
                .unevaluatedSignalDays
        ).toBe(3);
    });
});

describe('technicalChangesBetween: trend', () => {
    it('reports neutral to bullish', () => {
        const bars = mkBars(FLAT_THEN_UP.slice(0, 66));
        const changes = ofKind(
            technicalChangesBetween(bars, { fromIndex: 62 }),
            'trend_changed'
        );
        expect(changes).toHaveLength(1);
        expect(changes[0]).toMatchObject({
            from: 'neutral',
            to: 'bullish',
        });
        expect(changes[0].slopeAtr).toBeGreaterThanOrEqual(1);
    });

    it('reports neutral to bearish', () => {
        const bars = mkBars(FLAT_THEN_DOWN.slice(0, 66));
        const changes = ofKind(
            technicalChangesBetween(bars, { fromIndex: 62 }),
            'trend_changed'
        );
        expect(changes).toHaveLength(1);
        expect(changes[0]).toMatchObject({ from: 'neutral', to: 'bearish' });
        expect(changes[0].slopeAtr).toBeLessThanOrEqual(-1);
    });

    it('reports bullish to neutral when the close falls below the EMA', () => {
        const bars = mkBars([...FLAT_THEN_UP, 130]);
        const changes = ofKind(
            technicalChangesBetween(bars, { fromIndex: 84 }),
            'trend_changed'
        );
        expect(changes).toHaveLength(1);
        expect(changes[0]).toMatchObject({ from: 'bullish', to: 'neutral' });
    });

    it('reports nothing when the label is unchanged', () => {
        const bars = mkBars(FLAT_THEN_UP.slice(0, 60));
        expect(
            ofKind(
                technicalChangesBetween(bars, { fromIndex: 58 }),
                'trend_changed'
            )
        ).toEqual([]);
        const climbing = mkBars(FLAT_THEN_UP);
        expect(
            ofKind(
                technicalChangesBetween(climbing, { fromIndex: 83 }),
                'trend_changed'
            )
        ).toEqual([]);
    });

    it('reports nothing when the baseline end is not measurable', () => {
        // 31 bars at the baseline: under the 40 the rule needs, the end has no reading.
        const bars = mkBars(FLAT_THEN_UP.slice(0, 66));
        expect(
            ofKind(
                technicalChangesBetween(bars, { fromIndex: 30 }),
                'trend_changed'
            )
        ).toEqual([]);
    });

    it('reports nothing when the last end is not measurable', () => {
        const bars = mkBars(FLAT_THEN_UP.slice(0, 30));
        expect(
            ofKind(
                technicalChangesBetween(bars, { fromIndex: 20 }),
                'trend_changed'
            )
        ).toEqual([]);
    });
});

describe('technicalChangesBetween: signals', () => {
    const bars = mkBars(FLAT_THEN_UP);

    it('reports a signal that began after the baseline, once, with its start bar', () => {
        const started = ofKind(
            technicalChangesBetween(bars, { fromIndex: 60 }),
            'signal_started'
        );
        const overbought = started.filter(s => s.type === 'rsi_overbought');
        expect(overbought).toHaveLength(1);
        expect(overbought[0]).toMatchObject({
            direction: 'bearish',
            time: bars[62].time,
        });
        expect(new Set(started.map(s => `${s.type}@${s.time}`)).size).toBe(
            started.length
        );
    });

    it('does not report a signal already confirmed on the baseline bar', () => {
        // rsi_overbought is confirmed from bar 62 on; with the baseline at bar 70 it is not new.
        const started = ofKind(
            technicalChangesBetween(bars, { fromIndex: 70 }),
            'signal_started'
        );
        expect(started.map(s => s.type)).not.toContain('rsi_overbought');
        expect(started.map(s => s.type)).not.toContain('gap_up');
    });

    it('restricts the reported types with signalTypes', () => {
        const all = ofKind(
            technicalChangesBetween(bars, { fromIndex: 60 }),
            'signal_started'
        );
        expect(all.length).toBeGreaterThan(1);
        const only = ofKind(
            technicalChangesBetween(bars, {
                fromIndex: 60,
                signalTypes: ['rsi_overbought'],
            }),
            'signal_started'
        );
        expect(only.map(s => s.type)).toEqual(['rsi_overbought']);
        expect(
            ofKind(
                technicalChangesBetween(bars, {
                    fromIndex: 60,
                    signalTypes: [],
                }),
                'signal_started'
            )
        ).toEqual([]);
    });

    it('reports a signal that ended and restarted', () => {
        const walk = mkBars(seededCloses(42, 150));
        const restarted = walk.slice(0, 67);
        const fromIndex = 65;
        const direct = detectNewConfirmedSignals(restarted).map(s => s.type);
        expect(direct).toContain('macd_bullish_cross');
        const started = ofKind(
            technicalChangesBetween(restarted, { fromIndex }),
            'signal_started'
        );
        expect(started.map(s => s.type)).toContain('macd_bullish_cross');
    });

    it('agrees with detectNewConfirmedSignals for fromIndex = last - 1 on a seeded corpus', () => {
        const checked = [7, 42].flatMap(seed => {
            const walk = mkBars(seededCloses(seed, 140));
            return Array.from({ length: 30 }, (_, k) => walk.slice(0, 80 + k));
        });
        expect(checked).toHaveLength(60);
        const mismatches = checked.filter(prefix => {
            const expected = detectNewConfirmedSignals(prefix)
                .map(s => s.type)
                .sort();
            const actual = ofKind(
                technicalChangesBetween(prefix, {
                    fromIndex: prefix.length - 2,
                }),
                'signal_started'
            )
                .map(s => s.type)
                .sort();
            return JSON.stringify(expected) !== JSON.stringify(actual);
        });
        expect(mismatches).toHaveLength(0);
        const withStarts = checked.filter(
            prefix => detectNewConfirmedSignals(prefix).length > 0
        );
        expect(withStarts.length).toBeGreaterThan(5);
    });
});

describe('technicalChangesBetween: levels', () => {
    it('reports the first close across a resistance and a support going up', () => {
        const bars = mkBars(FLAT_THEN_UP);
        const crossed = ofKind(
            technicalChangesBetween(bars, {
                fromIndex: 60,
                reference: ref({ supports: [150], resistances: [120, 200] }),
            }),
            'level_crossed'
        );
        expect(crossed).toEqual([
            {
                kind: 'level_crossed',
                side: 'resistance',
                price: 120,
                direction: 'up',
                time: bars[66].time,
                close: 121,
            },
            {
                kind: 'level_crossed',
                side: 'support',
                price: 150,
                direction: 'up',
                time: bars[76].time,
                close: 151,
            },
        ]);
    });

    it('reports a close below a support and below a resistance going down', () => {
        const bars = mkBars([100, 100, 94, 90]);
        const crossed = ofKind(
            technicalChangesBetween(bars, {
                fromIndex: 1,
                reference: ref({ supports: [95], resistances: [99] }),
            }),
            'level_crossed'
        );
        expect(
            crossed.map(c => [c.side, c.price, c.direction, c.close])
        ).toEqual([
            ['support', 95, 'down', 94],
            ['resistance', 99, 'down', 94],
        ]);
    });

    it('treats a close equal to a support as below and equal to a resistance as above', () => {
        const down = ofKind(
            technicalChangesBetween(mkBars([100, 98]), {
                fromIndex: 0,
                reference: ref({ supports: [98] }),
            }),
            'level_crossed'
        );
        expect(down).toHaveLength(1);
        expect(down[0]).toMatchObject({ direction: 'down', close: 98 });

        const up = ofKind(
            technicalChangesBetween(mkBars([100, 102]), {
                fromIndex: 0,
                reference: ref({ resistances: [102] }),
            }),
            'level_crossed'
        );
        expect(up).toHaveLength(1);
        expect(up[0]).toMatchObject({ direction: 'up', close: 102 });
    });

    it('reads a baseline close that sits exactly on a level by the same tie rule', () => {
        // Baseline on a support is already below it: a later close above it is a move up.
        const regained = ofKind(
            technicalChangesBetween(mkBars([98, 99]), {
                fromIndex: 0,
                reference: ref({ supports: [98] }),
            }),
            'level_crossed'
        );
        expect(regained).toHaveLength(1);
        expect(regained[0]).toMatchObject({ direction: 'up', close: 99 });
        // Baseline on a resistance is already above it: no change while it stays on or above.
        expect(
            ofKind(
                technicalChangesBetween(mkBars([102, 102.5]), {
                    fromIndex: 0,
                    reference: ref({ resistances: [102] }),
                }),
                'level_crossed'
            )
        ).toEqual([]);
    });

    it('reports a level crossed and crossed back once, with its first crossing', () => {
        const bars = mkBars([100, 95, 101, 94, 102]);
        const crossed = ofKind(
            technicalChangesBetween(bars, {
                fromIndex: 0,
                reference: ref({ supports: [96] }),
            }),
            'level_crossed'
        );
        expect(crossed).toEqual([
            {
                kind: 'level_crossed',
                side: 'support',
                price: 96,
                direction: 'down',
                time: bars[1].time,
                close: 95,
            },
        ]);
    });

    it('reports nothing for a level never crossed or without a reference', () => {
        const bars = mkBars([100, 101, 102]);
        expect(
            ofKind(
                technicalChangesBetween(bars, {
                    fromIndex: 0,
                    reference: ref({ supports: [90], resistances: [120] }),
                }),
                'level_crossed'
            )
        ).toEqual([]);
        for (const reference of [undefined, null]) {
            expect(
                technicalChangesBetween(bars, { fromIndex: 0, reference })
            ).toMatchObject({ ok: true, changes: [] });
        }
    });

    it('does not count the baseline bar itself, and skips an unusable close in between', () => {
        // Baseline 100 is above support 99; the 0 close between is bad data, not a crossing.
        const bars = mkBars([100, 0, 101, 98]);
        const crossed = ofKind(
            technicalChangesBetween(bars, {
                fromIndex: 0,
                reference: ref({ supports: [99] }),
            }),
            'level_crossed'
        );
        expect(crossed).toHaveLength(1);
        expect(crossed[0]).toMatchObject({ time: bars[3].time, close: 98 });
    });
});

describe('technicalChangesBetween: plan', () => {
    const planAt = (closes: number[], p = plan()) =>
        ofKind(
            technicalChangesBetween(mkBars(closes), {
                fromIndex: closes.length - 2,
                reference: ref({ plan: p }),
            }),
            'plan_position_changed'
        );

    it('reports above_zone to in_zone', () => {
        expect(planAt([120, 105])).toEqual([
            {
                kind: 'plan_position_changed',
                from: 'above_zone',
                to: 'in_zone',
                time: T0 + DAY,
                close: 105,
            },
        ]);
    });

    it('reports in_zone to below_zone and below_zone to in_zone', () => {
        expect(planAt([105, 95])[0]).toMatchObject({
            from: 'in_zone',
            to: 'below_zone',
        });
        expect(planAt([95, 100])[0]).toMatchObject({
            from: 'below_zone',
            to: 'in_zone',
        });
    });

    it('reports in_zone to no_setup with the stopped reason', () => {
        expect(planAt([105, 90])).toEqual([
            {
                kind: 'plan_position_changed',
                from: 'in_zone',
                to: 'no_setup',
                reason: 'stopped',
                time: T0 + DAY,
                close: 90,
            },
        ]);
    });

    it('reports a no_setup reason change and nothing for the same reason', () => {
        const noRoom = plan({ takeProfitPrices: [110] });
        // targets must sit one ATR above the zone top; both ends fail it: no change.
        expect(planAt([105, 106], noRoom)).toEqual([]);
        // stopped -> no_room_above is a reason change inside no_setup.
        expect(planAt([85, 106], noRoom)[0]).toMatchObject({
            from: 'no_setup',
            to: 'no_setup',
            reason: 'no_room_above',
        });
    });

    it('reports nothing when the position is unchanged', () => {
        expect(planAt([120, 130])).toEqual([]);
        expect(planAt([101, 109])).toEqual([]);
    });

    it('reads the reconciled stop the way the plan state does', () => {
        const reconciled = plan({
            stopLoss: 90,
            reconciledLevels: {
                exit: '',
                riskReward: '',
                reason: '',
                stopLoss: 95,
            },
        });
        expect(planAt([105, 94], reconciled)[0]).toMatchObject({
            to: 'no_setup',
            reason: 'stopped',
        });
        expect(planAt([105, 94])[0]).toMatchObject({ to: 'below_zone' });
    });

    it('agrees with buildPlanState at both ends on a seeded corpus', () => {
        const levels = plan({
            entryPrices: [97, 103],
            stopLoss: 85,
            takeProfitPrices: [140],
        });
        const stateAt = (prefix: Bar[], index: number) => {
            const window = prefix.slice(0, index + 1);
            const { close } = window[index];
            const check = buildPlanCheck(
                levels,
                close,
                planEntryPrice(levels, close)
            );
            if (check === null) throw new Error('no plan check');
            return buildPlanState(
                levels,
                check,
                calculateIndicators(window).atr[index] ?? null
            );
        };
        const walk = mkBars(seededCloses(11, 160));
        const outcomes = Array.from({ length: 100 }, (_, k) => {
            const prefix = walk.slice(0, 60 + k);
            const from = stateAt(prefix, prefix.length - 2);
            const to = stateAt(prefix, prefix.length - 1);
            const reasonOf = (state: PlanState) =>
                state.position === 'no_setup' ? state.reason : undefined;
            const expectChange =
                from.position !== to.position ||
                reasonOf(from) !== reasonOf(to);
            const items = ofKind(
                technicalChangesBetween(prefix, {
                    fromIndex: prefix.length - 2,
                    reference: ref({ plan: levels }),
                }),
                'plan_position_changed'
            );
            expect(items.map(i => [i.from, i.to, i.reason])).toEqual(
                expectChange ? [[from.position, to.position, reasonOf(to)]] : []
            );
            return expectChange;
        });
        expect(outcomes.some(Boolean)).toBe(true);
        expect(outcomes.some(changed => !changed)).toBe(true);
    });

    it('puts plan and level items before trend and signal items', () => {
        const bars = mkBars(FLAT_THEN_UP.slice(0, 66));
        const kinds = okResult(
            technicalChangesBetween(bars, {
                fromIndex: 60,
                reference: ref({
                    resistances: [112],
                    plan: plan({ takeProfitPrices: [200] }),
                }),
            })
        ).changes.map(c => c.kind);
        const firstOf = (kind: string) => kinds.indexOf(kind as never);
        expect(kinds).toContain('plan_position_changed');
        expect(kinds).toContain('trend_changed');
        expect(firstOf('plan_position_changed')).toBeLessThan(
            firstOf('trend_changed')
        );
        expect(firstOf('trend_changed')).toBeLessThan(
            firstOf('signal_started')
        );
    });
});

const stored = (over: Record<string, unknown> = {}) => ({
    analyzedAt: '2026-11-01T01:00:00.000Z',
    keyLevels: {
        support: [
            { price: 95, reason: 'a' },
            { price: 90, reason: 'b' },
        ],
        resistance: [{ price: 120, reason: 'c' }],
    },
    actionRecommendation: {
        positionAnalysis: 'p',
        entry: 'e',
        exit: 'x',
        riskReward: 'r',
        entryPrices: [100, 110],
        stopLoss: 90,
        takeProfitPrices: [140, 130],
    },
    ...over,
});

describe('changeReferenceOf', () => {
    it('keeps levels and plan for a member', () => {
        const result = changeReferenceOf(stored(), { tier: 'member' });
        expect(result).toMatchObject({
            analyzedAt: '2026-11-01T01:00:00.000Z',
            supports: [90, 95],
            resistances: [120],
        });
        expect(result?.plan).toMatchObject({
            entryPrices: [100, 110],
            stopLoss: 90,
            takeProfitPrices: [130, 140],
        });
    });

    it('hides levels and plan from free and guest-tier readers', () => {
        expect(changeReferenceOf(stored(), { tier: 'free' })).toEqual({
            analyzedAt: '2026-11-01T01:00:00.000Z',
            supports: [],
            resistances: [],
            plan: null,
        });
    });

    it('applies the depth of a given config (restrictions off shows everything)', () => {
        const free = changeReferenceOf(stored(), {
            tier: 'free',
            config: TEST_TIER_CONFIG,
        });
        expect(free?.supports).toEqual([90, 95]);
        expect(free?.plan).not.toBeNull();
    });

    it('needs both entry and stoploss depth for the plan and partial_detail for levels', () => {
        const config = {
            ...TIER_CONFIG,
            infoDepth: {
                ...TIER_CONFIG.infoDepth,
                free: ['direction', 'entry'] as const,
            },
        };
        const entryOnly = changeReferenceOf(stored(), { tier: 'free', config });
        expect(entryOnly?.plan).toBeNull();
        expect(entryOnly?.supports).toEqual([]);
        const withLevels = changeReferenceOf(stored(), {
            tier: 'free',
            config: {
                ...config,
                infoDepth: {
                    ...config.infoDepth,
                    free: ['direction', 'partial_detail'] as const,
                },
            },
        });
        expect(withLevels?.supports).toEqual([90, 95]);
        expect(withLevels?.plan).toBeNull();
    });

    it.each<Tier>(['free', 'member', 'pro'])(
        'sees what filterAnalysisResult shows %s',
        tier => {
            const full = {
                summary: '',
                trend: 'neutral',
                indicatorResults: [],
                riskLevel: 'low',
                keyLevels: stored().keyLevels,
                priceTargets: {
                    bullish: { targets: [], condition: '' },
                    bearish: { targets: [], condition: '' },
                },
                patternSummaries: [],
                strategyResults: [],
                candlePatterns: [],
                trendlines: { shortTerm: [], midTerm: [], longTerm: [] },
                actionRecommendation: stored().actionRecommendation,
                analyzedAt: stored().analyzedAt,
            } as unknown as AnalysisResponse;
            const shown = filterAnalysisResult(full, tier).result;
            const reference = changeReferenceOf(stored(), { tier });
            expect(reference?.supports.length === 2).toBe(
                shown.keyLevels !== null
            );
            expect(reference?.plan !== null).toBe(
                shown.actionRecommendation?.entryPrices !== undefined &&
                    shown.actionRecommendation?.stopLoss !== undefined
            );
        }
    );

    it('keeps what is present for as_shown input', () => {
        const trimmed = changeReferenceOf(
            stored({ keyLevels: null, actionRecommendation: null }),
            'as_shown'
        );
        expect(trimmed).toEqual({
            analyzedAt: '2026-11-01T01:00:00.000Z',
            supports: [],
            resistances: [],
            plan: null,
        });
        expect(changeReferenceOf(stored(), 'as_shown')?.supports).toEqual([
            90, 95,
        ]);
    });

    it.each([
        ['null', null],
        ['a string', 'x'],
        ['an array', []],
        ['an empty object', {}],
        ['an unparsable analyzedAt', stored({ analyzedAt: 'yesterday' })],
        ['a non-string analyzedAt', stored({ analyzedAt: 5 })],
    ])('returns null for %s', (_name, value) => {
        expect(changeReferenceOf(value, 'as_shown')).toBeNull();
    });

    it('drops non-finite and non-positive prices one by one', () => {
        const result = changeReferenceOf(
            stored({
                keyLevels: {
                    support: [
                        { price: NaN },
                        { price: -3 },
                        { price: 0 },
                        { price: 88 },
                        null,
                        { price: '7' },
                        { price: 88 },
                    ],
                    resistance: 'broken',
                },
                actionRecommendation: {
                    entryPrices: [NaN, 100, Infinity, 0],
                    stopLoss: NaN,
                    takeProfitPrices: [0, 130],
                },
            }),
            'as_shown'
        );
        expect(result?.supports).toEqual([88]);
        expect(result?.resistances).toEqual([]);
        expect(result?.plan).toMatchObject({
            entryPrices: [100],
            takeProfitPrices: [130],
        });
        expect(result?.plan?.stopLoss).toBeUndefined();
    });

    it('has no plan without a usable entry price', () => {
        expect(
            changeReferenceOf(
                stored({
                    actionRecommendation: { entryPrices: [NaN], stopLoss: 90 },
                }),
                'as_shown'
            )?.plan
        ).toBeNull();
    });

    it('carries the reconciled stop, its rejection, its targets and its basis', () => {
        const withLevels = changeReferenceOf(
            stored({
                actionRecommendation: {
                    entryPrices: [100, 110],
                    stopLoss: 90,
                    takeProfitPrices: [140],
                    reconciledLevels: {
                        stopLoss: 95,
                        takeProfitPrices: [150, 150, 145],
                        stopBasis: 'atr',
                        stopLossRejected: true,
                    },
                },
            }),
            'as_shown'
        );
        expect(withLevels?.plan?.reconciledLevels).toMatchObject({
            stopLoss: 95,
            takeProfitPrices: [145, 150],
            stopBasis: 'atr',
            stopLossRejected: true,
        });
        const bad = changeReferenceOf(
            stored({
                actionRecommendation: {
                    entryPrices: [100],
                    reconciledLevels: { stopBasis: 'model' },
                },
            }),
            'as_shown'
        );
        expect(bad?.plan?.reconciledLevels?.stopBasis).toBeUndefined();
    });

    it('takes the analysis time from the caller when the object has none', () => {
        const projection = stored({ analyzedAt: undefined });
        expect(changeReferenceOf(projection, 'as_shown')).toBeNull();
        expect(
            changeReferenceOf(projection, 'as_shown', {
                analyzedAt: '2026-11-02T03:00:00.000Z',
            })?.analyzedAt
        ).toBe('2026-11-02T03:00:00.000Z');
        expect(
            changeReferenceOf(projection, 'as_shown', {
                analyzedAt: Date.UTC(2026, 10, 2, 3),
            })?.analyzedAt
        ).toBe('2026-11-02T03:00:00.000Z');
        expect(
            changeReferenceOf(projection, 'as_shown', { analyzedAt: 'later' })
        ).toBeNull();
        expect(
            changeReferenceOf(projection, 'as_shown', { analyzedAt: NaN })
        ).toBeNull();
        expect(
            changeReferenceOf(projection, 'as_shown', {
                analyzedAt: 8.64e15 + 1,
            })
        ).toBeNull();
    });

    it("prefers the object's own analyzedAt over the caller's", () => {
        expect(
            changeReferenceOf(stored(), 'as_shown', {
                analyzedAt: '2030-01-01T00:00:00.000Z',
            })?.analyzedAt
        ).toBe('2026-11-01T01:00:00.000Z');
    });

    it('feeds the guest result into technicalChangesBetween without level or plan items', () => {
        const bars = mkBars([120, 105]);
        const guest = changeReferenceOf(stored(), { tier: 'free' });
        const member = changeReferenceOf(stored(), { tier: 'member' });
        const kindsOf = (reference: ChangeReference | null) =>
            okResult(
                technicalChangesBetween(bars, { fromIndex: 0, reference })
            ).changes.map(c => c.kind);
        expect(kindsOf(guest)).toEqual([]);
        expect(kindsOf(member)).toEqual(
            expect.arrayContaining(['plan_position_changed', 'level_crossed'])
        );
    });
});

describe('anchorBarIndexOf', () => {
    const bars = mkBars([1, 2, 3]);

    it('picks the last bar that starts at or before the timestamp', () => {
        const at = (seconds: number) =>
            anchorBarIndexOf(bars, new Date(seconds * 1000).toISOString());
        expect(at(bars[1].time)).toBe(1);
        expect(at(bars[1].time + 3600)).toBe(1);
        expect(at(bars[2].time + 10 * DAY)).toBe(2);
    });

    it('returns null before every bar and for an unparsable timestamp', () => {
        expect(
            anchorBarIndexOf(
                bars,
                new Date((bars[0].time - 1) * 1000).toISOString()
            )
        ).toBeNull();
        expect(anchorBarIndexOf(bars, 'not a date')).toBeNull();
        expect(anchorBarIndexOf([], '2026-11-01T00:00:00Z')).toBeNull();
    });
});

describe('types', () => {
    it('narrows each change kind by its discriminant', () => {
        expectTypeOf<
            Extract<TechnicalChange, { kind: 'level_crossed' }>['direction']
        >().toEqualTypeOf<'down' | 'up'>();
        expectTypeOf<
            Extract<TechnicalChange, { kind: 'trend_changed' }>
        >().toHaveProperty('slopeAtr');
        expectTypeOf<
            Extract<TechnicalChangesResult, { ok: false }>['reason']
        >().toEqualTypeOf<
            'too_short' | 'too_old' | 'same_session' | 'invalid'
        >();
    });
});
