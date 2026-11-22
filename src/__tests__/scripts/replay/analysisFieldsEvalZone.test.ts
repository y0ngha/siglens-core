import { describe, expect, it } from 'vitest';
import {
    PULLBACK_CUE,
    ZONE_GATES,
    distanceAboveTopAtr,
    exactPosition,
    geometryOf,
    targetRoomComparison,
    zoneGates,
    zoneReport,
    type ZoneCase,
} from '../../../../scripts/replay/analysisFieldsEvalZone';

const zoneCase = (over: Partial<ZoneCase> = {}): ZoneCase => ({
    caseId: 'A',
    close: 99,
    atr: 2,
    zoneLow: 98,
    zoneTop: 100,
    tolerancePosition: 'in_zone',
    storedPosition: 'in_zone',
    approach: 'inside',
    prose: '지금 진입합니다',
    firstTargetRoomAtr: 2,
    ...over,
});

describe('geometryOf', () => {
    it.each([
        [99, 'strictly_inside'],
        [100, 'at_top'],
        [98, 'at_low'],
        [100.5, 'band_above'],
        [101, 'band_above'],
        [101.1, 'above'],
        [97.5, 'band_below'],
        [97.02, 'band_below'],
        [96, 'below'],
    ])('puts a close of %s at %s of the zone 98-100', (close, expected) => {
        expect(geometryOf(close, 98, 100)).toBe(expected);
    });
});

describe('exactPosition', () => {
    it('reads the edges exactly and leaves a no_setup plan alone', () => {
        expect(exactPosition(zoneCase({ close: 100 }))).toBe('in_zone');
        expect(exactPosition(zoneCase({ close: 98 }))).toBe('in_zone');
        expect(exactPosition(zoneCase({ close: 100.01 }))).toBe('above_zone');
        expect(exactPosition(zoneCase({ close: 97.99 }))).toBe('below_zone');
        expect(
            exactPosition(
                zoneCase({ close: 99, tolerancePosition: 'no_setup' })
            )
        ).toBe('no_setup');
        expect(exactPosition(zoneCase({ zoneLow: null, zoneTop: null }))).toBe(
            'no_setup'
        );
    });

    it('measures how far the close lies above the top, in ATR', () => {
        expect(distanceAboveTopAtr(zoneCase({ close: 101 }))).toBe(0.5);
        expect(distanceAboveTopAtr(zoneCase({ close: 99 }))).toBeNull();
        expect(
            distanceAboveTopAtr(zoneCase({ close: 101, atr: null }))
        ).toBeNull();
    });
});

describe('the pullback cue', () => {
    it('finds a plan written as a pullback, in either language', () => {
        expect(PULLBACK_CUE.ko.test('눌림 구간에서 진입')).toBe(true);
        expect(PULLBACK_CUE.ko.test('지지 확인 후 접근')).toBe(true);
        expect(PULLBACK_CUE.ko.test('조정을 기다리는 계획')).toBe(true);
        expect(PULLBACK_CUE.ko.test('조정 후 지지 확인')).toBe(true);
        expect(PULLBACK_CUE.ko.test('현재 가격에서 진입')).toBe(false);
        expect(PULLBACK_CUE.en.test('wait for a pullback to 98')).toBe(true);
        expect(PULLBACK_CUE.en.test('enter at the close')).toBe(false);
    });
});

