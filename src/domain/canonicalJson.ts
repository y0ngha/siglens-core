/**
 * Canonical JSON text of plain JSON data: object keys sorted recursively (UTF-16 code-unit
 * order), no whitespace, strings and finite numbers as `JSON.stringify` prints them, array
 * order kept.
 *
 * The same value always gives the same text whatever the key order it was built or parsed
 * in, so a hash of the text pairs data with a stored digest (`BacktestBenchmarks.tradesSha256`
 * is the SHA-256 of `canonicalJson(trades)`). The function is pure and does no hashing.
 *
 * Differences from `JSON.stringify`, all on purpose (a digest must never hide a value):
 * - It throws a `TypeError` instead of dropping or coercing: for a function, a symbol, a
 *   `bigint`, a top-level `undefined`, a non-finite number (`NaN`, `Infinity`; stringify
 *   prints `null`), any non-plain object (a `Date`, `Map`, `Set`, `RegExp`, class instance,
 *   or an object with a `toJSON` method: `toJSON` is never called) and a cycle.
 * - Keys are ordered by UTF-16 code unit, so `{ "10": 1, "2": 2 }` writes `"10"` before
 *   `"2"`; stringify puts integer-like keys first in numeric order.
 * - `-0` is written `0` (as stringify does), so two values equal under `===` share a text.
 * - An object property whose value is `undefined` is dropped; an `undefined` array element
 *   is written `null` (both as stringify does).
 *
 * @param value - Plain JSON data (objects, arrays, strings, finite numbers, booleans, `null`).
 * @returns The canonical JSON text.
 */
export function canonicalJson(value: unknown): string {
    return write(value, new Set());
}

const isPlainObject = (value: object): boolean => {
    const prototype: unknown = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
};

function write(value: unknown, ancestors: Set<object>): string {
    if (value === null) return 'null';
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) {
            throw new TypeError(
                `canonicalJson: ${value} is not a finite number`
            );
        }
        return JSON.stringify(value);
    }
    if (typeof value === 'string' || typeof value === 'boolean') {
        return JSON.stringify(value);
    }
    if (typeof value !== 'object') {
        throw new TypeError(
            `canonicalJson: a ${typeof value} has no JSON form`
        );
    }
    if (ancestors.has(value)) {
        throw new TypeError('canonicalJson: cycle');
    }
    if (!Array.isArray(value) && !isPlainObject(value)) {
        throw new TypeError(
            'canonicalJson: only plain objects and arrays have a canonical form'
        );
    }
    ancestors.add(value);
    const text = Array.isArray(value)
        ? // Array.from visits holes (as undefined), so a sparse array writes null like JSON.stringify.
          `[${Array.from(value, item => (item === undefined ? 'null' : write(item, ancestors))).join(',')}]`
        : `{${Object.entries(value)
              .filter(([, item]) => item !== undefined)
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(
                  ([key, item]) =>
                      `${JSON.stringify(key)}:${write(item, ancestors)}`
              )
              .join(',')}}`;
    ancestors.delete(value);
    return text;
}
