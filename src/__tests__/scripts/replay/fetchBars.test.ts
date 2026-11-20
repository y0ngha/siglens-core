import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    FETCH_ATTEMPTS,
    REQUESTS_PER_SYMBOL,
    fetchAll,
    fetchStoredBars,
    fmpGet,
    parseSymbols,
    planFetch,
    toBar,
    type FetchDeps,
} from '../../../../scripts/replay/fetchBars';
import { REPO_ROOT } from '../../../../scripts/replay/fsUtil';
import { REPLAY_US_SYMBOLS } from '../../../../scripts/replay/symbols';
import { makeTempDir } from './replayFixtures';

const KEY = 'KEY-FOR-TESTS-ONLY';

/** The default is a rejecting stub: a test that forgets to script a reply fails instead of reaching the network. */
function makeDeps(script: (url: string) => Response | Promise<Response>) {
    const fetchImpl = vi.fn<typeof fetch>(async input => {
        const url = String(input);
        if (!url.startsWith('https://financialmodelingprep.com/stable/')) {
            throw new Error(`unexpected URL ${url}`);
        }
        return script(url);
    });
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => undefined);
    const deps: FetchDeps = {
        fetchImpl,
        apiKey: KEY,
        sleep,
        now: () => new Date('2026-11-20T01:02:03.000Z'),
    };
    return { deps, fetchImpl, sleep };
}

const eodRows = [
    {
        date: '2024-01-03',
        open: 11,
        high: 12,
        low: 10,
        close: 11.5,
        volume: 200,
    },
    {
        date: '2024-01-02',
        open: 10,
        high: 11,
        low: 9,
        close: 10.5,
        volume: 100,
    },
];

const reply = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), { status });

const temps = new Set<() => void>();

