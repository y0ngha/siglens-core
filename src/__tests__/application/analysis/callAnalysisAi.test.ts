import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
    type MockInstance,
} from 'vitest';
import * as normalizeJsonResponseModule from '@/infrastructure/ai/normalizeJsonResponse';

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

import {
    _resetPartialHardOffWarningsForTest,
    callAnalysisAi,
    DEEPSEEK_FALLBACK_MODEL,
} from '@/application/analysis/callAnalysisAi';
import { UserApiKeyMissingError } from '@/application/byok/errors';
import * as serverKeysModule from '@/infrastructure/ai/serverKeys';
import { callClaudeWithRetry } from '@/infrastructure/ai/retry/anthropicRetry';
import { callDeepSeekWithRetry } from '@/infrastructure/ai/retry/deepseekRetry';
import { callGeminiWithRetry } from '@/infrastructure/ai/retry/geminiRetry';
import { callChatGPTWithRetry } from '@/infrastructure/ai/retry/openaiRetry';

const OK = '{"ok":true}';

/** free 모델(서버 키 경로) — tier와 무관하게 서버 키를 쓴다. */
const GEMINI_FREE = 'gemini-3.6-flash';
/**
 * 추론을 완전히 끌 수 있는 Gemini 모델 — `reasoning.off`가 `'minimal'`이고
 * 실측 사고 토큰이 0이다(2026-09-06).
 */
const GEMINI_HARD_OFF = 'gemini-3.6-flash';
/**
 * 추론을 완전히 끄지 못하는 Gemini 모델 — `'minimal'`을 400으로 거부해
 * `reasoning.off`가 `'low'`이고, 그 상태에서도 사고 토큰을 소비한다
 * (`hardOff: false`, 2026-09-06 실측).
 */
const GEMINI_PARTIAL_OFF = 'gemini-3.1-pro-preview';
const DEEPSEEK_FREE = 'deepseek-v4.1-flash';
/** premium 모델 — non-pro tier에서는 BYOK가 필요하다. */
const CLAUDE_PREMIUM = 'claude-opus-5';
const GPT_PREMIUM = 'gpt-5.6-sol';

function deepseekOptions(): Record<string, unknown> {
    return vi.mocked(callDeepSeekWithRetry).mock.calls[0][3] as Record<
        string,
        unknown
    >;
}

function claudeOptions(): Record<string, unknown> {
    return vi.mocked(callClaudeWithRetry).mock.calls[0][3] as Record<
        string,
        unknown
    >;
}

function chatgptOptions(): Record<string, unknown> {
    return vi.mocked(callChatGPTWithRetry).mock.calls[0][3] as Record<
        string,
        unknown
    >;
}

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
    it('member 등급 모델은 사용자 키 없이 서버 키로 호출된다', async () => {
        // 회귀 가드: 3분류 도입 전 `shouldUseServerKey`는 `isFreeModel` 기반이라
        // member 등급 모델에서 false를 반환했고, 서버가 대납하는 모델인데도
        // "User API key required"로 죽었다.
        await expect(
            callAnalysisAi({
                prompt: 'p',
                model: 'claude-sonnet-5-5',
                tier: 'member',
            })
        ).resolves.toBeDefined();
        expect(callClaudeWithRetry).toHaveBeenCalled();
    });

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

