import type {
    MarketBriefingContext,
    MarketIndexData,
    MarketSectorData,
} from '@/domain/types';
import {
    BRIEFING_INDEX_CHANGE_BUCKET_PCT,
    BRIEFING_SECTOR_CHANGE_BUCKET_PCT,
    BRIEFING_VOLATILITY_LEVEL_BUCKET,
} from '@/infrastructure/cache/config';
import { hashAnalysisInput } from '@/infrastructure/hash/analysisInput';

/**
 * @internal Bucket index of `value` on a `step` grid (`round(value / step)`), so two
 * readings within half a step of the same grid point share a bucket. A
 * non-finite reading (a failed quote's `NaN`) maps to `null` rather than
 * poisoning the JSON with `null`-vs-`NaN` ambiguity.
 */
export function quantizeForBriefingKey(
    value: number,
    step: number
): number | null {
    if (!Number.isFinite(value)) return null;
    // `+ 0` folds `-0` into `0` so a reading just below zero and one just
    // above it land in the same bucket.
    return Math.round(value / step) + 0;
}

/**
 * @internal
 * Derive a short deterministic hash of the index/sector **moves** driving the
 * briefing prompt, plus the `context` that shapes the prompt. Order-independent
 * (sorted by identifier), so the same data in a different array order yields
 * the same hash.
 *
 * **Quantized, not exact.** The prompt carries the exact quote values, but the
 * key only sees each change bucketed on a coarse grid
 * ({@link BRIEFING_INDEX_CHANGE_BUCKET_PCT} for indices,
 * {@link BRIEFING_SECTOR_CHANGE_BUCKET_PCT} for sector ETFs,
 * {@link BRIEFING_VOLATILITY_LEVEL_BUCKET} for the volatility level) and drops
 * the raw `price` entirely. Hashing the exact values made every intraday quote
 * tick a new key — the summary refreshes every minute during a session, so the
 * hourly slot missed (and re-billed the LLM) roughly once a minute. Now a slot
 * regenerates only when some instrument moves across a bucket edge; a briefing
 * cached a few ticks earlier describes the same market. `price > 0` still
 * enters the key as a flag, because a failed quote (`price: 0`) renders
 * differently in the prompt from a real flat print.
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
            quoted: i.price > 0,
            change: quantizeForBriefingKey(
                i.changesPercentage,
                BRIEFING_INDEX_CHANGE_BUCKET_PCT
            ),
        }))
        .toSorted((a, b) => a.fmpSymbol.localeCompare(b.fmpSymbol, 'en'));
    const sortedSectors = sectors
        .map(s => ({
            symbol: s.symbol,
            quoted: s.price > 0,
            change: quantizeForBriefingKey(
                s.changesPercentage,
                BRIEFING_SECTOR_CHANGE_BUCKET_PCT
            ),
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
            // 변동성 수치도 시세처럼 틱마다 움직이므로 버킷으로만 접는다.
            marketLabel: context.marketLabel,
            volatility: context.volatility
                ? {
                      label: context.volatility.label,
                      level: quantizeForBriefingKey(
                          context.volatility.level,
                          BRIEFING_VOLATILITY_LEVEL_BUCKET
                      ),
                  }
                : null,
        })
    );
}
