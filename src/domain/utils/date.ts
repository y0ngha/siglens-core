const MILLISECONDS_PER_SECOND = 1000;

/** @internal */
export function addSeconds(date: Date, seconds: number): Date {
    return new Date(date.getTime() + seconds * MILLISECONDS_PER_SECOND);
}
