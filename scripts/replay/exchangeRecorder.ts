/**
 * Records the HTTP exchanges a replay case makes with the model provider (request body
 * and response text), for the token usage of the run and for `--keep-raw`. `fetch` is
 * wrapped once; a case's exchanges are told apart with an `AsyncLocalStorage`, so cases
 * running side by side never see each other's calls.
 *
 * Only URLs containing `urlIncludes` are recorded. Request headers are never stored, so
 * no key can reach a file.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { UsageRecord } from './types';

export interface RecordedExchange {
    url: string;
    method: string;
    requestBody: unknown;
    status: number;
    responseText: string;
}

interface Scope {
    exchanges: RecordedExchange[];
    pending: Promise<void>[];
}

const scope = new AsyncLocalStorage<Scope>();

export const DEFAULT_RECORDED_HOST = 'api.deepseek.com';

function urlOf(input: Parameters<typeof fetch>[0]): string {
    if (typeof input === 'string') return input;
    return input instanceof URL ? input.href : input.url;
}

function parseBody(body: unknown): unknown {
    if (typeof body !== 'string') return body ?? null;
    try {
        return JSON.parse(body);
    } catch {
        return body;
    }
}

/**
 * Replaces `globalThis.fetch` with a recording wrapper around the current one and returns
 * the function that puts the previous one back.
 */
export function installFetchRecorder(
    urlIncludes: string = DEFAULT_RECORDED_HOST
): () => void {
    const previous = globalThis.fetch;
    const wrapped: typeof fetch = async (input, init) => {
        const response = await previous(input, init);
        const current = scope.getStore();
        const url = urlOf(input);
        if (current !== undefined && url.includes(urlIncludes)) {
            const record = response
                .clone()
                .text()
                .then(text => {
                    // Collected across async callbacks of one scope (CONVENTIONS.md#CP-5).
                    current.exchanges.push({
                        url,
                        method: init?.method ?? 'GET',
                        requestBody: parseBody(init?.body),
                        status: response.status,
                        responseText: text,
                    });
                })
                .catch(() => undefined);
            current.pending.push(record);
        }
        return response;
    };
    globalThis.fetch = wrapped;
    return () => {
        globalThis.fetch = previous;
    };
}

export type Recorded<T> =
    | { ok: true; value: T; exchanges: readonly RecordedExchange[] }
    | { ok: false; error: unknown; exchanges: readonly RecordedExchange[] };

/**
 * Runs `fn` and returns its outcome together with every provider exchange it made, also
 * when it threw (a failed call still cost tokens).
 */
export async function recordExchanges<T>(
    fn: () => Promise<T>
): Promise<Recorded<T>> {
    const own: Scope = { exchanges: [], pending: [] };
    const outcome = await scope.run(own, fn).then(
        value => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error })
    );
    await Promise.all(own.pending);
    return { ...outcome, exchanges: own.exchanges };
}

function asRecord(value: unknown): Record<string, unknown> | null {
    // The cast reads a non-null, non-array object as a string-keyed bag; every field taken
    // from it is checked (`count`, `asRecord`) before use, so nothing is trusted.
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
}

function count(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Usage block of a `/responses` stream event or a plain reply, or `null`. */
function usageBlock(payload: unknown): Record<string, unknown> | null {
    const root = asRecord(payload);
    return asRecord(asRecord(root?.response)?.usage) ?? asRecord(root?.usage);
}

function toUsage(block: Record<string, unknown>): UsageRecord {
    const details = asRecord(block.input_tokens_details);
    return {
        inputTokens: count(block.input_tokens) ?? count(block.prompt_tokens),
        outputTokens:
            count(block.output_tokens) ?? count(block.completion_tokens),
        cachedTokens:
            count(details?.cached_tokens) ??
            count(block.prompt_cache_hit_tokens),
    };
}

function tryParse(text: string): unknown {
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

/**
 * Token usage of one reply: the last `usage` block of an SSE stream (`data: {...}`
 * lines) or of a plain JSON body. `null` when the text carries none.
 */
export function extractUsage(responseText: string): UsageRecord | null {
    const events = responseText
        .split('\n')
        .filter(line => line.startsWith('data:'))
        .map(line => tryParse(line.slice('data:'.length).trim()));
    const blocks = [...events, tryParse(responseText.trim())]
        .map(usageBlock)
        .filter((block): block is Record<string, unknown> => block !== null);
    const last = blocks.at(-1);
    return last === undefined ? null : toUsage(last);
}

function sumField(values: readonly (number | null)[]): number | null {
    const known = values.filter((v): v is number => v !== null);
    return known.length === 0 ? null : known.reduce((a, b) => a + b, 0);
}

/**
 * Total usage of a case's exchanges (a regeneration is a second exchange); `null` when
 * none of them reported usage.
 */
export function sumUsage(
    exchanges: readonly RecordedExchange[]
): UsageRecord | null {
    const usages = exchanges
        .map(exchange => extractUsage(exchange.responseText))
        .filter((usage): usage is UsageRecord => usage !== null);
    return usages.length === 0
        ? null
        : {
              inputTokens: sumField(usages.map(u => u.inputTokens)),
              outputTokens: sumField(usages.map(u => u.outputTokens)),
              cachedTokens: sumField(usages.map(u => u.cachedTokens)),
          };
}
