import {
    getJobStatus,
    setJobError,
    setJobStatus,
} from '@/infrastructure/jobs/queue';
import type { JobStatus } from '@/infrastructure/jobs/types';

/** Worker error-body chars kept in the console log line before truncation. */
const WORKER_REJECTION_LOG_BODY_MAX_LENGTH = 500;

/**
 * Stringify an unknown thrown value without ever throwing itself.
 *
 * `String(error)` is not actually safe for an arbitrary caught value: a
 * null-prototype object (e.g. `Object.create(null)`) has no inherited
 * `toString`, and a value whose `toString` / `Symbol.toPrimitive` itself
 * throws makes `String()` raise a `TypeError`. Both call sites below have
 * nothing above them in `dispatchWorkerJob` — a throw from `String(error)`
 * there would escape as a promise rejection, straight into `fireAndForget`
 * with no `.catch()` attached at any of the 13 call sites, defeating the
 * "never rejects" guarantee this module documents. This is the same
 * hardening `dispatchWorkerJob` already applies to a stubbed/polyfilled
 * *resolved* fetch value (see the response-inspection try/catch below) —
 * a stubbed global fetch can just as easily *reject* with
 * `Object.create(null)`.
 */
function safeStringifyError(error: unknown): string {
    try {
        return String(error);
    } catch {
        return '[unstringifiable error]';
    }
}

/**
 * Write the same terminal `error` state a worker writes on a mid-job failure
 * so a dispatch-time failure is indistinguishable to `poll*` from a
 * worker-side one — no new error shape, no change required downstream.
 *
 * Write order mirrors the worker's own order, not the reverse: `setJobError`
 * (`infrastructure/jobs/queue.ts`) is documented as "called by the worker
 * immediately before transitioning the status to `error`", i.e. message
 * first, status flip last. These are two separate Upstash round-trips, and
 * every `poll*` reads status first, then falls back to `getJobError() ??
 * 'Unknown error'` when status is `'error'`. Writing status before the
 * message would open a window where a poll lands between the two writes and
 * observes `status==='error'` with no message yet, discarding the specific
 * failure reason (e.g. `Worker rejected job (status 400)`) — which is the
 * whole point of this fix. Writing the message first makes the interleaving
 * window benign instead: a poll landing there still sees the old
 * status (absent, so `poll*` treats it as `'processing'` and retries).
 *
 * Guarded with a read-before-write check so a dispatch-time failure never
 * clobbers a job the worker already completed: an HTTP response can be lost
 * (connection reset, an ALB/CDN 502/504, or the 5-minute
 * `AbortSignal.timeout` firing) *after* the worker finished and wrote
 * `result` + `'done'`. Only write the error state when the job has no
 * status yet or is still `'processing'`.
 *
 * The status read has its own try/catch, separate from the two writes below,
 * and fails OPEN: if the read itself rejects (an Upstash 5xx or network blip
 * on that one round-trip), `currentStatus` defaults to `null` — "no status
 * recorded" — and execution falls through to the writes. A shared
 * try/catch around the read and the writes would let a transient read
 * failure swallow the writes entirely, leaving the job with no terminal
 * state at all and every `poll*` spinning in `processing` forever — exactly
 * the infinite-spinner bug this module exists to remove. Only a *successful*
 * read that comes back with a genuine terminal status (`'done'`, or an
 * `'error'` the worker already wrote) may suppress the write.
 *
 * The two writes below (`setJobError` then `setJobStatus`) are likewise each
 * wrapped in their OWN try/catch rather than sharing one: Upstash is
 * per-request HTTP REST, so a transient failure on the `setJobError`
 * round-trip does not imply the following `setJobStatus` round-trip would
 * also fail. A shared catch would let a `setJobError` rejection skip
 * `setJobStatus` entirely, leaving the job with NO status recorded —
 * `poll*` treats an absent status as `'processing'`, which is the exact
 * infinite-spinner bug this module exists to remove, just reached through
 * the write side instead of the read side. Attempting `setJobStatus`
 * unconditionally means a `setJobError` failure degrades to a job that
 * reaches `'error'` with a generic `getJobError() ?? 'Unknown error'`
 * message instead of the specific one — a terminal state either way, never
 * a silently-abandoned one.
 *
 * Never rejects — every store write is caught and logged. `dispatchWorkerJob`
 * is always passed to `fireAndForget` (`application/background.ts`), whose
 * contract requires the promise to "already handle its own errors before
 * being passed here"; with no `waitUntil` registered, a rejection here would
 * otherwise be silently dropped into an unhandled rejection. This matches
 * the fail-open posture `submitOptionsAnalysis.ts` already uses around
 * `setJobMeta`.
 */
async function reportDispatchFailure(
    jobId: string,
    logPrefix: string,
    message: string
): Promise<void> {
    let currentStatus: JobStatus | null = null;
    try {
        currentStatus = await getJobStatus(jobId);
    } catch (error) {
        // Fail open: default to `null` ("no status recorded") so the writes
        // below still run. See the fail-open note in the doc comment above.
        console.error(
            `${logPrefix} Failed to read job status before recording error state:`,
            error
        );
    }
    if (currentStatus !== null && currentStatus !== 'processing') {
        // The worker already reached a terminal state (`done`, or an
        // `error` it wrote itself) — a lost/late dispatch-time failure
        // must not overwrite that outcome.
        return;
    }
    // Independent try/catch per write — see the doc comment above: a
    // `setJobError` failure must never skip the `setJobStatus` attempt.
    try {
        await setJobError(jobId, message);
    } catch (error) {
        console.error(`${logPrefix} Failed to record job error state:`, error);
    }
    try {
        await setJobStatus(jobId, 'error');
    } catch (error) {
        console.error(`${logPrefix} Failed to record job error status:`, error);
    }
}

