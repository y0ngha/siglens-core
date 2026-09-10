import { describe, it, expect } from 'vitest';
import {
    buildOptionsCacheKey,
    CACHE_KEY_SCHEMA_VERSION,
    OPTIONS_PROMPT_TEMPLATE_VERSION,
} from '@/infrastructure/cache/config';

describe('buildOptionsCacheKey', () => {
    const base = buildOptionsCacheKey('AAPL', '2026-05-22', 'm', 'h1');

    it('builds a deterministic key with every input segment', () => {
        const key = buildOptionsCacheKey(
            'AAPL',
            '2026-05-22',
            'claude-haiku',
            'abc123'
        );
        expect(key).toBe(
            `${CACHE_KEY_SCHEMA_VERSION}:analysis:options:AAPL:2026-05-22:claude-haiku:${OPTIONS_PROMPT_TEMPLATE_VERSION}:abc123`
        );
    });

    it('carries the OPTIONS_PROMPT_TEMPLATE_VERSION segment immediately after the modelId', () => {
        const key = buildOptionsCacheKey(
            'AAPL',
            '2026-05-22',
            'claude-haiku',
            'abc123'
        );
        const segments = key.split(':');
        const modelIdIndex = segments.indexOf('claude-haiku');
        expect(segments[modelIdIndex + 1]).toBe(
            OPTIONS_PROMPT_TEMPLATE_VERSION
        );
    });

    it('differs when the symbol changes', () => {
        expect(buildOptionsCacheKey('TSLA', '2026-05-22', 'm', 'h1')).not.toBe(
            base
        );
    });

    it('differs when the expirationDate changes', () => {
        expect(buildOptionsCacheKey('AAPL', '2026-06-19', 'm', 'h1')).not.toBe(
            base
        );
    });

    it('differs when the modelId changes', () => {
        expect(buildOptionsCacheKey('AAPL', '2026-05-22', 'm2', 'h1')).not.toBe(
            base
        );
    });

    it('differs when the snapshotInputHash changes', () => {
        expect(buildOptionsCacheKey('AAPL', '2026-05-22', 'm', 'h2')).not.toBe(
            base
        );
    });

    it('accepts the "all" expirationDate sentinel for aggregate analysis', () => {
        const key = buildOptionsCacheKey('AAPL', 'all', 'm', 'h1');
        expect(key).toBe(
            `${CACHE_KEY_SCHEMA_VERSION}:analysis:options:AAPL:all:m:${OPTIONS_PROMPT_TEMPLATE_VERSION}:h1`
        );
    });
});
