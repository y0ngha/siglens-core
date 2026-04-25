import { GoogleGenAI } from '@google/genai';
import type {
    CallGeminiWithKeyFallbackOptions,
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

export async function callGeminiWithKeyFallback({
    freeApiKey,
    paidApiKey,
    model,
    contents,
    systemInstruction,
}: CallGeminiWithKeyFallbackOptions): Promise<string> {
    if (freeApiKey) {
        try {
            return await callGemini({
                apiKey: freeApiKey,
                model,
                contents,
                systemInstruction,
            });
        } catch {
            // free key failed (quota/rate limit) — fall through to paid key
        }
    }
    return callGemini({
        apiKey: paidApiKey,
        model,
        contents,
        systemInstruction,
    });
}
