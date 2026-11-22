import { describe, expect, it } from 'vitest';
import { canonicalJson } from '@/domain/canonicalJson';

describe('canonicalJson', () => {
    it('sorts object keys at every depth and writes no whitespace', () => {
        expect(
            canonicalJson({ b: 1, a: { d: [3, { z: 1, x: null }], c: 'x' } })
        ).toBe('{"a":{"c":"x","d":[3,{"x":null,"z":1}]},"b":1}');
    });

    it('gives the same text whatever the key order', () => {
        const left = { a: 1, b: { c: 2, d: [1, { e: 1, f: 2 }] } };
        const right = { b: { d: [1, { f: 2, e: 1 }], c: 2 }, a: 1 };
        expect(canonicalJson(left)).toBe(canonicalJson(right));
    });

    it('keeps array order, so a different order is a different text', () => {
        expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
    });

    it('drops undefined properties and writes an undefined array element as null', () => {
        expect(canonicalJson({ a: undefined, b: 1 })).toBe('{"b":1}');
        expect(canonicalJson([undefined, 1])).toBe('[null,1]');
    });

    it('writes a hole in a sparse array as null, like JSON.stringify', () => {
        const sparse = [, 1];
        expect(canonicalJson(sparse)).toBe('[null,1]');
        expect(canonicalJson(sparse)).toBe(JSON.stringify(sparse));
    });

    it('writes primitives as JSON does, including negative zero as 0 and escapes', () => {
        expect(canonicalJson(null)).toBe('null');
        expect(canonicalJson(true)).toBe('true');
        expect(canonicalJson(-0)).toBe('0');
        expect(canonicalJson(1.5e-7)).toBe('1.5e-7');
        expect(canonicalJson('a"b\n')).toBe('"a\\"b\\n"');
        expect(canonicalJson({ 'k"': 1 })).toBe('{"k\\"":1}');
    });

    it('orders keys by UTF-16 code unit, not by locale', () => {
        expect(canonicalJson({ b: 1, B: 2, a: 3, '10': 4, '2': 5 })).toBe(
            '{"10":4,"2":5,"B":2,"a":3,"b":1}'
        );
    });

    it('rejects a non-finite number anywhere', () => {
        expect(() => canonicalJson(Number.NaN)).toThrow(TypeError);
        expect(() => canonicalJson({ a: [Infinity] })).toThrow('not a finite');
        expect(() => canonicalJson({ a: { b: -Infinity } })).toThrow(TypeError);
    });

    it('rejects values with no JSON form', () => {
        expect(() => canonicalJson(undefined)).toThrow(TypeError);
        expect(() => canonicalJson(10n)).toThrow(TypeError);
        expect(() => canonicalJson(() => 1)).toThrow(TypeError);
        expect(() => canonicalJson({ a: Symbol('x') })).toThrow(TypeError);
    });

    it('equals JSON.stringify of a pre-sorted copy for plain data', () => {
        const unsorted = {
            z: [1, { b: 2, a: 1 }],
            a: { y: true, x: 'v' },
            m: 0.1,
        };
        const sorted = {
            a: { x: 'v', y: true },
            m: 0.1,
            z: [1, { a: 1, b: 2 }],
        };
        expect(canonicalJson(unsorted)).toBe(JSON.stringify(sorted));
        expect(canonicalJson(unsorted)).not.toBe(JSON.stringify(unsorted));
    });

    it('rejects every non-plain object instead of coercing it', () => {
        const rejected: readonly unknown[] = [
            new Date(0),
            new Map([[1, 2]]),
            new Set([1]),
            /x/,
            new (class Point {
                x = 1;
            })(),
            { toJSON: () => ({ a: 1 }) },
            Object.create({ inherited: 1 }),
            { nested: [new Date(0)] },
        ];
        rejected.forEach(value => {
            expect(() => canonicalJson(value)).toThrow(TypeError);
        });
    });

    it('never calls toJSON', () => {
        let calls = 0;
        const withToJson = {
            toJSON: () => {
                calls += 1;
                return 1;
            },
        };
        expect(() => canonicalJson(withToJson)).toThrow(TypeError);
        expect(calls).toBe(0);
    });

    it('accepts an object with a null prototype', () => {
        const bare = Object.assign(Object.create(null), { b: 1, a: 2 });
        expect(canonicalJson(bare)).toBe('{"a":2,"b":1}');
    });

    it('rejects a cycle but not a value shared twice', () => {
        const loop: { self?: unknown } = {};
        loop.self = loop;
        expect(() => canonicalJson(loop)).toThrow('cycle');
        const ring: unknown[] = [];
        ring.push({ ring });
        expect(() => canonicalJson(ring)).toThrow('cycle');
        const shared = { v: 1 };
        expect(canonicalJson({ a: shared, b: [shared, shared] })).toBe(
            '{"a":{"v":1},"b":[{"v":1},{"v":1}]}'
        );
    });
});
