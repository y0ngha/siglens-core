import { describe, expect, it } from 'vitest';
import { tallyEarningsReactions } from '@/domain/agent/earningsReactionTally';

describe('tallyEarningsReactions', () => {
    describe('empty and unmeasured input', () => {
        it('returns a zero tally with null summary for an empty list', () => {
            expect(tallyEarningsReactions([])).toEqual({
                measured: 0,
                up: 0,
                down: 0,
                flat: 0,
                largestRise: null,
                largestFall: null,
                medianAbsMovePct: null,
                summary: null,
            });
        });

        it('treats all-null moves as measured 0 with null summary', () => {
            const tally = tallyEarningsReactions([
                { date: '2026-02-03', movePct: null },
                { date: '2025-10-28', movePct: null },
            ]);
            expect(tally.measured).toBe(0);
            expect(tally.summary).toBeNull();
            expect(tally.medianAbsMovePct).toBeNull();
        });

        it('excludes null, NaN and infinite moves from measured', () => {
            const tally = tallyEarningsReactions([
                { date: '2026-02-03', movePct: 2 },
                { date: '2025-10-28', movePct: null },
                { date: '2025-07-29', movePct: NaN },
                { date: '2025-04-30', movePct: Infinity },
                { date: '2025-01-29', movePct: -Infinity },
            ]);
            expect(tally.measured).toBe(1);
            expect(tally.up).toBe(1);
            expect(tally.down).toBe(0);
        });

        it('does not count an unmeasured entry as flat', () => {
            const tally = tallyEarningsReactions([
                { date: '2026-02-03', movePct: null },
                { date: '2025-10-28', movePct: 1 },
            ]);
            expect(tally.flat).toBe(0);
        });
    });

    describe('counts', () => {
        it('splits up, down and flat on the sign of the value as given', () => {
            const tally = tallyEarningsReactions([
                { date: '2026-02-03', movePct: 6.05 },
                { date: '2025-10-28', movePct: 0.01 },
                { date: '2025-07-29', movePct: -4.5 },
                { date: '2025-04-30', movePct: -0.01 },
                { date: '2025-01-29', movePct: 0 },
                { date: '2024-10-30', movePct: -0 },
            ]);
            expect([tally.up, tally.down, tally.flat, tally.measured]).toEqual([
                2, 2, 2, 6,
            ]);
        });
    });

    describe('extremes', () => {
        it('picks the largest rise and the largest fall', () => {
            const tally = tallyEarningsReactions([
                { date: '2026-02-03', movePct: 3 },
                { date: '2025-10-28', movePct: 6.05 },
                { date: '2025-07-29', movePct: -4.5 },
                { date: '2025-04-30', movePct: -1 },
            ]);
            expect(tally.largestRise).toEqual({
                date: '2025-10-28',
                movePct: 6.05,
            });
            expect(tally.largestFall).toEqual({
                date: '2025-07-29',
                movePct: -4.5,
            });
        });

        it('breaks a rise tie to the later date regardless of list order', () => {
            const rows = [
                { date: '2025-01-29', movePct: 5 },
                { date: '2026-02-03', movePct: 5 },
                { date: '2025-07-29', movePct: 5 },
            ];
            expect(tallyEarningsReactions(rows).largestRise?.date).toBe(
                '2026-02-03'
            );
            expect(
                tallyEarningsReactions(rows.toReversed()).largestRise?.date
            ).toBe('2026-02-03');
        });

        it('breaks a fall tie to the later date regardless of list order', () => {
            const rows = [
                { date: '2026-02-03', movePct: -2 },
                { date: '2025-01-29', movePct: -2 },
            ];
            expect(tallyEarningsReactions(rows).largestFall?.date).toBe(
                '2026-02-03'
            );
            expect(
                tallyEarningsReactions(rows.toReversed()).largestFall?.date
            ).toBe('2026-02-03');
        });

        it('keeps the earlier-listed larger move over a later-listed smaller one', () => {
            const tally = tallyEarningsReactions([
                { date: '2025-01-29', movePct: 9 },
                { date: '2026-02-03', movePct: 1 },
            ]);
            expect(tally.largestRise).toEqual({
                date: '2025-01-29',
                movePct: 9,
            });
        });

        it('keeps a larger fall that comes later in the list', () => {
            const tally = tallyEarningsReactions([
                { date: '2026-02-03', movePct: -1 },
                { date: '2025-01-29', movePct: -9 },
            ]);
            expect(tally.largestFall).toEqual({
                date: '2025-01-29',
                movePct: -9,
            });
        });

        it('has no largest rise when nothing rose', () => {
            const tally = tallyEarningsReactions([
                { date: '2026-02-03', movePct: -1 },
                { date: '2025-10-28', movePct: 0 },
            ]);
            expect(tally.largestRise).toBeNull();
        });

        it('has no largest fall when nothing fell', () => {
            const tally = tallyEarningsReactions([
                { date: '2026-02-03', movePct: 1 },
            ]);
            expect(tally.largestFall).toBeNull();
        });
    });

    describe('median of move sizes', () => {
        it('takes the middle size for an odd count', () => {
            const tally = tallyEarningsReactions([
                { date: '2026-02-03', movePct: 1 },
                { date: '2025-10-28', movePct: -5 },
                { date: '2025-07-29', movePct: 2 },
            ]);
            expect(tally.medianAbsMovePct).toBe(2);
        });

        it('averages the two middle sizes for an even count, to 2 decimals', () => {
            const tally = tallyEarningsReactions([
                { date: '2026-02-03', movePct: 1.01 },
                { date: '2025-10-28', movePct: -2.02 },
            ]);
            expect(tally.medianAbsMovePct).toBe(1.52);
        });

        it('rounds an odd-count median to 2 decimals', () => {
            const tally = tallyEarningsReactions([
                { date: '2026-02-03', movePct: 1.004 },
            ]);
            expect(tally.medianAbsMovePct).toBe(1);
        });

        it('is 0 when every measured move is flat', () => {
            const tally = tallyEarningsReactions([
                { date: '2026-02-03', movePct: 0 },
            ]);
            expect(tally.medianAbsMovePct).toBe(0);
        });
    });

    describe('summary', () => {
        it('lists counts, both extremes and the median size with a flat clause', () => {
            const tally = tallyEarningsReactions([
                { date: '2026-02-03', movePct: 6.05 },
                { date: '2025-10-28', movePct: 1.1 },
                { date: '2025-07-29', movePct: -4.5 },
                { date: '2025-04-30', movePct: 2.2 },
                { date: '2025-01-29', movePct: -2.2 },
                { date: '2024-10-30', movePct: 0 },
                { date: '2024-07-31', movePct: 3.3 },
            ]);
            expect(tally.summary).toBe(
                '7 reports measured: 4 up, 2 down, 1 flat; largest rise +6.05% (2026-02-03), largest fall -4.5% (2025-07-29); median move size 2.2%'
            );
        });

        it('drops the flat clause and the missing fall for a one-sided list', () => {
            const tally = tallyEarningsReactions([
                { date: '2026-01-28', movePct: 1.8 },
                { date: '2025-10-28', movePct: 0.9 },
                { date: '2025-07-29', movePct: 0.4 },
            ]);
            expect(tally.summary).toBe(
                '3 reports measured: 3 up, 0 down; largest rise +1.8% (2026-01-28); median move size 0.9%'
            );
        });

        it('drops the missing rise for a list where only falls exist', () => {
            const tally = tallyEarningsReactions([
                { date: '2026-01-28', movePct: -1.5 },
                { date: '2025-10-28', movePct: -0.5 },
            ]);
            expect(tally.summary).toBe(
                '2 reports measured: 0 up, 2 down; largest fall -1.5% (2026-01-28); median move size 1%'
            );
        });

        it('drops both extreme clauses when every move is flat', () => {
            const tally = tallyEarningsReactions([
                { date: '2026-01-28', movePct: 0 },
                { date: '2025-10-28', movePct: 0 },
            ]);
            expect(tally.summary).toBe(
                '2 reports measured: 0 up, 0 down, 2 flat; median move size 0%'
            );
        });

        it('uses the singular noun for one measured report', () => {
            const tally = tallyEarningsReactions([
                { date: '2026-01-28', movePct: -1.5 },
            ]);
            expect(tally.summary).toBe(
                '1 report measured: 0 up, 1 down; largest fall -1.5% (2026-01-28); median move size 1.5%'
            );
        });

        it('counts only measured entries in the summary', () => {
            const tally = tallyEarningsReactions([
                { date: '2026-01-28', movePct: 2 },
                { date: '2025-10-28', movePct: null },
            ]);
            expect(tally.summary?.startsWith('1 report measured')).toBe(true);
        });
    });

    it('does not mutate its input', () => {
        const rows = [
            { date: '2026-02-03', movePct: 3 },
            { date: '2025-10-28', movePct: -5 },
        ];
        const copy = structuredClone(rows);
        tallyEarningsReactions(rows);
        expect(rows).toEqual(copy);
    });
});
