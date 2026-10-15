import { describe, expect, it } from 'vitest';
import {
    LABEL_MILD_CUTOFF,
    LABEL_STRONG_CUTOFF,
    SIGNAL_POINTS,
} from '@/domain/investorFlows/constants';
import {
    clampScore,
    daysBetween,
    formatDay,
    labelForScore,
    makeSignal,
    parseAsOfDay,
    parseDay,
    roundValue,
    scoreFromSignals,
    signalPoints,
    sortSignals,
    strengthOf,
} from '@/domain/investorFlows/scoreHelpers';

describe('labelForScore', () => {
    it.each([
        [LABEL_STRONG_CUTOFF, 'strong_bullish'],
        [LABEL_STRONG_CUTOFF - 0.01, 'bullish'],
        [LABEL_MILD_CUTOFF, 'bullish'],
        [LABEL_MILD_CUTOFF - 0.01, 'neutral'],
        [0, 'neutral'],
        [-(LABEL_MILD_CUTOFF - 0.01), 'neutral'],
        [-LABEL_MILD_CUTOFF, 'bearish'],
        [-(LABEL_STRONG_CUTOFF - 0.01), 'bearish'],
        [-LABEL_STRONG_CUTOFF, 'strong_bearish'],
    ] as const)('%s → %s', (score, label) => {
        expect(labelForScore(score)).toBe(label);
    });

    it('keeps a lone weak signal neutral, a lone moderate one mild and a lone strong one strong', () => {
        expect(labelForScore(SIGNAL_POINTS.weak)).toBe('neutral');
        expect(labelForScore(SIGNAL_POINTS.moderate)).toBe('bullish');
        expect(labelForScore(SIGNAL_POINTS.strong)).toBe('strong_bullish');
    });
});

describe('scoring', () => {
    const bull = (strength: 'weak' | 'moderate' | 'strong') =>
        makeSignal(
            'insider',
            'insider_open_market_buying',
            'bullish',
            strength,
            {}
        );
    const bear = (strength: 'weak' | 'moderate' | 'strong') =>
        makeSignal(
            'insider',
            'insider_routine_selling',
            'bearish',
            strength,
            {}
        );
    const neutral = makeSignal(
        'insider',
        'insider_quiet',
        'neutral',
        'strong',
        {}
    );

    it('signs points by direction and gives neutral signals none', () => {
        expect(signalPoints(bull('moderate'))).toBe(SIGNAL_POINTS.moderate);
        expect(signalPoints(bear('moderate'))).toBe(-SIGNAL_POINTS.moderate);
        expect(signalPoints(neutral)).toBe(0);
    });

    it('sums and clamps to ±100', () => {
        expect(scoreFromSignals([bull('strong'), bear('weak')])).toBe(45);
        expect(
            scoreFromSignals([bull('strong'), bull('strong'), bull('strong')])
        ).toBe(100);
        expect(
            scoreFromSignals([bear('strong'), bear('strong'), bear('strong')])
        ).toBe(-100);
    });

    it('clamps and rounds a raw score', () => {
        expect(clampScore(150)).toBe(100);
        expect(clampScore(-150)).toBe(-100);
        expect(clampScore(12.3456)).toBe(12.35);
    });

    it('omits `subject` when there is none', () => {
        expect(bull('weak')).not.toHaveProperty('subject');
        expect(
            makeSignal('insider', 'insider_quiet', 'neutral', 'weak', {}, 'X')
        ).toHaveProperty('subject', 'X');
    });
});

describe('sortSignals', () => {
    it('orders strongest first, then by id, then by subject, without mutating the input', () => {
        const a = makeSignal(
            'largeHolders',
            'passive_13g_new',
            'bullish',
            'weak',
            {},
            'B'
        );
        const b = makeSignal(
            'largeHolders',
            'passive_13g_new',
            'bullish',
            'weak',
            {},
            'A'
        );
        const c = makeSignal(
            'largeHolders',
            'activist_13d_new',
            'bullish',
            'strong',
            {}
        );
        const input = [a, b, c];
        expect(sortSignals(input)).toEqual([c, b, a]);
        expect(input).toEqual([a, b, c]);
    });
});

describe('strengthOf', () => {
    const t = { weak: 1, moderate: 2, strong: 3 };
    it.each([
        [0.99, null],
        [1, 'weak'],
        [1.99, 'weak'],
        [2, 'moderate'],
        [2.99, 'moderate'],
        [3, 'strong'],
    ] as const)('%s → %s', (magnitude, expected) => {
        expect(strengthOf(magnitude, t)).toBe(expected);
    });

    it('caps at moderate when no strong threshold is given', () => {
        expect(strengthOf(1000, { weak: 1, moderate: 2 })).toBe('moderate');
    });
});

describe('dates and rounding', () => {
    it('parses the leading yyyy-mm-dd of a date or datetime as a UTC day', () => {
        expect(parseDay('2026-10-15')).toBe(Date.UTC(2026, 9, 15));
        expect(parseDay('2026-10-15T23:59:59Z')).toBe(Date.UTC(2026, 9, 15));
    });

    it.each(['', 'garbage', '2026-13-01', '2026-02-31', '15-10-2026'])(
        'rejects %j',
        text => {
            expect(parseDay(text)).toBeNull();
        }
    );

    it.each([
        ['2026-10-15', Date.UTC(2026, 9, 15)],
        ['2026-10-15T00:00:00Z', Date.UTC(2026, 9, 15)],
        ['2026-10-15T23:59:59', Date.UTC(2026, 9, 15)],
        ['2026-10-15T23:30:00-05:00', Date.UTC(2026, 9, 16)],
        ['2026-10-15T00:30:00+09:00', Date.UTC(2026, 9, 14)],
    ])('parseAsOfDay(%j) is the UTC calendar day', (text, expected) => {
        expect(parseAsOfDay(text)).toBe(expected);
    });

    it.each(['', 'garbage', '2026-10-15T99:99:00Z'])(
        'parseAsOfDay rejects %j',
        text => {
            expect(parseAsOfDay(text)).toBeNull();
        }
    );

    it('formats a UTC day and counts whole days between two of them', () => {
        const from = Date.UTC(2026, 0, 31);
        const to = Date.UTC(2026, 2, 1);
        expect(formatDay(from)).toBe('2026-01-31');
        expect(daysBetween(from, to)).toBe(29);
        expect(daysBetween(to, from)).toBe(-29);
    });

    it('rounds to two decimals and never returns -0', () => {
        expect(roundValue(1.005 + 1e-9)).toBe(1.01);
        expect(roundValue(-0.001)).toBe(0);
        expect(Object.is(roundValue(-0.001), 0)).toBe(true);
        expect(roundValue(0.123456, 4)).toBe(0.1235);
    });
});
