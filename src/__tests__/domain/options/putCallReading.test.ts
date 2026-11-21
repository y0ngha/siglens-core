import { describe, expect, it } from 'vitest';
import { readPutCallRatio } from '@/domain/options/putCallReading';

describe('readPutCallRatio', () => {
    describe('open interest basis', () => {
        it('reads a ratio below 1 as more calls', () => {
            expect(readPutCallRatio(0.58, 'open_interest')).toEqual({
                side: 'more_calls',
                text: '0.58 puts per call by open interest: more call contracts open than put contracts',
            });
        });

        it('reads a ratio above 1 as more puts', () => {
            expect(readPutCallRatio(1.42, 'open_interest')).toEqual({
                side: 'more_puts',
                text: '1.42 puts per call by open interest: more put contracts open than call contracts',
            });
        });

        it('reads exactly 1 as even', () => {
            expect(readPutCallRatio(1, 'open_interest')).toEqual({
                side: 'even',
                text: '1 puts per call by open interest: puts and calls even',
            });
        });

        it('reads zero as more calls and prints it as 0', () => {
            expect(readPutCallRatio(0, 'open_interest')).toEqual({
                side: 'more_calls',
                text: '0 puts per call by open interest: more call contracts open than put contracts',
            });
        });
    });

    describe('notional basis', () => {
        it('reads a ratio above 1 as more put exposure', () => {
            expect(readPutCallRatio(1.42, 'notional')).toEqual({
                side: 'more_puts',
                text: '1.42 puts per call by underlying notional (13F): more put exposure than call exposure',
            });
        });

        it('reads a ratio below 1 as more call exposure', () => {
            expect(readPutCallRatio(0.83, 'notional')).toEqual({
                side: 'more_calls',
                text: '0.83 puts per call by underlying notional (13F): more call exposure than put exposure',
            });
        });

        it('reads exactly 1 as even', () => {
            expect(readPutCallRatio(1, 'notional')).toEqual({
                side: 'even',
                text: '1 puts per call by underlying notional (13F): puts and calls even',
            });
        });
    });

    describe('values on either side of 1', () => {
        it('reads just below 1 as more calls', () => {
            expect(readPutCallRatio(0.9999, 'open_interest')?.side).toBe(
                'more_calls'
            );
        });

        it('reads just above 1 as more puts', () => {
            expect(readPutCallRatio(1.0001, 'open_interest')?.side).toBe(
                'more_puts'
            );
        });
    });

    describe('unusable ratios', () => {
        it('returns null for null', () => {
            expect(readPutCallRatio(null, 'open_interest')).toBeNull();
        });

        it('returns null for NaN', () => {
            expect(readPutCallRatio(NaN, 'notional')).toBeNull();
        });

        it('returns null for Infinity', () => {
            expect(readPutCallRatio(Infinity, 'open_interest')).toBeNull();
        });

        it('returns null for -Infinity', () => {
            expect(readPutCallRatio(-Infinity, 'open_interest')).toBeNull();
        });

        it('returns null for a negative ratio', () => {
            expect(readPutCallRatio(-0.5, 'open_interest')).toBeNull();
        });
    });
});
