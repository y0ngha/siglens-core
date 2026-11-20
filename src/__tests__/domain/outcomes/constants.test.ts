import { describe, expect, it } from 'vitest';
import * as constants from '@/domain/outcomes/constants';

/**
 * Every constant here is part of a label definition: a stored label means "computed with
 * these numbers". Changing one without bumping `OUTCOME_LABEL_VERSION` leaves stored
 * labels that claim a definition they were not computed with, and the relabel job never
 * runs. So the numbers and the version are pinned together: a change to either side fails
 * this test until both are updated deliberately.
 */
const PINNED = {
    version: 1,
    constants: {
        OUTCOME_SUBJECT_VERSION: 1,
        OUTCOME_WINDOW_BARS: 20,
        OUTCOME_PRE_BARS: 60,
        OUTCOME_HORIZON_BARS: [1, 5, 10, 20],
        LEVEL_MIN_DISTANCE_ATR: 0.25,
        LEVEL_TOUCH_BAND_ATR: 0.1,
        LEVEL_BARRIER_ATR: 0.5,
        LEVEL_FOLLOW_BARS: 10,
        PLACEBO_SHIFT_ATR: 0.5,
        ADJ_FACTOR_EPSILON: 5e-4,
        ADJ_FACTOR_RANGE: [0.02, 50],
        ANCHOR_FORMING_RANGE: [0.67, 1.5],
        ANCHOR_FORMING_REF_TOLERANCE: 0.01,
        BASELINE_MIN_SAMPLES: 20,
    },
};

const { OUTCOME_LABEL_VERSION: version, ...current } = constants;

describe('outcome label constants', () => {
    it('are pinned together with the label version', () => {
        expect(
            { version, constants: current },
            'A label-affecting constant changed (or OUTCOME_LABEL_VERSION did) without the ' +
                'other: bump OUTCOME_LABEL_VERSION in constants.ts and update PINNED here.'
        ).toEqual(PINNED);
    });

    it('lists no constant the pin does not know about', () => {
        expect(Object.keys(current).toSorted()).toEqual(
            Object.keys(PINNED.constants).toSorted()
        );
    });
});
