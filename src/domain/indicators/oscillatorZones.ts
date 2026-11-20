import {
    CCI_OVERBOUGHT_LEVEL,
    CCI_OVERSOLD_LEVEL,
    RSI_OVERBOUGHT_LEVEL,
    RSI_OVERSOLD_LEVEL,
    STOCHASTIC_OVERBOUGHT_LEVEL,
    STOCHASTIC_OVERSOLD_LEVEL,
    WILLIAMS_R_OVERBOUGHT_LEVEL,
    WILLIAMS_R_OVERSOLD_LEVEL,
} from '@/domain/indicators/constants';
import type { RsiZone } from '@/domain/indicators/rsiZone';
import {
    MFI_OVERBOUGHT_LEVEL,
    MFI_OVERSOLD_LEVEL,
} from '@/domain/signals/constants';

/** Zone of one oscillator reading; the same three values as {@link RsiZone}. */
export type OscillatorZone = RsiZone;

/** The oscillators that get a zone. `rsi2` is excluded: the pullback reading covers it. */
export type OscillatorKey = 'rsi' | 'stochastic' | 'williamsR' | 'cci' | 'mfi';

/** Latest oscillator values; `null` or a non-finite number means "not available". */
export interface OscillatorReadings {
    rsi: number | null;
    /** Stochastic %K. */
    stochasticK: number | null;
    williamsR: number | null;
    cci: number | null;
    mfi: number | null;
}

/** Per-oscillator zones plus one deterministic tally line. */
export interface OscillatorZonesView {
    /** Zone per oscillator; `null` when its reading is not available. */
    zones: Record<OscillatorKey, OscillatorZone | null>;
    /**
     * One-line tally of the available readings, naming the readings that are
     * not available; `null` when none is available.
     */
    summary: string | null;
}

/**
 * @internal A neutral reading closer than this many points to a zone line is
 * called "just above / just below" that line in the summary. It exists because
 * a value such as RSI 30.33 rounds to the oversold line at whole-number
 * precision, and an answer calling it plain "neutral" read as a miss. It is a
 * wording band only: it never changes a zone, and it applies to the bounded
 * oscillators (RSI, stochastic %K, MFI, Williams %R) only — CCI is unbounded
 * and on a different scale, so half a point means nothing there.
 */
export const OSCILLATOR_AT_LINE_POINTS = 0.5;

interface OscillatorSpec {
    key: OscillatorKey;
    /** Display label used in the summary (not the key). */
    label: string;
    reading: keyof OscillatorReadings;
    overbought: number;
    oversold: number;
    /** Whether the near-line wording band applies (bounded oscillators only). */
    nearLine: boolean;
}

/** Order here is the order inside every group of the summary. */
const OSCILLATORS: readonly OscillatorSpec[] = [
    {
        key: 'rsi',
        label: 'RSI',
        reading: 'rsi',
        overbought: RSI_OVERBOUGHT_LEVEL,
        oversold: RSI_OVERSOLD_LEVEL,
        nearLine: true,
    },
    {
        key: 'stochastic',
        label: 'stochastic %K',
        reading: 'stochasticK',
        overbought: STOCHASTIC_OVERBOUGHT_LEVEL,
        oversold: STOCHASTIC_OVERSOLD_LEVEL,
        nearLine: true,
    },
    {
        key: 'williamsR',
        label: 'Williams %R',
        reading: 'williamsR',
        overbought: WILLIAMS_R_OVERBOUGHT_LEVEL,
        oversold: WILLIAMS_R_OVERSOLD_LEVEL,
        nearLine: true,
    },
    {
        key: 'cci',
        label: 'CCI',
        reading: 'cci',
        overbought: CCI_OVERBOUGHT_LEVEL,
        oversold: CCI_OVERSOLD_LEVEL,
        nearLine: false,
    },
    {
        key: 'mfi',
        label: 'MFI',
        reading: 'mfi',
        overbought: MFI_OVERBOUGHT_LEVEL,
        oversold: MFI_OVERSOLD_LEVEL,
        nearLine: true,
    },
];

