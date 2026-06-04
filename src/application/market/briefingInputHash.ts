import type { MarketIndexData, MarketSectorData } from '@/domain/types';
import { hashAnalysisInput } from '@/infrastructure/hash/analysisInput';

/**
 * Derive a short deterministic hash of the index/sector values driving the
 * briefing prompt. Identity + quote values (`price`, `changesPercentage`) only —
 * the fields that change intra-hour. Order-independent (sorted by identifier).
 * Shared by submitBriefing (write key) and peekBriefingCache (read key) so both
 * resolve to the SAME cache entry.
 *
 * @param indices - Quoted market indices.
 * @param sectors - Quoted sector ETFs.
 * @returns 16-character lowercase hex string.
 */
export function hashBriefingInput(
    indices: readonly MarketIndexData[],
    sectors: readonly MarketSectorData[]
): string {
    const sortedIndices = indices
        .map(i => ({
            fmpSymbol: i.fmpSymbol,
            price: i.price,
            changesPercentage: i.changesPercentage,
        }))
        .toSorted((a, b) => a.fmpSymbol.localeCompare(b.fmpSymbol));
    const sortedSectors = sectors
        .map(s => ({
            symbol: s.symbol,
            price: s.price,
            changesPercentage: s.changesPercentage,
        }))
        .toSorted((a, b) => a.symbol.localeCompare(b.symbol));
    return hashAnalysisInput(
        JSON.stringify({ indices: sortedIndices, sectors: sortedSectors })
    );
}
