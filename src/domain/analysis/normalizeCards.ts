import {
    CYCLE_CARD_KINDS,
    INDICATOR_CARD_BASIS,
    INDICATOR_CARD_KINDS,
    INDICATOR_CARD_STATE_VALUES,
    INDICATOR_CARD_VALUE_KEYS,
} from '@/domain/analysis/computedCardKinds';
import {
    asArray,
    asObject,
    asOptionalEnum,
} from '@/domain/analysis/normalizePrimitives';
import type {
    CycleLineSlope,
    CycleReading,
    CycleStage,
    ImpulseColor,
    IndicatorCardKind,
    IndicatorCardSignal,
    IndicatorReading,
    SignalPhase,
    SignalType,
} from '@/domain/types';

// Both normalizers read a stored card on the cache-read path, where the card was written by
// `buildIndicatorCards` / `buildCycleCards`. They never coerce: a reading with any member that
// is not what the builder writes is dropped as a whole (the card keeps its other fields), and
// the model-reply path never calls them, so a model cannot supply a reading.

const SIGNAL_PHASES: readonly SignalPhase[] = ['confirmed', 'expected'];
const IMPULSE_COLORS: readonly ImpulseColor[] = ['green', 'red', 'blue'];
const LINE_SLOPES = ['rising', 'falling', 'flat'] as const;
const PROGRESSIONS = ['forward', 'reverse'] as const;
const MA_ROLES = ['short', 'medium', 'long'] as const;
const STAGES: readonly CycleStage[] = [1, 2, 3, 4, 5, 6];

const isFiniteNumber = (v: unknown): v is number =>
    typeof v === 'number' && Number.isFinite(v);

const isNonNegativeInteger = (v: unknown): v is number =>
    typeof v === 'number' && Number.isInteger(v) && v >= 0;

/** A stored `{ type, phase, barsAgo }`, or `null` when any member is off. */
function normalizeCardSignal(v: unknown): IndicatorCardSignal | null {
    const o = asObject(v);
    const phase = asOptionalEnum(o?.phase, SIGNAL_PHASES);
    if (
        o === null ||
        typeof o.type !== 'string' ||
        o.type === '' ||
        phase === undefined ||
        !isNonNegativeInteger(o.barsAgo)
    ) {
        return null;
    }
    // `type` is a name the builder took from a detected `Signal`; the stored string is kept
    // as written (a signal added after this cache entry was written is not a corrupt one).
    return { type: o.type as SignalType, phase, barsAgo: o.barsAgo };
}

/** The values of a stored reading when every key the kind owns is a finite number or `null`. */
function normalizeCardValues(
    kind: IndicatorCardKind,
    raw: unknown
): Record<string, number | null> | null {
    const o = asObject(raw);
    if (o === null) return null;
    const keys: readonly string[] = INDICATOR_CARD_VALUE_KEYS[kind];
    const entries = keys.flatMap((key): [string, number | null][] => {
        const value = o[key];
        return value === null || isFiniteNumber(value) ? [[key, value]] : [];
    });
    return entries.length === keys.length ? Object.fromEntries(entries) : null;
}

/**
 * @internal A stored `AnalysisSignal.reading`, or `undefined` when it is not one the builder
 * writes: an unknown kind or state, a `basis` that is not the kind's, a value that is neither
 * a finite number nor `null` (or a missing one), a signal that is malformed, an event reading
 * without a signal for its state, or a non-event reading with signals.
 */
