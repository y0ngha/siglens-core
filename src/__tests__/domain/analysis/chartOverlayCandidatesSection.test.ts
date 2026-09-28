import { describe, expect, it } from 'vitest';
import type { OverlayCandidate } from '@/domain/types';
import {
    CHART_OVERLAY_CANDIDATES_SECTION_HEADER,
    CHART_OVERLAY_CANDIDATES_SECTION_INTRO,
    formatChartOverlayCandidatesSection,
} from '@/domain/analysis/chartOverlayCandidatesSection';

const cand = (
    id: string,
    kind: OverlayCandidate['kind'],
    skill: string,
    promptLine: string
): OverlayCandidate => ({
    id,
    kind,
    skill,
    promptLine,
    segments: [],
    levels: [],
    labels: [],
});

describe('formatChartOverlayCandidatesSection', () => {
    it('returns "" when there are no candidates', () => {
        expect(formatChartOverlayCandidatesSection([])).toBe('');
    });

    it('drops pattern-kind candidates — those live in the pattern section', () => {
        expect(
            formatChartOverlayCandidatesSection([
                cand('pattern:double_top:1', 'pattern', 'double_top', 'p'),
            ])
        ).toBe('');
    });

    it('groups by kind under its own heading, in fixed order', () => {
        const out = formatChartOverlayCandidatesSection([
            cand('ew:up:1:6', 'elliott', 'elliott-wave', 'impulse up'),
            cand('tl:support:1:3', 'trendline', 'trendline', 'support line'),
            cand(
                'div:rsi_bullish:5',
                'divergence',
                'divergence',
                'RSI bullish'
            ),
            cand(
                'fib:short:5',
                'fibonacci',
                'fibonacci-retracement',
                'short leg'
            ),
        ]);
        expect(out).toBe(
            [
                CHART_OVERLAY_CANDIDATES_SECTION_HEADER,
                CHART_OVERLAY_CANDIDATES_SECTION_INTRO,
                '### Trendlines\n- id: tl:support:1:3 | skill: trendline | support line',
                '### Divergences\n- id: div:rsi_bullish:5 | skill: divergence | RSI bullish',
                '### Fibonacci\n- id: fib:short:5 | skill: fibonacci-retracement | short leg',
                '### Elliott waves\n- id: ew:up:1:6 | skill: elliott-wave | impulse up',
            ].join('\n')
        );
    });
});
