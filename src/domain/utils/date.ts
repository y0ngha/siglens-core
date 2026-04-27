const MILLISECONDS_PER_SECOND = 1000;

/** @internal Pure date arithmetic utility for duration-based timestamp calculations. */
export function addSeconds(date: Date, seconds: number): Date {
    return new Date(date.getTime() + seconds * MILLISECONDS_PER_SECOND);
}