export function normalizeIndicatorReading(
    raw: unknown
): IndicatorReading | undefined {
    const o = asObject(raw);
    const kind = asOptionalEnum<IndicatorCardKind>(
        o?.kind,
        INDICATOR_CARD_KINDS
    );
    if (o === null || kind === undefined) return undefined;
    if (o.basis !== INDICATOR_CARD_BASIS[kind]) return undefined;
    const states: readonly unknown[] | null = INDICATOR_CARD_STATE_VALUES[kind];
    if (typeof o.state !== 'string') return undefined;
    if (states !== null && !states.includes(o.state)) return undefined;
    const values = normalizeCardValues(kind, o.values);
    const signalList = asArray(o.signals).map(normalizeCardSignal);
    const signals = signalList.filter(
        (s): s is IndicatorCardSignal => s !== null
    );
    if (values === null || signals.length !== signalList.length) {
        return undefined;
    }
    const isEvent = INDICATOR_CARD_BASIS[kind] === 'event';
    if (isEvent !== signals.length > 0) return undefined;
    if (isEvent && !signals.some(s => s.type === o.state)) return undefined;
    const flippedFrom =
        kind === 'elder_impulse'
            ? o.flippedFrom === null
                ? null
                : asOptionalEnum(o.flippedFrom, IMPULSE_COLORS)
            : undefined;
    if (kind === 'elder_impulse' && flippedFrom === undefined) {
        return undefined;
    }
    // Safe cast: kind, basis, state, every value and every signal were checked against the
    // tables the builder's reading types are written from.
    return {
        kind,
        basis: INDICATOR_CARD_BASIS[kind],
        state: o.state,
        values,
        signals,
        ...(kind === 'elder_impulse' ? { flippedFrom } : {}),
    } as IndicatorReading;
}

const normalizeSlope = (v: unknown): CycleLineSlope | undefined =>
    v === null ? null : asOptionalEnum(v, LINE_SLOPES);

/** A record of finite numbers (`values`), or `null` when any entry is not one. */
function normalizeNumberRecord(raw: unknown): Record<string, number> | null {
    const o = asObject(raw);
    if (o === null) return null;
    const entries = Object.entries(o);
    return entries.every(([, v]) => isFiniteNumber(v))
        ? Object.fromEntries(entries as [string, number][])
        : null;
}

/**
 * @internal A stored `StrategyResult.cycle`, or `undefined` when it is not one the builder
 * writes: an unknown kind, a stage outside 1..6, a previous stage or progression that is not
 * `null` or valid, a count that is not a non-negative integer, a value that is not a finite
 * number, or a slope that is not a direction or `null`.
 */
export function normalizeCycleReading(raw: unknown): CycleReading | undefined {
    const o = asObject(raw);
    const kind = asOptionalEnum(o?.kind, CYCLE_CARD_KINDS);
    const stage = STAGES.find(s => s === o?.stage);
    if (o === null || kind === undefined || stage === undefined) {
        return undefined;
    }
    const previousStage =
        o.previousStage === null
            ? null
            : STAGES.find(s => s === o.previousStage);
    const progression =
        o.progression === null
            ? null
            : asOptionalEnum(o.progression, PROGRESSIONS);
    const values = normalizeNumberRecord(o.values);
    const slopeEntries = Object.entries(asObject(o.slopes) ?? {}).map(
        ([key, value]) => [key, normalizeSlope(value)] as const
    );
    const order = o.order === undefined ? undefined : asArray(o.order);
    const orderRoles = order?.map(role => asOptionalEnum(role, MA_ROLES));
    if (
        previousStage === undefined ||
        progression === undefined ||
        values === null ||
        asObject(o.slopes) === null ||
        slopeEntries.some(([, slope]) => slope === undefined) ||
        !isNonNegativeInteger(o.stageChanges) ||
        (o.barsInStage !== null && !isNonNegativeInteger(o.barsInStage)) ||
        (orderRoles !== undefined &&
            orderRoles.some(role => role === undefined))
    ) {
        return undefined;
    }
    // Safe casts: the slope entries and roles were checked non-`undefined` just above.
    return {
        kind,
        stage,
        previousStage,
        barsInStage: o.barsInStage as number | null,
        progression,
        stageChanges: o.stageChanges,
        values,
        ...(orderRoles === undefined
            ? {}
            : { order: orderRoles as CycleReading['order'] }),
        slopes: Object.fromEntries(slopeEntries) as CycleReading['slopes'],
    };
}