/** At most two decimals, trailing zeros trimmed, ASCII minus (`-0` prints `0`). */
function formatReading(value: number): string {
    return String(Number(value.toFixed(2)));
}

interface Classified {
    spec: OscillatorSpec;
    value: number;
    zone: OscillatorZone;
}

function classify(spec: OscillatorSpec, value: number): OscillatorZone {
    if (value >= spec.overbought) return 'overbought';
    if (value <= spec.oversold) return 'oversold';
    return 'neutral';
}

/** `RSI 30.33 (just above its oversold line 30)` for a neutral reading hugging a line. */
function neutralItem({ spec, value }: Classified): string {
    const base = `${spec.label} ${formatReading(value)}`;
    if (!spec.nearLine) return base;
    if (value - spec.oversold < OSCILLATOR_AT_LINE_POINTS)
        return `${base} (just above its oversold line ${formatReading(spec.oversold)})`;
    if (spec.overbought - value < OSCILLATOR_AT_LINE_POINTS)
        return `${base} (just below its overbought line ${formatReading(spec.overbought)})`;
    return base;
}

function zoneItem({ spec, value }: Classified): string {
    return `${spec.label} ${formatReading(value)}`;
}

function countPhrase(items: readonly string[]): string {
    return items.length > 0 ? ` (${items.join(', ')})` : '';
}

/**
 * Classifies the latest RSI, stochastic %K, Williams %R, CCI and MFI with the
 * thresholds the engine already uses (inclusive, like `rsiZone`), and
 * renders one deterministic tally line. A rule that tells a model to read an
 * overbought or oversold state from RSI alone hides the other oscillators; the
 * tally is computed here so the model quotes it instead of re-deriving it.
 *
 * Classification uses each value as given (round first when the consumer
 * displays rounded values), so `zones.rsi === rsiZone(readings.rsi)`.
 *
 * @param readings - Latest values; `null` or non-finite means not available.
 * @returns Zone per oscillator and the summary line (`null` when no reading is available).
 */
export function classifyOscillatorZones(
    readings: OscillatorReadings
): OscillatorZonesView {
    const classified: Classified[] = OSCILLATORS.flatMap(spec => {
        const value = readings[spec.reading];
        return value !== null && Number.isFinite(value)
            ? [{ spec, value, zone: classify(spec, value) }]
            : [];
    });
    const zones: Record<OscillatorKey, OscillatorZone | null> = {
        rsi: null,
        stochastic: null,
        williamsR: null,
        cci: null,
        mfi: null,
        ...Object.fromEntries(classified.map(c => [c.spec.key, c.zone])),
    };
    if (classified.length === 0) return { zones, summary: null };
    const inZone = (zone: OscillatorZone): Classified[] =>
        classified.filter(c => c.zone === zone);
    const oversold = inZone('oversold');
    const overbought = inZone('overbought');
    const neutral = inZone('neutral');
    const missing = OSCILLATORS.filter(
        spec => !classified.some(c => c.spec.key === spec.key)
    );
    // Name the denominator: "2 of 2" must not read as "all five" when
    // readings are missing.
    const noun =
        (missing.length > 0 ? 'available ' : '') +
        (classified.length === 1 ? 'oscillator' : 'oscillators');
    const parts = [
        `${oversold.length} of ${classified.length} ${noun} oversold${countPhrase(oversold.map(zoneItem))}`,
        `${overbought.length} overbought${countPhrase(overbought.map(zoneItem))}`,
        ...(neutral.length > 0
            ? [`neutral: ${neutral.map(neutralItem).join(', ')}`]
            : []),
        ...(missing.length > 0
            ? [`not available: ${missing.map(m => m.label).join(', ')}`]
            : []),
    ];
    return { zones, summary: parts.join('; ') };
}
