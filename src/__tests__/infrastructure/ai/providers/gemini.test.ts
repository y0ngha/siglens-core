import { GoogleGenAI } from '@google/genai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    MAX_TOKENS_CODE,
    callGemini,
} from '@/infrastructure/ai/providers/gemini';
import type { GeminiModelId } from '@/domain/analysis/modelSpecs';

const mockGenerateContent = vi.hoisted(() => vi.fn());

vi.mock('@google/genai', () => ({
    GoogleGenAI: vi.fn(function () {
        return {
            models: {
                generateContent: mockGenerateContent,
            },
        };
    }),
    // The adapter maps domain thinking levels through this enum, so the mock
    // must carry it — a bare function mock makes the import undefined at runtime.
    ThinkingLevel: {
        MINIMAL: 'MINIMAL',
        LOW: 'LOW',
        MEDIUM: 'MEDIUM',
        HIGH: 'HIGH',
    },
}));

const mockedGoogleGenAI = vi.mocked(GoogleGenAI);

const MODEL: GeminiModelId = 'gemini-3.5-flash-lite';

const SUCCESS = {
    candidates: [{ finishReason: 'STOP' }],
    text: 'analysis result',
};

describe('callGemini responseSchema enforcement', () => {
    beforeEach(() => {
        mockGenerateContent.mockClear();
        mockedGoogleGenAI.mockClear();
    });

    it('sets only responseMimeType when responseSchema is absent (backward-compat)', async () => {
        mockGenerateContent.mockResolvedValueOnce(SUCCESS);

        await callGemini('prompt', { model: MODEL, apiKey: 'key' });

        const config = mockGenerateContent.mock.calls[0][0].config;
        expect(config.responseMimeType).toBe('application/json');
        expect(config).not.toHaveProperty('responseJsonSchema');
        expect(config).not.toHaveProperty('responseSchema');
    });

    it('sets responseJsonSchema when responseSchema is present', async () => {
        mockGenerateContent.mockResolvedValueOnce(SUCCESS);

        const schema = {
            type: 'object',
            properties: { verdict: { type: 'string' } },
            required: ['verdict'],
            additionalProperties: false,
        };

        await callGemini('prompt', {
            model: MODEL,
            apiKey: 'key',
            responseSchema: schema,
        });

        const config = mockGenerateContent.mock.calls[0][0].config;
        // responseMimeType은 유지하면서 canonical schema를 그대로 전달한다.
        expect(config.responseMimeType).toBe('application/json');
        expect(config.responseJsonSchema).toBe(schema);
    });
});

describe('callGemini seed', () => {
    beforeEach(() => {
        mockGenerateContent.mockClear();
        mockedGoogleGenAI.mockClear();
    });

    it('omits seed from config when seed is absent (backward-compat)', async () => {
        mockGenerateContent.mockResolvedValueOnce(SUCCESS);

        await callGemini('prompt', { model: MODEL, apiKey: 'key' });

        const config = mockGenerateContent.mock.calls[0][0].config;
        expect(config).not.toHaveProperty('seed');
    });

    it('sets config.seed to the provided integer when seed is present', async () => {
        mockGenerateContent.mockResolvedValueOnce(SUCCESS);

        await callGemini('prompt', { model: MODEL, apiKey: 'key', seed: 42 });

        const config = mockGenerateContent.mock.calls[0][0].config;
        expect(config.seed).toBe(42);
    });

    it('sets config.seed to 0 (boundary: seed === 0 is honored, not treated as absent)', async () => {
        mockGenerateContent.mockResolvedValueOnce(SUCCESS);

        await callGemini('prompt', { model: MODEL, apiKey: 'key', seed: 0 });

        const config = mockGenerateContent.mock.calls[0][0].config;
        expect(config.seed).toBe(0);
    });
});

