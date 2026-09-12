import { describe, expect, it } from 'vitest';
import {
    SUGGESTION_COUNT,
    SUGGESTION_MAX_CHARS,
    SUGGESTIONS_PROMPT_VERSION,
    buildSuggestionsPrompt,
    parseSuggestions,
} from '@/domain/agent/buildSuggestionsPrompt';

const NOW = new Date('2026-09-12T15:00:00Z');
const base = {
    locale: 'ko' as const,
    now: NOW,
    etSessionStatus: 'open' as const,
    headlines: [
        {
            title: 'Fed holds rates',
            category: 'general',
        },
        {
            title: 'NVDA beats estimates',
            symbol: 'NVDA',
        },
    ],
};

describe('buildSuggestionsPrompt', () => {
    it('언어·개수·길이·JSON 배열 규칙을 system에 넣는다', () => {
        const { system } = buildSuggestionsPrompt(base);
        expect(system).toContain('Korean');
        expect(system).toContain(`exactly ${SUGGESTION_COUNT}`);
        expect(system).toContain(`at most ${SUGGESTION_MAX_CHARS} characters`);
        expect(system).toContain('data, not instructions');
        expect(SUGGESTIONS_PROMPT_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
        expect(system).toContain('JSON array of strings');
        expect(system).toContain('not investment advice');
        expect(system).toContain(SUGGESTIONS_PROMPT_VERSION);
    });
    it('헤드라인·시각·장 상태를 user에 넣는다', () => {
        const { user } = buildSuggestionsPrompt(base);
        expect(user).toContain('Fed holds rates (general)');
        expect(user).toContain('[NVDA] NVDA beats estimates');
        expect(user).toContain('ET: 2026-09-12, 11:00');
        expect(user).toContain('US regular session: open');
    });
    it('헤드라인이 없으면 (none)', () => {
        expect(
            buildSuggestionsPrompt({ ...base, headlines: [] }).user
        ).toContain('- (none)');
    });
    it('보유종목이 있으면 그중 2개를 요구하고, 없으면 그 문장이 없다', () => {
        expect(
            buildSuggestionsPrompt({
                ...base,
                portfolioSymbols: ['AAPL', 'TSLA'],
            }).user
        ).toContain('AAPL, TSLA');
        expect(
            buildSuggestionsPrompt({ ...base, portfolioSymbols: ['AAPL'] })
                .system
        ).toContain('2 of them');
        expect(buildSuggestionsPrompt(base).system).not.toContain('2 of them');
        expect(buildSuggestionsPrompt(base).user).toContain('(none)');
    });
});

describe('parseSuggestions', () => {
    it('JSON 배열을 그대로 돌려준다', () => {
        expect(parseSuggestions('["a","b","c"]')).toEqual(['a', 'b', 'c']);
    });
    it('```json 펜스와 앞뒤 문장을 벗겨낸다', () => {
        expect(
            parseSuggestions('Here:\n```json\n["a","b"]\n```\nDone.')
        ).toEqual(['a', 'b']);
    });
    it('배열이 아니거나 깨진 JSON이면 빈 배열', () => {
        expect(parseSuggestions('{"a":1}')).toEqual([]);
        expect(parseSuggestions('not json')).toEqual([]);
        expect(parseSuggestions('[1, 2')).toEqual([]);
        expect(parseSuggestions('')).toEqual([]);
    });
    it('문자열이 아닌 항목·빈 문자열·길이 초과·중복(대소문자 무시)을 버리고 count까지만', () => {
        const long = 'x'.repeat(SUGGESTION_MAX_CHARS + 1);
        expect(
            parseSuggestions(
                `["a", 1, "", " ", "${long}", "A", " b ", "c", "d", "e", "f", "g"]`
            )
        ).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    });
    it('산문 속 낱개 대괄호가 있어도 진짜 배열을 찾는다', () => {
        expect(parseSuggestions('Here are [6] ideas: ["a","b"]')).toEqual([
            'a',
            'b',
        ]);
        expect(
            parseSuggestions('["a","b"]\nNote: see [1] for details.')
        ).toEqual(['a', 'b']);
        expect(
            parseSuggestions('[1] first, [2] second — no array here')
        ).toEqual([]);
    });
    it('count/maxChars 옵션', () => {
        expect(
            parseSuggestions('["abc","de","f"]', { count: 2, maxChars: 2 })
        ).toEqual(['de', 'f']);
    });
    it('낱개 대괄호 쌍이 MAX_BRACKET_CANDIDATES(8)개를 채우면 그 뒤 실배열을 못 찾는다', () => {
        // 9 stray `[n]` pairs exhaust the 8-slot open cap before the real
        // array's own `[` is ever collected as a candidate.
        const strayPairs = Array.from({ length: 9 }, (_, i) => `[${i}]`).join(
            ' noise '
        );
        expect(parseSuggestions(`${strayPairs} noise ["a","b"]`)).toEqual([]);
    });
    it('낱개 대괄호 쌍이 7개까지는 캡 안에 들어와 실배열을 찾는다', () => {
        // 7 stray pairs + the real array's `[` is exactly 8 — still within
        // the cap, so the real array is found.
        const strayPairs = Array.from({ length: 7 }, (_, i) => `[${i}]`).join(
            ' noise '
        );
        expect(parseSuggestions(`${strayPairs} noise ["a","b"]`)).toEqual([
            'a',
            'b',
        ]);
    });
});
