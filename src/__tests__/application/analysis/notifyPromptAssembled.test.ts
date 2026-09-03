import { describe, it, expect, vi, afterEach } from 'vitest';
import { notifyPromptAssembled } from '@/application/analysis/notifyPromptAssembled';
import type { AssembledPromptRecord } from '@/domain/types';

const record: AssembledPromptRecord = {
    system: 'sys',
    stable: 'stable',
    dynamic: 'dyn',
    promptVersion: 'p9',
};

afterEach(() => {
    vi.restoreAllMocks();
});

/** Waits out the microtask queue so a rejected callback promise settles. */
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('notifyPromptAssembled', () => {
    it('passes the record through to the callback', () => {
        const cb = vi.fn();
        notifyPromptAssembled(cb, record, '[Test]');
        expect(cb).toHaveBeenCalledWith(record);
    });

    it('does nothing when no callback is supplied', () => {
        expect(() =>
            notifyPromptAssembled(undefined, record, '[Test]')
        ).not.toThrow();
    });

    it('swallows a synchronous throw and logs it', () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        expect(() =>
            notifyPromptAssembled(
                () => {
                    throw new Error('sync boom');
                },
                record,
                '[Test]'
            )
        ).not.toThrow();
        expect(spy).toHaveBeenCalledWith(
            expect.stringContaining('threw'),
            expect.any(Error)
        );
    });

    it('swallows an async rejection instead of leaving it unhandled', async () => {
        // The reason this helper exists. A throw inside an `async` callback
        // never surfaces synchronously, so a bare try/catch around the call
        // sees nothing and the rejection goes unhandled — which Node
        // terminates the process for by default. Persisting a prompt is an
        // async write, so this is the ordinary case, not an edge one.
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const unhandled = vi.fn();
        process.on('unhandledRejection', unhandled);

        notifyPromptAssembled(
            async () => {
                throw new Error('async boom');
            },
            record,
            '[Test]'
        );
        await flush();

        process.off('unhandledRejection', unhandled);
        expect(unhandled).not.toHaveBeenCalled();
        expect(spy).toHaveBeenCalledWith(
            expect.stringContaining('rejected'),
            expect.any(Error)
        );
    });

    it('leaves a resolving async callback alone', async () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        notifyPromptAssembled(async () => {}, record, '[Test]');
        await flush();
        expect(spy).not.toHaveBeenCalled();
    });
});