describe('callGemini finishReason handling', () => {
    beforeEach(() => {
        mockGenerateContent.mockClear();
        mockedGoogleGenAI.mockClear();
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('returns the text on finishReason STOP with non-empty text', async () => {
        mockGenerateContent.mockResolvedValueOnce({
            candidates: [{ finishReason: 'STOP' }],
            text: 'analysis result',
        });

        await expect(
            callGemini('prompt', { model: MODEL, apiKey: 'key' })
        ).resolves.toBe('analysis result');
    });

    it('throws a retryable error on STOP with empty text', async () => {
        mockGenerateContent.mockResolvedValueOnce({
            candidates: [{ finishReason: 'STOP' }],
            text: '',
        });

        await expect(
            callGemini('prompt', { model: MODEL, apiKey: 'key' })
        ).rejects.toMatchObject({ retryable: true });
    });

    it('throws a non-retryable error on finishReason SAFETY', async () => {
        mockGenerateContent.mockResolvedValueOnce({
            candidates: [
                { finishReason: 'SAFETY', safetyRatings: [{ category: 'X' }] },
            ],
            text: undefined,
        });

        const error = await callGemini('prompt', {
            model: MODEL,
            apiKey: 'key',
        }).catch((e: unknown) => e);

        // SAFETY는 재시도해도 동일 차단 → retryable/code 마커가 없어야 한다.
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toMatch(/safety filter/i);
        expect(error).not.toHaveProperty('retryable');
        expect(error).not.toHaveProperty('code');
    });

    it('throws an error carrying MAX_TOKENS_CODE on finishReason MAX_TOKENS', async () => {
        mockGenerateContent.mockResolvedValueOnce({
            candidates: [{ finishReason: 'MAX_TOKENS' }],
            text: undefined,
        });

        await expect(
            callGemini('prompt', { model: MODEL, apiKey: 'key' })
        ).rejects.toMatchObject({ code: MAX_TOKENS_CODE });
    });

    it('throws a retryable error on an unknown finishReason', async () => {
        mockGenerateContent.mockResolvedValueOnce({
            candidates: [{ finishReason: 'RECITATION' }],
            text: undefined,
        });

        await expect(
            callGemini('prompt', { model: MODEL, apiKey: 'key' })
        ).rejects.toMatchObject({ retryable: true });
    });
});

describe('callGemini — usage telemetry', () => {
    beforeEach(() => {
        mockGenerateContent.mockClear();
    });

    it('logs normalized [Usage] when jobId is provided', async () => {
        const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

        mockGenerateContent.mockResolvedValueOnce({
            ...SUCCESS,
            usageMetadata: {
                promptTokenCount: 1200,
                cachedContentTokenCount: 800,
                candidatesTokenCount: 60,
            },
        });

        await callGemini('prompt', {
            model: MODEL,
            apiKey: 'key',
            jobId: 'job-456',
        });

        expect(infoSpy).toHaveBeenCalledTimes(1);
        const [tag, payload] = infoSpy.mock.calls[0];
        expect(tag).toBe('[Usage]');
        expect(JSON.parse(payload as string)).toMatchObject({
            jobId: 'job-456',
            model: MODEL,
            promptTokens: 400,
            cachedTokens: 800,
            cacheWriteTokens: 0,
            outputTokens: 60,
        });

        infoSpy.mockRestore();
    });

    it('does not log usage when jobId is omitted', async () => {
        const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

        mockGenerateContent.mockResolvedValueOnce(SUCCESS);

        await callGemini('prompt', { model: MODEL, apiKey: 'key' });

        expect(infoSpy).not.toHaveBeenCalled();
        infoSpy.mockRestore();
    });
});

describe('callGemini thinkingConfig', () => {
    beforeEach(() => {
        mockGenerateContent.mockClear();
        mockedGoogleGenAI.mockClear();
    });

    /** Reads the thinkingConfig actually put on the wire. */
    function sentThinkingConfig(): Record<string, unknown> {
        return mockGenerateContent.mock.calls[0][0].config.thinkingConfig;
    }

    it('always sends thinkingConfig, even with no caller override', async () => {
        // Omitting it lets the model's natural default through, which is
        // reasoning ON for most Gemini models — that is exactly the silent
        // behaviour this adapter was changed to prevent.
        mockGenerateContent.mockResolvedValueOnce(SUCCESS);

        await callGemini('prompt', { model: MODEL, apiKey: 'key' });

        expect(sentThinkingConfig()).toBeDefined();
        expect(sentThinkingConfig().includeThoughts).toBe(false);
    });

    it("resolves the spec's default state when no override is given", async () => {
        mockGenerateContent.mockResolvedValueOnce(SUCCESS);

        await callGemini('prompt', { model: MODEL, apiKey: 'key' });

        // gemini-3.5-flash-lite is free class → `reasoning.default: 'off'` →
        // `minimal`, which maps to the SDK's uppercase enum member.
        expect(sentThinkingConfig().thinkingLevel).toBe('MINIMAL');
    });

    it('maps every domain thinking level to its SDK enum member', async () => {
        // Guards the THINKING_LEVEL_TO_SDK table. A wrong entry here reaches
        // the provider as an unknown level, and the wire format is the only
        // place the mistake would show up.
        const CASES = [
            ['minimal', 'MINIMAL'],
            ['low', 'LOW'],
            ['medium', 'MEDIUM'],
            ['high', 'HIGH'],
        ] as const;

        for (const [domain, sdk] of CASES) {
            mockGenerateContent.mockClear();
            mockGenerateContent.mockResolvedValueOnce(SUCCESS);

            await callGemini('prompt', {
                model: MODEL,
                apiKey: 'key',
                thinkingLevel: domain,
            });

            expect(sentThinkingConfig().thinkingLevel, domain).toBe(sdk);
        }
    });

    it('never sends a numeric thinkingBudget', async () => {
        // Generation-3 models either reject the numeric budget or ignore it
        // silently; the adapter must not fall back to it.
        mockGenerateContent.mockResolvedValueOnce(SUCCESS);

        await callGemini('prompt', { model: MODEL, apiKey: 'key' });

        expect(sentThinkingConfig()).not.toHaveProperty('thinkingBudget');
    });
});
