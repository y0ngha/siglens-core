import { describe, expect, it } from 'vitest';
import { MS_PER_DAY } from '@/domain/constants/time';
import {
    INSTITUTIONAL_MAX_AGE_DAYS,
    PUT_CALL_MIN_HOLDERS,
    PUT_CALL_SKEW_RATIO,
} from '@/domain/investorFlows/constants';
import { evaluateInstitutionalAxis } from '@/domain/investorFlows/institutionalAxis';
import { parseDay } from '@/domain/investorFlows/scoreHelpers';
import type {
    InstitutionalAxis,
    InstitutionalOptionsQuarter,
} from '@/domain/types';
import { AS_OF, optionsQuarter, quarter } from '../../fixtures/investorFlows';

const AS_OF_DAY = parseDay(AS_OF);
const PRIOR_PERIOD = '2026-03-31';

function axisWith(
    options: readonly InstitutionalOptionsQuarter[] | undefined
): InstitutionalAxis {
    return evaluateInstitutionalAxis(
        {
            quarters: [quarter()],
            topHolders: [],
            topHoldersPeriod: null,
            options,
        },
        1_000_000_000,
        AS_OF_DAY
    );
}

function skew(axis: InstitutionalAxis) {
    return axis.signals.find(s => s.id === 'institutional_put_call_skew');
}

describe('evaluateInstitutionalAxis — put/call skew', () => {
    it('reads a 2.4x put tilt as weak bearish, never stronger', () => {
        // $1.2B of put notional against $500M of calls across 85 filers.
        const axis = axisWith([
            optionsQuarter({ putHolders: 45, putValueUsd: 1_200_000_000 }),
            optionsQuarter({ period: PRIOR_PERIOD, putValueUsd: 900_000_000 }),
        ]);
        expect(skew(axis)).toEqual({
            id: 'institutional_put_call_skew',
            axis: 'institutional',
            direction: 'bearish',
            strength: 'weak',
            evidence: {
                putCallValueRatio: 2.4,
                priorPutCallValueRatio: 1.8,
                putHolders: 45,
                callHolders: 40,
            },
            subject: '2026-06-30',
        });
        expect(axis.metrics.putCallValueRatio).toBe(2.4);
        expect(axis.metrics.priorPutCallValueRatio).toBe(1.8);
        expect(axis.metrics.optionsPeriod).toBe('2026-06-30');
    });

    it('reads a call tilt as weak bullish', () => {
        const axis = axisWith([optionsQuarter({ putValueUsd: 300_000_000 })]);
        expect(skew(axis)?.direction).toBe('bullish');
        expect(skew(axis)?.evidence.priorPutCallValueRatio).toBeNull();
    });

    it('fires exactly at the skew ratio', () => {
        const axis = axisWith([
            optionsQuarter({
                putValueUsd: 500_000_000 * PUT_CALL_SKEW_RATIO,
            }),
        ]);
        expect(skew(axis)?.direction).toBe('bearish');
    });

    it('fires on a doubling from the prior quarter inside the neutral band', () => {
        // 0.6 → 1.3: still inside 1/1.5..1.5, but more than a 2x shift toward puts.
        const axis = axisWith([
            optionsQuarter({ putValueUsd: 650_000_000 }),
            optionsQuarter({ period: PRIOR_PERIOD, putValueUsd: 300_000_000 }),
        ]);
        expect(skew(axis)?.direction).toBe('bearish');
    });

    it('stays silent for a balanced, steady book', () => {
        const axis = axisWith([
            optionsQuarter({ putValueUsd: 600_000_000 }),
            optionsQuarter({ period: PRIOR_PERIOD, putValueUsd: 550_000_000 }),
        ]);
        expect(skew(axis)).toBeUndefined();
        expect(axis.metrics.putCallValueRatio).toBe(1.2);
    });

    it('stays silent when level and shift disagree', () => {
        // Still put-heavy (2.0) but down from 5.0 — mixed, not a read.
        const axis = axisWith([
            optionsQuarter({ putValueUsd: 1_000_000_000 }),
            optionsQuarter({
                period: PRIOR_PERIOD,
                putValueUsd: 2_500_000_000,
            }),
        ]);
        expect(skew(axis)).toBeUndefined();
    });

    it('needs PUT_CALL_MIN_HOLDERS filers', () => {
        const axis = axisWith([
            optionsQuarter({
                putHolders: PUT_CALL_MIN_HOLDERS - 2,
                callHolders: 1,
                putValueUsd: 2_000_000_000,
            }),
        ]);
        expect(skew(axis)).toBeUndefined();
        expect(axis.metrics.putCallValueRatio).toBeNull();
    });

    it('skips an in-progress options quarter and reads the latest complete one', () => {
        const axis = axisWith([
            optionsQuarter({
                period: '2026-09-30',
                complete: false,
                putValueUsd: 3_000_000_000,
            }),
            optionsQuarter(),
        ]);
        expect(axis.metrics.optionsPeriod).toBe('2026-06-30');
        expect(skew(axis)).toBeUndefined();
    });

    it('ignores a stale options quarter', () => {
        const old = new Date(
            (AS_OF_DAY ?? 0) - (INSTITUTIONAL_MAX_AGE_DAYS + 1) * MS_PER_DAY
        )
            .toISOString()
            .slice(0, 10);
        const axis = axisWith([
            optionsQuarter({ period: old, putValueUsd: 3_000_000_000 }),
        ]);
        expect(axis.metrics.optionsPeriod).toBeNull();
    });

    it('ignores a quarter with no call notional (ratio undefined)', () => {
        const axis = axisWith([optionsQuarter({ callValueUsd: 0 })]);
        expect(axis.metrics.putCallValueRatio).toBeNull();
    });

    it('reads nothing from snapshots built before the options field', () => {
        const axis = axisWith(undefined);
        expect(axis.metrics.putCallValueRatio).toBeNull();
        expect(skew(axis)).toBeUndefined();
    });

    it('adds at most a weak signal to the axis score', () => {
        const without = axisWith(undefined);
        const withSkew = axisWith([
            optionsQuarter({ putValueUsd: 5_000_000_000 }),
        ]);
        expect((withSkew.score ?? 0) - (without.score ?? 0)).toBe(-15);
    });
});
