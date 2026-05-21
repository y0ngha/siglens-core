import { describe, it, expect } from 'vitest';
import {
    EXPIRATION_SLOTS,
    ZERO_DTE_MAX_DAYS,
    mapExpirationsToSlots,
} from '@/domain/options/expirationSlots';
import type {
    ExpirationSlotKey,
    SlotMapping,
} from '@/domain/options/types';

const isMapping = (x: SlotMapping | null): x is SlotMapping => x !== null;

describe('EXPIRATION_SLOTS', () => {
    it('declares the seven canonical chip slots in ascending order', () => {
        expect(EXPIRATION_SLOTS).toHaveLength(7);
        expect(EXPIRATION_SLOTS.map(s => s.key)).toEqual([
            '0D',
            '1W',
            '2W',
            '1M',
            '2M',
            '3M',
            '6M',
        ]);
    });

    it('declares `0D` with a maxDays upper bound so it cannot steal 1W expirations', () => {
        const zero = EXPIRATION_SLOTS.find(s => s.key === '0D');
        expect(zero?.targetDays).toBe(0);
        expect(zero?.maxDays).toBe(ZERO_DTE_MAX_DAYS);
        // Standard slots intentionally omit maxDays.
        for (const slot of EXPIRATION_SLOTS) {
            if (slot.key !== '0D') {
                expect(slot.maxDays).toBeUndefined();
            }
        }
    });
});

describe('mapExpirationsToSlots', () => {
    const now = new Date('2026-05-14T00:00:00-04:00'); // ET midnight

    it('maps closest expiration ≥ target days to each slot', () => {
        const expirations = [
            '2026-05-22', // 8 days  → 1W (0D's maxDays=6 excludes this)
            '2026-05-29', // 15 days → 2W
            '2026-06-14', // 31 days → 1M
            '2026-07-15', // 62 days → 2M
            '2026-08-15', // 93 days → 3M
            '2026-11-13', // 183 days → 6M
        ];
        const result = mapExpirationsToSlots(expirations, now);
        const filled = result.filter(isMapping);
        // 0D has no within-window match — six of seven slots are filled.
        expect(filled).toHaveLength(6);
        expect(filled[0]?.slot.key).toBe('1W');
        expect(filled[0]?.expirationDate).toBe('2026-05-22');
        expect(filled[5]?.slot.key).toBe('6M');
    });

    it('maps a same-day expiration to the 0D slot without stealing it from 1W', () => {
        // PLTR-style: 오늘 만기(0d) + 다음 주 만기(7d). 0D는 0~6일 범위만
        // 매칭하므로 7d짜리는 그대로 1W로 흘러간다.
        const expirations = ['2026-05-14', '2026-05-21'];
        const result = mapExpirationsToSlots(expirations, now);
        const byKey = Object.fromEntries(
            result
                .filter(isMapping)
                .map(m => [m.slot.key, m.expirationDate] as const)
        ) as Partial<Record<ExpirationSlotKey, string>>;
        expect(byKey['0D']).toBe('2026-05-14');
        expect(byKey['1W']).toBe('2026-05-21');
    });

    it(`maps the inclusive ${ZERO_DTE_MAX_DAYS}-day boundary to the 0D slot, ` +
        `forcing 7-day expirations into 1W`, () => {
        // 2026-05-14 기준: 6일 후 = 2026-05-20 (포함적 maxDays 상한 = 0D),
        // 8일 후 = 2026-05-22 (maxDays 초과 = 1W). ZERO_DTE_MAX_DAYS 값을
        // 직접 검증해 상수 변경 시 경계가 무너지면 즉시 회귀가 잡힌다.
        const expirations = ['2026-05-20', '2026-05-22'];
        const result = mapExpirationsToSlots(expirations, now);
        const byKey = Object.fromEntries(
            result
                .filter(isMapping)
                .map(m => [m.slot.key, m.expirationDate] as const)
        ) as Partial<Record<ExpirationSlotKey, string>>;
        expect(byKey['0D']).toBe('2026-05-20');
        expect(byKey['1W']).toBe('2026-05-22');
    });

    it('omits slots with no satisfying expiration', () => {
        const expirations = ['2026-05-22']; // only 1W
        const result = mapExpirationsToSlots(expirations, now);
        const filled = result.filter(isMapping);
        expect(filled).toHaveLength(1);
        expect(filled[0]?.slot.key).toBe('1W');
    });

    it('does not reuse the same expiration across slots', () => {
        const expirations = ['2026-05-22']; // 8 days
        const result = mapExpirationsToSlots(expirations, now);
        const filled = result.filter(isMapping);
        expect(filled).toHaveLength(1);
    });

    it('past expirations (days < 0) are filtered out before slot matching', () => {
        // now = 2026-05-14; 2026-05-01 is in the past, 2026-05-22 is +8d.
        // Only the future expiration should populate the 1W slot.
        const expirations = ['2026-05-01', '2026-05-22'];
        const result = mapExpirationsToSlots(expirations, now);
        const filled = result.filter(isMapping);
        expect(filled).toHaveLength(1);
        expect(filled[0]?.slot.key).toBe('1W');
        expect(filled[0]?.expirationDate).toBe('2026-05-22');
    });

    it('returns all-null when expirations is empty', () => {
        const result = mapExpirationsToSlots([], now);
        expect(result).toHaveLength(7);
        expect(result.every(r => r === null)).toBe(true);
    });
});
