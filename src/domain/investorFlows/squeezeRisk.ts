import {
    RATIO_DECIMALS,
    SQUEEZE_CAPPED_LEVEL,
    SQUEEZE_COMPONENTS,
    SQUEEZE_LEVEL_CUTOFFS,
    SQUEEZE_MAX_BAR_AGE_DAYS,
    SQUEEZE_POSITIONING_COMPONENTS,
    SQUEEZE_PRICE_CHANGE_SESSIONS,
    SQUEEZE_SHORT_SIDE_COMPONENTS,
    SQUEEZE_VOLUME_BASELINE_SESSIONS,
    SQUEEZE_VOLUME_RECENT_SESSIONS,
} from '@/domain/investorFlows/constants';
import {
    daysBetween,
    formatDay,
    isFiniteNumber,
    parseAsOfDay,
    parseDay,
    roundValue,
} from '@/domain/investorFlows/scoreHelpers';
import {
    readFailsToDeliver,
    readShortPositioning,
} from '@/domain/investorFlows/shortReadings';
import type {
    EvaluateSqueezeRiskOptions,
    InvestorFlowsSnapshot,
    SqueezeRiskComponent,
    SqueezeRiskComponentId,
    SqueezeRiskContext,
    SqueezeRiskLevel,
    SqueezeRiskScore,
} from '@/domain/investorFlows/types';

/**
 * Every input, in the order `missing` lists them. The cast is safe:
 * `SQUEEZE_COMPONENTS` is a `Record<SqueezeRiskComponentId, …>`, so every key
 * is a component id; `Object.keys` only types them as `string`.
 */
const COMPONENT_IDS = Object.keys(
    SQUEEZE_COMPONENTS
) as SqueezeRiskComponentId[];

interface DatedBar {
    readonly day: number;
    readonly close: number;
    readonly volume: number;
}

type RawValues = Partial<Record<SqueezeRiskComponentId, number>>;

/**
 * Completed daily bars: valid, dated strictly before the reference day (a bar
 * of the reference day may still be forming), one per day (the last given
 * wins), oldest first. No bars at all without a usable reference day, or when
 * the newest completed bar is more than {@link SQUEEZE_MAX_BAR_AGE_DAYS} days
 * older than it (a stalled feed does not describe the current move).
 */
function completedBars(
    context: SqueezeRiskContext,
    asOfDay: number | null
): DatedBar[] {
    if (asOfDay === null) return [];
    // A Map keyed by day dedupes in one pass; the loop mutates only this local.
    const byDay = new Map<number, DatedBar>();
    for (const bar of context.dailyBars) {
        const day = parseDay(bar.date);
        if (
            day === null ||
            day >= asOfDay ||
            !isFiniteNumber(bar.close) ||
            bar.close <= 0 ||
            !isFiniteNumber(bar.volume) ||
            bar.volume < 0
        ) {
            continue;
        }
        byDay.set(day, { day, close: bar.close, volume: bar.volume });
    }
    const bars = [...byDay.values()].sort((a, b) => a.day - b.day);
    const newest = bars.at(-1);
    return newest !== undefined &&
        daysBetween(newest.day, asOfDay) <= SQUEEZE_MAX_BAR_AGE_DAYS
        ? bars
        : [];
}