describe('callAnalysisAi — reasoning 해석', () => {
    it('reasoning=false는 gemini를 스펙의 off level로 내린다', async () => {
        await callAnalysisAi({
            prompt: 'p',
            model: GEMINI_HARD_OFF,
            reasoning: false,
        });
        expect(geminiOptions().levelRef).toEqual({ current: 'minimal' });
    });

    it('완전히 끄지 못하는 모델은 off level까지만 내리고 경고한다', async () => {
        // gemini-3.1-pro-preview는 'minimal'을 400으로 거부한다. 요청을 죽이는 대신
        // 그 모델이 받는 최저 level('low')로 내리고, 사용자가 "껐다"고 오해하지
        // 않도록 한 번 경고한다.
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        _resetPartialHardOffWarningsForTest();

        await callAnalysisAi({
            prompt: 'p',
            model: GEMINI_PARTIAL_OFF,
            tier: 'pro',
            reasoning: false,
        });

        expect(geminiOptions().levelRef).toEqual({ current: 'low' });
        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining(GEMINI_PARTIAL_OFF)
        );

        warnSpy.mockRestore();
    });

    it('경고는 같은 모델에 대해 1회만 로깅한다', async () => {
        // 뉴스카드 25건처럼 같은 모델로 배치 호출할 때 경고가 도배되지 않아야 한다.
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        _resetPartialHardOffWarningsForTest();

        for (let i = 0; i < 3; i += 1) {
            await callAnalysisAi({
                prompt: 'p',
                model: GEMINI_PARTIAL_OFF,
                tier: 'pro',
                reasoning: false,
            });
        }

        expect(warnSpy).toHaveBeenCalledTimes(1);

        warnSpy.mockRestore();
    });

    it('완전히 끌 수 있는 모델에서는 경고하지 않는다', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        _resetPartialHardOffWarningsForTest();

        await callAnalysisAi({
            prompt: 'p',
            model: GEMINI_HARD_OFF,
            reasoning: false,
        });

        expect(warnSpy).not.toHaveBeenCalled();

        warnSpy.mockRestore();
    });

    it('reasoning=undefined면 스펙의 default 쪽을 쓴다', async () => {
        // GEMINI_HARD_OFF는 Free 등급이라 `default: 'off'` → 'minimal'.
        await callAnalysisAi({ prompt: 'p', model: GEMINI_HARD_OFF });
        expect(geminiOptions().levelRef).toEqual({ current: 'minimal' });
    });

    it('reasoning=true는 gemini를 스펙의 on level로 올린다', async () => {
        await callAnalysisAi({
            prompt: 'p',
            model: GEMINI_HARD_OFF,
            reasoning: true,
        });
        expect(geminiOptions().levelRef).toEqual({ current: 'high' });
    });

    it('deepseek은 reasoning=true를 thinking:true로 전달한다', async () => {
        await callAnalysisAi({
            prompt: 'p',
            model: DEEPSEEK_FREE,
            reasoning: true,
        });
        expect(deepseekOptions().reasoning).toEqual({ thinking: true });
    });

    it('deepseek reasoning=undefined는 스펙 default(off)를 쓴다', async () => {
        await callAnalysisAi({ prompt: 'p', model: DEEPSEEK_FREE });
        expect(deepseekOptions().reasoning).toEqual({ thinking: false });
    });

    it('reasoning=false는 claude를 disabled로, gpt를 effort:none으로 내린다', async () => {
        await callAnalysisAi({
            prompt: 'p',
            model: CLAUDE_PREMIUM,
            tier: 'pro',
            reasoning: false,
        });
        expect(claudeOptions().reasoning).toEqual({ mode: 'disabled' });

        await callAnalysisAi({
            prompt: 'p',
            model: GPT_PREMIUM,
            tier: 'pro',
            reasoning: false,
        });
        expect(chatgptOptions().reasoning).toEqual({ effort: 'none' });
    });

    it('reasoning=true는 claude/gpt에서도 스펙 on을 적용한다', async () => {
        // 회귀 가드: 예전에는 ON 오버라이드가 deepseek 전용이라, 스펙 기본이
        // OFF가 되면 claude/gpt는 토글을 켜도 아무 일도 일어나지 않았다.
        await callAnalysisAi({
            prompt: 'p',
            model: CLAUDE_PREMIUM,
            tier: 'pro',
            reasoning: true,
        });
        expect(claudeOptions().reasoning).toEqual({
            mode: 'adaptive',
            effort: 'high',
        });

        await callAnalysisAi({
            prompt: 'p',
            model: GPT_PREMIUM,
            tier: 'pro',
            reasoning: true,
        });
        expect(chatgptOptions().reasoning).toEqual({ effort: 'high' });
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

describe('callAnalysisAi — 파싱 불가 응답 1회 재생성', () => {
    // jsonrepair도 못 살리는 페이로드 — 실측으로 SyntaxError를 던진다.
    const UNSALVAGEABLE = '{"a":1,,,,"b":}';

    it('JSON으로 살릴 수 없는 응답이면 한 번 다시 생성한다', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.mocked(callDeepSeekWithRetry)
            .mockResolvedValueOnce(UNSALVAGEABLE)
            .mockResolvedValueOnce(OK);

        await expect(
            callAnalysisAi({ prompt: 'p', model: DEEPSEEK_FREE, tier: 'free' })
        ).resolves.toBe(OK);

        expect(callDeepSeekWithRetry).toHaveBeenCalledTimes(2);
        expect(warn).toHaveBeenCalledWith(
            '[callAnalysisAi] response was not parseable JSON; regenerating once',
            expect.objectContaining({ model: DEEPSEEK_FREE })
        );
        warn.mockRestore();
    });

    it('재생성도 살릴 수 없으면 SyntaxError를 던지고 세 번째 호출은 하지 않는다', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.mocked(callDeepSeekWithRetry).mockResolvedValue(UNSALVAGEABLE);

        await expect(
            callAnalysisAi({ prompt: 'p', model: DEEPSEEK_FREE, tier: 'free' })
        ).rejects.toBeInstanceOf(SyntaxError);

        expect(callDeepSeekWithRetry).toHaveBeenCalledTimes(2);
        warn.mockRestore();
    });

    it('뒤에 중복이 붙어도 살릴 수 있으면 재생성하지 않는다', async () => {
        vi.mocked(callDeepSeekWithRetry).mockResolvedValueOnce(`${OK}\n${OK}`);

        await expect(
            callAnalysisAi({ prompt: 'p', model: DEEPSEEK_FREE, tier: 'free' })
        ).resolves.toBe(OK);

        expect(callDeepSeekWithRetry).toHaveBeenCalledTimes(1);
    });

    it('빈 재생성 응답은 빈 응답 오류로 드러낸다', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.mocked(callDeepSeekWithRetry)
            .mockResolvedValueOnce(UNSALVAGEABLE)
            .mockResolvedValueOnce('   ');

        await expect(
            callAnalysisAi({ prompt: 'p', model: DEEPSEEK_FREE, tier: 'free' })
        ).rejects.toThrow('AI returned an empty response');
        warn.mockRestore();
    });

    it('SyntaxError가 아닌 오류는 재생성 없이 그대로 다시 던진다', async () => {
        // The `!(error instanceof SyntaxError)` guard exists precisely so a
        // programming error inside normalization (not a malformed-JSON
        // response) fails loudly instead of being spent on a wasted retry.
        const normalizeSpy = vi
            .spyOn(normalizeJsonResponseModule, 'normalizeJsonResponse')
            .mockImplementation(() => {
                throw new TypeError('boom');
            });
        vi.mocked(callDeepSeekWithRetry).mockResolvedValue(OK);

        await expect(
            callAnalysisAi({ prompt: 'p', model: DEEPSEEK_FREE, tier: 'free' })
        ).rejects.toThrow(TypeError);

        expect(callDeepSeekWithRetry).toHaveBeenCalledTimes(1);
        normalizeSpy.mockRestore();
    });
});

