import { afterEach, describe, expect, it, vi } from 'vitest';
import { hashUsageIp } from '@/infrastructure/usage/hash';

describe('hashUsageIp', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('returns a stable SHA-256 hex digest for the same IP and UTC day', () => {
        const first = hashUsageIp(
            '203.0.113.10',
            new Date('2026-04-28T00:00:00.000Z')
        );
        const second = hashUsageIp(
            '203.0.113.10',
            new Date('2026-04-28T23:59:59.999Z')
        );

        expect(first).toBe(second);
        expect(first).toHaveLength(64);
        expect(first).toMatch(/^[0-9a-f]+$/);
    });

    it('uses a UTC daily salt so hashes reset on the next UTC day', () => {
        const today = hashUsageIp(
            '203.0.113.10',
            new Date('2026-04-28T23:59:59.999Z')
        );
        const tomorrow = hashUsageIp(
            '203.0.113.10',
            new Date('2026-04-29T00:00:00.000Z')
        );

        expect(today).not.toBe(tomorrow);
    });

    it('returns different hashes for different IP values on the same day', () => {
        const date = new Date('2026-04-28T12:00:00.000Z');

        expect(hashUsageIp('203.0.113.10', date)).not.toBe(
            hashUsageIp('203.0.113.11', date)
        );
    });

    it('uses the current system clock when the date argument is omitted', () => {
        const now = new Date('2026-04-28T12:00:00.000Z');
        vi.useFakeTimers();
        vi.setSystemTime(now);

        expect(hashUsageIp('203.0.113.10')).toBe(
            hashUsageIp('203.0.113.10', now)
        );
    });
});
