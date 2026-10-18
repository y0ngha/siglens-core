/**
 * KRX tick sizes (호가가격단위) for KOSPI and KOSDAQ shares, in force since the
 * 2023-01-25 revision: `[below, tick]` — a price under `below` (and at or
 * above the previous band's `below`) quotes in steps of `tick` won.
 *
 * | price (KRW)          | tick  |
 * |----------------------|-------|
 * | < 2,000              | 1     |
 * | 2,000 – < 5,000      | 5     |
 * | 5,000 – < 20,000     | 10    |
 * | 20,000 – < 50,000    | 50    |
 * | 50,000 – < 200,000   | 100   |
 * | 200,000 – < 500,000  | 500   |
 * | ≥ 500,000            | 1,000 |
 *
 * Every band edge is a multiple of the next band's tick, so a price rounded
 * up across an edge still lands on a valid tick.
 */
const KRX_TICK_BANDS: ReadonlyArray<readonly [below: number, tick: number]> = [
    [2_000, 1],
    [5_000, 5],
    [20_000, 10],
    [50_000, 50],
    [200_000, 100],
    [500_000, 500],
    [Number.POSITIVE_INFINITY, 1_000],
];

/**
 * The KRX tick size for a share priced at `price` won (see
 * {@link KRX_TICK_BANDS}).
 */
export function krxTickSize(price: number): number {
    const band = KRX_TICK_BANDS.find(([below]) => price < below);
    // The last band is open-ended, so only NaN falls through.
    return band?.[1] ?? 1;
}

/**
 * `price` rounded to the nearest KRX tick (half up), so a computed level —
 * a Camarilla pivot at 205,325, a Keltner band at 224,565 — reads as a price
 * the market can actually quote (205,500 / 224,500). A non-finite or
 * non-positive value is returned unchanged: it is not a price to round.
 */
export function roundToKrxTick(price: number): number {
    if (!Number.isFinite(price) || price <= 0) return price;
    const tick = krxTickSize(price);
    return Math.round(price / tick) * tick;
}
