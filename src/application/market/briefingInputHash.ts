import type { MarketIndexData, MarketSectorData } from '@/domain/types';
import { hashAnalysisInput } from '@/infrastructure/hash/analysisInput';

/**
 * @internal
 * Derive a short deterministic hash of the index/sector values driving the
 * briefing prompt. Identity + quote values (`price`, `changesPercentage`) only —
 * the fields that change intra-hour. Order-independent (sorted by identifier),
 * so the same data in a different array order yields the same hash.
 *
 * @param indices - Quoted market indices.
 * @param sectors - Quoted sector ETFs.
 * @returns 16-character lowercase hex string.
 */
export function hashBriefingInput(
    indices: readonly MarketIndexData[],
    sectors: readonly MarketSectorData[]
): string {
    // Pin the locale: a locale-free `localeCompare` is environment-dependent and
    // would produce a different sort order — and therefore a different hash — per
    // server (e.g. LANG=ko_KR vs en_US), making the write key and the read key
    // diverge so the peek would always miss.
    const sortedIndices = indices
        .map(i => ({
            fmpSymbol: i.fmpSymbol,
            price: i.price,
            changesPercentage: i.changesPercentage,
        }))
        .toSorted((a, b) => a.fmpSymbol.localeCompare(b.fmpSymbol, 'en'));
    const sortedSectors = sectors
        .map(s => ({
            symbol: s.symbol,
            price: s.price,
            changesPercentage: s.changesPercentage,
        }))
        .toSorted((a, b) => a.symbol.localeCompare(b.symbol, 'en'));
    return hashAnalysisInput(
        JSON.stringify({ indices: sortedIndices, sectors: sortedSectors })
    );
}
