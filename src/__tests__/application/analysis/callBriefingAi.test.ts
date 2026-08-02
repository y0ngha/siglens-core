import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/infrastructure/ai/retry/geminiRetry', () => ({
    callGeminiWithRetry: vi.fn(),
}));
vi.mock('@/infrastructure/ai/retry/deepseekRetry', () => ({
    callDeepSeekWithRetry: vi.fn(),
}));

import { callBriefingAi } from '@/application/analysis/callBriefingAi';
import { callDeepSeekWithRetry } from '@/infrastructure/ai/retry/deepseekRetry';
import { callGeminiWithRetry } from '@/infrastructure/ai/retry/geminiRetry';

const OK = 'briefing text';
const FALLBACK = 'deepseek-v4-flash';

beforeEach(() => {
    vi.mocked(callGeminiWithRetry).mockResolvedValue(OK);
    vi.mocked(callDeepSeekWithRetry).mockResolvedValue(OK);
    vi.stubEnv('GEMINI_API_KEY', 'server-gemini');
    vi.stubEnv('DEEPSEEK_API_KEY', 'server-deepseek');
});

afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
});

describe('callBriefingAi', () => {
    it('gemini 요청은 gemini 어댑터로 라우팅한다', async () => {
        await callBriefingAi({
            prompt: 'p',
            requestedModel: 'gemini-2.5-flash',
            fallbackModel: FALLBACK,
        });
        expect(callGeminiWithRetry).toHaveBeenCalledTimes(1);
        expect(callDeepSeekWithRetry).not.toHaveBeenCalled();
        expect(vi.mocked(callGeminiWithRetry).mock.calls[0][1]).toBe(
            'gemini-2.5-flash'
        );
    });

    it('요청 모델이 없으면 fallback으로 라우팅한다', async () => {
        await callBriefingAi({ prompt: 'p', fallbackModel: FALLBACK });
        expect(vi.mocked(callDeepSeekWithRetry).mock.calls[0][1]).toBe(
            FALLBACK
        );
    });

    it('브리핑 불가 모델(claude)은 fallback으로 degrade된다', async () => {
        await callBriefingAi({
            prompt: 'p',
            requestedModel: 'claude-opus-4-7',
            fallbackModel: FALLBACK,
        });
        expect(vi.mocked(callDeepSeekWithRetry).mock.calls[0][1]).toBe(
            FALLBACK
        );
    });

    it('항상 서버 키를 쓴다 (BYOK 개념 없음)', async () => {
        await callBriefingAi({
            prompt: 'p',
            requestedModel: 'gemini-2.5-pro',
            fallbackModel: FALLBACK,
        });
        // gemini-2.5-pro는 premium 모델이지만 브리핑은 tier와 무관하게 서버 키를 쓴다.
        expect(vi.mocked(callGeminiWithRetry).mock.calls[0][2]).toBe(
            'server-gemini'
        );
    });

    it('분석(30s)보다 짧은 10s 누적 재시도 상한을 쓴다', async () => {
        await callBriefingAi({ prompt: 'p', fallbackModel: FALLBACK });
        expect(
            (
                vi.mocked(callDeepSeekWithRetry).mock.calls[0][3] as Record<
                    string,
                    unknown
                >
            ).abortIfCumulativeDelayReachesMs
        ).toBe(10_000);
    });

    it('correlationId를 jobId로 전달한다', async () => {
        await callBriefingAi({
            prompt: 'p',
            fallbackModel: FALLBACK,
            correlationId: 'corr-b',
        });
        expect(
            (
                vi.mocked(callDeepSeekWithRetry).mock.calls[0][3] as Record<
                    string,
                    unknown
                >
            ).jobId
        ).toBe('corr-b');
    });
});
