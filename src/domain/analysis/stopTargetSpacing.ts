import {
    SL_FALLBACK_ATR_MULTIPLIER,
    SL_MAX_ATR_MULTIPLIER,
} from '@/domain/analysis/ai-levels';
import { printedLevelsOnSide } from '@/domain/analysis/printedReferenceLevels';
import { PLAN_MIN_ATR_SPACING } from '@/domain/analysis/planCheck';
import {
    AT_PRICE_BAR_RANGE_FRACTION,
    meanBarRangePercent,
} from '@/domain/analysis/referenceLevels';
import {
    differenceDecimalPlaces,
    formatNullableNumber,
    formatQuotedPrice,
    type PriceQuoting,
} from '@/domain/analysis/promptFormat';
import { ATR_DEFAULT_PERIOD } from '@/domain/indicators/constants';
import { calculateATR } from '@/domain/indicators/atr';
import type {
    Bar,
    MarketReference,
    ReferenceLevel,
    Timeframe,
} from '@/domain/types';

/**
 * Stop and first-target spacing, rendered into `## Deterministic Metrics`.
 *
 * **Why it exists.** A two-year daily backtest of this prompt (10 U.S. large caps, one
 * analysis per session, 1,107 `wait` plans) found the plan's stop sitting a median 0.52
 * ATR(14) below the entry zone's low — inside half of one ordinary session's range. Of the
 * 278 trades whose first exit was that stop, 87% hit it within two sessions, and 63% then
 * reached the plan's original first target within 20 sessions: the stop measured bar noise,
 * not invalidation. The first take-profit had the mirror-image habit — the nearest
 * resistance, a median 0.78 ATR above the entry zone's high and at the zone itself in the
 * bottom decile.
 *
 * **Why code computes the candidates.** Asked to keep a stop "beyond bar noise", the model
 * picked the nearest support anyway; the distance in ATR is arithmetic it does not do.
 * The block prints the ATR in price terms and the first level on each side that clears one
 * ATR from two anchors (the close, for an entry at the price; the nearest support, for a
 * pullback entry). Every printed price is a reference level already in the data, so the
 * "prices only from data" rule still holds — no derived price is ever printed.
 *
 * **What code does with it.** Reconciliation enforces the same one-ATR floor on the stop
 * (`ai-levels.ts`), snapping to the highest printed support in the allowed band from
 * {@link printedSupportLevels}, so the block and the enforcement read one list. The first
 * target is never moved: no target one ATR above the zone makes the plan `no_setup`.
 */

/** Stop candidates printed per anchor — enough for a choice, few enough to stay readable. */
const STOP_CANDIDATE_LIMIT = 2;

const SPACING_HEADER = '### Stop & Target Spacing';

/**
 * @internal
 * The support levels the prompt prints beyond the at-price band, nearest first, one per
 * quoted price. The stop candidates of `### Stop & Target Spacing` and the stop-floor
 * candidates reconciliation snaps to are both read from this list, so a `level` stop is
 * always a price the model was shown (DOM-8).
 */
export function printedSupportLevels(
    reference: MarketReference,
    quoting: PriceQuoting
): ReferenceLevel[] {
    return printedLevelsOnSide(reference, 'support', quoting);
}

/**
 * @internal
 * The resistance levels the prompt prints beyond the at-price band, nearest first, one per
 * quoted price (the first-target candidates of `### Stop & Target Spacing`).
 */
export function printedResistanceLevels(
    reference: MarketReference,
    quoting: PriceQuoting
): ReferenceLevel[] {
    return printedLevelsOnSide(reference, 'resistance', quoting);
}

function formatLevel(level: ReferenceLevel, quoting: PriceQuoting): string {
    return `${level.label} at ${formatQuotedPrice(level.price, quoting)}`;
}

function formatList(
    levels: readonly ReferenceLevel[],
    quoting: PriceQuoting
): string {
    return levels.map(l => formatLevel(l, quoting)).join(', ');
}

const NO_STOP_LEVEL = `none — no support level in the data lies that far below. Do not compute a stop price yourself: set stopLoss to the lowest support printed below the zone, name it in exit as the stop and say there that no support lies one ATR below the zone; code replaces it with a stop ${SL_FALLBACK_ATR_MULTIPLIER}×ATR below the zone low (no lower than ${SL_MAX_ATR_MULTIPLIER}×ATR below the zone middle, and no stop at all when the zone is too wide for any stop to fit)`;
const NO_TARGET_LEVEL =
    'none — no resistance level in the data lies that far above; a plan with no target that far above its zone is read as no setup, so say in exit that the first target has no level beyond one ATR instead of using a closer one';

