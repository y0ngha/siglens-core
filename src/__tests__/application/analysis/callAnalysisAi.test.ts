import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/infrastructure/ai/retry/anthropicRetry', () => ({
    callClaudeWithRetry: vi.fn(),
}));
vi.mock('@/infrastructure/ai/retry/openaiRetry', () => ({
    callChatGPTWithRetry: vi.fn(),
}));
vi.mock('@/infrastructure/ai/retry/geminiRetry', () => ({
    callGeminiWithRetry: vi.fn(),
}));
vi.mock('@/infrastructure/ai/retry/deepseekRetry', () => ({
    callDeepSeekWithRetry: vi.fn(),
}));

import { callAnalysisAi } from '@/application/analysis/callAnalysisAi';
import { DISABLED_THINKING_BUDGET } from '@/domain/analysis/modelSpecs';
import { callClaudeWithRetry } from '@/infrastructure/ai/retry/anthropicRetry';
import { callDeepSeekWithRetry } from '@/infrastructure/ai/retry/deepseekRetry';
import { callGeminiWithRetry } from '@/infrastructure/ai/retry/geminiRetry';
import { callChatGPTWithRetry } from '@/infrastructure/ai/retry/openaiRetry';

const OK = '{"ok":true}';

/** free 모델(서버 키 경로) — tier와 무관하게 서버 키를 쓴다. */
const GEMINI_FREE = 'gemini-2.5-flash';
const DEEPSEEK_FREE = 'deepseek-v4-flash';
/** premium 모델 — non-pro tier에서는 BYOK가 필요하다. */
const CLAUDE_PREMIUM = 'claude-opus-4-7';
const GPT_PREMIUM = 'gpt-5.5';

function geminiOptions(): Record<string, unknown> {
    return vi.mocked(callGeminiWithRetry).mock.calls[0][3] as Record<
        string,
        unknown
    >;
}

beforeEach(() => {
    vi.mocked(callClaudeWithRetry).mockResolvedValue(OK);
    vi.mocked(callChatGPTWithRetry).mockResolvedValue(OK);
    vi.mocked(callGeminiWithRetry).mockResolvedValue(OK);
    vi.mocked(callDeepSeekWithRetry).mockResolvedValue(OK);
    vi.stubEnv('GEMINI_API_KEY', 'server-gemini');
    vi.stubEnv('DEEPSEEK_API_KEY', 'server-deepseek');
    vi.stubEnv('ANTHROPIC_API_KEY', 'server-anthropic');
    vi.stubEnv('OPENAI_API_KEY', 'server-openai');
});

afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
});

describe('callAnalysisAi — 키 라우팅', () => {
    it('free 모델은 tier와 무관하게 서버 키를 쓴다', async () => {
        await callAnalysisAi({ prompt: 'p', model: GEMINI_FREE, tier: 'free' });
        expect(vi.mocked(callGeminiWithRetry).mock.calls[0][2]).toBe(
            'server-gemini'
        );
    });

    it('pro tier는 premium 모델도 서버 키를 쓴다', async () => {
        await callAnalysisAi({
            prompt: 'p',
            model: CLAUDE_PREMIUM,
            tier: 'pro',
            userApiKey: 'user-key',
        });
        expect(vi.mocked(callClaudeWithRetry).mock.calls[0][2]).toBe(
            'server-anthropic'
        );
    });

    it('non-pro tier + premium 모델은 BYOK를 쓴다', async () => {
        await callAnalysisAi({
            prompt: 'p',
            model: CLAUDE_PREMIUM,
            tier: 'member',
            userApiKey: 'user-key',
        });
        expect(vi.mocked(callClaudeWithRetry).mock.calls[0][2]).toBe(
            'user-key'
        );
    });

    it('BYOK가 필요한데 없으면 던진다', async () => {
        await expect(
            callAnalysisAi({
                prompt: 'p',
                model: CLAUDE_PREMIUM,
                tier: 'member',
            })
        ).rejects.toThrow(/User API key required/);
    });
});

