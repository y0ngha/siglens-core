import {
    deduplicateResults,
    isKoreanInput,
    isValidTickerFormat,
} from '@/domain/ticker';
import type { TickerSearchResult } from '@/domain/types';
import { describe, expect, it } from 'vitest';

describe('isValidTickerFormat', () => {
    it('1–5 대문자 심볼을 허용한다', () => {
        expect(isValidTickerFormat('A')).toBe(true);
        expect(isValidTickerFormat('AAPL')).toBe(true);
        expect(isValidTickerFormat('GOOGL')).toBe(true);
    });

    it('점 구분 형식 (BRK.A) 을 허용한다', () => {
        expect(isValidTickerFormat('BRK.A')).toBe(true);
        expect(isValidTickerFormat('BRK.B')).toBe(true);
    });

    it('소문자나 잘못된 형식은 거부한다', () => {
        expect(isValidTickerFormat('aapl')).toBe(false);
        expect(isValidTickerFormat('TOOLONG')).toBe(false);
        expect(isValidTickerFormat('123')).toBe(false);
        expect(isValidTickerFormat('AAPL!')).toBe(false);
        expect(isValidTickerFormat('')).toBe(false);
    });
});

describe('isKoreanInput', () => {
    it('한글 음절을 포함하면 true', () => {
        expect(isKoreanInput('애플')).toBe(true);
        expect(isKoreanInput('AAPL애플')).toBe(true);
    });

    it('한글 자모(ㄱ, ㅏ)를 포함하면 true', () => {
        expect(isKoreanInput('ㄱ')).toBe(true);
        expect(isKoreanInput('ㅏ')).toBe(true);
    });

    it('한글이 없으면 false', () => {
        expect(isKoreanInput('AAPL')).toBe(false);
        expect(isKoreanInput('Apple')).toBe(false);
        expect(isKoreanInput('123')).toBe(false);
    });
});

describe('deduplicateResults', () => {
    const make = (symbol: string, name: string): TickerSearchResult => ({
        symbol,
        name,
        exchange: 'NYSE',
        exchangeFullName: 'New York Stock Exchange',
    });

    it('동일 심볼이 처음 등장한 항목만 유지한다', () => {
        const result = deduplicateResults([
            make('AAPL', 'Apple Inc.'),
            make('MSFT', 'Microsoft'),
            make('AAPL', 'Apple Inc. (duplicate)'),
        ]);
        expect(result).toHaveLength(2);
        expect(result[0]).toMatchObject({ symbol: 'AAPL', name: 'Apple Inc.' });
        expect(result[1]).toMatchObject({ symbol: 'MSFT' });
    });

    it('중복이 없으면 입력을 그대로 반환한다', () => {
        const input = [make('AAPL', 'Apple'), make('MSFT', 'Microsoft')];
        const result = deduplicateResults(input);
        expect(result).toEqual(input);
    });

    it('빈 배열을 빈 배열로 반환한다', () => {
        expect(deduplicateResults([])).toEqual([]);
    });
});
