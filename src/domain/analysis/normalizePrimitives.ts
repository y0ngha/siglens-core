/** @internal Coerces an unknown value to a string with a fallback. */
export function asString(v: unknown, fallback = ''): string {
    return typeof v === 'string' ? v : fallback;
}

/** @internal Coerces an unknown value to a finite number or undefined. */
export function asNumber(v: unknown): number | undefined {
    return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/** @internal Coerces an unknown value to a boolean with a fallback. */
export function asBoolean(v: unknown, fallback = false): boolean {
    return typeof v === 'boolean' ? v : fallback;
}

/** @internal Coerces an unknown value to a valid enum member or fallback. */
export function asEnum<T extends string>(
    v: unknown,
    valid: readonly T[],
    fallback: T
): T {
    return valid.find(x => x === v) ?? fallback;
}

/** @internal Coerces an unknown value to a valid enum member or undefined. */
export function asOptionalEnum<T extends string>(
    v: unknown,
    valid: readonly T[]
): T | undefined {
    return valid.find(x => x === v);
}

/** @internal Coerces an unknown value to a plain object record or null. */
export function asObject(v: unknown): Record<string, unknown> | null {
    if (v === null || typeof v !== 'object' || Array.isArray(v)) return null;
    // 바로 위 가드에서 null, 비객체, 배열을 모두 걸러내 Record 구조임을 확정했다.
    return v as Record<string, unknown>;
}

/** @internal Coerces an unknown value to an array. */
export function asArray(v: unknown): unknown[] {
    return Array.isArray(v) ? v : [];
}

/** @internal Drops null entries from an array. */
export function compact<T>(xs: (T | null)[]): T[] {
    return xs.filter((x): x is T => x !== null);
}

const ISO_DATE_RE =
    /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/;

/**
 * @internal Validate an ISO 8601 date or datetime string. Returns the input
 * string when valid (canonical form unchanged) or null otherwise.
 */
export function asIsoDate(v: unknown): string | null {
    if (typeof v !== 'string') return null;
    if (!ISO_DATE_RE.test(v)) return null;
    const t = Date.parse(v);
    if (Number.isNaN(t)) return null;
    return v;
}
