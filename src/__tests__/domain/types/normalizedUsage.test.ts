import { describe, expect, it } from 'vitest';
import type { NormalizedUsage } from '@/domain/types';
import { extractClaudeUsage } from '@/infrastructure/ai/usage';

describe('NormalizedUsage (domain)', () => {
    it('infrastructure 추출기가 domain 타입과 구조적으로 같다', () => {
        const usage: NormalizedUsage = extractClaudeUsage({
            input_tokens: 10,
            cache_read_input_tokens: 5,
            cache_creation_input_tokens: 2,
            output_tokens: 7,
        });
        expect(usage).toEqual({
            promptTokens: 10,
            cachedTokens: 5,
            cacheWriteTokens: 2,
            outputTokens: 7,
        });
    });
});
