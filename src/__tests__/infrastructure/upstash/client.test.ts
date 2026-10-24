import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The real `loadOptionalSdk` (memoization + MODULE_NOT_FOUND mapping) runs;
 * only the `import('@upstash/redis')` thunk is swapped for `importSdk`, so each
 * test decides whether the package "is installed".
 */
const { importSdk } = vi.hoisted(() => ({ importSdk: vi.fn() }));

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

const RedisCtor = vi.fn(function (options: { url: string; token: string }) {
    return { options };
});

function missingModule(): Error {
    return Object.assign(new Error("Cannot find module '@upstash/redis'"), {
        code: 'MODULE_NOT_FOUND',
    });
}

// `loadOptionalSdk` memoizes a successful load at module level, so each test
// gets a fresh module graph; otherwise an earlier "installed" test would leak.
let lazyRedisClient: typeof import('@/infrastructure/upstash/client').lazyRedisClient;

// The failure path logs once by design; capture it instead of printing.
let log: ReturnType<typeof vi.spyOn>;

afterEach(() => {
    log.mockRestore();
});

beforeEach(async () => {
    log = vi.spyOn(console, 'error').mockImplementation(() => {});
    importSdk.mockReset();
    RedisCtor.mockClear();
    vi.resetModules();
    ({ lazyRedisClient } = await import('@/infrastructure/upstash/client'));
});

describe('lazyRedisClient', () => {
    describe('when @upstash/redis is installed', () => {
        beforeEach(() => {
            importSdk.mockResolvedValue({ Redis: RedisCtor });
        });

        it('does not load the package before the first call', () => {
            lazyRedisClient('https://u', 't');
            expect(importSdk).not.toHaveBeenCalled();
        });

        it('creates the client with the given url and token', async () => {
            const client = await lazyRedisClient('https://u', 't')();
            expect(client).toEqual({
                options: { url: 'https://u', token: 't' },
            });
        });

        it('reuses one client across calls', async () => {
            const getClient = lazyRedisClient('https://u', 't');
            const [first, second] = await Promise.all([
                getClient(),
                getClient(),
            ]);
            expect(first).toBe(second);
            expect(RedisCtor).toHaveBeenCalledTimes(1);
        });
    });

    describe('when @upstash/redis is not installed', () => {
        it('rejects with MissingSdkError naming the package', async () => {
            importSdk.mockRejectedValue(missingModule());
            await expect(
                lazyRedisClient('https://u', 't')()
            ).rejects.toMatchObject({
                name: 'MissingSdkError',
                sdk: '@upstash/redis',
            });
        });

        it('logs a repeated failure once per process, across clients', async () => {
            // Consumers build a factory per request; a per-client log would
            // repeat on every request.
            importSdk.mockRejectedValue(missingModule());
            await expect(lazyRedisClient('https://u', 't')()).rejects.toThrow();
            await expect(lazyRedisClient('https://u', 't')()).rejects.toThrow();
            expect(log).toHaveBeenCalledTimes(1);
        });
    });

    describe('when loading fails transiently', () => {
        it('retries on the next call instead of keeping the failure', async () => {
            // Callers keep the returned function for the life of the process
            // (reanalyzeCooldown holds it module-wide). A remembered failure
            // would leave the feature off until restart.
            importSdk
                .mockRejectedValueOnce(new Error('EIO: transient read error'))
                .mockResolvedValueOnce({ Redis: RedisCtor });
            const getClient = lazyRedisClient('https://u', 't');
            await expect(getClient()).rejects.toThrow('EIO');
            await expect(getClient()).resolves.toEqual({
                options: { url: 'https://u', token: 't' },
            });
        });

        it('keeps the client once it has been created', async () => {
            importSdk
                .mockRejectedValueOnce(new Error('EIO: transient read error'))
                .mockResolvedValue({ Redis: RedisCtor });
            const getClient = lazyRedisClient('https://u', 't');
            await expect(getClient()).rejects.toThrow();
            const first = await getClient();
            expect(await getClient()).toBe(first);
            expect(RedisCtor).toHaveBeenCalledTimes(1);
        });
    });

    describe('when the client constructor rejects the settings', () => {
        it('rejects with the constructor error on every call and logs it once', async () => {
            importSdk.mockResolvedValue({
                Redis: vi.fn(function () {
                    throw new Error('invalid URL');
                }),
            });
            const getClient = lazyRedisClient('redis://wrong', 't');
            await expect(getClient()).rejects.toThrow('invalid URL');
            await expect(getClient()).rejects.toThrow('invalid URL');
            expect(log).toHaveBeenCalledTimes(1);
        });
    });
});
