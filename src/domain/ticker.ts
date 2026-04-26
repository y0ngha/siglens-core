import type { TickerSearchResult } from '@/domain/types';

const KOREAN_UNICODE_REGEX = /[ㄱ-ㅣ가-힣]/;

// 미국 주식 티커 형식: 1–5 대문자, 또는 BRK.A 형식(점 + 1–2 대문자)
const TICKER_FORMAT_REGEX = /^(?:[A-Z]{1,5}|[A-Z]{1,4}\.[A-Z]{1,2})$/;

export function isValidTickerFormat(ticker: string): boolean {
    return TICKER_FORMAT_REGEX.test(ticker);
}

export function isKoreanInput(query: string): boolean {
    return KOREAN_UNICODE_REGEX.test(query);
}

export function deduplicateResults(
    results: TickerSearchResult[]
): TickerSearchResult[] {
    const seen = new Set<string>();
    return results.filter(r => {
        if (seen.has(r.symbol)) return false;
        seen.add(r.symbol);
        return true;
    });
}
