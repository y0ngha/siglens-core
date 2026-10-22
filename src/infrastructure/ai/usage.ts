/**
 * Provider-agnostic token-usage telemetry.
 *
 * The three provider SDKs report usage under different field names and
 * different nesting. This module normalizes them to one shape so
 * `[Usage]` log lines are comparable across providers regardless of which
 * model served a given job.
 */
import type { NormalizedUsage } from '@/domain/types';

// Frozen module-scoped singleton — extractors return a fresh spread copy
// (`{ ...ZERO_USAGE }`) so no caller can mutate shared state; the freeze is a
// defense-in-depth belt so a direct-reference regression fails loudly.
const ZERO_USAGE: Readonly<NormalizedUsage> = Object.freeze({
    promptTokens: 0,
    cachedTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
});

/**
 * Anthropic Messages API usage shape (`@anthropic-ai/sdk` `Message.usage`).
 * Fields are `number | null` in the SDK types.
 */
export interface ClaudeUsageLike {
    input_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
    cache_read_input_tokens?: number | null;
    output_tokens?: number | null;
}

/**
 * Anthropic bills the three input buckets at distinct rates, so they are kept
 * separate: `input_tokens` is standard-price non-cached input (`promptTokens`,
 * 1x); `cache_read_input_tokens` is cache reads (`cachedTokens`, ~0.1x);
 * `cache_creation_input_tokens` is cache writes (`cacheWriteTokens`, ~1.25x).
 * Folding cache-creation into `promptTokens` would inflate the standard-price
 * bucket by the 1.25x write premium and distort cost visibility.
 */
export function extractClaudeUsage(
    usage: ClaudeUsageLike | undefined | null
): NormalizedUsage {
    if (!usage) return { ...ZERO_USAGE };
    return {
        promptTokens: usage.input_tokens ?? 0,
        cachedTokens: usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
        outputTokens: usage.output_tokens ?? 0,
    };
}

/** Gemini `GenerateContentResponse.usageMetadata` shape (`@google/genai`). */
export interface GeminiUsageLike {
    promptTokenCount?: number;
    cachedContentTokenCount?: number;
    candidatesTokenCount?: number;
}

export function extractGeminiUsage(
    usage: GeminiUsageLike | undefined | null
): NormalizedUsage {
    if (!usage) return { ...ZERO_USAGE };
    return {
        promptTokens: Math.max(
            0,
            (usage.promptTokenCount ?? 0) - (usage.cachedContentTokenCount ?? 0)
        ),
        cachedTokens: usage.cachedContentTokenCount ?? 0,
        // Gemini has no separate cache-write metric.
        cacheWriteTokens: 0,
        outputTokens: usage.candidatesTokenCount ?? 0,
    };
}

/**
 * OpenAI usage shape.
 *
 * NOTE: providers/openai.ts calls the **Responses API** (`client.responses.create`),
 * whose `response.usage` (`OpenAI.Responses.ResponseUsage`) reports
 * `input_tokens` / `input_tokens_details.cached_tokens` / `output_tokens` —
 * *not* the Chat Completions shape (`prompt_tokens` /
 * `prompt_tokens_details.cached_tokens` / `completion_tokens`). This extractor
 * matches the actually-installed SDK's Responses API shape; using the Chat
 * Completions field names here would silently extract all-zero usage.
 */
export interface OpenAIUsageLike {
    input_tokens?: number;
    input_tokens_details?: { cached_tokens?: number };
    output_tokens?: number;
}

export function extractOpenAIUsage(
    usage: OpenAIUsageLike | undefined | null
): NormalizedUsage {
    if (!usage) return { ...ZERO_USAGE };
    return {
        promptTokens: Math.max(
            0,
            (usage.input_tokens ?? 0) -
                (usage.input_tokens_details?.cached_tokens ?? 0)
        ),
        cachedTokens: usage.input_tokens_details?.cached_tokens ?? 0,
        // OpenAI has no separate cache-write metric.
        cacheWriteTokens: 0,
        outputTokens: usage.output_tokens ?? 0,
    };
}

/**
 * DeepSeek `chat.completions` usage shape (classic OpenAI Chat Completions
 * shape — NOT the Responses API shape used by `extractOpenAIUsage`, since
 * `providers/deepseek.ts` calls `chat.completions.create`, not `responses.create`).
 *
 * DeepSeek's context-caching reports cache hits/misses two ways: the
 * DeepSeek-specific top-level `prompt_cache_hit_tokens`/`prompt_cache_miss_tokens`
 * split (where `prompt_tokens = hit + miss`) and/or the OpenAI-compatible
 * `prompt_tokens_details.cached_tokens`. Cache reads must be kept out of the
 * standard-price `promptTokens` bucket to honor this module's invariant.
 */
export interface DeepSeekUsageLike {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_cache_hit_tokens?: number;
    /**
     * Cache-miss counterpart of `prompt_cache_hit_tokens`
     * (`prompt_tokens = hit + miss`). Not read directly — `promptTokens` is
     * derived as `prompt_tokens - hit` — but declared so the reported shape is
     * documented and callers can pass it without an excess-property error.
     */
    prompt_cache_miss_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
}

export function extractDeepSeekUsage(
    usage: DeepSeekUsageLike | undefined | null
): NormalizedUsage {
    if (!usage) return { ...ZERO_USAGE };
    // Cache reads: prefer DeepSeek's explicit hit count; fall back to the
    // OpenAI-compatible details field. Either way, subtract from prompt_tokens
    // so the standard-price bucket excludes cache-read tokens.
    const cached =
        usage.prompt_cache_hit_tokens ??
        usage.prompt_tokens_details?.cached_tokens ??
        0;
    return {
        promptTokens: Math.max(0, (usage.prompt_tokens ?? 0) - cached),
        cachedTokens: cached,
        // DeepSeek has no separate cache-write metric (writes are billed as
        // regular misses), so this is always 0.
        cacheWriteTokens: 0,
        outputTokens: usage.completion_tokens ?? 0,
    };
}

export interface UsageLogFields extends NormalizedUsage {
    jobId: string;
    model: string;
    latencyMs: number;
}

/** Emits the single normalized `[Usage]` telemetry line shared by all providers. */
export function logUsage(fields: UsageLogFields): void {
    console.info('[Usage]', JSON.stringify(fields));
}