describe('zoneReport', () => {
    const cases = [
        zoneCase({ caseId: 'inside', close: 99 }),
        zoneCase({ caseId: 'top', close: 100 }),
        zoneCase({
            caseId: 'band',
            close: 100.4,
            prose: '눌림을 기다립니다',
            storedPosition: 'in_zone',
        }),
        zoneCase({
            caseId: 'far',
            close: 105,
            tolerancePosition: 'above_zone',
            storedPosition: 'above_zone',
            approach: 'from_above',
            prose: '되돌림 대기',
        }),
        zoneCase({
            caseId: 'below',
            close: 90,
            tolerancePosition: 'below_zone',
            storedPosition: 'below_zone',
            approach: 'from_below',
        }),
        zoneCase({
            caseId: 'nosetup',
            tolerancePosition: 'no_setup',
            storedPosition: 'no_setup',
            approach: null,
        }),
    ];
    const report = zoneReport(cases, { language: 'ko', restate: false });

    it('counts the positions under the tolerance and under exact edges', () => {
        expect(report.n).toBe(6);
        expect(report.positions.tolerance.in_zone).toMatchObject({
            count: 3,
            n: 6,
        });
        expect(report.positions.exact.in_zone).toMatchObject({
            count: 2,
            n: 6,
        });
        expect(report.positions.exact.above_zone).toMatchObject({
            count: 2,
            n: 6,
        });
        expect(report.positions.stored?.in_zone.count).toBe(3);
    });

    it('splits the plans the 1% rule calls in_zone by where the close sits', () => {
        expect(report.toleranceInZoneGeometry).toMatchObject({
            strictly_inside: { count: 1, n: 3 },
            at_top: { count: 1, n: 3 },
            band_above: { count: 1, n: 3 },
            above: { count: 0, n: 3 },
        });
        expect(report.bandAboveDistanceAtr).toMatchObject({ n: 1 });
        expect(report.bandAboveDistanceAtr.median).toBeCloseTo(0.2);
        expect(report.inZoneWidthAtr.exact).toMatchObject({ n: 2, median: 1 });
        expect(report.inZoneWidthAtr.tolerance).toMatchObject({
            n: 3,
            median: 1,
        });
    });

    it('reads the pullback cue per group', () => {
        expect(report.cueByGroup.tolerance_band_above).toMatchObject({
            count: 1,
            n: 1,
        });
        expect(report.cueByGroup.tolerance_at_or_inside).toMatchObject({
            count: 0,
            n: 2,
        });
        expect(report.cueByGroup.exact_in_zone).toMatchObject({
            count: 0,
            n: 2,
        });
        expect(report.cueByGroup.exact_above_zone).toMatchObject({
            count: 2,
            n: 2,
        });
        expect(report.cueByGroup.tolerance_above_zone).toMatchObject({
            count: 1,
            n: 1,
        });
    });

    it('checks the stored state against the exact rule, the edges and the labeller', () => {
        // The band plan is stored in_zone but sits above the top.
        expect(report.z1.positionEqualsExact).toMatchObject({ count: 5, n: 6 });
        expect(report.z1.inZoneIffInside).toMatchObject({ count: 4, n: 5 });
        expect(report.z1.approachInsideIffInZone).toMatchObject({
            count: 5,
            n: 5,
        });
    });

    it('samples the cases for the manual read deterministically', () => {
        const many = Array.from({ length: 60 }, (_, i) =>
            zoneCase({ caseId: `K${i}`, close: i % 2 === 0 ? 99 : 100.3 })
        );
        const sample = zoneReport(many, {
            language: 'ko',
            restate: true,
        }).n1Sample;
        expect(sample.in_zone).toHaveLength(15);
        expect(sample.above_zone_near).toHaveLength(15);
        expect(sample.other).toHaveLength(0);
        expect(
            zoneReport(many, { language: 'ko', restate: true }).n1Sample
        ).toEqual(sample);
        expect(
            new Set([...sample.in_zone, ...sample.above_zone_near]).size
        ).toBe(30);
    });

    it('uses the exact positions for N3 when restating, the stored ones otherwise', () => {
        const restated = zoneReport(cases, { language: 'ko', restate: true });
        expect(restated.n3.basis).toBe('exact');
        expect(restated.n3.positions.in_zone.count).toBe(2);
        expect(report.n3.basis).toBe('stored');
        expect(report.n3.positions.in_zone.count).toBe(3);
        expect(report.n3.inZoneCi.point).toBeCloseTo(0.5);
    });

    it('falls back to the recomputed position for a run without a stored state', () => {
        const old = zoneReport(
            cases.map(c => ({ ...c, storedPosition: null })),
            { language: 'ko', restate: false }
        );
        expect(old.positions.stored).toBeNull();
        expect(old.n3.positions.in_zone.count).toBe(3);
        expect(old.z1.positionEqualsExact).toBeNull();
        expect(old.z1.inZoneIffInside).toBeNull();
    });
});

