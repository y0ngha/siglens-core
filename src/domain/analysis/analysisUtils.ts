/** @internal Last element of the array, or null when the array is empty. */
export const lastOf = <T>(arr: T[]): T | null =>
    arr.length > 0 ? arr[arr.length - 1] : null;