/**
 * @internal Not re-exported from `src/index.ts` / `src/index.client.ts` —
 * module-exported only so all 13 `submit*` call sites can import it
 * directly.
 *
 * Dispatch a fire-and-forget POST to the AI worker and guard against a
 * silently-swallowed rejection.
 *
 * `fetch` does NOT reject on 4xx/5xx — it only rejects on network-level
 * failures (DNS, TLS, a timed-out/aborted `AbortSignal`). Every `submit*`
 * use-case used to dispatch with a bare `fetch(...).catch(error => …)`,
 * which logged network failures but never inspected `response.ok`. When the
 * worker synchronously rejected a job (e.g. a `400` before it ever wrote
 * `processing`), nothing was logged and no job state was ever written:
 * `pollAnalysis`/`poll*` treat an absent job status as `'processing'`
 * forever, so the consumer polled indefinitely (an infinite spinner).
 *
 * This helper makes every dispatch failure — both a non-2xx response and a
 * network-level rejection — terminal from the poller's point of view, by
 * writing the exact same job-error state a worker itself writes on a
 * mid-job failure (see {@link reportDispatchFailure}). `poll*` then reports
 * the failure exactly as if the worker had picked up the job and failed
 * mid-flight, so existing consumer error handling keeps working unchanged.
 *
 * Deliberately kept in its own module rather than folded into
 * `application/background.ts`: many `submit*` test suites blanket
 * `vi.mock('@/application/background')` to stub `fireAndForget`, which would
 * silently replace this function with a no-op mock (and the real `fetch`
 * call along with it) had it lived in that module.
 *
 * Intentionally NOT awaited by the call site: pass the returned promise to
 * `fireAndForget` (`application/background.ts`) the same way the old bare
 * `fetch(...).catch(...)` chain was — `submit*` must still return
 * `{ status: 'submitted', jobId }` before this settles.
 *
 * The returned promise NEVER rejects — the network-failure branch, the
 * response-inspection branch (guarding `response.ok`/`response.text()`
 * against a resolved value that doesn't actually behave like a `Response`),
 * the error-to-string conversion in both of those branches (via the
 * internal `safeStringifyError`, which never throws even for a
 * null-prototype rejection value or a `toString` that itself throws), and
 * {@link reportDispatchFailure}'s own job-store writes (each in its own
 * try/catch, so one write failing can never suppress the other) are all
 * fully caught. This is required by `fireAndForget`'s contract ("the
 * promise should already handle its own errors before being passed here"):
 * with no `waitUntil` registered, a rejecting promise handed to
 * `fireAndForget` would be dropped as an unhandled rejection, which is
 * process-fatal under Node's default `--unhandled-rejections=throw`.
 *
 * @param url - Worker endpoint (e.g. `` `${workerUrl}/analyze` `` or
 *   `` `${workerUrl}/briefing` ``).
 * @param init - `fetch` request init (method/headers/body/signal) — identical
 *   to what each `submit*` call site already builds.
 * @param jobId - The job id already registered via `setJobMeta` at the call
 *   site, so the error state lands on the same job the caller hands back to
 *   the consumer as `{ status: 'submitted', jobId }`.
 * @param logPrefix - Per-call-site log tag (e.g. `'[Submit]'`,
 *   `'[submitCongressTrend]'`) — kept so existing log greps by prefix keep
 *   working, and so the console line stays traceable to its use-case.
 */
export async function dispatchWorkerJob(
    url: string,
    init: RequestInit,
    jobId: string,
    logPrefix: string
): Promise<void> {
    let response: Response;
    try {
        response = await fetch(url, init);
    } catch (error) {
        console.error(`${logPrefix} Worker request failed:`, error);
        await reportDispatchFailure(
            jobId,
            logPrefix,
            `Worker request failed: ${safeStringifyError(error)}`
        );
        return;
    }

    // Everything below reads/inspects `response`, and is wrapped so the
    // "never rejects" contract above actually holds. `fetch` resolving does
    // not guarantee the resolved value behaves like a spec `Response` — a
    // stubbed/instrumented global fetch, a polyfill, or a future test double
    // could resolve to something where `.ok` access or `.text()` throws
    // synchronously instead of rejecting. Without this try/catch that throw
    // would propagate out of this `async function` as a promise rejection,
    // straight into `fireAndForget` with no `.catch()` attached at any of
    // the 13 call sites (see the doc comment above) — the exact
    // process-fatal unhandled-rejection case this module exists to avoid.
    try {
        if (!response.ok) {
            const body = await response.text().catch(() => '');
            const truncatedBody = body.slice(
                0,
                WORKER_REJECTION_LOG_BODY_MAX_LENGTH
            );
            console.error(
                `${logPrefix} Worker rejected job:`,
                jobId,
                response.status,
                truncatedBody
            );
            await reportDispatchFailure(
                jobId,
                logPrefix,
                `Worker rejected job (status ${response.status})`
            );
        }
    } catch (error) {
        console.error(`${logPrefix} Worker response inspection failed:`, error);
        await reportDispatchFailure(
            jobId,
            logPrefix,
            `Worker response inspection failed: ${safeStringifyError(error)}`
        );
    }
}
