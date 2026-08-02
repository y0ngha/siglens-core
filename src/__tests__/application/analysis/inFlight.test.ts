import { describe, expect, it, vi } from 'vitest';
import { dedupeInFlight } from '@/application/analysis/inFlight';

describe('dedupeInFlight', () => {
    it('같은 키의 동시 호출은 한 번만 실행된다', async () => {
        const fn = vi.fn().mockResolvedValue('r');
        const [a, b] = await Promise.all([
            dedupeInFlight('k', fn),
            dedupeInFlight('k', fn),
        ]);
        expect(fn).toHaveBeenCalledTimes(1);
        expect(a).toBe('r');
        expect(b).toBe('r');
    });

    it('완료 후에는 다시 실행된다', async () => {
        const fn = vi.fn().mockResolvedValue('r');
        await dedupeInFlight('k', fn);
        await dedupeInFlight('k', fn);
        expect(fn).toHaveBeenCalledTimes(2);
    });

    it('실패해도 항목을 남기지 않는다', async () => {
        const fail = vi.fn().mockRejectedValue(new Error('x'));
        await expect(dedupeInFlight('k', fail)).rejects.toThrow('x');
        const ok = vi.fn().mockResolvedValue('r');
        await expect(dedupeInFlight('k', ok)).resolves.toBe('r');
    });

    it('다른 키는 서로 합류하지 않는다', async () => {
        const fn = vi.fn().mockResolvedValue('r');
        await Promise.all([dedupeInFlight('a', fn), dedupeInFlight('b', fn)]);
        expect(fn).toHaveBeenCalledTimes(2);
    });
});
