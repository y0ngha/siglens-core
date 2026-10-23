import { describe, expect, it } from 'vitest';
import {
    isRateDecisionEvent,
    selectCalendarEvents,
} from '@/domain/economy/selectCalendarEvents';
import type { CalendarImpact, EconomicCalendarEvent } from '@/domain/types';

function row(
    date: string,
    event: string,
    impact: CalendarImpact
): EconomicCalendarEvent {
    return {
        date,
        event,
        impact,
        actual: null,
        estimate: null,
        previous: null,
        unit: '%',
    };
}

/** `2026-10-23 HH:00:00` plus `day` days — FMP's naive UTC shape. */
function at(day: number, hour = 12): string {
    const d = new Date(Date.UTC(2026, 9, 23 + day, hour));
    return d.toISOString().replace('T', ' ').slice(0, 19);
}

describe('isRateDecisionEvent', () => {
    it('matches the FMP rate-decision row and nothing around it', () => {
        expect(
            isRateDecisionEvent(
                row(at(5), 'Fed Interest Rate Decision', 'High')
            )
        ).toBe(true);
        expect(
            isRateDecisionEvent(row(at(5), 'FOMC Economic Projections', 'High'))
        ).toBe(false);
        expect(
            isRateDecisionEvent(row(at(5), 'Press Conference', 'High'))
        ).toBe(false);
    });
});

describe('selectCalendarEvents', () => {
    it('keeps an FOMC decision that nearer Low rows would have crowded out of the first N by date', () => {
        // 2026-10-23: rig count and CFTC rows filled the first 10 slots, so
        // the decision five days out never reached the agent.
        const lows = Array.from({ length: 10 }, (_, i) =>
            row(at(0, 13 + i), `CFTC position ${i}`, 'Low')
        );
        const fomc = row(at(5, 18), 'Fed Interest Rate Decision', 'High');
        const { events, omitted } = selectCalendarEvents([...lows, fomc], {
            max: 6,
        });
        expect(events.map(e => e.event)).toEqual([
            'CFTC position 0',
            'CFTC position 1',
            'CFTC position 2',
            'CFTC position 3',
            'CFTC position 4',
            'Fed Interest Rate Decision',
        ]);
        expect(omitted).toEqual({ High: 0, Medium: 0, Low: 5 });
    });

    it('fills High, then Medium, then Low, nearest first, and returns the pick date-ascending', () => {
        const { events } = selectCalendarEvents(
            [
                row(at(1), 'low near', 'Low'),
                row(at(2), 'medium near', 'Medium'),
                row(at(9), 'high far', 'High'),
                row(at(3), 'high near', 'High'),
                row(at(8), 'medium far', 'Medium'),
            ],
            { max: 3 }
        );
        expect(events.map(e => e.event)).toEqual([
            'medium near',
            'high near',
            'high far',
        ]);
    });

    it('pins rate decisions even when more High rows than max sit before them', () => {
        const highs = Array.from({ length: 5 }, (_, i) =>
            row(at(1 + i), `High ${i}`, 'High')
        );
        const later = row(at(40, 18), 'Fed Interest Rate Decision', 'High');
        const { events, omitted } = selectCalendarEvents([...highs, later], {
            max: 3,
        });
        expect(events.map(e => e.event)).toEqual([
            'High 0',
            'High 1',
            'Fed Interest Rate Decision',
        ]);
        expect(omitted.High).toBe(3);
    });

    it('drops rows before notBefore and rows with an unparseable date, and does not count them as omitted', () => {
        const { events, omitted } = selectCalendarEvents(
            [
                row(at(-1), 'yesterday', 'High'),
                row('not a date', 'broken', 'High'),
                row(at(1), 'tomorrow', 'Low'),
            ],
            { max: 5, notBefore: new Date(Date.UTC(2026, 9, 23)) }
        );
        expect(events.map(e => e.event)).toEqual(['tomorrow']);
        expect(omitted).toEqual({ High: 0, Medium: 0, Low: 0 });
    });

    it('keeps a row at exactly notBefore', () => {
        const boundary = new Date(Date.UTC(2026, 9, 23, 12));
        const { events } = selectCalendarEvents(
            [row(at(0, 12), 'at the boundary', 'Low')],
            { max: 5, notBefore: boundary }
        );
        expect(events.map(e => e.event)).toEqual(['at the boundary']);
    });

    it('caps rate decisions too: with more decisions than max, the nearest ones stay', () => {
        const { events, omitted } = selectCalendarEvents(
            [
                row(at(90), 'Fed Interest Rate Decision', 'High'),
                row(at(5), 'Fed Interest Rate Decision', 'High'),
                row(at(45), 'Fed Interest Rate Decision', 'High'),
                row(at(1), 'CPI', 'High'),
            ],
            { max: 2 }
        );
        expect(events.map(e => e.date)).toEqual([at(5), at(45)]);
        expect(omitted.High).toBe(2);
    });

    it('treats a non-finite max as zero', () => {
        const { events } = selectCalendarEvents([row(at(1), 'a', 'High')], {
            max: Number.NaN,
        });
        expect(events).toEqual([]);
    });

    it('keeps every row without notBefore, sorting an unparseable date last', () => {
        const { events } = selectCalendarEvents(
            [row('not a date', 'broken', 'High'), row(at(-3), 'past', 'Low')],
            { max: 5 }
        );
        expect(events.map(e => e.event)).toEqual(['past', 'broken']);
    });

    it('returns nothing for a non-positive max and counts every row as omitted', () => {
        const { events, omitted } = selectCalendarEvents(
            [row(at(1), 'a', 'High'), row(at(2), 'b', 'Medium')],
            { max: 0 }
        );
        expect(events).toEqual([]);
        expect(omitted).toEqual({ High: 1, Medium: 1, Low: 0 });
    });

    it('counts a row object passed twice once per occurrence in omitted', () => {
        const dup = row(at(9), 'duplicated', 'Low');
        const { omitted } = selectCalendarEvents(
            [row(at(1), 'kept', 'High'), dup, dup],
            { max: 1 }
        );
        expect(omitted.Low).toBe(2);
    });

    it('does not rewrite the date strings it returns', () => {
        const naive = row(
            '2026-10-28 18:00:00',
            'Fed Interest Rate Decision',
            'High'
        );
        const { events } = selectCalendarEvents([naive], { max: 1 });
        expect(events[0]).toBe(naive);
    });
});
