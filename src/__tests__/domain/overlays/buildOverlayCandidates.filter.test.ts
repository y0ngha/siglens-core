import { describe, expect, it, vi } from 'vitest';
import type { MarketReference, OverlayCandidate } from '@/domain/types';
import { buildOverlayCandidates } from '@/domain/overlays/buildOverlayCandidates';

const segment = (from: number, to: number) => ({
    from: { time: from, price: 1 },
    to: { time: to, price: 2 },
    role: 'wave_1',
    style: 'solid' as const,
    pane: 'price' as const,
});
const candidate = (id: string, from: number, to: number): OverlayCandidate => ({
    id,
    kind: 'elliott',
    skill: 'elliott-wave',
    promptLine: '',
    segments: [segment(from, to)],
    levels: [],
    labels: [],
});

// Isolated file: this mock replaces the elliott builder for every test here.
vi.mock('@/domain/overlays/elliottCandidates', () => ({
    buildElliottCandidates: (): OverlayCandidate[] => [
        candidate('ew:good', 1, 3),
        candidate('ew:zero-length', 2, 2),
        candidate('ew:backwards', 5, 4),
    ],
}));

const EMPTY_HORIZON = { fibProjection: null, abcExtension: null };

describe('buildOverlayCandidates — non-forward segments', () => {
    it('drops candidates whose segments do not move forward and keeps the rest', () => {
        const out = buildOverlayCandidates({
            bars: [],
            atr: 1,
            rsi: [],
            patternCandidates: [],
            marketReference: {
                short: EMPTY_HORIZON,
                medium: EMPTY_HORIZON,
                long: EMPTY_HORIZON,
            } as unknown as MarketReference,
            fmt: { timeframe: '1Day', priceDp: 2 },
        });
        expect(out.candidates.map(c => c.id)).toEqual(['ew:good']);
    });
});
