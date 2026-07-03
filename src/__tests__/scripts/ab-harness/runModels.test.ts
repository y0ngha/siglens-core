import { describe, expect, it } from 'vitest';
import { inferModeFromFilename } from '../../../../scripts/ab-harness/runModels';

describe('inferModeFromFilename', () => {
    it('infers "full" from a filename containing full', () => {
        expect(inferModeFromFilename('/tmp/prompts-full.json')).toBe('full');
        expect(inferModeFromFilename('prompts-full.json')).toBe('full');
    });

    it('infers "digest" from a filename containing digest', () => {
        expect(inferModeFromFilename('/tmp/prompts-digest.json')).toBe(
            'digest'
        );
    });

    it('prefers "digest" when both substrings somehow appear (documented tie-break, worst case)', () => {
        expect(inferModeFromFilename('full-digest.json')).toBe('digest');
    });

    it('returns "unknown" when neither substring is present (worst case)', () => {
        expect(inferModeFromFilename('results.json')).toBe('unknown');
    });
});
