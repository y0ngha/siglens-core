/**
 * @internal Plain decimal text of a finite number, exactly as the value reads:
 * trailing zeros trimmed (they are not stored), an ASCII minus, no grouping.
 *
 * `String(value)` switches to exponent form below `1e-6` and from `1e21`, which a
 * model cannot line up with the figures printed next to it, so those fall back to
 * a locale formatter with grouping off. A value that is `-0` prints `0`.
 */
export function formatPlainNumber(value: number): string {
    const text = String(value);
    if (!/e/i.test(text)) return text;
    return value.toLocaleString('en-US', {
        useGrouping: false,
        maximumFractionDigits: 20,
    });
}