function mean(values: readonly number[]): number {
    return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Close change over {@link SQUEEZE_PRICE_CHANGE_SESSIONS} sessions, percent. */
function priceChange(bars: readonly DatedBar[]): number | null {
    if (bars.length < SQUEEZE_PRICE_CHANGE_SESSIONS + 1) return null;
    const last = bars[bars.length - 1].close;
    const first = bars[bars.length - 1 - SQUEEZE_PRICE_CHANGE_SESSIONS].close;
    return roundValue((last / first - 1) * 100);
}

/** Recent sessions' average volume over the baseline sessions' average. */
function volumeRatio(bars: readonly DatedBar[]): number | null {
    const needed =
        SQUEEZE_VOLUME_RECENT_SESSIONS + SQUEEZE_VOLUME_BASELINE_SESSIONS;
    if (bars.length < needed) return null;
    const window = bars.slice(-needed).map(b => b.volume);
    const baseline = mean(window.slice(0, SQUEEZE_VOLUME_BASELINE_SESSIONS));
    const recent = mean(window.slice(SQUEEZE_VOLUME_BASELINE_SESSIONS));
    return baseline > 0 ? roundValue(recent / baseline) : null;
}

function normalize(id: SqueezeRiskComponentId, value: number): number {
    const { floor, cap } = SQUEEZE_COMPONENTS[id].scale;
    return Math.max(0, Math.min(1, (value - floor) / (cap - floor)));
}

function levelOf(score: number): SqueezeRiskLevel {
    if (score >= SQUEEZE_LEVEL_CUTOFFS.extreme) return 'extreme';
    if (score >= SQUEEZE_LEVEL_CUTOFFS.high) return 'high';
    if (score >= SQUEEZE_LEVEL_CUTOFFS.elevated) return 'elevated';
    return 'low';
}

const LEVEL_RANK: Readonly<Record<SqueezeRiskLevel, number>> = {
    low: 0,
    elevated: 1,
    high: 2,
    extreme: 3,
};

/**
 * Score how exposed a stock is to a short squeeze, 0..100.
 *
 * Eight inputs, each mapped onto 0..1 between a floor and a cap (see
 * `SQUEEZE_COMPONENTS`) and weighted: short interest % of float, days to
 * cover, the short-interest trend and the off-exchange short-volume z-score
 * (FINRA), recent fails to deliver as % of shares outstanding (SEC), days on a
 * Reg SHO threshold list (exchanges), and the 20-session price change and
 * 5-vs-20-session volume ratio computed here from `context.dailyBars`. The
 * FINRA inputs are read exactly as the short axis reads them (same freshness
 * gates and rounding).
 *
 * - **Completed bars only.** Bars dated on or after the reference day are
 *   ignored, so the same snapshot and bars always give the same score, even
 *   while the reference day's session is still trading. When the newest
 *   completed bar is more than `SQUEEZE_MAX_BAR_AGE_DAYS` days old, both price
 *   inputs are listed in `missing` and `lastBarDate` is `null`.
 * - **Missing inputs renormalize.** An input that is unavailable, stale or
 *   switched off (`includeFinraData`, `includeExchangeLists`) is listed in
 *   `missing` and the others' weights are scaled to sum to 1 (`partial`).
 * - **No short side, no score.** Without any short-side input (FINRA, FTD or
 *   threshold list) the score is `insufficient`: price and volume alone do not
 *   describe a squeeze.
 * - **No positioning, capped level.** Without a FINRA positioning input the
 *   level is held at `elevated` (`levelCapped`), because fails and a rally do
 *   not show how crowded the short side is.
 *
 * @param snapshot - The investor-flows snapshot.
 * @param context - Daily bars (close and volume).
 * @param options - Reference-date override and data switches.
 * @returns The score with its inputs, largest contribution first.
 */
export function evaluateSqueezeRisk(
    snapshot: InvestorFlowsSnapshot,
    context: SqueezeRiskContext,
    options: EvaluateSqueezeRiskOptions = {}
): SqueezeRiskScore {
    const asOfDay = parseAsOfDay(options.asOf ?? snapshot.asOf);
    const includeFinra = options.includeFinraData ?? true;
    const includeLists = options.includeExchangeLists ?? true;
    const positioning = readShortPositioning(
        includeFinra ? snapshot.shortInterest : null,
        includeFinra ? snapshot.shortVolume : null,
        snapshot.floatShares,
        asOfDay
    );
    const ftd = readFailsToDeliver(
        snapshot.failsToDeliver ?? null,
        snapshot.sharesOutstanding,
        asOfDay
    );
    const thresholdList = includeLists
        ? (snapshot.thresholdList ?? null)
        : null;
    const bars = completedBars(context, asOfDay);

    const raw: RawValues = {
        short_interest_pct_float: positioning.pctFloat ?? undefined,
        days_to_cover: positioning.dtc ?? undefined,
        short_interest_trend: positioning.trend?.changePct,
        off_exchange_short_ratio_z: positioning.volume?.z ?? undefined,
        fails_to_deliver_pct: ftd?.pctOutstanding ?? undefined,
        threshold_list_days:
            thresholdList === null
                ? undefined
                : thresholdList.listed
                  ? thresholdList.consecutiveDays
                  : 0,
        price_change_20d: priceChange(bars) ?? undefined,
        volume_ratio: volumeRatio(bars) ?? undefined,
    };
    const presentIds = COMPONENT_IDS.filter(id => raw[id] !== undefined);
    const missing = COMPONENT_IDS.filter(id => raw[id] === undefined);
    const has = (ids: readonly SqueezeRiskComponentId[]): boolean =>
        ids.some(id => raw[id] !== undefined);
    const base = {
        missing,
        includesFinra: has(SQUEEZE_POSITIONING_COMPONENTS),
        includesExchangeLists: raw.threshold_list_days !== undefined,
        asOf: asOfDay === null ? null : formatDay(asOfDay),
        lastBarDate:
            bars.length === 0 ? null : formatDay(bars[bars.length - 1].day),
    };

    if (!has(SQUEEZE_SHORT_SIDE_COMPONENTS)) {
        return {
            ...base,
            score: null,
            level: null,
            components: [],
            sufficiency: 'insufficient',
            levelCapped: false,
        };
    }

    const totalWeight = presentIds.reduce(
        (sum, id) => sum + SQUEEZE_COMPONENTS[id].weight,
        0
    );
    const components: SqueezeRiskComponent[] = presentIds
        .map(id => {
            // `presentIds` holds only ids whose value is defined.
            const value = raw[id]!;
            const normalized = normalize(id, value);
            const weight = SQUEEZE_COMPONENTS[id].weight / totalWeight;
            return {
                id,
                value,
                normalized: roundValue(normalized, RATIO_DECIMALS),
                weight: roundValue(weight, RATIO_DECIMALS),
                contribution: roundValue(normalized * weight * 100),
            };
        })
        .sort(
            (a, b) =>
                b.contribution - a.contribution || a.id.localeCompare(b.id)
        );
    // The score is the sum of the rounded contributions, so a reader adding up
    // the rendered contributions gets the rendered score (DOM-8).
    const score = roundValue(
        components.reduce((sum, c) => sum + c.contribution, 0)
    );
    const uncapped = levelOf(score);
    const levelCapped =
        !base.includesFinra &&
        LEVEL_RANK[uncapped] > LEVEL_RANK[SQUEEZE_CAPPED_LEVEL];
    return {
        ...base,
        score,
        level: levelCapped ? SQUEEZE_CAPPED_LEVEL : uncapped,
        components,
        sufficiency: missing.length === 0 ? 'full' : 'partial',
        levelCapped,
    };
}
