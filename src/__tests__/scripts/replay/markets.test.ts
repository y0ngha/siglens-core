import { describe, expect, it } from 'vitest';
import { US_EQUITY_SESSION } from '@/domain/session';
import {
    CLOCK_AFTER_CLOSE_MINUTES,
    KR_SESSION,
    marketOfSymbol,
    profileOf,
    sessionCloseInstantMs,
} from '../../../../scripts/replay/markets';
import {
    REPLAY_KR_SYMBOLS,
    REPLAY_SYMBOLS,
    REPLAY_US_ADDED_SYMBOLS,
    REPLAY_US_BASE_SYMBOLS,
    REPLAY_US_SYMBOLS,
} from '../../../../scripts/replay/symbols';

const MS_PER_MINUTE = 60_000;

describe('replay symbols', () => {
    it('lists 40 + 15 US symbols and 10 Korean ones', () => {
        expect(REPLAY_US_BASE_SYMBOLS).toHaveLength(40);
        expect(REPLAY_US_ADDED_SYMBOLS).toHaveLength(15);
        expect(REPLAY_US_SYMBOLS).toHaveLength(55);
        expect(REPLAY_KR_SYMBOLS).toHaveLength(10);
        expect(REPLAY_SYMBOLS).toHaveLength(65);
    });

    it('has no duplicate symbol', () => {
        expect(new Set(REPLAY_SYMBOLS).size).toBe(REPLAY_SYMBOLS.length);
    });

    it('classifies every listed symbol into the market its list says', () => {
        expect(REPLAY_US_SYMBOLS.length).toBeGreaterThan(0);
        expect(REPLAY_KR_SYMBOLS.length).toBeGreaterThan(0);
        expect(REPLAY_US_SYMBOLS.every(s => marketOfSymbol(s) === 'us')).toBe(
            true
        );
        expect(REPLAY_KR_SYMBOLS.every(s => marketOfSymbol(s) === 'kr')).toBe(
            true
        );
    });
});

describe('marketOfSymbol', () => {
    it('reads the .KS and .KQ suffixes as Korean', () => {
        expect(marketOfSymbol('005930.KS')).toBe('kr');
        expect(marketOfSymbol('086520.KQ')).toBe('kr');
    });

    it('does not read a US ticker that merely contains KS as Korean', () => {
        expect(marketOfSymbol('KS')).toBe('us');
        expect(marketOfSymbol('NVDA')).toBe('us');
    });
});

describe('profileOf', () => {
    it('gives US the NYSE session in USD and Korea the KRX session in KRW', () => {
        expect(profileOf('us')).toMatchObject({
            session: US_EQUITY_SESSION,
            currency: 'USD',
        });
        expect(profileOf('kr')).toMatchObject({
            session: KR_SESSION,
            currency: 'KRW',
            krxTickTable: 'share',
        });
    });
});

describe('KR_SESSION', () => {
    it('is 09:00 to 15:30 KST with weekends closed', () => {
        expect(KR_SESSION).toMatchObject({
            kind: 'scheduled',
            timeZone: 'Asia/Seoul',
            openMinute: 540,
            closeMinute: 930,
            weekendDays: [0, 6],
        });
    });
});

describe('sessionCloseInstantMs', () => {
    it('is one hour after the 16:00 EST close in winter (21:00 UTC close)', () => {
        const instant = sessionCloseInstantMs(US_EQUITY_SESSION, '2024-01-17');
        expect(new Date(instant).toISOString()).toBe(
            '2024-01-17T22:00:00.000Z'
        );
    });

    it('is one hour after the 16:00 EDT close in summer (20:00 UTC close)', () => {
        const instant = sessionCloseInstantMs(US_EQUITY_SESSION, '2024-07-17');
        expect(new Date(instant).toISOString()).toBe(
            '2024-07-17T21:00:00.000Z'
        );
    });

    it('uses the half-day close on an early-close day', () => {
        const instant = sessionCloseInstantMs(US_EQUITY_SESSION, '2024-11-29');
        expect(new Date(instant).toISOString()).toBe(
            '2024-11-29T19:00:00.000Z'
        );
    });

    it('is one hour after the 15:30 KST close for a Korean day', () => {
        const instant = sessionCloseInstantMs(KR_SESSION, '2024-03-04');
        expect(new Date(instant).toISOString()).toBe(
            '2024-03-04T07:30:00.000Z'
        );
    });

    it('takes the minutes after close from its argument', () => {
        const base = sessionCloseInstantMs(KR_SESSION, '2024-03-04', 0);
        expect(sessionCloseInstantMs(KR_SESSION, '2024-03-04', 90) - base).toBe(
            90 * MS_PER_MINUTE
        );
        expect(sessionCloseInstantMs(KR_SESSION, '2024-03-04') - base).toBe(
            CLOCK_AFTER_CLOSE_MINUTES * MS_PER_MINUTE
        );
    });

    it('refuses a US holiday instead of returning the next trading day', () => {
        expect(() =>
            sessionCloseInstantMs(US_EQUITY_SESSION, '2024-11-28')
        ).toThrow('not a trading day');
    });

    it('refuses a weekend', () => {
        expect(() => sessionCloseInstantMs(KR_SESSION, '2024-03-02')).toThrow(
            'not a trading day'
        );
    });

    it('refuses an always-open session', () => {
        expect(() =>
            sessionCloseInstantMs({ kind: 'always-open' }, '2024-03-04')
        ).toThrow('scheduled session');
    });
});
