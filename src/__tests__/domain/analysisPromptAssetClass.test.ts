import { describe, it, expect } from 'vitest';
import { buildAnalysisPrompt } from '@/domain/analysis/prompt';
import { EMPTY_INDICATOR_RESULT } from '@/domain/indicators/constants';
import type { Bar } from '@/domain/types';

const bars: Bar[] = []; // empty is fine; we assert framing text, not data sections
const indicators = EMPTY_INDICATOR_RESULT;

describe('buildAnalysisPrompt assetClass framing', () => {
    it('crypto prompt avoids equity-only framing and adds 24/7 context', () => {
        const p = buildAnalysisPrompt(
            'BTCUSD',
            'Bitcoin',
            bars,
            indicators,
            [],
            '1Day',
            undefined,
            'crypto'
        );
        expect(p).toMatch(/24\/7|no market open\/close/i);
        expect(p).not.toMatch(/earnings report|quarterly earnings|P\/E ratio/i);
    });

    it('equity prompt (default) is unchanged framing', () => {
        const p = buildAnalysisPrompt(
            'AAPL',
            'Apple',
            bars,
            indicators,
            [],
            '1Day'
        );
        // Must contain the equity framing literal emitted by buildAnalysisPrompt.
        expect(p).toContain('U.S. equity');
        // Must not bleed crypto-specific context into an equity prompt.
        expect(p).not.toMatch(/24\/7|no market open\/close/i);
    });
});
