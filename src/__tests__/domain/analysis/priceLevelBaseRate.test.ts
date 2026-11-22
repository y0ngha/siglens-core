import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    formatLevelHoldFraming,
    PRICE_LEVEL_HOLD_RATE,
    type PriceLevelHoldRate,
} from '@/domain/analysis/priceLevelBaseRate';

describe('formatLevelHoldFraming', () => {
    it('prints every daily figure from the rate, with grouped digits', () => {
        const text = formatLevelHoldFraming('1Day');
        expect(text).toContain(
            `Measured on ${PRICE_LEVEL_HOLD_RATE.symbols} symbols (${PRICE_LEVEL_HOLD_RATE.usSymbols} U.S., ${PRICE_LEVEL_HOLD_RATE.krSymbols} Korean), daily bars ${PRICE_LEVEL_HOLD_RATE.fromYear}–${PRICE_LEVEL_HOLD_RATE.toYear}`
        );
        expect(text).toContain('in 49.6% of 550,171 touches');
        expect(text).toContain('on another date (49.7%)');
        expect(text).toContain('by more than about 2 points');
    });

    it('renders whatever rate it is given, one decimal and grouped touches', () => {
        const rate: PriceLevelHoldRate = {
            symbols: 3,
            usSymbols: 2,
            krSymbols: 1,
            fromYear: 2020,
            toYear: 2021,
            touches: 1_234_567,
            heldShare: 0.512,
            placeboShare: 0.4985,
            groupSpreadPoints: 3,
        };
        const text = formatLevelHoldFraming('1Day', rate);
        expect(text).toContain('Measured on 3 symbols (2 U.S., 1 Korean)');
        expect(text).toContain('daily bars 2020–2021');
        expect(text).toContain('in 51.2% of 1,234,567 touches');
        expect(text).toContain('on another date (49.9%)');
        expect(text).toContain('about 3 points');
    });

    it.each(['5Min', '15Min', '30Min', '1Hour', '4Hour'] as const)(
        'says the levels are not measured on %s bars and prints no number',
        timeframe => {
            const text = formatLevelHoldFraming(timeframe);
            expect(text).toMatch(/^Not measured on intraday bars\./);
            expect(text).not.toMatch(/\d/);
        }
    );

    it('tells the model not to call a level strong because references coincide, on every timeframe', () => {
        for (const timeframe of ['1Day', '1Hour'] as const) {
            expect(formatLevelHoldFraming(timeframe)).toContain(
                'a map of where price may pause or react, not as levels that hold; do not call a level strong, firm or key because several references coincide there'
            );
        }
    });
});

describe('PRICE_LEVEL_HOLD_RATE is a placeholder for the generated table', () => {
    const analysisDir = resolve(__dirname, '../../../domain/analysis');

    it('is removed once measuredBaseRates.ts (WP-18 core-3) exists', () => {
        // The generated `PRICE_LEVEL_BASE_RATE` row is the same measurement; two sources for
        // one number is the drift CP-11 forbids, so core-3 must delete this constant.
        const generated = existsSync(
            resolve(analysisDir, 'measuredBaseRates.ts')
        );
        const source = readFileSync(
            resolve(analysisDir, 'priceLevelBaseRate.ts'),
            'utf-8'
        );
        const stillExported = /export const PRICE_LEVEL_HOLD_RATE\b/.test(
            source
        );
        expect(generated && stillExported).toBe(false);
    });

    it('states the measured study range, which starts after the first 300 bars', () => {
        expect(PRICE_LEVEL_HOLD_RATE.fromYear).toBe(2018);
        expect(PRICE_LEVEL_HOLD_RATE.toYear).toBe(2026);
    });
});