describe('callAnalysisAi — DeepSeek 장애 시 Gemini 1회 폴백', () => {
    const FALLBACK_ON = { fallbackOnProviderFailure: true } as const;
    const stalled = Object.assign(new Error('DeepSeek stalled'), {
        code: 'DEEPSEEK_STALLED',
    });

    beforeEach(() => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        // `clearAllMocks` leaves queued `*Once` values behind; start each case clean.
        vi.mocked(callDeepSeekWithRetry).mockReset().mockResolvedValue(OK);
        vi.mocked(callGeminiWithRetry).mockReset().mockResolvedValue(OK);
    });

    /** 사용자가 모델을 고른 경로(기본)는 폴백하지 않는다 — 실패를 드러내 모델 변경을 안내한다. */
    it('옵트인하지 않으면 DeepSeek 실패를 그대로 던진다', async () => {
        vi.mocked(callDeepSeekWithRetry).mockRejectedValueOnce(stalled);
        await expect(
            callAnalysisAi({ prompt: 'p', model: DEEPSEEK_FREE, tier: 'free' })
        ).rejects.toBe(stalled);
        expect(callGeminiWithRetry).not.toHaveBeenCalled();
    });

    it('JSON 재생성까지 합쳐도 Gemini 호출은 최대 2번이다', async () => {
        vi.mocked(callDeepSeekWithRetry)
            .mockRejectedValueOnce(stalled)
            .mockRejectedValueOnce(stalled);
        vi.mocked(callGeminiWithRetry)
            .mockResolvedValueOnce('{"a":1,,,,"b":}')
            .mockResolvedValueOnce(OK);
        await expect(
            callAnalysisAi({
                ...FALLBACK_ON,
                prompt: 'p',
                model: DEEPSEEK_FREE,
                tier: 'free',
            })
        ).resolves.toBe(OK);
        expect(callDeepSeekWithRetry).toHaveBeenCalledTimes(2);
        expect(callGeminiWithRetry).toHaveBeenCalledTimes(2);
    });

    it('서버 키 DeepSeek 호출이 멈추면 서버 Gemini 키로 폴백 모델을 한 번 부른다', async () => {
        vi.mocked(callDeepSeekWithRetry).mockRejectedValueOnce(stalled);

        await expect(
            callAnalysisAi({
                ...FALLBACK_ON,
                prompt: 'p',
                model: DEEPSEEK_FREE,
                tier: 'free',
            })
        ).resolves.toBe(OK);

        expect(callGeminiWithRetry).toHaveBeenCalledTimes(1);
        const [, model, key] = vi.mocked(callGeminiWithRetry).mock.calls[0];
        expect(model).toBe(DEEPSEEK_FALLBACK_MODEL);
        expect(model).toBe('gemini-3.6-flash');
        expect(key).toBe('server-gemini');
    });

    it('5xx 재시도 소진·네트워크 오류도 폴백한다', async () => {
        vi.mocked(callDeepSeekWithRetry).mockRejectedValueOnce(
            Object.assign(new Error('bad gateway'), { status: 502 })
        );
        await expect(
            callAnalysisAi({
                ...FALLBACK_ON,
                prompt: 'p',
                model: DEEPSEEK_FREE,
                tier: 'free',
            })
        ).resolves.toBe(OK);

        vi.mocked(callDeepSeekWithRetry).mockRejectedValueOnce(
            new Error('socket hang up')
        );
        await expect(
            callAnalysisAi({
                ...FALLBACK_ON,
                prompt: 'p',
                model: DEEPSEEK_FREE,
                tier: 'free',
            })
        ).resolves.toBe(OK);
        expect(callGeminiWithRetry).toHaveBeenCalledTimes(2);
    });

    it('429 외 4xx(잘못된 요청)는 폴백하지 않는다', async () => {
        const badRequest = Object.assign(new Error('bad request'), {
            status: 400,
        });
        vi.mocked(callDeepSeekWithRetry).mockRejectedValueOnce(badRequest);
        await expect(
            callAnalysisAi({
                ...FALLBACK_ON,
                prompt: 'p',
                model: DEEPSEEK_FREE,
                tier: 'free',
            })
        ).rejects.toBe(badRequest);
        expect(callGeminiWithRetry).not.toHaveBeenCalled();
    });

    it('호출자가 abort했으면 폴백하지 않는다', async () => {
        const controller = new AbortController();
        controller.abort();
        vi.mocked(callDeepSeekWithRetry).mockRejectedValueOnce(stalled);
        await expect(
            callAnalysisAi({
                ...FALLBACK_ON,
                prompt: 'p',
                model: DEEPSEEK_FREE,
                tier: 'free',
                signal: controller.signal,
            })
        ).rejects.toBe(stalled);
        expect(callGeminiWithRetry).not.toHaveBeenCalled();
    });

    it('Gemini 서버 키가 없으면 원래 DeepSeek 오류를 그대로 던진다', async () => {
        vi.stubEnv('GEMINI_API_KEY', '');
        vi.mocked(callDeepSeekWithRetry).mockRejectedValueOnce(stalled);
        await expect(
            callAnalysisAi({
                ...FALLBACK_ON,
                prompt: 'p',
                model: DEEPSEEK_FREE,
                tier: 'free',
            })
        ).rejects.toBe(stalled);
        expect(callGeminiWithRetry).not.toHaveBeenCalled();
    });

    it('DeepSeek이 아닌 모델의 실패는 폴백하지 않는다', async () => {
        const failure = Object.assign(new Error('down'), { status: 503 });
        vi.mocked(callGeminiWithRetry).mockRejectedValueOnce(failure);
        await expect(
            callAnalysisAi({
                ...FALLBACK_ON,
                prompt: 'p',
                model: GEMINI_FREE,
                tier: 'free',
            })
        ).rejects.toBe(failure);
        expect(callGeminiWithRetry).toHaveBeenCalledTimes(1);
        expect(callDeepSeekWithRetry).not.toHaveBeenCalled();
    });
});

