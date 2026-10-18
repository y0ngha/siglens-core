import { describe, expect, it } from 'vitest';
import type { OverlayKind } from '@/domain/types';
import { buildAnalysisPrompt } from '@/domain/analysis/prompt';
import { calculateIndicators } from '@/domain/indicators/index';
import {
    OVERLAY_ID_PREFIX,
    overlayKindOfId,
} from '@/domain/overlays/constants';
import { chartFixture } from '@/__tests__/domain/patterns/fixtures/chartFixture';
import cupOutsideBarRimFile from '@/__tests__/domain/patterns/fixtures/charts/daily-cup-outside-bar-rim.json';
import crashThenClimbFile from '@/__tests__/domain/patterns/fixtures/charts/daily-crash-then-climb-and-pennant.json';
import hourlyOscillationFile from '@/__tests__/domain/patterns/fixtures/charts/hourly-level-oscillation-b.json';
import { buildDivergenceCandidates } from '@/domain/overlays/divergenceCandidates';

/**
 * The builders write their id prefixes as literals; `OVERLAY_ID_PREFIX` is
 * what readers (`overlayKindOfId`) match on. Every id real prompt builds
 * offer starts with its own kind's prefix and reads back as that kind.
 */
describe('OVERLAY_ID_PREFIX', () => {
    const offered = [
        cupOutsideBarRimFile,
        crashThenClimbFile,
        hourlyOscillationFile,
    ]
        .map(chartFixture)
        .flatMap(
            c =>
                buildAnalysisPrompt(
                    'T',
                    'T',
                    c.bars,
                    calculateIndicators(c.bars),
                    [],
                    c.timeframe
                ).overlayCandidates
        );
    // The real charts carry no RSI divergence: one built from a textbook
    // bullish divergence (lows 105 → 103, RSI 25 → 32).
    const lows = [
        110, 109, 108, 107, 105, 107, 108, 109, 110, 109, 108, 107, 106, 105,
        106, 103, 105, 107, 109, 111,
    ];
    const divergences = buildDivergenceCandidates(
        lows.map((low, i) => ({
            time: 1000 + i,
            open: low + 1,
            high: low + 2,
            low,
            close: low + 1,
            volume: 1,
        })),
        lows.map((_, i) => (i === 4 ? 25 : i === 15 ? 32 : 50)),
        { timeframe: '1Day', quoting: { dp: 2, krxTick: null } }
    );
    const all = [...offered, ...divergences];

    it('every offered id starts with its kind’s prefix and reads back as that kind', () => {
        for (const c of all) {
            expect(c.id.startsWith(OVERLAY_ID_PREFIX[c.kind]), c.id).toBe(true);
            expect(overlayKindOfId(c.id)).toBe(c.kind);
        }
    });

    it('the charts cover every kind', () => {
        const kinds = new Set<OverlayKind>(all.map(c => c.kind));
        expect([...kinds].toSorted()).toEqual(
            Object.keys(OVERLAY_ID_PREFIX).toSorted()
        );
    });

    it('any other string has no kind', () => {
        expect(overlayKindOfId('diamond')).toBeUndefined();
        expect(overlayKindOfId('')).toBeUndefined();
    });
});
