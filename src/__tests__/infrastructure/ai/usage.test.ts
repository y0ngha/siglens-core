import { describe, expect, it, vi } from 'vitest';
import {
    extractClaudeUsage,
    extractDeepSeekUsage,
    extractGeminiUsage,
    extractOpenAIUsage,
    logUsage,
} from '@/infrastructure/ai/usage';

describe('extractClaudeUsage', () => {
    it('splits input_tokens (standard), cache_read (cachedTokens) and cache_creation (cacheWriteTokens) into disjoint buckets', () => {
        const result = extractClaudeUsage({
            input_tokens: 100,
            cache_creation_input_tokens: 50,
            cache_read_input_tokens: 900,
            output_tokens: 25,
        });

        expect(result).toEqual({
            promptTokens: 100,
            cachedTokens: 900,
            cacheWriteTokens: 50,
            outputTokens: 25,
        });
    });

    it('treats missing/null fields as zero', () => {
        expect(
            extractClaudeUsage({
                input_tokens: null,
                cache_creation_input_tokens: null,
                cache_read_input_tokens: null,
                output_tokens: null,
            })
        ).toEqual({
            promptTokens: 0,
            cachedTokens: 0,
            cacheWriteTokens: 0,
            outputTokens: 0,
        });
    });

    it('returns zeroed usage when usage is undefined', () => {
        expect(extractClaudeUsage(undefined)).toEqual({
            promptTokens: 0,
            cachedTokens: 0,
            cacheWriteTokens: 0,
            outputTokens: 0,
        });
    });
});

describe('extractGeminiUsage', () => {
    it('maps usageMetadata fields to normalized usage', () => {
        const result = extractGeminiUsage({
            promptTokenCount: 1200,
            cachedContentTokenCount: 800,
            candidatesTokenCount: 60,
        });

        expect(result).toEqual({
            promptTokens: 400,
            cachedTokens: 800,
            cacheWriteTokens: 0,
            outputTokens: 60,
        });
    });

    it('returns zeroed usage when usageMetadata is undefined', () => {
        expect(extractGeminiUsage(undefined)).toEqual({
            promptTokens: 0,
            cachedTokens: 0,
            cacheWriteTokens: 0,
            outputTokens: 0,
        });
    });

    it('clamps promptTokens to 0 when cachedContentTokenCount exceeds promptTokenCount', () => {
        const result = extractGeminiUsage({
            promptTokenCount: 500,
            cachedContentTokenCount: 900,
            candidatesTokenCount: 60,
        });

        expect(result).toEqual({
            promptTokens: 0,
            cachedTokens: 900,
            cacheWriteTokens: 0,
            outputTokens: 60,
        });
    });
});

describe('extractOpenAIUsage', () => {
    // NOTE: chatgpt.ts uses the Responses API, whose usage shape is
    // input_tokens / input_tokens_details.cached_tokens / output_tokens —
    // not the Chat Completions shape (prompt_tokens / completion_tokens).
    it('maps Responses API usage fields to normalized usage', () => {
        const result = extractOpenAIUsage({
            input_tokens: 2000,
            input_tokens_details: { cached_tokens: 1500 },
            output_tokens: 80,
        });

        expect(result).toEqual({
            promptTokens: 500,
            cachedTokens: 1500,
            cacheWriteTokens: 0,
            outputTokens: 80,
        });
    });

    it('treats a missing input_tokens_details as zero cached tokens', () => {
        const result = extractOpenAIUsage({
            input_tokens: 500,
            output_tokens: 20,
        });

        expect(result).toEqual({
            promptTokens: 500,
            cachedTokens: 0,
            cacheWriteTokens: 0,
            outputTokens: 20,
        });
    });

    it('returns zeroed usage when usage is undefined', () => {
        expect(extractOpenAIUsage(undefined)).toEqual({
            promptTokens: 0,
            cachedTokens: 0,
            cacheWriteTokens: 0,
            outputTokens: 0,
        });
    });

    it('clamps promptTokens to 0 when cached_tokens exceeds input_tokens', () => {
        const result = extractOpenAIUsage({
            input_tokens: 1000,
            input_tokens_details: { cached_tokens: 1600 },
            output_tokens: 80,
        });

        expect(result).toEqual({
            promptTokens: 0,
            cachedTokens: 1600,
            cacheWriteTokens: 0,
            outputTokens: 80,
        });
    });
});

