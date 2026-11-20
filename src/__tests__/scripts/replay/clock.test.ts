import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    activeClockRuns,
    runAtInstant,
} from '../../../../scripts/replay/clock';
import { deferred } from './replayFixtures';

/**
 * Only `Date` is faked, and it is frozen: the "real" clock of these tests stands still, so
 * every comparison is exact and does not depend on how fast or loaded the machine is.
 */
const REAL_NOW = Date.UTC(2026, 10, 21, 12, 0, 0);
const PAST = Date.UTC(2021, 2, 5, 22, 0, 0);
const OTHER_PAST = Date.UTC(2019, 6, 1, 12, 0, 0);

describe('runAtInstant', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(REAL_NOW);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('shifts Date.now, new Date() and Date() to the instant', async () => {
        const seen = await runAtInstant(PAST, async () => ({
            now: Date.now(),
            constructed: new Date().getTime(),
            text: Date(),
        }));
        expect(seen.now).toBe(PAST);
        expect(seen.constructed).toBe(PAST);
        expect(seen.text).toContain('2021');
    });

    it('lets time move forward from the instant by exactly as much as the real clock moves', async () => {
        const [first, second] = await runAtInstant(PAST, async () => {
            const before = Date.now();
            vi.setSystemTime(REAL_NOW + 1_500);
            return [before, Date.now()];
        });
        expect(first).toBe(PAST);
        expect(second).toBe(PAST + 1_500);
    });

    it('leaves dates built from arguments, Date.UTC, Date.parse and instanceof alone', async () => {
        const seen = await runAtInstant(PAST, async () => ({
            fromArg: new Date('2020-02-03T04:05:06Z').toISOString(),
            utc: Date.UTC(2020, 1, 3),
            parsed: Date.parse('2020-02-03T00:00:00Z'),
            isDate: new Date() instanceof Date,
        }));
        expect(seen.fromArg).toBe('2020-02-03T04:05:06.000Z');
        expect(seen.utc).toBe(Date.UTC(2020, 1, 3));
        expect(seen.parsed).toBe(Date.UTC(2020, 1, 3));
        expect(seen.isDate).toBe(true);
    });

    it('puts the Date that was global back after the function resolves', async () => {
        const before = globalThis.Date;
        await runAtInstant(PAST, async () => undefined);
        expect(globalThis.Date).toBe(before);
        expect(Date.now()).toBe(REAL_NOW);
        expect(activeClockRuns()).toBe(0);
    });

    it('puts the real Date back and rethrows when the function rejects', async () => {
        const before = globalThis.Date;
        await expect(
            runAtInstant(PAST, async () => {
                throw new Error('boom');
            })
        ).rejects.toThrow('boom');
        expect(globalThis.Date).toBe(before);
        expect(Date.now()).toBe(REAL_NOW);
        expect(activeClockRuns()).toBe(0);
    });

    it('puts the real Date back when the function throws before returning a promise', async () => {
        const before = globalThis.Date;
        await expect(
            runAtInstant(PAST, () => {
                throw new Error('sync boom');
            })
        ).rejects.toThrow('sync boom');
        expect(globalThis.Date).toBe(before);
    });

    it('does not shift a chain that began outside the call, even while the call runs', async () => {
        const outside = Promise.resolve();
        const insideStarted = deferred<void>();
        const release = deferred<void>();
        const run = runAtInstant(PAST, async () => {
            insideStarted.resolve();
            await release.promise;
            return Date.now();
        });
        await insideStarted.promise;
        // This chain is not inside the call: it reads the real clock through the same shim.
        const outsideNow = await outside.then(() => Date.now());
        release.resolve();
        expect(await run).toBe(PAST);
        expect(outsideNow).toBe(REAL_NOW);
    });

    it('gives each of two concurrent calls its own instant', async () => {
        const gate = deferred<void>();
        const read = async (): Promise<number> => {
            await gate.promise;
            return Date.now();
        };
        const first = runAtInstant(PAST, read);
        const second = runAtInstant(OTHER_PAST, read);
        gate.resolve();
        expect([await first, await second]).toEqual([PAST, OTHER_PAST]);
    });

    it('keeps the shim installed until the last concurrent call ends', async () => {
        const before = globalThis.Date;
        const release = deferred<void>();
        const slow = runAtInstant(PAST, () => release.promise);
        await runAtInstant(OTHER_PAST, async () => undefined);
        expect(activeClockRuns()).toBe(1);
        expect(globalThis.Date).not.toBe(before);
        release.resolve();
        await slow;
        expect(activeClockRuns()).toBe(0);
        expect(globalThis.Date).toBe(before);
    });

    it('does not shift a callback that runs after the call has ended', async () => {
        const captured: { read: (() => number) | null } = { read: null };
        await runAtInstant(PAST, async () => {
            captured.read = () => Date.now();
        });
        expect(captured.read).not.toBeNull();
        expect(captured.read?.()).toBe(REAL_NOW);
    });
});