describe('zoneGates', () => {
    const gateOf = (
        cases: readonly ZoneCase[],
        id: string,
        restate = false,
        room = null as ReturnType<typeof targetRoomComparison> | null
    ) =>
        zoneGates(
            zoneReport(cases, { language: 'ko', restate }),
            cases.length,
            room
        ).find(g => g.id === id);

    const consistent = Array.from({ length: 10 }, (_, i) =>
        i < 3
            ? zoneCase({ caseId: `in${i}`, close: 99 })
            : zoneCase({
                  caseId: `up${i}`,
                  close: 105,
                  tolerancePosition: 'above_zone',
                  storedPosition: 'above_zone',
                  approach: 'from_above',
              })
    );

    it('Z1 passes when stored state, edges and approach all agree', () => {
        expect(gateOf(consistent, 'Z1')?.pass).toBe(true);
    });

    it('Z1 fails on a band plan stored in_zone and cannot be decided without labels', () => {
        const band = [...consistent, zoneCase({ caseId: 'b', close: 100.3 })];
        expect(gateOf(band, 'Z1')?.pass).toBe(false);
        const unlabelled = consistent.map(c => ({ ...c, approach: null }));
        expect(gateOf(unlabelled, 'Z1')?.pass).toBeNull();
    });

    it('Z1 is not computable when the run stores a state or a label for some plans only', () => {
        const noState = consistent.map((c, i) =>
            i < 2 ? { ...c, storedPosition: null } : c
        );
        expect(gateOf(noState, 'Z1')?.pass).toBeNull();
        // Labels on all but one placed plan: the approach part covers only part of the population.
        const partlyLabelled = consistent.map((c, i) =>
            i === 0 ? { ...c, approach: null } : c
        );
        expect(gateOf(partlyLabelled, 'Z1')?.pass).toBeNull();
        // A no_setup plan needs no label: it is not placed.
        const withNoSetup = [
            ...consistent,
            zoneCase({
                caseId: 'ns',
                tolerancePosition: 'no_setup',
                storedPosition: 'no_setup',
                approach: null,
            }),
        ];
        expect(gateOf(withNoSetup, 'Z1')?.pass).toBe(true);
    });

    it('Z2 passes at the measured M2 figure of 66 in 164 and fails at 67', () => {
        const plans = (cues: number) =>
            Array.from({ length: 164 }, (_, i) =>
                zoneCase({ caseId: `b${i}`, prose: i < cues ? '눌림' : '진입' })
            );
        const gate = (cues: number) => gateOf(plans(cues), 'Z2');
        expect(gate(66)?.pass).toBe(true);
        expect(gate(67)?.pass).toBe(false);
        expect(gate(66)?.threshold).toBe('<= 40.2% (66/164)');
        expect(ZONE_GATES.maxInZoneCueShare).toBe(66 / 164);
    });

    it('Z2 holds the cue share of the exact in_zone plans to 40%', () => {
        const cue = (n: number) =>
            Array.from({ length: 10 }, (_, i) =>
                zoneCase({ caseId: `z${i}`, prose: i < n ? '눌림' : '진입' })
            );
        expect(gateOf(cue(4), 'Z2')?.pass).toBe(true);
        expect(gateOf(cue(5), 'Z2')?.pass).toBe(false);
        expect(gateOf(consistent.slice(3), 'Z2')?.pass).toBeNull();
    });

    it('N3 keeps every position under 85% of the rows', () => {
        expect(gateOf(consistent, 'N3')?.pass).toBe(true);
        const lopsided = Array.from({ length: 10 }, (_, i) =>
            zoneCase({
                caseId: `p${i}`,
                close: i < 9 ? 105 : 99,
                tolerancePosition: i < 9 ? 'above_zone' : 'in_zone',
                storedPosition: i < 9 ? 'above_zone' : 'in_zone',
            })
        );
        expect(gateOf(lopsided, 'N3')?.pass).toBe(false);
        expect(ZONE_GATES.maxPositionShare).toBe(0.85);
    });

    it('N2 compares the target room with a before run and needs it paired', () => {
        expect(gateOf(consistent, 'N2')?.pass).toBeNull();
        const after = Array.from({ length: 40 }, (_, i) =>
            zoneCase({ caseId: `n${i}`, firstTargetRoomAtr: 2 })
        );
        const worse = after.map(c => ({ ...c, firstTargetRoomAtr: 0.3 }));
        const same = after.map(c => ({ ...c }));
        expect(
            gateOf(after, 'N2', false, targetRoomComparison(after, same))?.pass
        ).toBe(true);
        expect(
            gateOf(after, 'N2', false, targetRoomComparison(worse, after))?.pass
        ).toBe(false);
        expect(
            gateOf(
                after,
                'N2',
                false,
                targetRoomComparison(after.slice(0, 20), same)
            )?.pass
        ).toBeNull();
    });
});

describe('targetRoomComparison', () => {
    it('pairs by case and reads the share with a target a full ATR above the top', () => {
        const before = [
            zoneCase({ caseId: 'a', firstTargetRoomAtr: 2 }),
            zoneCase({ caseId: 'b', firstTargetRoomAtr: 0.5 }),
            zoneCase({ caseId: 'c', firstTargetRoomAtr: null }),
        ];
        const after = [
            zoneCase({ caseId: 'a', firstTargetRoomAtr: 1 }),
            zoneCase({ caseId: 'b', firstTargetRoomAtr: 3 }),
            zoneCase({ caseId: 'z', firstTargetRoomAtr: 3 }),
        ];
        const comparison = targetRoomComparison(after, before);
        expect(comparison.paired).toBe(2);
        expect(comparison.before).toMatchObject({ count: 1, n: 2 });
        expect(comparison.after).toMatchObject({ count: 2, n: 2 });
        expect(comparison.diff.point).toBeCloseTo(0.5);
    });
});
