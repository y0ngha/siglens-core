import { describe, expect, it, vi } from 'vitest';
import {
    CLIENT_CACHE_MAX_ENTRIES,
    createClientCache,
} from '@/infrastructure/ai/providers/clientCache';

describe('createClientCache', () => {
    it('reuses the client for the same key', () => {
        const build = vi.fn((key: string) => ({ key }));
        const cache = createClientCache(build);
        expect(cache.get('a')).toBe(cache.get('a'));
        expect(build).toHaveBeenCalledTimes(1);
    });

    it('never holds more than the bound, however many distinct keys arrive', () => {
        const cache = createClientCache(key => ({ key }));
        for (let i = 0; i < CLIENT_CACHE_MAX_ENTRIES * 5; i++) {
            cache.get(`user-key-${i}`);
        }
        expect(cache.size()).toBe(CLIENT_CACHE_MAX_ENTRIES);
    });

    it('evicts the least recently used key and keeps a hot one', () => {
        const build = vi.fn((key: string) => ({ key }));
        const cache = createClientCache(build, 2);
        const hot = cache.get('hot');
        cache.get('b');
        cache.get('hot'); // refresh
        cache.get('c'); // evicts b
        expect(cache.get('hot')).toBe(hot);
        expect(build).toHaveBeenCalledTimes(3);
        cache.get('b'); // rebuilt
        expect(build).toHaveBeenCalledTimes(4);
    });
});