/**
 * @internal
 *
 * Render the spacing block, or an explicit "not measurable" block when ATR cannot be
 * computed. Never vanishes silently: Step 2 of the action rules points at this block.
 */
export function formatStopTargetSpacing(
    reference: MarketReference,
    bars: readonly Bar[],
    timeframe: Timeframe,
    quoting: PriceQuoting
): string[] {
    const atr = calculateATR(bars, ATR_DEFAULT_PERIOD).at(-1) ?? null;
    const close = bars.at(-1)?.close;
    if (atr === null || !(atr > 0) || close === undefined || !(close > 0)) {
        return [
            SPACING_HEADER,
            `Not measurable: ATR(${ATR_DEFAULT_PERIOD}) needs more than ${ATR_DEFAULT_PERIOD} bars and received ${bars.length}. Keep the stop below a support that lies clearly beyond the entry zone and the first target beyond the nearest resistance; do not anchor either on an at-price level. Code cannot check the spacing without an ATR.`,
        ];
    }

    const supports = printedSupportLevels(reference, quoting);
    const resistances = printedResistanceLevels(reference, quoting);
    const gap = atr * PLAN_MIN_ATR_SPACING;
    const atrText = formatNullableNumber(
        atr,
        differenceDecimalPlaces(atr, quoting.dp)
    );
    const atrPercent = formatNullableNumber((atr / close) * 100, 2);
    // The noise band the printed lists skip (`atPrice` levels): said here, where the lists
    // are, so a stop or an entry trigger is not anchored on a level inside one bar's noise.
    const noiseFloorPercent =
        meanBarRangePercent(bars) * AT_PRICE_BAR_RANGE_FRACTION;
    const noiseNote =
        noiseFloorPercent > 0
            ? [
                  `Levels within ${formatNullableNumber(noiseFloorPercent)}% of the current price (half the mean bar range over the last ${ATR_DEFAULT_PERIOD} bars) sit inside ordinary bar noise and are skipped in the lists below. Do not anchor a stop-loss or an entry trigger on such an at-price level.`,
              ]
            : [];

    const stopsBelow = (anchor: number): string => {
        const found = supports
            .filter(s => s.price <= anchor - gap)
            .slice(0, STOP_CANDIDATE_LIMIT);
        return found.length > 0 ? formatList(found, quoting) : NO_STOP_LEVEL;
    };
    const targetAbove = (anchor: number): string => {
        const found = resistances.find(r => r.price >= anchor + gap);
        return found ? formatLevel(found, quoting) : NO_TARGET_LEVEL;
    };

    const nearestSupport = supports[0];
    const pullbackLines = nearestSupport
        ? [
              `- Entry zone at the nearest support (${formatLevel(nearestSupport, quoting)}): stop candidates ${stopsBelow(nearestSupport.price)}; first target from ${targetAbove(nearestSupport.price)} upward.`,
          ]
        : [];

    const measured =
        timeframe === '1Day'
            ? [
                  'Measured in a two-year daily backtest of this prompt (10 U.S. large caps, 278 trades whose first exit was the stop): with the stop a median 0.52 ATR below the entry zone, 87% of those stops were hit within two sessions and 63% of those trades then reached their original first target within 20 sessions.',
              ]
            : [];

    return [
        SPACING_HEADER,
        `ATR(${ATR_DEFAULT_PERIOD}) = ${atrText} (${atrPercent}% of the last close): one ordinary bar's range. The stop must sit at least ${PLAN_MIN_ATR_SPACING}×ATR below the low of entryPrices (code moves a closer stop), and the first take-profit at least ${PLAN_MIN_ATR_SPACING}×ATR above its high; a level closer than that is skipped, not used.`,
        ...noiseNote,
        'First levels clearing one ATR (all are reference levels from the data):',
        `- Entry zone at the current price: stop candidates ${stopsBelow(close)}; first target from ${targetAbove(close)} upward.`,
        ...pullbackLines,
        ...measured,
    ];
}
