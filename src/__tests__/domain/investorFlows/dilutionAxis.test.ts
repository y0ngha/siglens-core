import { describe, expect, it } from 'vitest';
import { DILUTION_WINDOW_DAYS } from '@/domain/investorFlows/constants';
import { evaluateDilutionAxis } from '@/domain/investorFlows/dilutionAxis';
import { parseDay } from '@/domain/investorFlows/scoreHelpers';
import {
    AS_OF,
    daysBeforeAsOf,
    offeringFiling,
} from '../../fixtures/investorFlows';

const AS_OF_DAY = parseDay(AS_OF);

describe('evaluateDilutionAxis — coverage', () => {
    it('is insufficient when the snapshot predates the offerings field', () => {
        const axis = evaluateDilutionAxis(undefined, AS_OF_DAY);
        expect(axis.sufficiency).toBe('insufficient');
        expect(axis.score).toBeNull();
        expect(axis.metrics).toBeNull();
    });

    it('is insufficient with no filings at all', () => {
        expect(evaluateDilutionAxis([], AS_OF_DAY).sufficiency).toBe(
            'insufficient'
        );
    });

    it('is insufficient without a usable reference day', () => {
        expect(evaluateDilutionAxis([offeringFiling()], null).score).toBeNull();
    });

    it('drops future-dated and unparsable filings before counting coverage', () => {
        const axis = evaluateDilutionAxis(
            [
                offeringFiling({ filingDate: '2026-10-20' }),
                offeringFiling({ filingDate: 'not-a-date' }),
            ],
            AS_OF_DAY
        );
        expect(axis.sufficiency).toBe('insufficient');
    });

    it('treats an old filing as coverage and scores a quiet window at zero', () => {
        const axis = evaluateDilutionAxis(
            [
                offeringFiling({
                    kind: 'shelf',
                    form: 'S-3',
                    filingDate: daysBeforeAsOf(400),
                }),
            ],
            AS_OF_DAY
        );
        expect(axis.sufficiency).toBe('sufficient');
        expect(axis.score).toBe(0);
        expect(axis.signals).toEqual([]);
        expect(axis.metrics?.filingsInWindow).toBe(0);
    });
});

describe('evaluateDilutionAxis — signals', () => {
    it('reads an ATM prospectus supplement as moderate bearish', () => {
        const axis = evaluateDilutionAxis([offeringFiling()], AS_OF_DAY);
        expect(axis.signals).toEqual([
            {
                id: 'atm_offering_active',
                axis: 'dilution',
                direction: 'bearish',
                strength: 'moderate',
                evidence: { filings: 1, latestDaysAgo: 10 },
            },
        ]);
        expect(axis.score).toBe(-35);
        expect(axis.label).toBe('bearish');
    });

    it('collapses repeated filings of one kind into one signal', () => {
        // A typical ATM program files a fresh 424B5 every few weeks.
        const axis = evaluateDilutionAxis(
            [
                offeringFiling({ filingDate: daysBeforeAsOf(100) }),
                offeringFiling({ filingDate: daysBeforeAsOf(60) }),
                offeringFiling({ filingDate: daysBeforeAsOf(5) }),
            ],
            AS_OF_DAY
        );
        expect(axis.signals).toHaveLength(1);
        expect(axis.signals[0].evidence).toEqual({
            filings: 3,
            latestDaysAgo: 5,
        });
        expect(axis.metrics?.atmFilings).toBe(3);
        expect(axis.metrics?.latestFilingDate).toBe(daysBeforeAsOf(5));
    });

    it('reads underwritten and best-efforts 424B5s as one marketed-offering signal', () => {
        const axis = evaluateDilutionAxis(
            [
                offeringFiling({ kind: 'underwritten' }),
                offeringFiling({
                    kind: 'best_efforts',
                    filingDate: daysBeforeAsOf(30),
                }),
            ],
            AS_OF_DAY
        );
        expect(axis.signals.map(s => [s.id, s.strength])).toEqual([
            ['underwritten_offering', 'moderate'],
        ]);
        expect(axis.signals[0].evidence).toEqual({
            filings: 2,
            latestDaysAgo: 10,
            underwritten: 1,
            bestEfforts: 1,
        });
    });

    it('reads a new shelf, a full registration and a Form D as weak bearish', () => {
        const axis = evaluateDilutionAxis(
            [
                offeringFiling({ kind: 'shelf', form: 'S-3' }),
                offeringFiling({ kind: 'registration', form: 'S-1' }),
                offeringFiling({ kind: 'private_placement', form: 'D' }),
            ],
            AS_OF_DAY
        );
        expect(axis.signals.map(s => [s.id, s.strength, s.direction])).toEqual([
            ['private_placement', 'weak', 'bearish'],
            ['registration_new', 'weak', 'bearish'],
            ['shelf_registration_new', 'weak', 'bearish'],
        ]);
        expect(axis.score).toBe(-45);
        expect(axis.label).toBe('bearish');
    });

    it('reads a shelf followed by its ATM takedown as strongly bearish', () => {
        const axis = evaluateDilutionAxis(
            [
                offeringFiling({
                    kind: 'shelf',
                    form: 'S-3',
                    filingDate: daysBeforeAsOf(120),
                }),
                offeringFiling(),
            ],
            AS_OF_DAY
        );
        expect(axis.score).toBe(-50);
        expect(axis.label).toBe('strong_bearish');
    });

    it('emits nothing for prospectus and unclassified filings', () => {
        const axis = evaluateDilutionAxis(
            [
                offeringFiling({ kind: 'prospectus', form: '424B3' }),
                offeringFiling({ kind: 'other' }),
            ],
            AS_OF_DAY
        );
        expect(axis.signals).toEqual([]);
        expect(axis.score).toBe(0);
        expect(axis.metrics?.filingsInWindow).toBe(2);
    });
});

describe('evaluateDilutionAxis — window boundary', () => {
    it('includes a filing exactly DILUTION_WINDOW_DAYS old', () => {
        const axis = evaluateDilutionAxis(
            [
                offeringFiling({
                    filingDate: daysBeforeAsOf(DILUTION_WINDOW_DAYS),
                }),
            ],
            AS_OF_DAY
        );
        expect(axis.signals).toHaveLength(1);
    });

    it('excludes a filing one day older', () => {
        const axis = evaluateDilutionAxis(
            [
                offeringFiling({
                    filingDate: daysBeforeAsOf(DILUTION_WINDOW_DAYS + 1),
                }),
            ],
            AS_OF_DAY
        );
        expect(axis.signals).toEqual([]);
        expect(axis.sufficiency).toBe('sufficient');
    });
});
