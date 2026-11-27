import { describe, expect, it } from 'vitest';
import * as clientApi from '@/index.client';
import * as serverApi from '@/index';
import {
    AGENT_FOLLOW_UP_MARKER,
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
    PRICE_STATS_CAGR_ABOVE_DAYS,
    PRICE_STATS_NOTE_TEMPLATES,
    PRICE_STATS_YEAR,
    PULLBACK_MEASURED_RATE_MEANING,
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
    it('runAgentTurn·CounterStoreUnavailableError를 값으로 내보낸다', () => {
        expect(typeof runAgentTurn).toBe('function');
        expect(new CounterStoreUnavailableError('p')).toBeInstanceOf(Error);
    });

    // core는 도구를 싣지 않는다: 도구 명세·묶음은 소비자 것이다.
    it('내장 도구 묶음과 옛 도구 카탈로그·출력 계약 상수를 내보내지 않는다', () => {
        const api: Record<string, unknown> = { ...serverApi };
        for (const name of [
            'BUILT_IN_AGENT_TOOL_SET',
            'AGENT_TOOL_SPECS',
            'AGENT_TOOL_NAMES',
            'findToolSpec',
            'selectTools',
            'BARS_RESULT_NOTES',
            'FUNDAMENTALS_RESULT_NOTES',
            'AGENT_X_POSTS_MAX',
            'AGENT_FILINGS_LIST_MAX',
            'AGENT_MACRO_INSTRUMENTS',
            'AGENT_CHART_KINDS',
            'AGENT_COMPARE_SYMBOLS_MAX',
        ]) {
            expect(name in api).toBe(false);
        }
    });

    // 서버 진입점 전용이다: 프롬프트·루프 조립은 서버만 하고 브라우저 번들은 도구 묶음을 쓰지 않는다.
    it('도구 묶음 선택 함수를 서버 진입점으로만 내보낸다', () => {
        const toolSet = {
            version: 't',
            tools: [
                {
                    name: 'lookup_a',
                    description: 'A.',
                    costClass: 'free' as const,
                    inputSchema: {
                        type: 'object' as const,
                        properties: {},
                        additionalProperties: false as const,
                    },
                    perTurn: { max: 1 },
                },
            ],
            routingRows: [],
            ruleLines: () => [],
            fragments: {
                computedFigureExamples: '',
                guestCapabilities: () => '',
                portfolioTool: '',
                recallExamples: () => '',
                internalToolNameExamples: '',
                toolDisplayNames: '',
            },
        };
        expect(
            selectToolSetSpecs(toolSet, new Set(['lookup_a'])).map(t =>
                Object.keys(t)
            )
        ).toEqual([['name', 'description', 'costClass', 'inputSchema']]);
        expect('selectToolSetSpecs' in clientApi).toBe(false);
    });

    // 서버 진입점 전용이다: 소비자의 도구 문구가 core 계산과 같은 숫자·문장을 쓰도록 내보낸다.
    it('계산과 묶인 상수·문장을 서버 진입점으로만 내보낸다', () => {
        expect(PRICE_STATS_CAGR_ABOVE_DAYS).toBe(366);
        expect(PRICE_STATS_YEAR).toEqual({ min: 1971, max: 2100 });
        expect(PULLBACK_MEASURED_RATE_MEANING).toContain('66-75%');
        expect('PRICE_STATS_CAGR_ABOVE_DAYS' in clientApi).toBe(false);
        expect('PRICE_STATS_YEAR' in clientApi).toBe(false);
        expect('PULLBACK_MEASURED_RATE_MEANING' in clientApi).toBe(false);
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
