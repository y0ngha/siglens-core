import { describe, it, expect } from 'vitest';
import { extractJsonWithRepair } from '@/infrastructure/ai/extractJsonWithRepair';
import { normalizeJsonResponse } from '@/infrastructure/ai/normalizeJsonResponse';

// ─────────────────────────────────────────
// Characterization of the `jsonrepair` salvage path on LLM-shaped breakage.
//
// Both parsers fall back to `jsonrepair` only after `JSON.parse` fails, so the
// library's repair output *is* our business output on that path. Pinning a
// corpus here makes a `jsonrepair` upgrade show exactly which inputs change
// outcome instead of letting the change ride in silently.
//
// `THROWS` = the salvage attempt fails and the caller receives a SyntaxError
// (for the analysis pipeline that means a retryable parse failure).
// ─────────────────────────────────────────

const THROWS = Symbol('throws');

/**
 * `[name, input, expected]`, or `[name, input, extractExpected, normalizeExpected]`
 * where the two entry points legitimately differ: `extractJsonWithRepair` first
 * narrows to the outermost `{…}` pair (so a max-token cut drops the dangling
 * element), and `normalizeJsonResponse` round-trips through `JSON.stringify`
 * (so `-0` comes back as `0`).
 */
type Case =
    | readonly [name: string, input: string, expected: unknown]
    | readonly [
          name: string,
          input: string,
          extractExpected: unknown,
          normalizeExpected: unknown,
      ];

const CORPUS: readonly Case[] = [
    ['trailing comma', '{"a":1,"b":[1,2,],}', { a: 1, b: [1, 2] }],
    [
        'nested trailing comma followed by a sibling',
        '{"a":[1,2,],"b":3}',
        { a: [1, 2], b: 3 },
    ],
    [
        'nested object trailing comma',
        '{"a":{"x":1,},"b":{"y":2}}',
        { a: { x: 1 }, b: { y: 2 } },
    ],
    ['single quotes', "{'a':'b'}", { a: 'b' }],
    ['unquoted keys', '{a:1,b:"x"}', { a: 1, b: 'x' }],
    ['missing comma', '{"a":1 "b":2}', { a: 1, b: 2 }],
    [
        'truncated mid-array (max-token cut)',
        '{"summary":"abc","items":[{"x":1},{"x":',
        { summary: 'abc', items: [{ x: 1 }] },
        { summary: 'abc', items: [{ x: 1 }, { x: null }] },
    ],
    ['truncated mid-string', '{"summary":"abc de', { summary: 'abc de' }],
    [
        'unescaped inner quotes',
        '{"text":"He said "hi" to me"}',
        { text: 'He said "hi" to me' },
    ],
    ['line comment', '{"a":1 // note\n}', { a: 1 }],
    [
        'python constants',
        '{"a":None,"b":True,"c":False}',
        { a: null, b: true, c: false },
    ],
    ['number with trailing dot', '{"a": 1.}', { a: 1 }],
    // 3.14.1+: `.5` is completed to `0.5` (3.14.0 left the invalid `.5` in place).
    ['number with leading dot', '{"a": .5}', { a: 0.5 }],
    ['number with dangling exponent', '{"a": 2e}', { a: 2 }],
    ['number that is only a minus sign', '{"a": -}', { a: -0 }, { a: 0 }],
    // 3.14.1+: an unquoted value that merely starts with a keyword is quoted as a
    // string instead of failing on the keyword prefix.
    [
        'unquoted value starting with a keyword',
        '{"a": trueish}',
        { a: 'trueish' },
    ],
    [
        'unquoted value starting with null',
        '{"a": nullable value}',
        { a: 'nullable value' },
    ],
    ['unescaped quote before a paren', '{"a":"f("x")"}', THROWS],
    [
        'raw newline inside a string',
        '{"a":"line1\nline2"}',
        { a: 'line1\nline2' },
    ],
    [
        // 3.15.0: entity-encoded structural quotes are decoded (3.14 kept them as
        // literal key/value text). Entities *inside* a valid string stay put — below.
        'HTML-entity-encoded quotes',
        '{&quot;a&quot;:&quot;b&quot;}',
        { a: 'b' },
    ],
    [
        'entities inside a valid string value survive',
        '{"a":"S&amp;P 500" "b":1}',
        { a: 'S&amp;P 500', b: 1 },
    ],
    ['ellipsis in an array', '[1,2,...]', [1, 2]],
    [
        'unescaped quotes around a number in Korean prose',
        '{"reason":"지지선 "150" 부근","score":3}',
        THROWS,
    ],
    ['percent-suffixed number', '{"pct": 12.5%}', { pct: '12.5%' }],
    [
        'unquoted multi-word value',
        '{"trend": bullish momentum, "n":1}',
        { trend: 'bullish momentum', n: 1 },
    ],
    // 3.15.0 (#175): a stray backslash after a closed string now fails the repair
    // consistently. 3.14 either dropped it, overflowed the stack (array case —
    // already a SyntaxError for us, but after burning a deep recursion), or glued
    // it into the previous value (`"b\"\n"` — silently corrupted output). Failing
    // is the safe outcome: callers treat a SyntaxError as a retryable parse failure.
    ['backslash right after a closed string', '{"a":"b"\\}', THROWS],
    ['backslash after a string inside an array', '["a"\\,"b"]', THROWS],
    ['literal backslash-n after a closed string', '{"a":"b"\\n,"c":1}', THROWS],
];

describe('jsonrepair salvage — extractJsonWithRepair', () => {
    it.each(CORPUS)('%s', (_name, input, ...rest) => {
        const expected = rest[0];
        if (expected === THROWS) {
            expect(() => extractJsonWithRepair(input)).toThrow(SyntaxError);
        } else {
            expect(extractJsonWithRepair(input)).toEqual(expected);
        }
    });
});

describe('jsonrepair salvage — normalizeJsonResponse', () => {
    it.each(CORPUS)('%s', (_name, input, ...rest) => {
        const expected = rest.length === 2 ? rest[1] : rest[0];
        if (expected === THROWS) {
            expect(() => normalizeJsonResponse(input)).toThrow(SyntaxError);
        } else {
            expect(JSON.parse(normalizeJsonResponse(input))).toEqual(expected);
        }
    });
});