describe('fetchBars', () => {
    afterEach(() => {
        [...temps].forEach(remove => remove());
        temps.clear();
    });

    describe('toBar', () => {
        it('stamps the date at UTC midnight in seconds and keeps the prices', () => {
            expect(toBar(eodRows[1])).toEqual({
                time: Date.UTC(2024, 0, 2) / 1000,
                open: 10,
                high: 11,
                low: 9,
                close: 10.5,
                volume: 100,
            });
        });
    });

    describe('fmpGet', () => {
        it('calls the stable endpoint with the query and the key', async () => {
            const { deps, fetchImpl } = makeDeps(() => reply([]));
            await fmpGet(deps, 'profile', { symbol: 'NVDA' });
            const url = new URL(String(fetchImpl.mock.lastCall?.[0]));
            expect(url.pathname).toBe('/stable/profile');
            expect(url.searchParams.get('symbol')).toBe('NVDA');
            expect(url.searchParams.get('apikey')).toBe(KEY);
        });

        it('retries a rate-limit with a growing wait, then succeeds', async () => {
            const replies = [
                reply({}, 429),
                reply({}, 503),
                reply({ ok: true }),
            ];
            const { deps, fetchImpl, sleep } = makeDeps(
                () => replies.shift() ?? reply({}, 500)
            );
            await expect(
                fmpGet(deps, 'profile', { symbol: 'NVDA' })
            ).resolves.toEqual({ ok: true });
            expect(fetchImpl).toHaveBeenCalledTimes(3);
            expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([5_000, 10_000]);
        });

        it('stops after the last attempt and reports the status only, never the URL or key', async () => {
            const { deps, fetchImpl } = makeDeps(() => reply({}, 429));
            const failure = await fmpGet(deps, 'profile', {
                symbol: 'NVDA',
            }).catch((e: Error) => e);
            expect(fetchImpl).toHaveBeenCalledTimes(FETCH_ATTEMPTS);
            expect((failure as Error).message).toBe(
                'FMP profile NVDA: HTTP 429'
            );
            expect((failure as Error).message).not.toContain(KEY);
        });

        it('does not retry a client error', async () => {
            const { deps, fetchImpl, sleep } = makeDeps(() => reply({}, 402));
            await expect(fmpGet(deps, 'x', { symbol: 'A' })).rejects.toThrow(
                'HTTP 402'
            );
            expect(fetchImpl).toHaveBeenCalledTimes(1);
            expect(sleep).not.toHaveBeenCalled();
        });
    });

    describe('fetchStoredBars', () => {
        const route = (url: string): Response =>
            url.includes('historical-price-eod')
                ? reply(eodRows)
                : reply([{ companyName: 'Nvidia Corporation' }]);

        it('returns the bars oldest first with the company name and the date range', async () => {
            const { deps } = makeDeps(route);
            const stored = await fetchStoredBars(
                deps,
                'NVDA',
                '2024-01-01',
                '2024-01-31'
            );
            expect(stored).toMatchObject({
                ticker: 'NVDA',
                companyName: 'Nvidia Corporation',
                fetchedAt: '2026-11-20T01:02:03.000Z',
                from: '2024-01-02',
                to: '2024-01-03',
            });
            expect(stored.bars.map(bar => bar.close)).toEqual([10.5, 11.5]);
        });

        it('falls back to the ticker when the profile has no name', async () => {
            const { deps } = makeDeps(url =>
                url.includes('historical-price-eod')
                    ? reply(eodRows)
                    : reply([{}])
            );
            expect(
                (await fetchStoredBars(deps, 'NVDA', 'a', 'b')).companyName
            ).toBe('NVDA');
        });

        it('falls back to the ticker when the profile is not an array', async () => {
            const { deps } = makeDeps(url =>
                url.includes('historical-price-eod')
                    ? reply(eodRows)
                    : reply({ error: 'x' })
            );
            expect(
                (await fetchStoredBars(deps, 'NVDA', 'a', 'b')).companyName
            ).toBe('NVDA');
        });

        it.each([
            ['a non-ISO date', { ...eodRows[0], date: '03/01/2024' }],
            ['a NaN price', { ...eodRows[0], close: null }],
            ['a missing volume', { ...eodRows[0], volume: undefined }],
            ['a non-object row', 'row'],
            ['a null row', null],
        ])(
            'names the symbol and the row when a row has %s',
            async (_name, bad) => {
                const { deps, fetchImpl } = makeDeps(() =>
                    reply([eodRows[1], bad])
                );
                await expect(
                    fetchStoredBars(deps, 'NVDA', 'a', 'b')
                ).rejects.toThrow('FMP bars for NVDA: row 1 is malformed');
                expect(fetchImpl).toHaveBeenCalledTimes(1);
            }
        );

        it('fails on an empty or non-array bars reply without asking for the profile', async () => {
            const { deps, fetchImpl } = makeDeps(() => reply([]));
            await expect(
                fetchStoredBars(deps, 'NVDA', 'a', 'b')
            ).rejects.toThrow('empty or not an array');
            expect(fetchImpl).toHaveBeenCalledTimes(1);
            const other = makeDeps(() => reply({ not: 'an array' }));
            await expect(
                fetchStoredBars(other.deps, 'NVDA', 'a', 'b')
            ).rejects.toThrow('empty or not an array');
        });
    });

    describe('planFetch and parseSymbols', () => {
        it('counts two requests per symbol', () => {
            expect(REQUESTS_PER_SYMBOL).toBe(2);
            expect(planFetch(['NVDA', 'AAPL'])).toEqual({
                symbols: ['NVDA', 'AAPL'],
                requests: 4,
                worstCaseRequests: 4 * FETCH_ATTEMPTS,
            });
        });

        it('states the worst case with every request retried to the last attempt', () => {
            expect(planFetch(parseSymbols('all-us')).worstCaseRequests).toBe(
                110 * FETCH_ATTEMPTS
            );
        });

        it('expands all-us to the 55 US symbols', () => {
            expect(parseSymbols('all-us')).toEqual(REPLAY_US_SYMBOLS);
            expect(planFetch(parseSymbols('all-us')).requests).toBe(110);
        });

        it('splits and trims a comma list', () => {
            expect(parseSymbols('NVDA, AAPL')).toEqual(['NVDA', 'AAPL']);
        });

        it('rejects a Korean symbol, an unknown one and an empty list', () => {
            expect(() => parseSymbols('005930.KS')).toThrow(
                'replay US symbols'
            );
            expect(() => parseSymbols('ZZZZ')).toThrow('ZZZZ');
            expect(() => parseSymbols('')).toThrow('replay US symbols');
        });
    });

    describe('fetchAll', () => {
        const route = (url: string): Response =>
            url.includes('historical-price-eod')
                ? reply(eodRows)
                : reply([{ companyName: 'Co' }]);

        it('writes one file per symbol and pauses between symbols', async () => {
            const { dir, remove } = makeTempDir();
            temps.add(remove);
            const { deps, sleep } = makeDeps(route);
            const log = vi.fn();
            const written = await fetchAll(deps, {
                symbols: ['NVDA', 'AAPL'],
                from: '2024-01-01',
                to: '2024-01-31',
                out: dir,
                force: false,
                log,
            });
            expect(written).toEqual(['NVDA', 'AAPL']);
            expect(
                JSON.parse(readFileSync(join(dir, 'AAPL.json'), 'utf-8')).ticker
            ).toBe('AAPL');
            expect(sleep).toHaveBeenCalledTimes(2);
        });

        it('skips an existing file unless forced', async () => {
            const { dir, remove } = makeTempDir();
            temps.add(remove);
            const options = {
                symbols: ['NVDA'],
                from: 'a',
                to: 'b',
                out: dir,
                force: false,
                log: vi.fn(),
            };
            await fetchAll(makeDeps(route).deps, options);
            const second = makeDeps(route);
            expect(await fetchAll(second.deps, options)).toEqual([]);
            expect(second.fetchImpl).not.toHaveBeenCalled();
            expect(
                await fetchAll(second.deps, { ...options, force: true })
            ).toEqual(['NVDA']);
        });

        it('refuses an output directory inside the repository before any request', async () => {
            const { deps, fetchImpl } = makeDeps(route);
            await expect(
                fetchAll(deps, {
                    symbols: ['NVDA'],
                    from: 'a',
                    to: 'b',
                    out: join(REPO_ROOT, 'bars'),
                    force: false,
                    log: vi.fn(),
                })
            ).rejects.toThrow('inside the repository');
            expect(fetchImpl).not.toHaveBeenCalled();
        });

        it('stops at the first failing symbol and leaves the later ones unfetched', async () => {
            const { dir, remove } = makeTempDir();
            temps.add(remove);
            const { deps, fetchImpl } = makeDeps(() => reply({}, 402));
            await expect(
                fetchAll(deps, {
                    symbols: ['NVDA', 'AAPL'],
                    from: 'a',
                    to: 'b',
                    out: dir,
                    force: false,
                    log: vi.fn(),
                })
            ).rejects.toThrow('HTTP 402');
            expect(fetchImpl).toHaveBeenCalledTimes(1);
        });
    });
});
