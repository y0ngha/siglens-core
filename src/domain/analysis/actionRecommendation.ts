import type {
    ActionRecommendation,
    ReconciledActionLineData,
    ValidatedActionPrices,
} from '@/domain/types';

/**
 * The model's entry, stop and target prices with every non-positive value dropped, for
 * drawing the plan's lines; `undefined` when no price is left.
 *
 * When core refused the model's stop (`reconciledLevels.stopLossRejected === true`) the plan
 * has no stop, so `stopLoss` is `undefined` even though `rec.stopLoss` still holds the
 * refused value: a chart must not draw it. A plan whose only price was that stop returns
 * `undefined`. Entry and target prices are unaffected.
 *
 * @param rec - The analysis' action recommendation, if any.
 * @returns The usable prices, or `undefined` when there is nothing to draw.
 */
export function validateActionPrices(
    rec: ActionRecommendation | undefined
): ValidatedActionPrices | undefined {
    if (!rec) return undefined;

    const entryPrices = (rec.entryPrices ?? []).filter(p => p > 0);
    const stopLoss =
        rec.reconciledLevels?.stopLossRejected !== true &&
        rec.stopLoss !== undefined &&
        rec.stopLoss > 0
            ? rec.stopLoss
            : undefined;
    const takeProfitPrices = (rec.takeProfitPrices ?? []).filter(p => p > 0);

    if (
        entryPrices.length === 0 &&
        stopLoss === undefined &&
        takeProfitPrices.length === 0
    ) {
        return undefined;
    }

    return { entryPrices, stopLoss, takeProfitPrices };
}

// Returns only reconciled values that differ from AI originals — avoids duplicate chart overlay lines.
export function extractReconciledActionLines(
    rec: ActionRecommendation | undefined
): ReconciledActionLineData | undefined {
    const reconciled = rec?.reconciledLevels;
    if (!rec || !reconciled) return undefined;

    const aiSl = rec.stopLoss;
    const reconciledSl = reconciled.stopLoss;
    const slToRender =
        reconciledSl !== undefined && reconciledSl > 0 && reconciledSl !== aiSl
            ? reconciledSl
            : undefined;

    const reconciledTps = reconciled.takeProfitPrices ?? [];
    const totalCount = reconciledTps.length;
    const aiTps = rec.takeProfitPrices ?? [];
    const tpsToRender = reconciledTps.flatMap((reconciledTp, index) => {
        // Compared by value, not by index: reconciliation drops targets, so a kept
        // AI target can sit at a lower index than in the AI array and must not be
        // drawn a second time as a "reconciled" line.
        if (
            reconciledTp === undefined ||
            reconciledTp <= 0 ||
            aiTps.includes(reconciledTp)
        ) {
            return [];
        }
        return [{ index, price: reconciledTp, totalCount }];
    });

    if (slToRender === undefined && tpsToRender.length === 0) return undefined;

    return {
        stopLoss: slToRender,
        takeProfitPrices: tpsToRender,
    };
}
