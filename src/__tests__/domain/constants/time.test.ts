import { describe, it, expect } from 'vitest';
import {
    KST_OFFSET_HOURS,
    MS_PER_DAY,
    MS_PER_HOUR,
    MS_PER_MINUTE,
    MS_PER_SECOND,
    SECONDS_PER_DAY,
    SECONDS_PER_HOUR,
    SECONDS_PER_MINUTE,
    SECONDS_PER_YEAR,
} from '@/domain/constants/time';

describe('time constants', () => {
    it('KST_OFFSET_HOURS', () => {
        expect(KST_OFFSET_HOURS).toBe(9);
    });

    it('MS_PER_SECOND', () => {
        expect(MS_PER_SECOND).toBe(1_000);
    });

    it('MS_PER_MINUTE', () => {
        expect(MS_PER_MINUTE).toBe(60_000);
    });

    it('MS_PER_HOUR', () => {
        expect(MS_PER_HOUR).toBe(3_600_000);
    });

    it('MS_PER_DAY', () => {
        expect(MS_PER_DAY).toBe(86_400_000);
    });

    it('SECONDS_PER_MINUTE', () => {
        expect(SECONDS_PER_MINUTE).toBe(60);
    });

    it('SECONDS_PER_HOUR', () => {
        expect(SECONDS_PER_HOUR).toBe(3_600);
    });

    it('SECONDS_PER_DAY', () => {
        expect(SECONDS_PER_DAY).toBe(86_400);
    });

    it('SECONDS_PER_YEAR', () => {
        expect(SECONDS_PER_YEAR).toBe(31_536_000);
    });

    it('derived relationships hold', () => {
        expect(MS_PER_MINUTE).toBe(SECONDS_PER_MINUTE * MS_PER_SECOND);
        expect(MS_PER_HOUR).toBe(60 * MS_PER_MINUTE);
        expect(MS_PER_DAY).toBe(24 * MS_PER_HOUR);
        expect(SECONDS_PER_HOUR).toBe(60 * SECONDS_PER_MINUTE);
        expect(SECONDS_PER_DAY).toBe(24 * SECONDS_PER_HOUR);
        expect(SECONDS_PER_YEAR).toBe(365 * SECONDS_PER_DAY);
    });
});
