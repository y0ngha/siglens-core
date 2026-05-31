/** @internal Last element of the array, or null when the array is empty. */
export const lastOf = <T>(arr: T[]): T | null =>
    arr.length > 0 ? arr[arr.length - 1] : null;

/** @internal A price usable for level math: finite and strictly positive. */
export const isUsablePrice = (price: number): boolean =>
    Number.isFinite(price) && price > 0;
