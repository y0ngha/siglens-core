import type {
    ActionRecommendation,
    AnalysisResponse,
    CurrencyCode,
    KeyLevel,
    PriceScenario,
} from '@/domain/types';
import { roundToKrxTick, type KrxTickTable } from '@/domain/analysis/krxTick';

/** Rounds one price to the tick of `table`. */
type TickRounder = (price: number) => number;

const roundLevel =
    (round: TickRounder) =>
    <T extends { price: number }>(level: T): T => ({
        ...level,
        price: round(level.price),
    });

const roundScenario = (
    s: PriceScenario | null,
    round: TickRounder
): PriceScenario | null =>
    s === null ? null : { ...s, targets: s.targets.map(roundLevel(round)) };

const roundAll = (prices: readonly number[] | undefined, round: TickRounder) =>
    prices?.map(p => round(p));

function roundRecommendation(
    rec: ActionRecommendation,
    round: TickRounder
): ActionRecommendation {
    const { reconciledLevels: levels } = rec;
    return {
        ...rec,
        ...(rec.entryPrices !== undefined
            ? { entryPrices: rec.entryPrices.map(p => round(p)) }
            : {}),
        ...(rec.stopLoss !== undefined
            ? { stopLoss: round(rec.stopLoss) }
            : {}),
        ...(rec.takeProfitPrices !== undefined
            ? { takeProfitPrices: rec.takeProfitPrices.map(p => round(p)) }
            : {}),
        ...(levels !== undefined
            ? {
                  reconciledLevels: {
                      ...levels,
                      ...(levels.stopLoss !== undefined
                          ? { stopLoss: round(levels.stopLoss) }
                          : {}),
                      ...(levels.takeProfitPrices !== undefined
                          ? {
                                takeProfitPrices: roundAll(
                                    levels.takeProfitPrices,
                                    round
                                ),
                            }
                          : {}),
                  },
              }
            : {}),
    };
}

/**
 * @internal
 * The quoted prices of an analysis — key levels and POC, scenario targets,
 * pattern key prices, entry / stop / take-profit (AI and reconciled) —
 * rounded to the KRX tick (`krxTick` table) for a KRW listing, so what is cached and shown is
 * a price the market can quote (`240,300` stays, `205,325` → `205,500`). The
 * prompt already prints KRX prices at their tick (`formatQuotedPrice`); this
 * catches what the model computed itself and the measured pattern targets
 * post-processing appends. Rounding the model's entry / stop / take-profit
 * is normalization, like the rest of the response parsing — not the
 * reconciliation `reconciledLevels` documents as leaving them untouched; the
 * reconciliation's own ATR fallbacks are tick-rounded where they are made
 * (`reconcileBullishActionRecommendation`), so the plan check reads the same
 * levels the card shows. Any other currency is returned as is (same
 * reference), and rounding is idempotent, so running it before and after
 * post-processing is safe.
 *
 * Drawing coordinates (trendline points, pattern geometry, chart overlays)
 * are left exact: they place lines on the chart, and the consumer formats
 * any number it prints from them.
 */
export function roundAnalysisPrices<T extends AnalysisResponse>(
    response: T,
    currency: CurrencyCode = 'USD',
    krxTick: KrxTickTable = 'share'
): T {
    if (currency !== 'KRW') return response;
    const round: TickRounder = price => roundToKrxTick(price, krxTick);
    const roundKeyLevel = roundLevel(round);
    const { keyLevels, priceTargets, actionRecommendation } = response;
    return {
        ...response,
        keyLevels: {
            ...keyLevels,
            support: keyLevels.support.map(roundKeyLevel),
            resistance: keyLevels.resistance.map(roundKeyLevel),
            ...(keyLevels.poc !== undefined
                ? { poc: roundKeyLevel<KeyLevel>(keyLevels.poc) }
                : {}),
        },
        priceTargets: {
            bullish: roundScenario(priceTargets.bullish, round),
            bearish: roundScenario(priceTargets.bearish, round),
        },
        patternSummaries: response.patternSummaries.map(p =>
            p.keyPrices === undefined
                ? p
                : { ...p, keyPrices: p.keyPrices.map(roundKeyLevel) }
        ),
        ...(actionRecommendation !== undefined
            ? {
                  actionRecommendation: roundRecommendation(
                      actionRecommendation,
                      round
                  ),
              }
            : {}),
    };
}
