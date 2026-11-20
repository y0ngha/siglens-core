import { describe, expect, it } from 'vitest';
import {
    OSCILLATOR_AT_LINE_POINTS,
    classifyOscillatorZones,
    type OscillatorKey,
    type OscillatorReadings,
} from '@/domain/indicators/oscillatorZones';
import { rsiZone } from '@/domain/indicators/rsiZone';

const NONE: OscillatorReadings = {
    rsi: null,
    stochasticK: null,
    williamsR: null,
    cci: null,
    mfi: null,
};

const READING_OF: Record<OscillatorKey, keyof OscillatorReadings> = {
    rsi: 'rsi',
    stochastic: 'stochasticK',
    williamsR: 'williamsR',
    cci: 'cci',
    mfi: 'mfi',
};

/** key, overbought line, oversold line (the engine's own levels, inclusive). */
const LINES: ReadonlyArray<readonly [OscillatorKey, number, number]> = [
    ['rsi', 70, 30],
    ['stochastic', 80, 20],
    ['williamsR', -20, -80],
    ['cci', 100, -100],
    ['mfi', 80, 20],
];

function zoneOf(key: OscillatorKey, value: number): string | null {
    return classifyOscillatorZones({ ...NONE, [READING_OF[key]]: value }).zones[
        key
    ];
}

describe('classifyOscillatorZones zones', () => {
    it.each(LINES)(
        '%s: the overbought line itself is overbought',
        (key, hi) => {
            expect(zoneOf(key, hi)).toBe('overbought');
        }
    );

    it.each(LINES)(
        '%s: just inside the overbought line is neutral',
        (key, hi) => {
            expect(zoneOf(key, hi - 0.01)).toBe('neutral');
        }
    );

    it.each(LINES)(
        '%s: the oversold line itself is oversold',
        (key, _hi, lo) => {
            expect(zoneOf(key, lo)).toBe('oversold');
        }
    );

    it.each(LINES)(
        '%s: just inside the oversold line is neutral',
        (key, _hi, lo) => {
            expect(zoneOf(key, lo + 0.01)).toBe('neutral');
        }
    );

    it('marks an unavailable reading null and leaves the others classified', () => {
        const { zones } = classifyOscillatorZones({
            ...NONE,
            rsi: 50,
            cci: Number.NaN,
            mfi: Number.POSITIVE_INFINITY,
        });
        expect(zones).toEqual({
            rsi: 'neutral',
            stochastic: null,
            williamsR: null,
            cci: null,
            mfi: null,
        });
    });

    it.each([0, 29.99, 30, 44.74, 69.99, 70, 100])(
        'zones.rsi equals rsiZone(%s)',
        rsi => {
            expect(classifyOscillatorZones({ ...NONE, rsi }).zones.rsi).toBe(
                rsiZone(rsi)
            );
        }
    );
});

describe('classifyOscillatorZones summary', () => {
    it('tallies a mixed reading, listing oversold names then neutral ones', () => {
        const { summary } = classifyOscillatorZones({
            rsi: 44.74,
            stochasticK: 15.96,
            williamsR: -80.08,
            cci: -103.51,
            mfi: 32.07,
        });
        expect(summary).toBe(
            '3 of 5 oscillators oversold (stochastic %K 15.96, Williams %R -80.08, CCI -103.51); 0 overbought; neutral: RSI 44.74, MFI 32.07'
        );
    });

    it('lists overbought readings and trims trailing zeros', () => {
        const { summary } = classifyOscillatorZones({
            rsi: 71.5,
            stochasticK: 90,
            williamsR: -10.123,
            cci: 50,
            mfi: null,
        });
        expect(summary).toBe(
            '0 of 4 available oscillators oversold; 3 overbought (RSI 71.5, stochastic %K 90, Williams %R -10.12); neutral: CCI 50; not available: MFI'
        );
    });

    it('prints 0 of M without a list and flags a neutral value hugging its line', () => {
        const { summary } = classifyOscillatorZones({
            rsi: 30.33,
            stochasticK: 41.2,
            williamsR: null,
            cci: -12.5,
            mfi: 48,
        });
        expect(summary).toBe(
            '0 of 4 available oscillators oversold; 0 overbought; neutral: RSI 30.33 (just above its oversold line 30), stochastic %K 41.2, CCI -12.5, MFI 48; not available: Williams %R'
        );
    });

    it('omits the neutral part when every reading is in a zone', () => {
        const { summary } = classifyOscillatorZones({
            rsi: 25,
            stochasticK: 10,
            williamsR: -90,
            cci: -150,
            mfi: 5,
        });
        expect(summary).toBe(
            '5 of 5 oscillators oversold (RSI 25, stochastic %K 10, Williams %R -90, CCI -150, MFI 5); 0 overbought'
        );
    });

    it('is null when no reading is available', () => {
        expect(classifyOscillatorZones(NONE).summary).toBeNull();
        expect(
            classifyOscillatorZones({ ...NONE, rsi: Number.NaN }).summary
        ).toBeNull();
    });

    it('adds the just-above suffix 0.49 points over the oversold line', () => {
        expect(classifyOscillatorZones({ ...NONE, rsi: 30.49 }).summary).toBe(
            '0 of 1 available oscillator oversold; 0 overbought; neutral: RSI 30.49 (just above its oversold line 30); not available: stochastic %K, Williams %R, CCI, MFI'
        );
    });

    it('adds no suffix 0.5 points over the oversold line', () => {
        expect(classifyOscillatorZones({ ...NONE, rsi: 30.5 }).summary).toBe(
            '0 of 1 available oscillator oversold; 0 overbought; neutral: RSI 30.5; not available: stochastic %K, Williams %R, CCI, MFI'
        );
    });

    it('adds the just-below suffix 0.49 points under the overbought line', () => {
        expect(
            classifyOscillatorZones({ ...NONE, williamsR: -20.49 }).summary
        ).toBe(
            '0 of 1 available oscillator oversold; 0 overbought; neutral: Williams %R -20.49 (just below its overbought line -20); not available: RSI, stochastic %K, CCI, MFI'
        );
    });

    it('never adds a near-line suffix to CCI, which is on a different scale', () => {
        expect(classifyOscillatorZones({ ...NONE, cci: 99.9 }).summary).toBe(
            '0 of 1 available oscillator oversold; 0 overbought; neutral: CCI 99.9; not available: RSI, stochastic %K, Williams %R, MFI'
        );
    });

    it('names the denominator and lists the readings that are not available', () => {
        expect(
            classifyOscillatorZones({ ...NONE, rsi: 25, mfi: 10 }).summary
        ).toBe(
            '2 of 2 available oscillators oversold (RSI 25, MFI 10); 0 overbought; not available: stochastic %K, Williams %R, CCI'
        );
    });

    it('does not apply the near-line band to CCI at either line', () => {
        expect(
            classifyOscillatorZones({ ...NONE, cci: -99.9 }).summary
        ).toContain('neutral: CCI -99.9;');
    });

    it('applies the near-line band to MFI', () => {
        expect(
            classifyOscillatorZones({ ...NONE, mfi: 79.6 }).summary
        ).toContain('MFI 79.6 (just below its overbought line 80)');
    });

    it('prints a reading that rounds to zero as 0', () => {
        expect(classifyOscillatorZones({ ...NONE, cci: -0.001 }).summary).toBe(
            '0 of 1 available oscillator oversold; 0 overbought; neutral: CCI 0; not available: RSI, stochastic %K, Williams %R, MFI'
        );
    });

    it('keeps the near-line band at half a point', () => {
        expect(OSCILLATOR_AT_LINE_POINTS).toBe(0.5);
    });
});
