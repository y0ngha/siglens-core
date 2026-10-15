import { describe, expect, it } from 'vitest';
import {
    LARGE_HOLDER_13G_POINTS_CAP,
    LARGE_HOLDER_WINDOW_DAYS,
    SIGNAL_POINTS,
} from '@/domain/investorFlows/constants';
import { evaluateLargeHolderAxis } from '@/domain/investorFlows/largeHolderAxis';
import { parseDay } from '@/domain/investorFlows/scoreHelpers';
import type { LargeHolderFiling } from '@/domain/types';
import {
    AS_OF,
    daysBeforeAsOf,
    largeHolderFiling,
} from '../../fixtures/investorFlows';

const AS_OF_DAY = parseDay(AS_OF);

function axisOf(...filings: LargeHolderFiling[]) {
    return evaluateLargeHolderAxis(filings, AS_OF_DAY);
}

describe('evaluateLargeHolderAxis — 13D', () => {
    it('reads a new 13D as a strong bullish event', () => {
        const axis = axisOf(largeHolderFiling());
        expect(axis.signals).toHaveLength(1);
        expect(axis.signals[0]).toMatchObject({
            id: 'activist_13d_new',
            direction: 'bullish',
            strength: 'strong',
            subject: 'Activist Capital LP',
        });
        expect(axis.score).toBe(SIGNAL_POINTS.strong);
        expect(axis.label).toBe('strong_bullish');
    });

    it('reads an amendment that raised the stake as a strong bullish increase', () => {
        const axis = axisOf(
            largeHolderFiling({
                filingDate: daysBeforeAsOf(200),
                percentOfClass: 5.2,
            }),
            largeHolderFiling({
                filingDate: daysBeforeAsOf(10),
                form: 'SC 13D/A',
                percentOfClass: 7.8,
            })
        );
        expect(axis.signals).toHaveLength(1);
        expect(axis.signals[0]).toMatchObject({
            id: 'activist_13d_increase',
            direction: 'bullish',
            strength: 'strong',
        });
        expect(axis.signals[0].evidence).toMatchObject({
            percentOfClass: 7.8,
            prevPercentOfClass: 5.2,
            daysAgo: 10,
        });
    });

    it('reads an amendment that cut the stake as a moderate bearish reduction', () => {
        const axis = axisOf(
            largeHolderFiling({
                filingDate: daysBeforeAsOf(200),
                percentOfClass: 9,
            }),
            largeHolderFiling({
                filingDate: daysBeforeAsOf(10),
                form: 'SC 13D/A',
                percentOfClass: 6,
            })
        );
        expect(axis.signals[0]).toMatchObject({
            id: 'activist_13d_reduction',
            direction: 'bearish',
            strength: 'moderate',
        });
        expect(axis.label).toBe('bearish');
    });

    it('reads a filing at 0% as an exit', () => {
        const axis = axisOf(
            largeHolderFiling({
                filingDate: daysBeforeAsOf(10),
                form: 'SC 13D/A',
                percentOfClass: 0,
            })
        );
        expect(axis.signals[0]).toMatchObject({
            id: 'activist_13d_exit',
            direction: 'bearish',
            strength: 'moderate',
        });
    });

    it('cannot tell a direction from an amendment with no known prior stake', () => {
        const axis = axisOf(
            largeHolderFiling({ form: 'SC 13D/A', percentOfClass: 8 })
        );
        expect(axis.signals[0]).toMatchObject({
            id: 'large_holder_amendment',
            direction: 'neutral',
        });
        expect(axis.score).toBe(0);
    });

    it('treats an unchanged stake as a neutral amendment', () => {
        const axis = axisOf(
            largeHolderFiling({
                filingDate: daysBeforeAsOf(200),
                percentOfClass: 6,
            }),
            largeHolderFiling({
                filingDate: daysBeforeAsOf(10),
                form: 'SC 13D/A',
                percentOfClass: 6,
            })
        );
        expect(axis.signals[0].id).toBe('large_holder_amendment');
    });

    it('compares a filer only with its own earlier filings of the same schedule', () => {
        const axis = axisOf(
            largeHolderFiling({
                filingDate: daysBeforeAsOf(200),
                filer: 'Other Fund',
                percentOfClass: 5,
            }),
            largeHolderFiling({
                filingDate: daysBeforeAsOf(150),
                filer: 'Activist Capital LP',
                form: 'SC 13G',
                percentOfClass: 5,
            }),
            largeHolderFiling({
                filingDate: daysBeforeAsOf(10),
                filer: 'activist capital lp',
                percentOfClass: 6.1,
            })
        );
        expect(axis.signals.map(s => s.id)).toEqual(['activist_13d_new']);
    });

    it('accepts the post-2024 SCHEDULE 13D form names', () => {
        const axis = axisOf(largeHolderFiling({ form: 'SCHEDULE 13D' }));
        expect(axis.signals[0].id).toBe('activist_13d_new');
        expect(axis.metrics?.filings13d).toBe(1);
    });
});

