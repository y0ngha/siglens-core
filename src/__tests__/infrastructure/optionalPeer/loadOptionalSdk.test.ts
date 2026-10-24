import { describe, expect, it, vi } from 'vitest';
import {
    MISSING_SDK_CODE,
    MissingSdkError,
    loadOptionalSdk,
} from '@/infrastructure/optionalPeer/loadOptionalSdk';
import { classifyError } from '@/infrastructure/ai/retry/withRetry';

function moduleNotFound(code: string, sdk: string): Error & { code: string } {
    return Object.assign(new Error(`Cannot find module '${sdk}'`), { code });
}

describe('loadOptionalSdk', () => {
    it('memoizes the module: importer runs once across calls', async () => {
        const mod = { default: 'sdk' };
        const importer = vi.fn(async () => mod);
        const load = loadOptionalSdk('pkg', 'tests', importer);

        const [a, b] = await Promise.all([load(), load()]);
        const c = await load();

        expect(a).toBe(mod);
        expect(b).toBe(mod);
        expect(c).toBe(mod);
        expect(importer).toHaveBeenCalledTimes(1);
    });

    it.each(['MODULE_NOT_FOUND', 'ERR_MODULE_NOT_FOUND'])(
        'maps %s for the requested sdk to an install-hint error',
        async code => {
            const original = moduleNotFound(code, 'pkg');
            const load = loadOptionalSdk('pkg', 'Claude models', () =>
                Promise.reject(original)
            );

            const error = await load().catch((e: unknown) => e);

            expect(error).toBeInstanceOf(MissingSdkError);
            expect((error as MissingSdkError).message).toBe(
                "@y0ngha/siglens-core: 'pkg' is required for Claude models — install it as a dependency"
            );
            expect((error as MissingSdkError).code).toBe(MISSING_SDK_CODE);
            expect((error as MissingSdkError).cause).toBe(original);
        }
    );

    it('rethrows a missing transitive dependency unchanged', async () => {
        const original = moduleNotFound('MODULE_NOT_FOUND', 'other-dep');
        const load = loadOptionalSdk('pkg', 'tests', () =>
            Promise.reject(original)
        );

        await expect(load()).rejects.toBe(original);
    });

    it('rethrows non-missing-module errors unchanged', async () => {
        const original = new Error('boom');
        const load = loadOptionalSdk('pkg', 'tests', () =>
            Promise.reject(original)
        );

        await expect(load()).rejects.toBe(original);
    });

    it('does not memoize a failed load, so a later call can succeed', async () => {
        const importer = vi
            .fn<() => Promise<string>>()
            .mockRejectedValueOnce(moduleNotFound('MODULE_NOT_FOUND', 'pkg'))
            .mockResolvedValueOnce('loaded');
        const load = loadOptionalSdk('pkg', 'tests', importer);

        await expect(load()).rejects.toBeInstanceOf(MissingSdkError);
        await expect(load()).resolves.toBe('loaded');
        expect(importer).toHaveBeenCalledTimes(2);
    });

    it('is classified as non-retryable by the retry wrappers', () => {
        expect(classifyError(new MissingSdkError('pkg', 'tests'))).toBe('none');
    });
});
