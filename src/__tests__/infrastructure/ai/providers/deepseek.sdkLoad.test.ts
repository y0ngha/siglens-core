import { describe, expect, it, vi } from 'vitest';
import { callDeepSeek } from '@/infrastructure/ai/providers/deepseek';
import { callDeepSeekWithRetry } from '@/infrastructure/ai/retry/deepseekRetry';
import type { DeepSeekModelId } from '@/domain/analysis/modelSpecs';

/**
 * Lazy SDK load edge cases. The real `loadOptionalSdk` (memoization +
 * MODULE_NOT_FOUND mapping) runs; only the `import('openai')` thunk the
 * provider hands it is swapped for `importSdk`, so each test decides when —
 * and whether — the SDK module "arrives".
 */
const { importSdk, sdkMethod } = vi.hoisted(() => ({
    importSdk: vi.fn(),
    sdkMethod: vi.fn(),
}));

vi.mock('@/infrastructure/ai/loadOptionalSdk', async importOriginal => {
    const actual =
        await importOriginal<
            typeof import('@/infrastructure/ai/loadOptionalSdk')
        >();
    return {
        ...actual,
        loadOptionalSdk: <M>(
            sdk: string,
            purpose: string,
            _importer: () => Promise<M>
        ) => actual.loadOptionalSdk<M>(sdk, purpose, () => importSdk()),
    };
});

const MODEL: DeepSeekModelId = 'deepseek-v4.1-flash';

function fakeSdk() {
    return {
        default: vi.fn(function () {
            return {
                chat: { completions: { create: sdkMethod } },
                responses: { create: sdkMethod },
            };
        }),
    };
}

describe('callDeepSeek lazy SDK load', () => {
    it('SDK가 없으면 MissingSdkError로 거부하고 재시도하지 않는다', async () => {
        importSdk.mockReset();
        sdkMethod.mockReset();
        importSdk.mockRejectedValue(
            Object.assign(new Error("Cannot find module 'openai'"), {
                code: 'MODULE_NOT_FOUND',
            })
        );

        await expect(
            callDeepSeekWithRetry('prompt', MODEL, 'key', { maxAttempts: 3 })
        ).rejects.toMatchObject({
            name: 'MissingSdkError',
            sdk: 'openai',
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

        const pending = callDeepSeek('prompt', {
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
