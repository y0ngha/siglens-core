import { inspect } from 'node:util';
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

        it('tries the load again on the next call', async () => {
            importSdk
                .mockRejectedValueOnce(missingModule())
                .mockResolvedValueOnce({ Redis: RedisCtor });
            const getClient = lazyRedisClient('https://u', 't');
            await expect(getClient()).rejects.toThrow();
            await expect(getClient()).resolves.toEqual({
                options: { url: 'https://u', token: 't' },
            });
        });
    });

    describe('when the client constructor rejects the settings', () => {
        it('rejects with the constructor error and tries again on the next call', async () => {
            const rejectingRedis = vi.fn(function () {
                throw new Error('invalid URL');
            });
            importSdk.mockResolvedValue({ Redis: rejectingRedis });
            const getClient = lazyRedisClient('redis://wrong', 't');
            await expect(getClient()).rejects.toThrow('invalid URL');
            await expect(getClient()).rejects.toThrow('invalid URL');
            expect(rejectingRedis).toHaveBeenCalledTimes(2);
        });
    });

    describe('when loading fails transiently', () => {
        const transient = (): Error => new Error('EIO: transient read error');

        it('retries on the next call instead of keeping the failure', async () => {
            // Callers can hold the returned function for the whole process
            // (reanalyzeCooldown keeps it module-wide). A remembered failure
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

        it('shares one in-flight attempt between concurrent calls', async () => {
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
        afterEach(() => {
            vi.useRealTimers();
        });

        const failWith = (error: unknown, url = 'https://u') => {
            importSdk.mockRejectedValueOnce(error);
            return expect(lazyRedisClient(url, 't')()).rejects.toBeDefined();
        };

        it('logs the same URL and error once within the window, across clients', async () => {
            // Consumers build a factory per request; every failed call reaches
            // the log.
            await failWith(new Error('EIO'));
            await failWith(new Error('EIO'));
            expect(log).toHaveBeenCalledTimes(1);
        });

        it('logs it again once the window has passed', async () => {
            vi.useFakeTimers({ toFake: ['performance'] });
            await failWith(new Error('EIO'));
            vi.advanceTimersByTime(5 * 60 * 1000);
            await failWith(new Error('EIO'));
            expect(log).toHaveBeenCalledTimes(2);
        });

        it('is not silenced by a wall-clock step back', async () => {
            vi.useFakeTimers({ toFake: ['performance', 'Date'] });
            vi.setSystemTime(new Date('2026-10-25T00:10:00Z'));
            await failWith(new Error('EIO'));
            vi.setSystemTime(new Date('2026-10-25T00:00:00Z'));
            vi.advanceTimersByTime(5 * 60 * 1000);
            await failWith(new Error('EIO'));
            expect(log).toHaveBeenCalledTimes(2);
        });

        it('logs different errors separately', async () => {
            await failWith(new Error('EIO'));
            await failWith(new Error('EACCES'));
            expect(log).toHaveBeenCalledTimes(2);
        });

        it('logs the same error for different URLs separately', async () => {
            await failWith(new Error('EIO'), 'https://a');
            await failWith(new Error('EIO'), 'https://b');
            expect(log).toHaveBeenCalledTimes(2);
        });

        it('tells errors with the same message apart by cause', async () => {
            await failWith(
                new Error('load failed', { cause: new Error('EIO') })
            );
            await failWith(
                new Error('load failed', { cause: new Error('EACCES') })
            );
            expect(log).toHaveBeenCalledTimes(2);
        });

        it('tells non-Error rejections apart by content', async () => {
            await failWith({ reason: 'a' });
            await failWith({ reason: 'b' });
            expect(log).toHaveBeenCalledTimes(2);
        });

        it('never puts the token in the log', async () => {
            const token = 'secret-token-3f9a';
            importSdk.mockRejectedValueOnce(new Error('EIO'));
            await expect(
                lazyRedisClient('https://u', token)()
            ).rejects.toThrow();
            expect(log).toHaveBeenCalledWith(
                expect.stringContaining('[upstash] Redis client unavailable'),
                expect.objectContaining({ message: 'EIO' })
            );
            expect(inspect(log.mock.calls, { depth: 5 })).not.toContain(token);
        });

        it('tells errors apart by code and by a non-Error cause', async () => {
            await failWith(
                Object.assign(new Error('load failed'), { code: 'EIO' })
            );
            await failWith(
                Object.assign(new Error('load failed'), { code: 'EACCES' })
            );
            await failWith(new Error('load failed', { cause: 'EIO' }));
            await failWith(new Error('load failed', { cause: 'EACCES' }));
            expect(log).toHaveBeenCalledTimes(4);
        });

        it('keeps tracking bounded when every failure text differs', async () => {
            vi.useFakeTimers({ toFake: ['performance'] });
            for (let index = 0; index < 150; index += 1)
                await failWith(new Error(`request ${index}`));
            // The oldest keys were dropped, so the first failure is logged again.
            await failWith(new Error('request 0'));
            expect(log).toHaveBeenCalledTimes(151);
        });
    });
});