describe('extractDeepSeekUsage', () => {
    // NOTE: deepseek.ts calls chat.completions.create (classic OpenAI Chat
    // Completions shape) — prompt_tokens / completion_tokens / total_tokens —
    // not the Responses API shape used by extractOpenAIUsage.
    it('maps chat.completions usage fields to normalized usage (no cache metric)', () => {
        const result = extractDeepSeekUsage({
            prompt_tokens: 500,
            completion_tokens: 80,
        });

        expect(result).toEqual({
            promptTokens: 500,
            cachedTokens: 0,
            cacheWriteTokens: 0,
            outputTokens: 80,
        });
    });

    it('splits DeepSeek cache hits out of the standard-price bucket (prompt_cache_hit_tokens)', () => {
        // prompt_tokens = hit + miss = 600; hit=400 must land in cachedTokens
        // and promptTokens must be the miss remainder (200), not the full 600.
        const result = extractDeepSeekUsage({
            prompt_tokens: 600,
            prompt_cache_hit_tokens: 400,
            prompt_cache_miss_tokens: 200,
            completion_tokens: 80,
        });

        expect(result).toEqual({
            promptTokens: 200,
            cachedTokens: 400,
            cacheWriteTokens: 0,
            outputTokens: 80,
        });
    });

    it('splits cache reads via the OpenAI-compatible prompt_tokens_details.cached_tokens', () => {
        const result = extractDeepSeekUsage({
            prompt_tokens: 600,
            prompt_tokens_details: { cached_tokens: 400 },
            completion_tokens: 80,
        });

        expect(result).toEqual({
            promptTokens: 200,
            cachedTokens: 400,
            cacheWriteTokens: 0,
            outputTokens: 80,
        });
    });

    it('prefers prompt_cache_hit_tokens over prompt_tokens_details when both are present', () => {
        const result = extractDeepSeekUsage({
            prompt_tokens: 600,
            prompt_cache_hit_tokens: 400,
            prompt_tokens_details: { cached_tokens: 999 },
            completion_tokens: 80,
        });

        expect(result).toEqual({
            promptTokens: 200,
            cachedTokens: 400,
            cacheWriteTokens: 0,
            outputTokens: 80,
        });
    });

    it('clamps promptTokens to 0 when cached exceeds prompt_tokens', () => {
        const result = extractDeepSeekUsage({
            prompt_tokens: 300,
            prompt_cache_hit_tokens: 500,
            completion_tokens: 80,
        });

        expect(result).toEqual({
            promptTokens: 0,
            cachedTokens: 500,
            cacheWriteTokens: 0,
            outputTokens: 80,
        });
    });

    it('treats missing fields as zero', () => {
        expect(extractDeepSeekUsage({})).toEqual({
            promptTokens: 0,
            cachedTokens: 0,
            cacheWriteTokens: 0,
            outputTokens: 0,
        });
    });

    it('returns zeroed usage when usage is undefined', () => {
        expect(extractDeepSeekUsage(undefined)).toEqual({
            promptTokens: 0,
            cachedTokens: 0,
            cacheWriteTokens: 0,
            outputTokens: 0,
        });
    });
});

describe('logUsage', () => {
    it('emits a single [Usage] console.info line with all fields serialized', () => {
        const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

        logUsage({
            jobId: 'job-1',
            model: 'claude-opus-4-7',
            promptTokens: 100,
            cachedTokens: 80,
            cacheWriteTokens: 40,
            outputTokens: 10,
            latencyMs: 1234,
        });

        expect(infoSpy).toHaveBeenCalledWith(
            '[Usage]',
            JSON.stringify({
                jobId: 'job-1',
                model: 'claude-opus-4-7',
                promptTokens: 100,
                cachedTokens: 80,
                cacheWriteTokens: 40,
                outputTokens: 10,
                latencyMs: 1234,
            })
        );

        infoSpy.mockRestore();
    });
});
