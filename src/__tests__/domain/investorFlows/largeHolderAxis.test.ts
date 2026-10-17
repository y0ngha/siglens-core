import { describe, expect, it } from 'vitest';
import {
    LARGE_HOLDER_13D_POINTS_CAP,
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
const GME_AS_OF_DAY = parseDay('2026-10-16');

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
            preWindowPercentOfClass: 5.2,
            preWindowDaysAgo: 200,
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

    it('reads a filing reporting 0 shares as an exit even without a percent', () => {
        // Without the shares === 0 rule, 30M → 0 shares would read as a reduction.
        const axis = axisOf(
            largeHolderFiling({
                filingDate: daysBeforeAsOf(200),
                percentOfClass: 6,
                shares: 30_000_000,
            }),
            largeHolderFiling({
                filingDate: daysBeforeAsOf(10),
                form: 'SC 13D/A',
                percentOfClass: null,
                shares: 0,
            })
        );
        expect(axis.signals.map(s => s.id)).toEqual(['activist_13d_exit']);
    });

    it.each([
        ['a 2-for-1 forward split', 60_000_000],
        ['a 1-for-10 reverse split', 3_000_000],
    ])(
        'reads %s (shares rescaled, percent unchanged) as a neutral amendment',
        (_name, shares) => {
            const axis = axisOf(
                largeHolderFiling({
                    filingDate: daysBeforeAsOf(200),
                    percentOfClass: 6,
                    shares: 30_000_000,
                }),
                largeHolderFiling({
                    filingDate: daysBeforeAsOf(10),
                    form: 'SC 13D/A',
                    percentOfClass: 6,
                    shares,
                })
            );
            expect(axis.signals.map(s => [s.id, s.direction])).toEqual([
                ['large_holder_amendment', 'neutral'],
            ]);
            expect(axis.score).toBe(0);
        }
    );

    it('still reads a share change with a moved percent as directional', () => {
        // Guard for the split rule: it applies only when the percent held still.
        const axis = axisOf(
            largeHolderFiling({
                filingDate: daysBeforeAsOf(200),
                percentOfClass: 6,
                shares: 30_000_000,
            }),
            largeHolderFiling({
                filingDate: daysBeforeAsOf(10),
                form: 'SC 13D/A',
                percentOfClass: 6.2,
                shares: 31_000_000,
            })
        );
        expect(axis.signals[0].id).toBe('activist_13d_increase');
    });

    it('maps non-finite percents and shares to null in the evidence', () => {
        const axis = axisOf(
            largeHolderFiling({
                filingDate: daysBeforeAsOf(200),
                percentOfClass: Number.NaN,
                shares: Number.POSITIVE_INFINITY,
            }),
            largeHolderFiling({
                filingDate: daysBeforeAsOf(10),
                form: 'SC 13D/A',
                percentOfClass: Number.NaN,
                shares: Number.NEGATIVE_INFINITY,
            })
        );
        expect(axis.signals[0]).toMatchObject({
            id: 'large_holder_amendment',
            evidence: {
                percentOfClass: null,
                shares: null,
                windowStartPercentOfClass: null,
                windowStartShares: null,
                preWindowPercentOfClass: null,
                preWindowShares: null,
                preWindowDaysAgo: 200,
            },
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

    it('caps 13D events at one strong event, so separate activists never pin the axis at 100', () => {
        const filings = Array.from({ length: 3 }, (_, i) =>
            largeHolderFiling({
                filer: `Activist ${i}`,
                filingDate: daysBeforeAsOf(10 + i),
            })
        );
        const axis = axisOf(...filings);
        expect(axis.signals).toHaveLength(3);
        expect(3 * SIGNAL_POINTS.strong).toBeGreaterThan(
            LARGE_HOLDER_13D_POINTS_CAP
        );
        expect(axis.score).toBe(LARGE_HOLDER_13D_POINTS_CAP);
    });

    it('applies the 13D cap to bearish events too', () => {
        const filings = Array.from({ length: 3 }, (_, i) =>
            largeHolderFiling({
                filer: `Activist ${i}`,
                form: 'SC 13D/A',
                percentOfClass: 0,
                filingDate: daysBeforeAsOf(10 + i),
            })
        );
        expect(axisOf(...filings).score).toBe(-LARGE_HOLDER_13D_POINTS_CAP);
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

/** A filing-specific EDGAR URL (it carries an accession number). */
const JOINT_URL =
    'https://www.sec.gov/Archives/edgar/data/1234567/000110465926012345/0001104659-26-012345-index.htm';

describe('evaluateLargeHolderAxis — joint filings and stacked amendments', () => {
    it('keeps co-filers of one accession apart when they report different positions', () => {
        const axis = axisOf(
            largeHolderFiling({
                filer: 'Fund A',
                percentOfClass: 6,
                url: JOINT_URL,
            }),
            largeHolderFiling({
                filer: 'Fund B',
                percentOfClass: 9.4,
                shares: 46_000_000,
                url: JOINT_URL,
            })
        );
        expect(axis.signals.map(s => s.subject)).toEqual(['Fund A', 'Fund B']);
        // Two positions, still one filing.
        expect(axis.metrics).toEqual({
            events13d: 2,
            filings13d: 1,
            events13g: 0,
            filings13g: 0,
        });
    });

    it('treats percents within rounding as the same joint position', () => {
        const axis = axisOf(
            largeHolderFiling({
                filer: 'Fund A',
                percentOfClass: 9.4,
                shares: 47_000_000,
                url: JOINT_URL,
            }),
            largeHolderFiling({
                filer: 'Fund B',
                percentOfClass: 9.405,
                shares: 47_000_000,
                url: JOINT_URL,
            })
        );
        expect(axis.signals.map(s => s.subject)).toEqual(['Fund A / Fund B']);
    });

    it('merges co-filers of a URL carrying only the 18-digit undashed accession', () => {
        const url =
            'https://www.sec.gov/Archives/edgar/data/1234567/000110465926012345/primary_doc.xml';
        const axis = axisOf(
            largeHolderFiling({ filer: 'Fund A', percentOfClass: 9.4, url }),
            largeHolderFiling({ filer: 'Fund B', percentOfClass: 9.4, url })
        );
        expect(axis.signals.map(s => s.subject)).toEqual(['Fund A / Fund B']);
        expect(axis.metrics).toMatchObject({ events13d: 1, filings13d: 1 });
    });

    it.each([
        [
            'a generic URL',
            'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany',
        ],
        ['a blank URL', ''],
    ])(
        'never merges different filers sharing %s, even with equal positions',
        (_name, url) => {
            const axis = axisOf(
                largeHolderFiling({
                    filer: 'Fund A',
                    percentOfClass: 9.4,
                    url,
                }),
                largeHolderFiling({
                    filer: 'Fund B',
                    percentOfClass: 9.4,
                    url,
                }),
                largeHolderFiling({ filer: 'Fund C', percentOfClass: 7, url })
            );
            expect(axis.signals.map(s => s.subject)).toEqual([
                'Fund A',
                'Fund B',
                'Fund C',
            ]);
            expect(axis.metrics).toEqual({
                events13d: 3,
                filings13d: 3,
                events13g: 0,
                filings13g: 0,
            });
        }
    );

    it("counts one filer's two same-day blank-URL filings as two filings in one event", () => {
        const axis = axisOf(
            largeHolderFiling({ url: '', percentOfClass: 6.1 }),
            largeHolderFiling({
                url: '',
                form: 'SC 13D/A',
                percentOfClass: 6.5,
            })
        );
        expect(axis.metrics).toEqual({
            events13d: 1,
            filings13d: 2,
            events13g: 0,
            filings13g: 0,
        });
        expect(axis.signals).toHaveLength(1);
        expect(axis.signals[0].evidence.filings).toBe(2);
    });

    it('counts a joint 13D once, naming every co-filer (HSCS: DCG and Fortitude, 9.40%)', () => {
        const url = JOINT_URL;
        const axis = axisOf(
            largeHolderFiling({
                filer: 'Fortitude Re',
                percentOfClass: 9.4,
                url,
            }),
            largeHolderFiling({
                filer: 'DCG International',
                percentOfClass: 9.4,
                url,
            })
        );
        expect(axis.signals).toEqual([
            {
                id: 'activist_13d_new',
                axis: 'largeHolders',
                direction: 'bullish',
                strength: 'strong',
                evidence: {
                    percentOfClass: 9.4,
                    shares: 47_000_000,
                    daysAgo: 10,
                    windowStartPercentOfClass: 9.4,
                    windowStartShares: 47_000_000,
                    windowStartDaysAgo: 10,
                    preWindowPercentOfClass: null,
                    preWindowShares: null,
                    preWindowDaysAgo: null,
                    filings: 1,
                },
                subject: 'DCG International / Fortitude Re',
            },
        ]);
        expect(axis.score).toBe(SIGNAL_POINTS.strong);
        expect(axis.metrics).toEqual({
            events13d: 1,
            filings13d: 1,
            events13g: 0,
            filings13g: 0,
        });
    });

    it('keeps two separate filings by different filers as two events', () => {
        const axis = axisOf(
            largeHolderFiling({ filer: 'Fortitude Re' }),
            largeHolderFiling({ filer: 'DCG International' })
        );
        expect(axis.signals).toHaveLength(2);
        expect(axis.metrics).toEqual({
            events13d: 2,
            filings13d: 2,
            events13g: 0,
            filings13g: 0,
        });
    });

    it("nets a filer's stacked 13D/As into one event (7 amendments)", () => {
        const amendments = [9.98, 10.6, 11.2, 11.9, 12.3, 12.6, 12.9].map(
            (percentOfClass, i) =>
                largeHolderFiling({
                    filer: 'RC Ventures LLC',
                    form: 'SC 13D/A',
                    filingDate: daysBeforeAsOf(80 - i * 10),
                    percentOfClass,
                })
        );
        const axis = axisOf(
            largeHolderFiling({
                filer: 'RC Ventures LLC',
                filingDate: daysBeforeAsOf(400),
                percentOfClass: 9.98,
            }),
            ...amendments
        );
        expect(axis.signals).toHaveLength(1);
        expect(axis.signals[0]).toMatchObject({
            id: 'activist_13d_increase',
            strength: 'strong',
            subject: 'RC Ventures LLC',
            evidence: {
                percentOfClass: 12.9,
                preWindowPercentOfClass: 9.98,
                daysAgo: 20,
                filings: 7,
            },
        });
        expect(axis.score).toBe(SIGNAL_POINTS.strong);
        expect(axis.metrics).toEqual({
            events13d: 1,
            filings13d: 7,
            events13g: 0,
            filings13g: 0,
        });
    });

    describe('GME-like: Ryan Cohen 13D/As (SEC data, 2026)', () => {
        const cohen = (
            filingDate: string,
            percentOfClass: number,
            shares: number,
            accession: string
        ) =>
            largeHolderFiling({
                filer: 'Cohen Ryan',
                form: 'SCHEDULE 13D/A',
                filingDate,
                percentOfClass,
                shares,
                url: `https://www.sec.gov/Archives/edgar/data/1326380/${accession.replace(/-/g, '')}/${accession}-index.htm`,
            });
        const axisOf = (...filings: LargeHolderFiling[]) =>
            evaluateLargeHolderAxis(filings, GME_AS_OF_DAY);
        // Real sequence; as-of 2026-10-16 (the fixture AS_OF is 2026-10-15).
        const rows = [
            cohen('2026-01-21', 9.3, 42_082_626, '0000921895-26-000120'),
            cohen('2026-09-03', 8.3, 42_082_626, '0000921895-26-002474'),
            cohen('2026-09-10', 8.5, 43_082_626, '0000921895-26-002530'),
            cohen('2026-09-21', 8.7, 44_233_306, '0000921895-26-002607'),
            cohen('2026-09-29', 8.8, 44_683_306, '0000921895-26-002669'),
            cohen('2026-09-29', 8.8, 44_683_306, '0000921895-26-002679'),
            cohen('2026-10-02', 8.9, 45_383_306, '0000921895-26-002718'),
            cohen('2026-10-13', 9.1, 46_227_436, '0000921895-26-002783'),
        ];

        it('reads more shares at a lower percent as an increase, with the in-window change', () => {
            const axis = axisOf(...rows);
            expect(axis.signals).toEqual([
                {
                    id: 'activist_13d_increase',
                    axis: 'largeHolders',
                    direction: 'bullish',
                    strength: 'strong',
                    evidence: {
                        percentOfClass: 9.1,
                        shares: 46_227_436,
                        daysAgo: 3,
                        windowStartPercentOfClass: 8.3,
                        windowStartShares: 42_082_626,
                        windowStartDaysAgo: 43,
                        // The pre-window baseline (2026-01-21), not the
                        // filing just before the latest (2026-10-02, 8.9%).
                        preWindowPercentOfClass: 9.3,
                        preWindowShares: 42_082_626,
                        preWindowDaysAgo: 268,
                        filings: 6,
                    },
                    subject: 'Cohen Ryan',
                },
            ]);
            expect(axis.score).toBe(SIGNAL_POINTS.strong);
        });

        it('counts one position, and the identical same-day 13D/A pair as one filing', () => {
            expect(axisOf(...rows).metrics).toEqual({
                events13d: 1,
                filings13d: 6,
                events13g: 0,
                filings13g: 0,
            });
        });

        it('reads a lower percent on unchanged shares as dilution, not a reduction', () => {
            // 2026-01-21 → 2026-09-03: 9.3% → 8.3% on the same 42,082,626 shares.
            const axis = axisOf(rows[0], rows[1]);
            expect(axis.signals.map(s => [s.id, s.direction])).toEqual([
                ['large_holder_ratio_diluted', 'neutral'],
            ]);
            expect(axis.score).toBe(0);
        });

        it('falls back to the percent when a filing has no shares', () => {
            const axis = axisOf(
                { ...rows[0], shares: null },
                { ...rows[7], shares: null }
            );
            expect(axis.signals[0].id).toBe('activist_13d_reduction');
        });

        it('reads fewer shares as a reduction even when the percent rose', () => {
            const axis = axisOf(
                rows[0],
                cohen('2026-10-13', 9.5, 40_000_000, '0000921895-26-002783')
            );
            expect(axis.signals[0].id).toBe('activist_13d_reduction');
        });
    });

    it('compares the latest amendment with the position before the window, not the step before', () => {
        // 8% before the window, up to 9% then back to 7%: net reduction.
        const axis = axisOf(
            largeHolderFiling({
                filingDate: daysBeforeAsOf(200),
                percentOfClass: 8,
            }),
            largeHolderFiling({
                form: 'SC 13D/A',
                filingDate: daysBeforeAsOf(40),
                percentOfClass: 9,
            }),
            largeHolderFiling({
                form: 'SC 13D/A',
                filingDate: daysBeforeAsOf(10),
                percentOfClass: 7,
            })
        );
        expect(axis.signals.map(s => s.id)).toEqual(['activist_13d_reduction']);
        expect(axis.signals[0].evidence.preWindowPercentOfClass).toBe(8);
    });

    it('reads a new 13D followed by amendments in the same window as one new event', () => {
        const axis = axisOf(
            largeHolderFiling({ filingDate: daysBeforeAsOf(60) }),
            largeHolderFiling({
                form: 'SC 13D/A',
                filingDate: daysBeforeAsOf(20),
                percentOfClass: 8,
            })
        );
        expect(axis.signals.map(s => s.id)).toEqual(['activist_13d_new']);
        expect(axis.signals[0].evidence.percentOfClass).toBe(8);
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
            metrics: {
                events13d: 0,
                filings13d: 0,
                events13g: 0,
                filings13g: 0,
            },
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
        expect(axis.metrics).toEqual({
            events13d: 0,
            filings13d: 0,
            events13g: 0,
            filings13g: 0,
        });
        expect(axis.sufficiency).toBe('sufficient');
    });

    it('counts 13D and 13G filings in the window', () => {
        const axis = axisOf(
            largeHolderFiling(),
            largeHolderFiling({ form: 'SC 13G', filer: 'B' }),
            largeHolderFiling({ form: 'SC 13G/A', filer: 'C' })
        );
        expect(axis.metrics).toEqual({
            events13d: 1,
            filings13d: 1,
            events13g: 2,
            filings13g: 2,
        });
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
        expect(axis.signals[0].evidence.preWindowPercentOfClass).toBeNull();
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
