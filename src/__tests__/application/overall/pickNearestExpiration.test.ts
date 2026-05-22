import { describe, it, expect } from 'vitest';
import { pickNearestExpiration } from '@/application/overall/pickNearestExpiration';
import type { OptionsSnapshot, OptionsChain } from '@/domain/types';

function makeChain(date: string): OptionsChain {
    return {
        expirationDate: date,
        calls: [],
        puts: [],
    } as OptionsChain;
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
    const now = new Date('2026-05-22T12:00:00Z');

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