describe('evaluateLargeHolderAxis — 13G', () => {
    const g = (overrides: Partial<LargeHolderFiling> = {}) =>
        largeHolderFiling({
            form: 'SC 13G',
            filer: 'Index Fund Co',
            ...overrides,
        });

    it('reads a new 13G as a weak bullish event', () => {
        const axis = axisOf(g());
        expect(axis.signals[0]).toMatchObject({
            id: 'passive_13g_new',
            direction: 'bullish',
            strength: 'weak',
        });
        expect(axis.score).toBe(SIGNAL_POINTS.weak);
        expect(axis.label).toBe('neutral');
    });

    it('reads a smaller 13G stake as weak bearish and an exit likewise', () => {
        const reduction = axisOf(
            g({ filingDate: daysBeforeAsOf(200), percentOfClass: 9 }),
            g({
                filingDate: daysBeforeAsOf(10),
                form: 'SC 13G/A',
                percentOfClass: 7,
            })
        );
        const exit = axisOf(
            g({
                form: 'SC 13G/A',
                percentOfClass: 0,
                filingDate: daysBeforeAsOf(5),
            })
        );
        expect(reduction.signals[0]).toMatchObject({
            id: 'passive_13g_reduction',
            strength: 'weak',
        });
        expect(exit.signals[0]).toMatchObject({
            id: 'passive_13g_exit',
            direction: 'bearish',
            strength: 'weak',
        });
    });

    it('caps what many 13G events can add so routine index-fund filings never stack into a strong read', () => {
        const filings = Array.from({ length: 8 }, (_, i) =>
            g({ filer: `Fund ${i}`, filingDate: daysBeforeAsOf(10 + i) })
        );
        const axis = axisOf(...filings);
        expect(axis.signals).toHaveLength(8);
        expect(8 * SIGNAL_POINTS.weak).toBeGreaterThan(
            LARGE_HOLDER_13G_POINTS_CAP
        );
        expect(axis.score).toBe(LARGE_HOLDER_13G_POINTS_CAP);
        expect(axis.label).toBe('bullish');
    });

    it('applies the cap to bearish 13G events too', () => {
        const filings = Array.from({ length: 8 }, (_, i) =>
            g({
                filer: `Fund ${i}`,
                form: 'SC 13G/A',
                percentOfClass: 0,
                filingDate: daysBeforeAsOf(10 + i),
            })
        );
        expect(axisOf(...filings).score).toBe(-LARGE_HOLDER_13G_POINTS_CAP);
    });

    it('does not cap 13D events', () => {
        const filings = Array.from({ length: 3 }, (_, i) =>
            largeHolderFiling({
                filer: `Activist ${i}`,
                filingDate: daysBeforeAsOf(10 + i),
            })
        );
        expect(axisOf(...filings).score).toBe(100);
    });

    it('adds 13D points to the capped 13G points', () => {
        const axis = axisOf(
            largeHolderFiling(),
            ...Array.from({ length: 8 }, (_, i) =>
                g({ filer: `Fund ${i}`, filingDate: daysBeforeAsOf(10 + i) })
            )
        );
        expect(axis.score).toBe(
            SIGNAL_POINTS.strong + LARGE_HOLDER_13G_POINTS_CAP
        );
    });
});

