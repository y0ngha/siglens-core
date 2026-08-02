import type { LlmProvider } from '@/domain/types';

const ENV_BY_PROVIDER: Record<LlmProvider, string> = {
    anthropic: 'ANTHROPIC_API_KEY',
    google: 'GEMINI_API_KEY',
    openai: 'OPENAI_API_KEY',
    deepseek: 'DEEPSEEK_API_KEY',
};

/**
 * 서버 소유 provider 키를 읽는다.
 *
 * worker는 `config.ts`에서 `requireEnv`로 **import 시점에** 던졌지만, core는
 * 라이브러리라 같은 방식을 쓸 수 없다 — 그 provider를 전혀 호출하지 않는
 * consumer까지 startup에서 죽는다. 그래서 검증을 호출 시점으로 미룬다.
 *
 * BYOK(사용자 키) 경로에서는 이 함수가 아예 호출되지 않는다 —
 * `shouldUseServerKey(model, tier)`가 false일 때는 호출 측이 사용자 키를 쓴다.
 */
export function resolveServerApiKey(provider: LlmProvider): string {
    const envName = ENV_BY_PROVIDER[provider];
    const value = process.env[envName];
    if (!value) {
        throw new Error(`${envName} environment variable is required`);
    }
    return value;
}
