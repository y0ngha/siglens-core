import type {
    ActionRecommendation,
    ReconciledActionLineData,
    ValidatedActionPrices,
} from '@/domain/types';

export function validateActionPrices(
    rec: ActionRecommendation | undefined
): ValidatedActionPrices | undefined {
    if (!rec) return undefined;

    const entryPrices = (rec.entryPrices ?? []).filter(p => p > 0);
    const stopLoss =
        rec.stopLoss !== undefined && rec.stopLoss > 0
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
    const tpsToRender = reconciledTps.flatMap((reconciledTp, index) => {
        const aiTp = rec.takeProfitPrices?.[index];
        if (
            reconciledTp === undefined ||
            reconciledTp <= 0 ||
            reconciledTp === aiTp
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
