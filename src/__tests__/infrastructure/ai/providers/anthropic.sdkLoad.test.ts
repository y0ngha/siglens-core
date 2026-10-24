import { describe, expect, it, vi } from 'vitest';
import { callClaude } from '@/infrastructure/ai/providers/anthropic';
import { callClaudeWithRetry } from '@/infrastructure/ai/retry/anthropicRetry';
import type { ClaudeModelId } from '@/domain/analysis/modelSpecs';

/**
 * Lazy SDK load edge cases. The real `loadOptionalSdk` (memoization +
 * MODULE_NOT_FOUND mapping) runs; only the `import('@anthropic-ai/sdk')` thunk the
 * provider hands it is swapped for `importSdk`, so each test decides when —
 * and whether — the SDK module "arrives".
 */
const { importSdk, sdkMethod } = vi.hoisted(() => ({
    importSdk: vi.fn(),
    sdkMethod: vi.fn(),
}));

vi.mock(
    '@/infrastructure/optionalPeer/loadOptionalSdk',
    async importOriginal => {
        const actual =
            await importOriginal<
                typeof import('@/infrastructure/optionalPeer/loadOptionalSdk')
            >();
        return {
            ...actual,
            loadOptionalSdk: <M>(
                sdk: string,
                purpose: string,
                _importer: () => Promise<M>
            ) => actual.loadOptionalSdk<M>(sdk, purpose, () => importSdk()),
        };
    }
);

const MODEL: ClaudeModelId = 'claude-sonnet-5-5';

function fakeSdk() {
    return {
        default: vi.fn(function () {
            return { messages: { stream: sdkMethod } };
        }),
    };
}

describe('callClaude lazy SDK load', () => {
    it('SDK가 없으면 MissingSdkError로 거부하고 재시도하지 않는다', async () => {
        importSdk.mockReset();
        sdkMethod.mockReset();
        importSdk.mockRejectedValue(
            Object.assign(new Error("Cannot find module '@anthropic-ai/sdk'"), {
                code: 'MODULE_NOT_FOUND',
            })
        );

        await expect(
            callClaudeWithRetry('prompt', MODEL, 'key', { maxAttempts: 3 })
        ).rejects.toMatchObject({
            name: 'MissingSdkError',
            sdk: '@anthropic-ai/sdk',
        });

        expect(importSdk).toHaveBeenCalledTimes(1);
        expect(sdkMethod).not.toHaveBeenCalled();
    });

    it('SDK 로드 중에 abort되면 요청을 보내지 않고 abort로 거부한다', async () => {
        importSdk.mockReset();
        sdkMethod.mockReset();
        let releaseSdk: (sdk: ReturnType<typeof fakeSdk>) => void = () => {};
        importSdk.mockReturnValue(
            new Promise(resolve => {
                releaseSdk = resolve;
            })
        );
        const controller = new AbortController();

        const pending = callClaude('prompt', {
            model: MODEL,
            apiKey: 'key',
            signal: controller.signal,
        });
        // 입구의 throwIfAborted()는 이미 통과했고, SDK 로드는 아직 끝나지 않았다.
        await Promise.resolve();
        expect(importSdk).toHaveBeenCalledTimes(1);

        controller.abort();
        releaseSdk(fakeSdk());

        await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
        expect(sdkMethod).not.toHaveBeenCalled();
    });
});
