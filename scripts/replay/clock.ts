/**
 * A per-async-chain clock for replaying a past day. `runAnalysis` has no `now` option and
 * `fetchBarsWithIndicators` cuts its bar window at `new Date()`, so a case analysed "as of"
 * an old session needs the clock set to that session. A global freeze would break the
 * cases running side by side, so each chain carries its own offset in an
 * `AsyncLocalStorage` and the shim reads it.
 *
 * Confinement: this is the only place that touches `globalThis.Date`. The shim is installed
 * when the first replay starts and the previous `Date` is put back when the last one ends
 * (also when the replayed function throws), so no code outside a `runAtInstant` call ever
 * runs against it. Inside a call, only the chains started by that call see the shifted
 * time; every other chain reads the real clock through the same shim.
 *
 * What the shim changes: `Date.now()`, `new Date()` and `Date()` read the shifted time;
 * `new Date(x)`, `Date.UTC`, `Date.parse` and `instanceof Date` behave as the real `Date`.
 * Not shifted, because they do not go through `Date`: `Intl.DateTimeFormat#format()` and
 * `formatToParts()` called without an argument, `performance.now()`, and any timer or
 * callback that outlives the replay (it reads the real clock once the shim is removed).
 * `date.constructor === Date` is `false` for a date made under the shim (it is the real
 * constructor), which no code in this repository compares.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

interface ClockStore {
    readonly offsetMs: number;
}

interface ShimState {
    /** Replays currently inside `runAtInstant`. */
    active: number;
    /** The `Date` that was global when the first active replay started. */
    base: DateConstructor | null;
}

const store = new AsyncLocalStorage<ClockStore>();
const state: ShimState = { active: 0, base: null };

function createShiftedDate(base: DateConstructor): DateConstructor {
    const shiftedNow = (): number =>
        base.now() + (store.getStore()?.offsetMs ?? 0);
    return new Proxy(base, {
        construct: (target, args: unknown[]) =>
            Reflect.construct(
                target,
                args.length === 0 ? [shiftedNow()] : args
            ),
        apply: () => new base(shiftedNow()).toString(),
        get: (target, property) =>
            property === 'now'
                ? shiftedNow
                : Reflect.get(target, property, target),
    });
}

function enter(): DateConstructor {
    const base = state.base ?? globalThis.Date;
    if (state.active === 0) {
        state.base = base;
        globalThis.Date = createShiftedDate(base);
    }
    state.active += 1;
    return base;
}

function exit(): void {
    state.active -= 1;
    if (state.active === 0 && state.base !== null) {
        globalThis.Date = state.base;
        state.base = null;
    }
}

/** Number of replays currently running under the shim (`0` means the real `Date` is global). */
export function activeClockRuns(): number {
    return state.active;
}

/**
 * Runs `fn` with `Date` reading `instantMs` (epoch ms) at the start and moving forward in
 * real time from there. Resolves or rejects like `fn`; the real clock is restored either way.
 */
export async function runAtInstant<T>(
    instantMs: number,
    fn: () => Promise<T>
): Promise<T> {
    const base = enter();
    try {
        return await store.run({ offsetMs: instantMs - base.now() }, fn);
    } finally {
        exit();
    }
}
