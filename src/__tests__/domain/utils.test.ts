import { describe, it, expect } from 'vitest';
import { parseNumberEnv, stripMarkdownCodeBlock } from '@/domain/utils';

describe('parseNumberEnv', () => {
    it('returns defaultValue when raw is undefined', () => {
        expect(parseNumberEnv(undefined, 42)).toBe(42);
    });

    it('returns defaultValue when raw is empty string', () => {
        expect(parseNumberEnv('', 42)).toBe(42);
    });

    it('parses valid float', () => {
        expect(parseNumberEnv('3.14', 0)).toBe(3.14);
    });

    it('parses valid integer', () => {
        expect(parseNumberEnv('100', 0)).toBe(100);
    });

    it('returns defaultValue for non-numeric string', () => {
        expect(parseNumberEnv('not-a-number', 99)).toBe(99);
    });

    it('returns defaultValue for NaN string', () => {
        expect(parseNumberEnv('NaN', 5)).toBe(5);
    });

    it('returns defaultValue for Infinity', () => {
        expect(parseNumberEnv('Infinity', 5)).toBe(5);
    });
});

describe('stripMarkdownCodeBlock', () => {
    it('strips ```json code block', () => {
        const input = '```json\n{"key": "value"}\n```';
        expect(stripMarkdownCodeBlock(input)).toBe('{"key": "value"}');
    });

    it('strips plain ``` code block', () => {
        const input = '```\n{"key": "value"}\n```';
        expect(stripMarkdownCodeBlock(input)).toBe('{"key": "value"}');
    });

    it('returns trimmed text as-is when no code block', () => {
        const input = '  {"key": "value"}  ';
        expect(stripMarkdownCodeBlock(input)).toBe('{"key": "value"}');
    });

    it('trims the extracted content', () => {
        const input = '```json\n  {"key": "value"}  \n```';
        expect(stripMarkdownCodeBlock(input)).toBe('{"key": "value"}');
    });
});
