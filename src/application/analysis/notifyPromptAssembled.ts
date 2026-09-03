import type { AssembledPromptRecord } from '@/domain/types';

/**
 * @internal Invokes a consumer's `onPromptAssembled` callback without letting
 * its failure reach the analysis.
 *
 * Both failure shapes have to be handled, and the second one is the reason
 * this helper exists rather than a bare `try`/`catch` at each call site:
 *
 * - A **synchronous** throw is caught here and logged.
 * - An **async** callback that rejects never throws synchronously — a throw
 *   inside an `async` function always becomes a promise rejection, so a
 *   `try`/`catch` around the call sees nothing. With the return value
 *   discarded, that rejection is unhandled, and Node's default policy since
 *   v15 is to terminate the process. The documented use for this option is
 *   persisting the prompt, which is virtually always an async write, so this
 *   is the ordinary case rather than an edge one — and TypeScript does not
 *   flag it, since an `async` function is structurally assignable to a
 *   `() => void` parameter.
 *
 * Neither shape may propagate: a consumer's persistence failure must not fail
 * an analysis, let alone take down its process.
 */
export function notifyPromptAssembled(
    callback:
        | ((record: AssembledPromptRecord) => void | Promise<void>)
        | undefined,
    record: AssembledPromptRecord,
    logPrefix: string
): void {
    if (callback === undefined) return;
    try {
        const settled = callback(record);
        if (settled !== undefined) {
            Promise.resolve(settled).catch((error: unknown) => {
                console.error(
                    `${logPrefix} onPromptAssembled callback rejected; continuing:`,
                    error
                );
            });
        }
    } catch (error) {
        console.error(
            `${logPrefix} onPromptAssembled callback threw; continuing:`,
            error
        );
    }
}
