import { describe, expect, it } from 'vitest';
import * as clientApi from '@/index.client';
import {
    AGENT_FOLLOW_UP_MARKER,
    BARS_RESULT_NOTES,
    FUNDAMENTALS_RESULT_NOTES,
    AGENT_TOOL_SPECS,
    BUILT_IN_AGENT_TOOL_SET,
    CounterStoreUnavailableError,
    findUngroundedNumbers,
    peekMacroBriefingCacheEntry,
    runAgentTurn,
    splitAgentFollowUps,
    SWING_MIN_PCT,
    computeSwingHistory,
    AGENT_PRICE_STATS_DEFAULT_PERIOD,
    AGENT_PRICE_STATS_MAX_DATES,
    AGENT_PRICE_STATS_MAX_SUBJECTS,
    AGENT_PRICE_STATS_PERIODS,
    PRICE_STATS_NOTE_TEMPLATES,
    alignNewsWithPriceMoves,
    buildLevelLadder,
    calendarPeriodChange,
    closeOnOrBefore,
    computeBarChangeStats,
    computeBarRangeStats,
    computeCloseStreak,
    computeEarningsReactions,
    computePriceStats,
    isIsoDate,
    LONG_TERM_MA_CROSS,
    minusCalendarMonths,
    priceStatsEarliestDate,
    readPutCallRatio,
    scanLongTermMaCrosses,
    selectToolSetSpecs,
    tallyEarningsReactions,
} from '@/index';

describe('index — agent exports', () => {
    it('runAgentTurn·툴 카탈로그·CounterStoreUnavailableError를 값으로 내보낸다', () => {
        expect(typeof runAgentTurn).toBe('function');
        expect(AGENT_TOOL_SPECS.length).toBe(24);
        expect(new CounterStoreUnavailableError('p')).toBeInstanceOf(Error);
    });

    // 서버 진입점 전용이다: 프롬프트·루프 조립은 서버만 하고 브라우저 번들은 도구 묶음을 쓰지 않는다.
    it('도구 묶음(내장 묶음·선택 함수)을 서버 진입점으로만 내보낸다', () => {
        expect(BUILT_IN_AGENT_TOOL_SET.tools).toHaveLength(
            AGENT_TOOL_SPECS.length
        );
        expect(
            selectToolSetSpecs(
                BUILT_IN_AGENT_TOOL_SET,
                new Set(['get_quote'])
            ).map(t => t.name)
        ).toEqual(['get_quote']);
        expect('BUILT_IN_AGENT_TOOL_SET' in clientApi).toBe(false);
        expect('selectToolSetSpecs' in clientApi).toBe(false);
    });

    // 서버 진입점 전용이다: 스윙 통계는 도구 실행기(서버)만 계산하고 브라우저 번들은 쓰지 않는다.
    it('스윙 통계 함수·인자 범위를 서버 진입점으로만 내보낸다', () => {
        expect(typeof computeSwingHistory).toBe('function');
        expect(SWING_MIN_PCT.default).toBe(10);
        expect('computeSwingHistory' in clientApi).toBe(false);
    });

    // 서버 진입점 전용이다: 해석 사실 계산은 도구 실행기(서버)만 부르고 브라우저 번들은 쓰지 않는다.
    it('해석 사실 계산 함수 4개를 서버 진입점으로만 내보낸다', () => {
        const fns = {
            alignNewsWithPriceMoves,
            buildLevelLadder,
            readPutCallRatio,
            tallyEarningsReactions,
        };
        Object.entries(fns).forEach(([name, fn]) => {
            expect(typeof fn).toBe('function');
            expect(name in clientApi).toBe(false);
        });
    });

    // 서버 진입점 전용이다: 기간 통계는 도구 실행기(서버)만 계산하고 브라우저 번들은 쓰지 않는다.
    it('기간 통계 함수·상수를 서버 진입점으로만 내보낸다', () => {
        const fns = {
            calendarPeriodChange,
            closeOnOrBefore,
            computePriceStats,
            isIsoDate,
            minusCalendarMonths,
            priceStatsEarliestDate,
        };
        Object.entries(fns).forEach(([name, fn]) => {
            expect(typeof fn).toBe('function');
            expect(name in clientApi).toBe(false);
        });
        expect(AGENT_PRICE_STATS_PERIODS).toContain('ytd');
        expect(AGENT_PRICE_STATS_DEFAULT_PERIOD).toBe('1y');
        expect(AGENT_PRICE_STATS_MAX_SUBJECTS).toBe(3);
        expect(AGENT_PRICE_STATS_MAX_DATES).toBe(5);
        expect(typeof PRICE_STATS_NOTE_TEMPLATES.historyStart).toBe('function');
        expect('AGENT_PRICE_STATS_PERIODS' in clientApi).toBe(false);
        expect('PRICE_STATS_NOTE_TEMPLATES' in clientApi).toBe(false);
    });

    // 서버 진입점 전용이다: 봉 통계는 도구 실행기(서버)만 계산하고 브라우저 번들은 쓰지 않는다.
    it('봉 통계 함수·상수를 서버 진입점으로만 내보낸다', () => {
        const fns = {
            computeBarChangeStats,
            computeBarRangeStats,
            computeCloseStreak,
            computeEarningsReactions,
            scanLongTermMaCrosses,
        };
        Object.entries(fns).forEach(([name, fn]) => {
            expect(typeof fn).toBe('function');
            expect(name in clientApi).toBe(false);
        });
        expect(LONG_TERM_MA_CROSS.lookbackBars).toBe(252);
        expect('LONG_TERM_MA_CROSS' in clientApi).toBe(false);
    });

    // 서버 진입점 전용이다: 결과 notes는 도구 실행기(서버)만 붙이고 브라우저 번들은 쓰지 않는다.
    it('결과 notes 문구를 서버 진입점으로만 내보낸다', () => {
        expect(typeof BARS_RESULT_NOTES.dailyOnlyFields).toBe('function');
        expect(typeof BARS_RESULT_NOTES.closeStreakUnavailable).toBe('string');
        expect(typeof FUNDAMENTALS_RESULT_NOTES.peUntrusted).toBe('string');
        expect('BARS_RESULT_NOTES' in clientApi).toBe(false);
        expect('FUNDAMENTALS_RESULT_NOTES' in clientApi).toBe(false);
    });

    it('findUngroundedNumbers를 값으로 내보낸다', () => {
        expect(typeof findUngroundedNumbers).toBe('function');
    });

    it('후속 질문 마커·파서를 서버·브라우저 진입점 양쪽으로 내보낸다', () => {
        expect(AGENT_FOLLOW_UP_MARKER).toBe('[[followups]]');
        expect(splitAgentFollowUps('본문\n[[followups]] A').followUps).toEqual([
            'A',
        ]);
        expect(clientApi.AGENT_FOLLOW_UP_MARKER).toBe(AGENT_FOLLOW_UP_MARKER);
        expect(clientApi.splitAgentFollowUps).toBe(splitAgentFollowUps);
    });

    it('peekMacroBriefingCacheEntry를 서버 진입점으로 내보낸다', () => {
        expect(typeof peekMacroBriefingCacheEntry).toBe('function');
    });
});
