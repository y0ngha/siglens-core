import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatLevelHoldFraming } from '@/domain/analysis/priceLevelBaseRate';
import {
    PRICE_LEVEL_BASE_RATE,
    type MeasuredBaseRate,
} from '@/domain/analysis/measuredBaseRates';

const percent = (share: number): string => `${(share * 100).toFixed(1)}%`;

describe('formatLevelHoldFraming', () => {
    it('prints every daily figure from the generated row, with grouped digits', () => {
        const { scope } = PRICE_LEVEL_BASE_RATE;
        const text = formatLevelHoldFraming('1Day');
        expect(text).toContain(
            `Measured on ${scope.symbols} symbols (U.S. and Korean), daily bars ${scope.from.slice(0, 4)}–${scope.to.slice(0, 4)}`
        );
        expect(text).toContain(
            `in ${percent(PRICE_LEVEL_BASE_RATE.eventShare)} of ${PRICE_LEVEL_BASE_RATE.n.toLocaleString('en-US')} touches`
        );
        expect(text).toContain(
            `on another date (${percent(PRICE_LEVEL_BASE_RATE.placeboShare)})`
        );
        // Only what the row carries (DOM-12): no claim about groups of levels.
        expect(text).not.toContain('moved that by more than');
    });

    it('renders whatever row it is given, one decimal and grouped touches', () => {
        const row: MeasuredBaseRate = {
            ...PRICE_LEVEL_BASE_RATE,
            n: 1_234_567,
            eventShare: 0.512,
            placeboShare: 0.4985,
            scope: {
                timeframe: '1Day',
                symbols: 3,
                from: '2020-02-01',
                to: '2021-12-31',
            },
        };
        const text = formatLevelHoldFraming('1Day', row);
        expect(text).toContain('Measured on 3 symbols (U.S. and Korean)');
        expect(text).toContain('daily bars 2020–2021');
        expect(text).toContain('in 51.2% of 1,234,567 touches');
        expect(text).toContain('on another date (49.9%)');
    });

    it.each(['5Min', '15Min', '30Min', '1Hour', '4Hour'] as const)(
        'says the levels are not measured on %s bars and prints no number',
        timeframe => {
            const text = formatLevelHoldFraming(timeframe);
            expect(text).toMatch(/^Not measured on intraday bars\./);
            expect(text).not.toMatch(/\d/);
        }
    );

    it('says the levels are not measured on weekly bars, with no number and no "intraday"', () => {
        const text = formatLevelHoldFraming('1Week');
        expect(text).toMatch(/^Not measured on weekly bars\./);
        expect(text).not.toMatch(/\d/);
        expect(text).not.toMatch(/intraday/i);
    });

    it('tells the model not to call a level strong because references coincide, on every timeframe', () => {
        for (const timeframe of ['1Day', '1Hour', '1Week'] as const) {
            expect(formatLevelHoldFraming(timeframe)).toContain(
                'a map of where price may pause or react, not as levels that hold; do not call a level strong, firm or key because several references coincide there'
            );
        }
    });
});

describe('the core-2 placeholder is gone', () => {
    const analysisDir = resolve(__dirname, '../../../domain/analysis');

    it('has the generated table and no second source for the hold rate (CP-11)', () => {
        expect(existsSync(resolve(analysisDir, 'measuredBaseRates.ts'))).toBe(
            true
        );
        const source = readFileSync(
            resolve(analysisDir, 'priceLevelBaseRate.ts'),
            'utf-8'
        );
        expect(source).not.toMatch(/export const PRICE_LEVEL_HOLD_RATE\b/);
        expect(source).not.toMatch(/export interface PriceLevelHoldRate\b/);
    });
});
