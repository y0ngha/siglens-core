import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    DEFAULT_RECORDED_HOST,
    extractUsage,
    installFetchRecorder,
    recordExchanges,
    sumUsage,
    type RecordedExchange,
} from '../../../../scripts/replay/exchangeRecorder';

const URL_MODEL = `https://${DEFAULT_RECORDED_HOST}/responses`;

/** Every test that reaches `fetch` goes through this stub: a bare spy would call the network. */
const baseFetch = vi.fn<typeof fetch>();
const recorder = { uninstall: (): void => undefined };

describe('exchange recorder', () => {
    beforeEach(() => {
        baseFetch.mockReset();
        baseFetch.mockRejectedValue(new Error('network blocked in tests'));
        vi.stubGlobal('fetch', baseFetch);
        recorder.uninstall = installFetchRecorder();
    });

    afterEach(() => {
        recorder.uninstall();
        vi.unstubAllGlobals();
    });

    const sse = (usage: object): string =>
        [
            'event: response.output_text.delta',
            'data: {"type":"response.output_text.delta","delta":"x"}',
            '',
            'event: response.completed',
            `data: ${JSON.stringify({ type: 'response.completed', response: { usage } })}`,
            '',
        ].join('\n');

    describe('installFetchRecorder / recordExchanges', () => {
        it('records the request body and response text of a matching call inside a scope', async () => {
            baseFetch.mockImplementation(
                async () => new Response('reply-text', { status: 200 })
            );
            const recorded = await recordExchanges(async () => {
                const response = await fetch(URL_MODEL, {
                    method: 'POST',
                    body: JSON.stringify({ model: 'm' }),
                    headers: { authorization: 'Bearer secret' },
                });
                return response.text();
            });
            expect(recorded.ok).toBe(true);
            expect(recorded.ok && recorded.value).toBe('reply-text');
            expect(recorded.exchanges).toHaveLength(1);
            expect(recorded.exchanges[0]).toEqual({
                url: URL_MODEL,
                method: 'POST',
                requestBody: { model: 'm' },
                status: 200,
                responseText: 'reply-text',
            });
        });

        it('never stores request headers', async () => {
            baseFetch.mockImplementation(async () => new Response('ok'));
            const recorded = await recordExchanges(async () => {
                await fetch(URL_MODEL, {
                    method: 'POST',
                    body: '{}',
                    headers: { authorization: 'Bearer secret' },
                });
            });
            expect(JSON.stringify(recorded.exchanges)).not.toContain('secret');
        });

        it('keeps a body that is not JSON as it was sent', async () => {
            baseFetch.mockImplementation(async () => new Response('ok'));
            const recorded = await recordExchanges(async () => {
                await fetch(URL_MODEL, { method: 'POST', body: 'not json' });
            });
            expect(recorded.exchanges[0].requestBody).toBe('not json');
        });

        it('does not record a URL that does not match', async () => {
            baseFetch.mockImplementation(async () => new Response('ok'));
            const recorded = await recordExchanges(async () => {
                await fetch('https://example.invalid/other');
            });
            expect(baseFetch).toHaveBeenCalledTimes(1);
            expect(recorded.exchanges).toEqual([]);
        });

        it('does not record a call made outside any scope', async () => {
            baseFetch.mockImplementation(async () => new Response('ok'));
            await fetch(URL_MODEL);
            const recorded = await recordExchanges(async () => undefined);
            expect(recorded.exchanges).toEqual([]);
        });

        it('keeps two concurrent scopes apart', async () => {
            baseFetch.mockImplementation(
                async input => new Response(`for ${String(input)}`)
            );
            const call = (suffix: string) =>
                recordExchanges(async () => {
                    await fetch(`${URL_MODEL}/${suffix}`);
                    await new Promise(done => setTimeout(done, 5));
                    await fetch(`${URL_MODEL}/${suffix}`);
                });
            const [a, b] = await Promise.all([call('a'), call('b')]);
            expect(a.exchanges.map(e => e.url)).toEqual([
                `${URL_MODEL}/a`,
                `${URL_MODEL}/a`,
            ]);
            expect(b.exchanges.map(e => e.url)).toEqual([
                `${URL_MODEL}/b`,
                `${URL_MODEL}/b`,
            ]);
        });

        it('returns the error and the exchanges made before it when the function throws', async () => {
            baseFetch.mockImplementation(async () => new Response('partial'));
            const recorded = await recordExchanges(async () => {
                await fetch(URL_MODEL);
                throw new Error('after the call');
            });
            expect(recorded.ok).toBe(false);
            expect(!recorded.ok && (recorded.error as Error).message).toBe(
                'after the call'
            );
            expect(recorded.exchanges).toHaveLength(1);
        });

        it('accepts a URL object and a Request as the input', async () => {
            baseFetch.mockImplementation(async () => new Response('ok'));
            const recorded = await recordExchanges(async () => {
                await fetch(new URL(URL_MODEL));
                await fetch(new Request(URL_MODEL));
            });
            expect(recorded.exchanges.map(e => e.url)).toEqual([
                URL_MODEL,
                URL_MODEL,
            ]);
        });

        it('lets the caller read the response body as usual (it records a clone)', async () => {
            baseFetch.mockImplementation(async () => new Response('body'));
            const recorded = await recordExchanges(async () =>
                (await fetch(URL_MODEL)).text()
            );
            expect(recorded.ok && recorded.value).toBe('body');
            expect(recorded.exchanges[0].responseText).toBe('body');
        });

        it('puts the previous fetch back on uninstall', () => {
            const wrapped = globalThis.fetch;
            recorder.uninstall();
            expect(globalThis.fetch).toBe(baseFetch);
            expect(globalThis.fetch).not.toBe(wrapped);
            recorder.uninstall = installFetchRecorder();
        });

        it('records a URL by the substring it is given', async () => {
            recorder.uninstall();
            recorder.uninstall = installFetchRecorder('example.invalid');
            baseFetch.mockImplementation(async () => new Response('ok'));
            const recorded = await recordExchanges(async () => {
                await fetch('https://example.invalid/x');
                await fetch(URL_MODEL);
            });
            expect(recorded.exchanges.map(e => e.url)).toEqual([
                'https://example.invalid/x',
            ]);
        });
    });

    describe('extractUsage', () => {
        it('reads the usage of the response.completed event of an SSE stream', () => {
            const text = sse({
                input_tokens: 100,
                output_tokens: 40,
                input_tokens_details: { cached_tokens: 60 },
            });
            expect(extractUsage(text)).toEqual({
                inputTokens: 100,
                outputTokens: 40,
                cachedTokens: 60,
            });
        });

        it('takes the last usage block when several are present', () => {
            const text = `${sse({ input_tokens: 1, output_tokens: 1 })}\n${sse({ input_tokens: 7, output_tokens: 9 })}`;
            expect(extractUsage(text)).toMatchObject({
                inputTokens: 7,
                outputTokens: 9,
            });
        });

        it('reads a plain JSON reply with a top-level usage block', () => {
            const text = JSON.stringify({
                usage: {
                    prompt_tokens: 5,
                    completion_tokens: 6,
                    prompt_cache_hit_tokens: 2,
                },
            });
            expect(extractUsage(text)).toEqual({
                inputTokens: 5,
                outputTokens: 6,
                cachedTokens: 2,
            });
        });

        it('leaves fields it cannot find as null', () => {
            expect(extractUsage(sse({ output_tokens: 3 }))).toEqual({
                inputTokens: null,
                outputTokens: 3,
                cachedTokens: null,
            });
        });

        it('is null for text without usage and for text that is not JSON', () => {
            expect(
                extractUsage('data: {"type":"response.output_text.delta"}')
            ).toBeNull();
            expect(extractUsage('plain text')).toBeNull();
            expect(extractUsage('')).toBeNull();
        });

        it('ignores a non-finite count', () => {
            expect(
                extractUsage(
                    JSON.stringify({
                        usage: { input_tokens: 'many', output_tokens: 4 },
                    })
                )
            ).toMatchObject({
                inputTokens: null,
                outputTokens: 4,
            });
        });
    });

    describe('sumUsage', () => {
        const exchange = (usage: object | null): RecordedExchange => ({
            url: URL_MODEL,
            method: 'POST',
            requestBody: {},
            status: 200,
            responseText: usage === null ? 'no usage here' : sse(usage),
        });

        it('adds the usage of every exchange (a regeneration is a second one)', () => {
            expect(
                sumUsage([
                    exchange({
                        input_tokens: 10,
                        output_tokens: 2,
                        input_tokens_details: { cached_tokens: 4 },
                    }),
                    exchange({ input_tokens: 20, output_tokens: 3 }),
                ])
            ).toEqual({ inputTokens: 30, outputTokens: 5, cachedTokens: 4 });
        });

        it('skips an exchange without usage', () => {
            expect(
                sumUsage([
                    exchange(null),
                    exchange({ input_tokens: 1, output_tokens: 2 }),
                ])
            ).toMatchObject({
                inputTokens: 1,
                outputTokens: 2,
            });
        });

        it('is null when no exchange reported usage', () => {
            expect(sumUsage([exchange(null)])).toBeNull();
            expect(sumUsage([])).toBeNull();
        });
    });
});