describe('callAnalysisAi — keyPolicy', () => {
    const CLASSES = [
        { access: 'free', model: GEMINI_FREE },
        { access: 'member', model: 'claude-sonnet-5-5' },
        { access: 'byok', model: CLAUDE_PREMIUM },
    ] as const;

    /** Throws if anything asks for a server key — the env stubs stay set on purpose. */
    let serverKeySpy: MockInstance | undefined;

    /** Restored after every test, pass or fail, so it cannot leak into the next. */
    afterEach(() => {
        serverKeySpy?.mockRestore();
        serverKeySpy = undefined;
    });

    function spyServerKeyThrows() {
        const spy = vi
            .spyOn(serverKeysModule, 'resolveServerApiKey')
            .mockImplementation(provider => {
                throw new Error(`server key read for ${provider}`);
            });
        serverKeySpy = spy;
        return spy;
    }

    function usedKeys(): unknown[] {
        return [
            callClaudeWithRetry,
            callChatGPTWithRetry,
            callGeminiWithRetry,
            callDeepSeekWithRetry,
        ].flatMap(a => vi.mocked(a).mock.calls.map(c => c[2]));
    }

    describe('byok-only', () => {
        it.each(CLASSES)(
            'passes the user key to the $access-class dispatch and never reads a server key',
            async ({ model }) => {
                const spy = spyServerKeyThrows();
                await callAnalysisAi({
                    prompt: 'p',
                    model,
                    tier: 'free',
                    userApiKey: 'user-key',
                    keyPolicy: 'byok-only',
                });
                expect(usedKeys()).toEqual(['user-key']);
                expect(spy).not.toHaveBeenCalled();
            }
        );

        it('uses the user key on a pro tier and with no tier at all', async () => {
            const spy = spyServerKeyThrows();
            for (const tier of ['pro', undefined] as const) {
                vi.clearAllMocks();
                await callAnalysisAi({
                    prompt: 'p',
                    model: GEMINI_FREE,
                    tier,
                    userApiKey: 'user-key',
                    keyPolicy: 'byok-only',
                });
                expect(usedKeys()).toEqual(['user-key']);
            }
            expect(spy).not.toHaveBeenCalled();
        });

        it.each(CLASSES)(
            'throws UserApiKeyMissingError for the $access-class model without a key, before any provider call',
            async ({ model }) => {
                const spy = spyServerKeyThrows();
                const attempt = callAnalysisAi({
                    prompt: 'p',
                    model,
                    tier: 'pro',
                    keyPolicy: 'byok-only',
                });
                await expect(attempt).rejects.toBeInstanceOf(
                    UserApiKeyMissingError
                );
                await expect(attempt).rejects.toMatchObject({
                    code: 'user_api_key_required',
                });
                expect(usedKeys()).toHaveLength(0);
                expect(spy).not.toHaveBeenCalled();
            }
        );

        it('treats an empty key as missing', async () => {
            await expect(
                callAnalysisAi({
                    prompt: 'p',
                    model: GEMINI_FREE,
                    userApiKey: '',
                    keyPolicy: 'byok-only',
                })
            ).rejects.toBeInstanceOf(UserApiKeyMissingError);
            expect(usedKeys()).toHaveLength(0);
        });

        describe('provider fallback', () => {
            const stalled = Object.assign(new Error('DeepSeek stalled'), {
                code: 'DEEPSEEK_STALLED',
            });

            beforeEach(() => {
                vi.spyOn(console, 'warn').mockImplementation(() => {});
                vi.mocked(callDeepSeekWithRetry).mockReset();
                vi.mocked(callGeminiWithRetry)
                    .mockReset()
                    .mockResolvedValue(OK);
            });

            it('is disabled even when requested: the DeepSeek failure surfaces, Gemini is never called', async () => {
                vi.mocked(callDeepSeekWithRetry).mockRejectedValue(stalled);
                const spy = spyServerKeyThrows();

                await expect(
                    callAnalysisAi({
                        prompt: 'p',
                        model: DEEPSEEK_FREE,
                        tier: 'free',
                        userApiKey: 'user-key',
                        keyPolicy: 'byok-only',
                        fallbackOnProviderFailure: true,
                    })
                ).rejects.toBe(stalled);

                expect(callGeminiWithRetry).not.toHaveBeenCalled();
                expect(spy).not.toHaveBeenCalled();
            });

            it('control: the same request under the default policy does fall back', async () => {
                vi.mocked(callDeepSeekWithRetry).mockRejectedValueOnce(stalled);

                await callAnalysisAi({
                    prompt: 'p',
                    model: DEEPSEEK_FREE,
                    tier: 'free',
                    fallbackOnProviderFailure: true,
                });

                expect(callGeminiWithRetry).toHaveBeenCalledTimes(1);
            });
        });

        it('a JSON-regeneration retry reuses the user key', async () => {
            vi.spyOn(console, 'warn').mockImplementation(() => {});
            const spy = spyServerKeyThrows();
            vi.mocked(callGeminiWithRetry)
                .mockReset()
                .mockResolvedValueOnce('{"a":1,,,,"b":}')
                .mockResolvedValueOnce(OK);

            await callAnalysisAi({
                prompt: 'p',
                model: GEMINI_FREE,
                userApiKey: 'user-key',
                keyPolicy: 'byok-only',
            });

            expect(usedKeys()).toEqual(['user-key', 'user-key']);
            expect(spy).not.toHaveBeenCalled();
        });
    });

    describe('unknown keyPolicy value fails closed', () => {
        it('uses the user key and never reads a server key', async () => {
            const spy = spyServerKeyThrows();
            await callAnalysisAi({
                prompt: 'p',
                model: GEMINI_FREE,
                tier: 'pro',
                userApiKey: 'user-key',
                keyPolicy: 'byok_only' as never,
            });
            expect(usedKeys()).toEqual(['user-key']);
            expect(spy).not.toHaveBeenCalled();
        });

        it('throws UserApiKeyMissingError without a key', async () => {
            const spy = spyServerKeyThrows();
            await expect(
                callAnalysisAi({
                    prompt: 'p',
                    model: GEMINI_FREE,
                    tier: 'pro',
                    keyPolicy: 'oops' as never,
                })
            ).rejects.toBeInstanceOf(UserApiKeyMissingError);
            expect(usedKeys()).toHaveLength(0);
            expect(spy).not.toHaveBeenCalled();
        });
    });

    describe('default policy (regression)', () => {
        it.each([
            { access: 'free', model: GEMINI_FREE, key: 'server-gemini' },
            {
                access: 'member',
                model: 'claude-sonnet-5-5',
                key: 'server-anthropic',
            },
        ] as const)(
            '$access-class model runs on the server key even if a user key is supplied',
            async ({ model, key }) => {
                await callAnalysisAi({
                    prompt: 'p',
                    model,
                    tier: 'free',
                    userApiKey: 'user-key',
                });
                expect(usedKeys()).toEqual([key]);
            }
        );

        it('byok-class model on a non-pro tier runs on the user key', async () => {
            await callAnalysisAi({
                prompt: 'p',
                model: CLAUDE_PREMIUM,
                tier: 'free',
                userApiKey: 'user-key',
                keyPolicy: 'tier',
            });
            expect(usedKeys()).toEqual(['user-key']);
        });

        it('missing-key failure is the same error type and message as before', async () => {
            const attempt = callAnalysisAi({
                prompt: 'p',
                model: CLAUDE_PREMIUM,
                tier: 'free',
            });
            await expect(attempt).rejects.toBeInstanceOf(
                UserApiKeyMissingError
            );
            await expect(attempt).rejects.toThrow(
                'User API key required for this model and tier combination'
            );
        });
    });
});
