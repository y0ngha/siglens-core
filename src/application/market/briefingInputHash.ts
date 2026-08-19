import type {
    MarketBriefingContext,
    MarketIndexData,
    MarketSectorData,
} from '@/domain/types';
import { hashAnalysisInput } from '@/infrastructure/hash/analysisInput';

/**
 * @internal
 * Derive a short deterministic hash of the index/sector values driving the
 * briefing prompt: identity + quote values (`price`, `changesPercentage`), plus
 * the `context` that shapes the prompt. Order-independent (sorted by
 * identifier), so the same data in a different array order yields the same hash.
 *
 * @param indices - Quoted market indices.
 * @param sectors - Quoted sector ETFs.
 * @param context - Market label + volatility reading; both change the prompt.
 * @returns 16-character lowercase hex string.
 */
export function hashBriefingInput(
    indices: readonly MarketIndexData[],
    sectors: readonly MarketSectorData[],
    context: MarketBriefingContext
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
        JSON.stringify({
            indices: sortedIndices,
            sectors: sortedSectors,
            // `context`도 프롬프트를 바꾸므로 키에 접는다.
            //
            // 시세만 해싱하면 **같은 시세에 다른 프롬프트**가 같은 키를 공유한다.
            // 소비자가 변동성 판독값을 여기 해싱되는 데이터 밖에서 가져오는 경우
            // (별도 quote 호출 등) `volatility`가 null↔값 사이를 오가도 해시가
            // 그대로라, 먼저 캐시를 채운 쪽의 변동성 블록 유무가 TTL 내내 유지된다.
            // `marketLabel`도 프롬프트 프레이밍에 들어가므로 같이 접는다.
            marketLabel: context.marketLabel,
            volatility: context.volatility
                ? {
                      label: context.volatility.label,
                      level: context.volatility.level,
                  }
                : null,
        })
    );
}
