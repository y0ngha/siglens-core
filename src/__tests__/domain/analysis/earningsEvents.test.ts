import { describe, it, expect } from 'vitest';
import {
    eventCategoryLabel,
    isCompanyEarningsEvent,
} from '@/domain/analysis/earningsEvents';

describe('isCompanyEarningsEvent', () => {
    const dates = ['2026-08-26', '2026-11-18'];

    it('window is report-1 .. report+3 days: -2 out, -1/0/+3 in, +4 out', () => {
        const at = (d: string) => isCompanyEarningsEvent(d, ['2026-08-26']);
        expect(at('2026-08-24')).toBe(false);
        expect(at('2026-08-25')).toBe(true);
        expect(at('2026-08-26')).toBe(true);
        expect(at('2026-08-29')).toBe(true);
        expect(at('2026-08-30')).toBe(false);
    });

    it('accepts a Date at any time of the report day', () => {
        expect(
            isCompanyEarningsEvent(new Date('2026-08-26T21:00:00Z'), dates)
        ).toBe(true);
    });

    it('rejects a themed article weeks from any report date (NVDA 2026-10-15)', () => {
        expect(
            isCompanyEarningsEvent(new Date('2026-10-15T12:00:00Z'), dates)
        ).toBe(false);
        expect(isCompanyEarningsEvent('2026-08-30', dates)).toBe(false);
    });

    it('is false for an empty list or unparsable dates', () => {
        expect(isCompanyEarningsEvent('2026-08-26', [])).toBe(false);
        expect(isCompanyEarningsEvent('garbage', dates)).toBe(false);
        expect(isCompanyEarningsEvent('2026-08-26', ['garbage'])).toBe(false);
    });
});

describe('eventCategoryLabel', () => {
    const at = new Date('2026-10-15T12:00:00Z');

    it('leaves other categories untouched', () => {
        expect(
            eventCategoryLabel({ category: 'guidance', publishedAt: at }, [])
        ).toBe('guidance');
    });

    it('treats an empty list like undefined (calendar unknown)', () => {
        expect(
            eventCategoryLabel({ category: 'earnings', publishedAt: at }, [])
        ).toBe('earnings-related news');
    });

    it('never claims a report without dates', () => {
        expect(
            eventCategoryLabel(
                { category: 'earnings', publishedAt: at },
                undefined
            )
        ).toBe('earnings-related news');
    });

    it('marks off-date earnings as not the company report, on-date as earnings', () => {
        expect(
            eventCategoryLabel({ category: 'earnings', publishedAt: at }, [
                '2026-11-18',
            ])
        ).toContain("not this company's report");
        expect(
            eventCategoryLabel({ category: 'earnings', publishedAt: at }, [
                '2026-10-15',
            ])
        ).toBe('earnings');
    });
});
