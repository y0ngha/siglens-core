import type {
    ActionRecommendation,
    AnalysisResponse,
    CurrencyCode,
    KeyLevel,
    PriceScenario,
} from '@/domain/types';
import { roundToKrxTick } from '@/domain/analysis/krxTick';

const roundLevel = <T extends { price: number }>(level: T): T => ({
    ...level,
    price: roundToKrxTick(level.price),
});

const roundScenario = (s: PriceScenario | null): PriceScenario | null =>
    s === null ? null : { ...s, targets: s.targets.map(roundLevel) };

const roundAll = (prices: readonly number[] | undefined) =>
    prices?.map(roundToKrxTick);

function roundRecommendation(rec: ActionRecommendation): ActionRecommendation {
    const { reconciledLevels: levels } = rec;
    return {
        ...rec,
        ...(rec.entryPrices !== undefined
            ? { entryPrices: rec.entryPrices.map(roundToKrxTick) }
            : {}),
        ...(rec.stopLoss !== undefined
            ? { stopLoss: roundToKrxTick(rec.stopLoss) }
            : {}),
        ...(rec.takeProfitPrices !== undefined
            ? { takeProfitPrices: rec.takeProfitPrices.map(roundToKrxTick) }
            : {}),
        ...(levels !== undefined
            ? {
                  reconciledLevels: {
                      ...levels,
                      ...(levels.stopLoss !== undefined
                          ? { stopLoss: roundToKrxTick(levels.stopLoss) }
                          : {}),
                      ...(levels.takeProfitPrices !== undefined
                          ? {
                                takeProfitPrices: roundAll(
                                    levels.takeProfitPrices
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
 * rounded to the KRX tick for a KRW listing, so what is cached and shown is
 * a price the market can quote (`240,300` stays, `205,325` → `205,500`). The
 * prompt already prints KRX prices at their tick (`formatPriceAtDp`); this
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
    currency: CurrencyCode = 'USD'
): T {
    if (currency !== 'KRW') return response;
    const { keyLevels, priceTargets, actionRecommendation } = response;
    return {
        ...response,
        keyLevels: {
            ...keyLevels,
            support: keyLevels.support.map(roundLevel),
            resistance: keyLevels.resistance.map(roundLevel),
            ...(keyLevels.poc !== undefined
                ? { poc: roundLevel<KeyLevel>(keyLevels.poc) }
                : {}),
        },
        priceTargets: {
            bullish: roundScenario(priceTargets.bullish),
            bearish: roundScenario(priceTargets.bearish),
        },
        patternSummaries: response.patternSummaries.map(p =>
            p.keyPrices === undefined
                ? p
                : { ...p, keyPrices: p.keyPrices.map(roundLevel) }
        ),
        ...(actionRecommendation !== undefined
            ? {
                  actionRecommendation:
                      roundRecommendation(actionRecommendation),
              }
            : {}),
    };
}
