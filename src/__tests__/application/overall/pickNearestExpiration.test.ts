import { describe, it, expect } from 'vitest';
import { pickNearestExpiration } from '@/application/overall/pickNearestExpiration';
import type { OptionsSnapshot, OptionsChain } from '@/domain/types';

const MS_PER_DAY = 1000 * 60 * 60 * 24;
const NOW = new Date('2026-05-22T12:00:00Z');

/**
 * `daysToExpiration` is required on `OptionsChain` and is computed from the
 * expiration date relative to a fixed test `now`. Values can be negative for
 * past expirations — `pickNearestExpiration` filters them out by date string
 * comparison, not by this field, so the negative-day case is still exercised.
 */
function makeChain(date: string): OptionsChain {
    return {
        expirationDate: date,
        daysToExpiration: Math.floor(
            (Date.parse(`${date}T00:00:00Z`) - NOW.getTime()) / MS_PER_DAY
        ),
        calls: [],
        puts: [],
    };
}

function makeSnapshot(dates: string[]): OptionsSnapshot {
    return {
        symbol: 'AAPL',
        underlyingPrice: 100,
        chains: dates.map(makeChain),
        capturedAt: '2026-05-22T13:30:00Z',
    };
}

describe('pickNearestExpiration', () => {
    const now = NOW;

    it('picks earliest expiration ≥ now + 3 days', () => {
        const snap = makeSnapshot(['2026-05-23', '2026-05-24', '2026-05-26', '2026-06-02']);
        expect(pickNearestExpiration(snap, now)).toBe('2026-05-26');
    });

    it('falls back to earliest expiration ≥ now when all are within 3 days', () => {
        const snap = makeSnapshot(['2026-05-23', '2026-05-24']);
        expect(pickNearestExpiration(snap, now)).toBe('2026-05-23');
    });

    it('skips past expirations', () => {
        const snap = makeSnapshot(['2026-05-20', '2026-05-21', '2026-05-26']);
        expect(pickNearestExpiration(snap, now)).toBe('2026-05-26');
    });

    it('returns null when chains is empty', () => {
        const snap = makeSnapshot([]);
        expect(pickNearestExpiration(snap, now)).toBeNull();
    });

    it('returns null when all expirations are in the past', () => {
        const snap = makeSnapshot(['2026-05-20', '2026-05-21']);
        expect(pickNearestExpiration(snap, now)).toBeNull();
    });
});
