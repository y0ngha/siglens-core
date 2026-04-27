const MILLISECONDS_PER_SECOND = 1000;

/** @internal Date arithmetic helper used by loginUser session expiry calculation. */
export function addSeconds(date: Date, seconds: number): Date {
    return new Date(date.getTime() + seconds * MILLISECONDS_PER_SECOND);
}
