import type { WaitUntil } from '@/domain/types';

/** Runtime hooks for background tasks started by application use-cases. */
export interface BackgroundTaskOptions {
    /**
     * Optional serverless lifetime extender for fire-and-forget work.
     *
     * On Vercel, pass `waitUntil` from `@vercel/functions` so worker dispatch,
     * cache writes, cleanup, and other background promises can continue after
     * the response is returned.
     */
    waitUntil?: WaitUntil;
}
