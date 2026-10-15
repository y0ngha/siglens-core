import { MS_PER_DAY } from '@/domain/constants/time';
import type {
    InsiderTransaction,
    InstitutionalHolderChange,
    InstitutionalHolderChangeKind,
    InstitutionalQuarter,
    LargeHolderFiling,
    InvestorFlowsSnapshot,
    ShortInterestPoint,
    ShortVolumePoint,
} from '@/domain/types';

/** Reference date every investor-flows fixture is measured from. */
export const AS_OF = '2026-10-15';

const AS_OF_MS = Date.UTC(2026, 9, 15);

/** `yyyy-mm-dd` of the day that is `days` before {@link AS_OF}. */
export function daysBeforeAsOf(days: number): string {
    return new Date(AS_OF_MS - days * MS_PER_DAY).toISOString().slice(0, 10);
}

/** `yyyy-mm-dd` of `date` moved `days` earlier. */
export function shiftDay(date: string, days: number): string {
    return new Date(Date.parse(`${date}T00:00:00Z`) - days * MS_PER_DAY)
        .toISOString()
        .slice(0, 10);
}

/** The same short-volume series with every date moved `days` earlier (so the newest day is that old). */
export function ageShortVolume(
    points: readonly ShortVolumePoint[],
    days: number
): ShortVolumePoint[] {
    return points.map(p => ({ ...p, date: shiftDay(p.date, days) }));
}

/** The same short-interest series with every settlement moved `days` earlier. */
export function ageShortInterest(
    points: readonly ShortInterestPoint[],
    days: number
): ShortInterestPoint[] {
    return points.map(p => ({
        ...p,
        settlementDate: shiftDay(p.settlementDate, days),
    }));
}

/** A complete mid-cap-sized 13F quarter with no net movement (every signal below its threshold). */
export function quarter(
    overrides: Partial<InstitutionalQuarter> = {}
): InstitutionalQuarter {
    return {
        period: '2026-06-30',
        complete: true,
        holders: 1500,
        shares: 800_000_000,
        valueUsd: 120_000_000_000,
        newHolders: 100,
        increased: 600,
        decreased: 600,
        exited: 100,
        netShareChange: 0,
        ...overrides,
    };
}

/**
 * A quarter whose holder count moved by `pct` percent against a prior
 * quarter of 100,000 holders (new = pct x 1,000, nobody exited).
 */
export function quarterWithHolderChange(pct: number): InstitutionalQuarter {
    const prior = 100_000;
    const added = Math.round(pct * 1000);
    return quarter({
        holders: prior + added,
        newHolders: added,
        exited: 0,
        increased: 0,
        decreased: 0,
    });
}

/**
 * A quarter whose new/exited balance equals `balance` over 1,000 events, with
 * 15,000 holders so the holder-count change stays small.
 */
export function quarterWithNewExitedBalance(
    balance: number
): InstitutionalQuarter {
    const events = 1000;
    const newHolders = Math.round((events + balance * events) / 2);
    return quarter({
        holders: 15_000,
        newHolders,
        exited: events - newHolders,
    });
}

/** `n` top holders: `up` increased, `down` decreased, the rest unchanged. */
export function topHolders(
    n: number,
    up: number,
    down: number
): InstitutionalHolderChange[] {
    const kinds: InstitutionalHolderChangeKind[] = Array.from(
        { length: n },
        (_, i) =>
            i < up ? 'increased' : i < up + down ? 'decreased' : 'unchanged'
    );
    return kinds.map((change, i) => ({
        filerName: `Holder ${i + 1}`,
        cik: String(1000 + i),
        shares: 10_000_000 - i * 100_000,
        valueUsd: 1_500_000_000 - i * 10_000_000,
        prevShares: 9_000_000,
        change,
    }));
}

/** A Form 4 open-market transaction. */
export function insiderTx(
    overrides: Partial<InsiderTransaction> = {}
): InsiderTransaction {
    return {
        date: daysBeforeAsOf(10),
        filingDate: daysBeforeAsOf(8),
        name: 'Jane Roe',
        role: 'officer: Chief Financial Officer',
        type: 'buy',
        shares: 1000,
        price: 100,
        value: 100_000,
        sharesOwnedAfter: 50_000,
        url: 'https://www.sec.gov/Archives/example',
        ...overrides,
    };
}