describe('callAnalysisAi — reasoning 번역', () => {
    it('reasoning=false는 gemini thinkingBudget을 0으로 강제한다', async () => {
        await callAnalysisAi({
            prompt: 'p',
            model: GEMINI_FREE,
            reasoning: false,
            // 호출자가 준 budget보다 OFF가 우선해야 한다.
            thinkingBudget: 8192,
        });
        expect(geminiOptions().budgetRef).toEqual({
            current: DISABLED_THINKING_BUDGET,
        });
    });

    it('reasoning=undefined면 gemini에 아무 override도 걸지 않는다', async () => {
        await callAnalysisAi({ prompt: 'p', model: GEMINI_FREE });
        expect(geminiOptions().budgetRef).toBeUndefined();
    });

    it('reasoning=undefined여도 호출자 thinkingBudget은 그대로 전달된다', async () => {
        await callAnalysisAi({
            prompt: 'p',
            model: GEMINI_FREE,
            thinkingBudget: 4096,
        });
        expect(geminiOptions().budgetRef).toEqual({ current: 4096 });
    });

    it('reasoning=true는 gemini에 override를 걸지 않는다 (스펙 강도 유지)', async () => {
        await callAnalysisAi({
            prompt: 'p',
            model: GEMINI_FREE,
            reasoning: true,
        });
        expect(geminiOptions().budgetRef).toBeUndefined();
    });

    it('deepseek은 reasoning 값을 thinking으로 그대로 전달한다', async () => {
        await callAnalysisAi({
            prompt: 'p',
            model: DEEPSEEK_FREE,
            reasoning: true,
        });
        expect(
            (
                vi.mocked(callDeepSeekWithRetry).mock.calls[0][3] as Record<
                    string,
                    unknown
                >
            ).thinking
        ).toBe(true);
    });

    it('deepseek reasoning=undefined는 thinking:undefined로 스펙 기본을 유지한다', async () => {
        await callAnalysisAi({ prompt: 'p', model: DEEPSEEK_FREE });
        expect(
            (
                vi.mocked(callDeepSeekWithRetry).mock.calls[0][3] as Record<
                    string,
                    unknown
                >
            ).thinking
        ).toBeUndefined();
    });

    it('reasoning=false는 claude/gpt를 effort:low로 최소화한다', async () => {
        await callAnalysisAi({
            prompt: 'p',
            model: CLAUDE_PREMIUM,
            tier: 'pro',
            reasoning: false,
        });
        expect(
            (
                vi.mocked(callClaudeWithRetry).mock.calls[0][3] as Record<
                    string,
                    unknown
                >
            ).effort
        ).toBe('low');

        await callAnalysisAi({
            prompt: 'p',
            model: GPT_PREMIUM,
            tier: 'pro',
            reasoning: false,
        });
        expect(
            (
                vi.mocked(callChatGPTWithRetry).mock.calls[0][3] as Record<
                    string,
                    unknown
                >
            ).effort
        ).toBe('low');
    });

    it('reasoning=true/undefined는 claude/gpt에 effort를 넣지 않는다', async () => {
        await callAnalysisAi({
            prompt: 'p',
            model: CLAUDE_PREMIUM,
            tier: 'pro',
            reasoning: true,
        });
        expect(
            (
                vi.mocked(callClaudeWithRetry).mock.calls[0][3] as Record<
                    string,
                    unknown
                >
            ).effort
        ).toBeUndefined();
    });
});

describe('callAnalysisAi — 누적 재시도 상한(비대칭)', () => {
    // 이 비대칭은 의도적이다 — callAnalysisAi.ts의 ANALYSIS_MAX_RETRY_DELAY_MS JSDoc 참조.
    // "누락된 cap"으로 오인해 claude/gpt에 추가하면 이 테스트가 깨진다.
    it('gemini와 deepseek에는 30s cap이 걸린다', async () => {
        await callAnalysisAi({ prompt: 'p', model: GEMINI_FREE });
        expect(geminiOptions().abortIfCumulativeDelayReachesMs).toBe(30_000);

        await callAnalysisAi({ prompt: 'p', model: DEEPSEEK_FREE });
        expect(
            (
                vi.mocked(callDeepSeekWithRetry).mock.calls[0][3] as Record<
                    string,
                    unknown
                >
            ).abortIfCumulativeDelayReachesMs
        ).toBe(30_000);
    });

    it('claude와 gpt에는 cap이 걸리지 않는다 (default 5분 유지)', async () => {
        await callAnalysisAi({
            prompt: 'p',
            model: CLAUDE_PREMIUM,
            tier: 'pro',
        });
        expect(
            (
                vi.mocked(callClaudeWithRetry).mock.calls[0][3] as Record<
                    string,
                    unknown
                >
            ).abortIfCumulativeDelayReachesMs
        ).toBeUndefined();

        await callAnalysisAi({ prompt: 'p', model: GPT_PREMIUM, tier: 'pro' });
        expect(
            (
                vi.mocked(callChatGPTWithRetry).mock.calls[0][3] as Record<
                    string,
                    unknown
                >
            ).abortIfCumulativeDelayReachesMs
        ).toBeUndefined();
    });
});

describe('callAnalysisAi — 응답 처리', () => {
    it('결과에 normalizeJsonResponse를 적용한다 (코드펜스 제거)', async () => {
        vi.mocked(callGeminiWithRetry).mockResolvedValue(
            '```json\n{ "a": 1 }\n```'
        );
        await expect(
            callAnalysisAi({ prompt: 'p', model: GEMINI_FREE })
        ).resolves.toBe('{"a":1}');
    });

    it('빈 응답이면 던진다', async () => {
        vi.mocked(callGeminiWithRetry).mockResolvedValue('   ');
        await expect(
            callAnalysisAi({ prompt: 'p', model: GEMINI_FREE })
        ).rejects.toThrow(/empty response/);
    });

    it('correlationId를 provider 어댑터에 jobId로 전달한다', async () => {
        await callAnalysisAi({
            prompt: 'p',
            model: GEMINI_FREE,
            correlationId: 'corr-1',
        });
        expect(geminiOptions().jobId).toBe('corr-1');
    });
});
