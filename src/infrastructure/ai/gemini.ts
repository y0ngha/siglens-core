import { GoogleGenAI } from '@google/genai';
import type {
    CallAiProviderOptions,
    GeminiContents,
} from '@/infrastructure/ai/types';

interface GeminiCallOptions {
    apiKey: string;
    model: string;
    contents: GeminiContents;
    systemInstruction?: string;
}

async function callGemini({
    apiKey,
    model,
    contents,
    systemInstruction,
}: GeminiCallOptions): Promise<string> {
    const genai = new GoogleGenAI({ apiKey });
    const response = await genai.models.generateContent({
        model,
        contents,
        ...(systemInstruction !== undefined
            ? { config: { systemInstruction } }
            : {}),
    });
    return response.text ?? '';
}

/**
 * Call Google Gemini with automatic free→paid API key fallback.
 *
 * Tries `primaryApiKey` first when provided; on any error (typically quota or
 * rate-limit rejection) falls through to `fallbackApiKey`. The `fallbackApiKey`
 * call is awaited normally and any error from it propagates to the
 * caller.
 *
 * Prompts go through `models.generateContent`. When `systemInstruction` is
 * provided it is attached via the SDK's `config.systemInstruction` field.
 *
 * @param options - Primary/fallback keys, model name, prompt contents, and
 *   optional system instruction — see {@link CallAiProviderOptions}.
 * @returns The text content of the first successful Gemini response, or
 *   the empty string when the response is missing text.
 *
 * @throws {Error} When the paid-key call fails (the free-key error is
 *   swallowed by design).
 */
export async function callGeminiWithKeyFallback({
    primaryApiKey,
    fallbackApiKey,
    model,
    contents,
    systemInstruction,
}: CallAiProviderOptions): Promise<string> {
    if (primaryApiKey) {
        try {
            return await callGemini({
                apiKey: primaryApiKey,
                model,
                contents,
                systemInstruction,
            });
        } catch {
            // primary key failed (quota/rate limit) — fall through to fallback key
        }
    }
    return callGemini({
        apiKey: fallbackApiKey,
        model,
        contents,
        systemInstruction,
    });
}