describe('evaluateLargeHolderAxis — window and sufficiency', () => {
    it('includes a filing exactly LARGE_HOLDER_WINDOW_DAYS old and excludes the day after', () => {
        const inside = axisOf(
            largeHolderFiling({
                filingDate: daysBeforeAsOf(LARGE_HOLDER_WINDOW_DAYS),
            })
        );
        const outside = axisOf(
            largeHolderFiling({
                filingDate: daysBeforeAsOf(LARGE_HOLDER_WINDOW_DAYS + 1),
            })
        );
        expect(inside.signals).toHaveLength(1);
        expect(outside.signals).toHaveLength(0);
    });

    it('treats an older filing as coverage: an empty window is quiet, scored zero', () => {
        const axis = axisOf(
            largeHolderFiling({ filingDate: daysBeforeAsOf(300) })
        );
        expect(axis).toMatchObject({
            score: 0,
            label: 'neutral',
            sufficiency: 'sufficient',
            metrics: { filings13d: 0, filings13g: 0 },
        });
    });

    it('ignores a filing dated after the reference date: no signal and not counted', () => {
        const axis = axisOf(
            largeHolderFiling({
                filingDate: daysBeforeAsOf(200),
                filer: 'Old',
            }),
            largeHolderFiling({
                filingDate: daysBeforeAsOf(-1),
                filer: 'Future',
            })
        );
        expect(axis.signals).toEqual([]);
        expect(axis.metrics).toEqual({ filings13d: 0, filings13g: 0 });
        expect(axis.sufficiency).toBe('sufficient');
    });

    it('counts 13D and 13G filings in the window', () => {
        const axis = axisOf(
            largeHolderFiling(),
            largeHolderFiling({ form: 'SC 13G', filer: 'B' }),
            largeHolderFiling({ form: 'SC 13G/A', filer: 'C' })
        );
        expect(axis.metrics).toEqual({ filings13d: 1, filings13g: 2 });
    });

    it.each([
        ['unavailable (null)', null],
        ['an empty list', []],
    ])('is insufficient when the filings are %s', (_name, filings) => {
        expect(evaluateLargeHolderAxis(filings, AS_OF_DAY)).toMatchObject({
            score: null,
            label: 'insufficient',
            sufficiency: 'insufficient',
            metrics: null,
        });
    });

    it('is insufficient when EVERY filing is dated after the reference date (no neutral vote)', () => {
        const axis = axisOf(
            largeHolderFiling({ filingDate: daysBeforeAsOf(-1), filer: 'A' }),
            largeHolderFiling({
                filingDate: daysBeforeAsOf(-40),
                filer: 'B',
                form: 'SC 13G',
            })
        );
        expect(axis).toMatchObject({
            score: null,
            label: 'insufficient',
            sufficiency: 'insufficient',
            metrics: null,
            signals: [],
        });
    });

    it('still counts a filing dated on the reference date', () => {
        const axis = axisOf(
            largeHolderFiling({ filingDate: daysBeforeAsOf(0) })
        );
        expect(axis.sufficiency).toBe('sufficient');
        expect(axis.signals[0].id).toBe('activist_13d_new');
    });

    it('does not use a future-dated filing as the "previous" stake', () => {
        const axis = axisOf(
            largeHolderFiling({
                filingDate: daysBeforeAsOf(-5),
                percentOfClass: 3,
            }),
            largeHolderFiling({
                filingDate: daysBeforeAsOf(10),
                form: 'SC 13D/A',
                percentOfClass: 7,
            })
        );
        expect(axis.signals[0].id).toBe('large_holder_amendment');
        expect(axis.signals[0].evidence.prevPercentOfClass).toBeNull();
    });

    it('is insufficient when the reference date is unusable', () => {
        expect(
            evaluateLargeHolderAxis([largeHolderFiling()], null).sufficiency
        ).toBe('insufficient');
    });

    it('ignores filings with unknown forms or unusable dates', () => {
        const axis = axisOf(
            largeHolderFiling({ form: 'SC TO-T' }),
            largeHolderFiling({ filingDate: 'garbage' })
        );
        expect(axis.sufficiency).toBe('insufficient');
    });
});