/** A 13D/13G filing. */
export function largeHolderFiling(
    overrides: Partial<LargeHolderFiling> = {}
): LargeHolderFiling {
    return {
        filingDate: daysBeforeAsOf(10),
        filer: 'Activist Capital LP',
        form: 'SC 13D',
        percentOfClass: 6.1,
        shares: 30_000_000,
        url: 'https://www.sec.gov/Archives/example13d',
        ...overrides,
    };
}

/** A short-interest settlement. */
export function shortInterestPoint(
    overrides: Partial<ShortInterestPoint> = {}
): ShortInterestPoint {
    return {
        settlementDate: daysBeforeAsOf(10),
        shortQty: 5_000_000,
        avgDailyVolume: 5_000_000,
        daysToCover: 1,
        ...overrides,
    };
}

/**
 * Three settlements ending at `latest`, strictly monotonic from `first`, dated
 * 30/15/0 days before the last one (`daysBeforeAsOf(10)`).
 */
export function shortInterestSeries(
    first: number,
    latest: number,
    daysToCover: number | null = 1
): ShortInterestPoint[] {
    const middle = Math.round((first + latest) / 2);
    return [first, middle, latest].map((shortQty, i) =>
        shortInterestPoint({
            settlementDate: daysBeforeAsOf(40 - i * 15),
            shortQty,
            daysToCover,
        })
    );
}

/** Short-volume baseline ratio mean and half-spread used by {@link shortVolumeSeries}. */
export const BASELINE_RATIO_MEAN = 0.45;
const BASELINE_RATIO_HALF_SPREAD = 0.02;
const TOTAL_VOLUME = 1_000_000;

/** Sample standard deviation of a baseline of `n` alternating mean +/- half-spread values. */
export function baselineStandardDeviation(n: number): number {
    return BASELINE_RATIO_HALF_SPREAD * Math.sqrt(n / (n - 1));
}

/**
 * `baselineDays` trading days alternating mean +/- 0.02, followed by one
 * latest day whose ratio sits `z` standard deviations above the baseline mean.
 * `olderOutliers` extra days dated before the baseline carry an extreme ratio
 * so a test can prove the baseline stops at its window.
 */
export function shortVolumeSeries(
    z: number,
    baselineDays = 60,
    olderOutliers = 0
): ShortVolumePoint[] {
    const day = (offset: number): string => daysBeforeAsOf(offset);
    const point = (offset: number, ratio: number): ShortVolumePoint => ({
        date: day(offset),
        shortVolume: Math.round(ratio * TOTAL_VOLUME),
        totalVolume: TOTAL_VOLUME,
    });
    const outliers = Array.from({ length: olderOutliers }, (_, i) =>
        point(baselineDays + olderOutliers + 1 - i, 0.9)
    );
    const baseline = Array.from({ length: baselineDays }, (_, i) =>
        point(
            baselineDays - i,
            BASELINE_RATIO_MEAN +
                (i % 2 === 0 ? 1 : -1) * BASELINE_RATIO_HALF_SPREAD
        )
    );
    const latestRatio =
        BASELINE_RATIO_MEAN + z * baselineStandardDeviation(baselineDays);
    return [...outliers, ...baseline, point(0, latestRatio)];
}

/** A snapshot with every section empty or unavailable; tests override what they exercise. */
export function emptySnapshot(
    overrides: Partial<InvestorFlowsSnapshot> = {}
): InvestorFlowsSnapshot {
    return {
        asOf: AS_OF,
        sharesOutstanding: 1_000_000_000,
        floatShares: 900_000_000,
        institutional: { quarters: [], topHolders: [], topHoldersPeriod: null },
        insider: { transactions: [] },
        largeHolders: null,
        shortInterest: null,
        shortVolume: null,
        ...overrides,
    };
}
