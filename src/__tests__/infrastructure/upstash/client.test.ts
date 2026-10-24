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

        it('remembers it for the process instead of looking the package up again', async () => {
            importSdk.mockRejectedValue(missingModule());
            await expect(lazyRedisClient('https://u', 't')()).rejects.toThrow();
            await expect(lazyRedisClient('https://u', 't')()).rejects.toThrow();
            await expect(lazyRedisClient('https://v', 't')()).rejects.toThrow();
            expect(importSdk).toHaveBeenCalledTimes(1);
        });
    });

    describe('when the client constructor rejects the settings', () => {
        const rejectingRedis = vi.fn(function () {
            throw new Error('invalid URL');
        });

        beforeEach(() => {
            rejectingRedis.mockClear();
            importSdk.mockResolvedValue({ Redis: rejectingRedis });
        });

        it('rejects with the constructor error', async () => {
            await expect(
                lazyRedisClient('redis://wrong', 't')()
            ).rejects.toThrow('invalid URL');
        });

        it('remembers it for the client instead of constructing again', async () => {
            const getClient = lazyRedisClient('redis://wrong', 't');
            await expect(getClient()).rejects.toThrow();
            await expect(getClient()).rejects.toThrow();
            expect(rejectingRedis).toHaveBeenCalledTimes(1);
        });
    });

    describe('when loading fails transiently', () => {
        const transient = (): Error => new Error('EIO: transient read error');

        it('retries on the next call instead of keeping the failure', async () => {
            // Callers keep the returned function for the life of the process
            // (reanalyzeCooldown holds it module-wide). A remembered failure
            // would leave the feature off until restart.
            importSdk
                .mockRejectedValueOnce(transient())
                .mockResolvedValueOnce({ Redis: RedisCtor });
            const getClient = lazyRedisClient('https://u', 't');
            await expect(getClient()).rejects.toThrow('EIO');
            await expect(getClient()).resolves.toEqual({
                options: { url: 'https://u', token: 't' },
            });
        });

        it('keeps the client once it has been created', async () => {
            importSdk
                .mockRejectedValueOnce(transient())
                .mockResolvedValue({ Redis: RedisCtor });
            const getClient = lazyRedisClient('https://u', 't');
            await expect(getClient()).rejects.toThrow();
            const first = await getClient();
            expect(await getClient()).toBe(first);
            expect(RedisCtor).toHaveBeenCalledTimes(1);
        });

        it('shares one in-flight load between concurrent calls', async () => {
            importSdk.mockRejectedValueOnce(transient());
            const getClient = lazyRedisClient('https://u', 't');
            const results = await Promise.allSettled([
                getClient(),
                getClient(),
            ]);
            expect(results.map(result => result.status)).toEqual([
                'rejected',
                'rejected',
            ]);
            expect(importSdk).toHaveBeenCalledTimes(1);
        });
    });

    describe('failure log', () => {
        it('logs the same error for the same client once', async () => {
            // Consumers build a factory per request; a per-instance log would
            // repeat on every request.
            importSdk.mockRejectedValue(new Error('EIO'));
            await expect(lazyRedisClient('https://u', 't')()).rejects.toThrow();
            await expect(lazyRedisClient('https://u', 't')()).rejects.toThrow();
            expect(log).toHaveBeenCalledTimes(1);
        });

        it('logs different errors separately', async () => {
            importSdk
                .mockRejectedValueOnce(new Error('EIO'))
                .mockRejectedValueOnce(new Error('EACCES'));
            const getClient = lazyRedisClient('https://u', 't');
            await expect(getClient()).rejects.toThrow();
            await expect(getClient()).rejects.toThrow();
            expect(log).toHaveBeenCalledTimes(2);
        });

        it('logs the writer and read-only clients separately', async () => {
            importSdk.mockRejectedValue(new Error('EIO'));
            await expect(
                lazyRedisClient('https://u', 'writer')()
            ).rejects.toThrow();
            await expect(
                lazyRedisClient('https://u', 'reader')()
            ).rejects.toThrow();
            expect(log).toHaveBeenCalledTimes(2);
        });

        it('logs a failure again when it recurs after a recovery', async () => {
            // A loaded module stays loaded, so what can recur is a client whose
            // settings the constructor rejects.
            importSdk.mockResolvedValue({
                Redis: vi.fn(function (options: { url: string }) {
                    if (options.url === 'redis://wrong')
                        throw new Error('invalid URL');
                    return { options };
                }),
            });
            await expect(
                lazyRedisClient('redis://wrong', 't')()
            ).rejects.toThrow();
            await lazyRedisClient('https://u', 't')();
            await expect(
                lazyRedisClient('redis://wrong', 't')()
            ).rejects.toThrow();
            expect(log).toHaveBeenCalledTimes(2);
        });

        it('tells non-Error rejections apart by content', async () => {
            importSdk
                .mockRejectedValueOnce({ reason: 'a' })
                .mockRejectedValueOnce({ reason: 'b' });
            const getClient = lazyRedisClient('https://u', 't');
            await expect(getClient()).rejects.toEqual({ reason: 'a' });
            await expect(getClient()).rejects.toEqual({ reason: 'b' });
            expect(log).toHaveBeenCalledTimes(2);
        });
    });
});
