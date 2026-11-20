import { describe, expect, it } from 'vitest';
import { MS_PER_MINUTE } from '@/domain/constants/time';
import { TIMEFRAME_MINUTES } from '@/domain/constants/market';
import { OUTCOME_WINDOW_BARS } from '@/domain/outcomes/constants';
import { outcomeEarliestLabelTime } from '@/domain/outcomes/outcomeEarliestLabelTime';
import type { Timeframe } from '@/domain/types';

const GENERATED_AT = new Date('2026-11-02T14:30:00.000Z');

describe('outcomeEarliestLabelTime', () => {
    it.each<[Timeframe, number]>([
        ['5Min', 100],
        ['15Min', 300],
        ['30Min', 600],
        ['1Hour', 1_200],
        ['4Hour', 4_800],
        ['1Day', 28_800],
    ])(
        'is the window length of %s bars after generation (%i minutes)',
        (timeframe, minutes) => {
            expect(
                outcomeEarliestLabelTime(GENERATED_AT, timeframe).getTime()
            ).toBe(GENERATED_AT.getTime() + minutes * MS_PER_MINUTE);
            expect(minutes).toBe(
                OUTCOME_WINDOW_BARS * TIMEFRAME_MINUTES[timeframe]
            );
        }
    );

    it('puts a daily analysis 20 calendar days later', () => {
        expect(
            outcomeEarliestLabelTime(GENERATED_AT, '1Day').toISOString()
        ).toBe('2026-11-22T14:30:00.000Z');
    });

    it('returns a new Date and leaves the input alone', () => {
        const input = new Date(GENERATED_AT);
        const result = outcomeEarliestLabelTime(input, '1Hour');
        expect(result).not.toBe(input);
        expect(input.getTime()).toBe(GENERATED_AT.getTime());
    });
});
