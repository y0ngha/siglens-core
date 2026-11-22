import { describe, expect, it } from 'vitest';
import {
    aggregateByWeek,
    holmAdjust,
    intervalOf,
    isoDate,
    isoWeekKey,
    pooledMean,
    sampleWithoutReplacement,
    streamForKey,
    weeksOfTimes,
    halfOf,
    weekSerial,
    blockOfWeek,
    recordOf,
} from '../../../../scripts/replay/engineEvalStats';
import { mulberry32 } from '@/domain/outcomes/weekClusterBootstrap';

const draw = (rand: () => number, n: number): number[] =>
    Array.from({ length: n }, () => rand());

describe('streamForKey', () => {
    it('gives identical streams for identical keys and seeds', () => {
        expect(draw(streamForKey(7, 'AAPL|300|hammer'), 5)).toEqual(
            draw(streamForKey(7, 'AAPL|300|hammer'), 5)
        );
    });

    it('differs by key and by seed', () => {
        const base = draw(streamForKey(7, 'AAPL|300|hammer'), 5);
        expect(draw(streamForKey(7, 'AAPL|301|hammer'), 5)).not.toEqual(base);
        expect(draw(streamForKey(8, 'AAPL|300|hammer'), 5)).not.toEqual(base);
    });
});

describe('sampleWithoutReplacement', () => {
    const items = Array.from({ length: 30 }, (_, i) => i);

    it('returns every item in order when there are k or fewer', () => {
        expect(sampleWithoutReplacement([1, 2, 3], 3, mulberry32(1))).toEqual([
            1, 2, 3,
        ]);
        expect(sampleWithoutReplacement([1, 2], 5, mulberry32(1))).toEqual([
            1, 2,
        ]);
    });

    it('draws k distinct members, deterministically, without touching the input', () => {
        const picked = sampleWithoutReplacement(items, 20, mulberry32(3));
        expect(picked).toHaveLength(20);
        expect(new Set(picked).size).toBe(20);
        expect(picked.every(v => items.includes(v))).toBe(true);
        expect(sampleWithoutReplacement(items, 20, mulberry32(3))).toEqual(
            picked
        );
        expect(items).toEqual(Array.from({ length: 30 }, (_, i) => i));
    });
});

describe('isoWeekKey and isoDate', () => {
    it('puts the first days of January in the previous ISO year when the week started in December', () => {
        expect(isoWeekKey(1609632000)).toBe('2020-W53'); // Sunday 2021-01-03
        expect(isoWeekKey(1609718400)).toBe('2021-W01'); // Monday 2021-01-04
    });

    it('puts the last days of December in the next ISO year when their week holds January 1', () => {
        expect(isoWeekKey(1577664000)).toBe('2020-W01'); // Monday 2019-12-30
    });

    it('formats the UTC date', () => {
        expect(isoDate(1795132800)).toBe('2026-11-20');
    });
});

describe('week aggregation', () => {
    it('lists the sorted distinct weeks of bar times', () => {
        expect(
            weeksOfTimes([1609718400, 1609632000, 1609804800, 1577664000])
        ).toEqual(['2020-W01', '2020-W53', '2021-W01']);
    });

    it('sums and counts per week and ignores a week outside the list', () => {
        const aggregate = aggregateByWeek(
            [
                { week: 'a', value: 1 },
                { week: 'a', value: 3 },
                { week: 'b', value: 5 },
                { week: 'zzz', value: 100 },
            ],
            ['a', 'b']
        );
        expect(aggregate.sums).toEqual([4, 5]);
        expect(aggregate.counts).toEqual([2, 1]);
        expect(pooledMean(aggregate)).toBe(3);
    });

    it('has no pooled mean without observations', () => {
        expect(pooledMean(aggregateByWeek([], ['a']))).toBeNull();
    });
});

describe('intervalOf', () => {
    it('is empty without usable replicates', () => {
        expect(intervalOf([])).toEqual({
            low: null,
            high: null,
            p: null,
            droppedReplicates: 0,
        });
        expect(intervalOf([null, null])).toEqual({
            low: null,
            high: null,
            p: null,
            droppedReplicates: 2,
        });
    });

    it('takes the 2.5% and 97.5% percentiles and skips null replicates', () => {
        const values = Array.from({ length: 101 }, (_, i) => i - 50);
        const interval = intervalOf([null, ...values]);
        expect(interval.droppedReplicates).toBe(1);
        expect(interval.low).toBeCloseTo(-47.5, 9);
        expect(interval.high).toBeCloseTo(47.5, 9);
    });

    it('gives a small p when every replicate is on one side of 0 and 1 when split evenly', () => {
        const positive = intervalOf(Array.from({ length: 99 }, () => 1));
        expect(positive.p).toBeCloseTo(2 / 100, 12);
        const split = intervalOf([-1, 1, -1, 1]);
        expect(split.p).toBe(1);
    });
});

describe('holmAdjust', () => {
    it('applies the step-down factors and keeps the adjusted values monotone', () => {
        const adjusted = holmAdjust([0.01, 0.04, 0.03]);
        expect(adjusted[0]).toBeCloseTo(0.03, 12);
        expect(adjusted[1]).toBeCloseTo(0.06, 12);
        expect(adjusted[2]).toBeCloseTo(0.06, 12);
    });

    it('caps at 1 and leaves a null p-value null', () => {
        expect(holmAdjust([0.9, null, 0.8])).toEqual([1, null, 1]);
    });
});

describe('halfOf', () => {
    it('splits at the end of the early year, on UTC dates', () => {
        expect(halfOf(Date.UTC(2021, 11, 31, 23) / 1000)).toBe('early');
        expect(halfOf(Date.UTC(2022, 0, 1) / 1000)).toBe('late');
    });
});

describe('blocks', () => {
    it('numbers consecutive ISO weeks consecutively, across a year boundary', () => {
        expect(weekSerial('2021-W01') - weekSerial('2020-W53')).toBe(1);
        expect(weekSerial('2020-W02') - weekSerial('2020-W01')).toBe(1);
    });

    it('puts every week in its own block for a block of one week and all weeks in one for a huge block', () => {
        expect(blockOfWeek('2020-W01', 1)).not.toBe(blockOfWeek('2020-W02', 1));
        expect(blockOfWeek('2020-W01', 1000)).toBe(
            blockOfWeek('2024-W30', 1000)
        );
    });

    it('never puts two weeks 13 apart in one 13-week block, and keeps neighbours together mostly', () => {
        const weeks = Array.from(
            { length: 20 },
            (_, i) => `2020-W${String(i + 1).padStart(2, '0')}`
        );
        weeks.slice(0, 7).forEach((week, i) => {
            expect(blockOfWeek(week, 13)).not.toBe(
                blockOfWeek(weeks[i + 13], 13)
            );
        });
        const keys = new Set(weeks.map(w => blockOfWeek(w, 13)));
        // 20 consecutive weeks span 2 blocks or 3, depending on where the boundary falls.
        expect([2, 3]).toContain(keys.size);
    });
});

describe('recordOf', () => {
    it('makes one value per key', () => {
        expect(recordOf(['a', 'b'] as const, key => key.toUpperCase())).toEqual(
            {
                a: 'A',
                b: 'B',
            }
        );
    });
});
