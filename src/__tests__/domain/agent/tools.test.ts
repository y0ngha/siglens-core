import { describe, expect, it } from 'vitest';
import {
    AGENT_TOOL_SPECS,
    AGENT_TOOL_NAMES,
    findToolSpec,
    selectTools,
} from '@/domain/agent/tools';
import { AGENT_TURN_CAPS } from '@/domain/agent/turnCaps';
import { validateArgs } from '@/domain/agent/validateArgs';

describe('AGENT_TOOL_SPECS', () => {
    it('13개 툴, 이름 유일, 스키마는 additionalProperties:false', () => {
        expect(AGENT_TOOL_SPECS).toHaveLength(13);
        expect(new Set(AGENT_TOOL_NAMES).size).toBe(13);
        for (const spec of AGENT_TOOL_SPECS) {
            expect(spec.inputSchema.additionalProperties).toBe(false);
            expect(spec.description.length).toBeGreaterThan(20);
        }
    });

    it('각 툴의 예시 인자가 자기 스키마를 통과한다', () => {
        const samples: Record<string, unknown> = {
            search_ticker: { query: '삼성전자' },
            get_quote: { symbols: ['AAPL'] },
            get_bars_indicators: {
                symbol: 'AAPL',
                timeframe: '1Day',
                bars: 30,
            },
            get_cached_analysis: { symbol: 'AAPL', tab: 'technical' },
            get_news: { symbol: 'AAPL', limit: 5 },
            get_options_summary: { symbol: 'AAPL' },
            get_fundamentals: { symbol: 'AAPL' },
            get_market_overview: { market: 'us' },
            get_economy: {},
            get_congress_trades: { symbol: 'AAPL' },
            run_fresh_analysis: { symbol: 'AAPL', kind: 'technical' },
            web_search: { query: 'Apple earnings', freshness: 'week' },
            get_my_portfolio: {},
        };
        for (const spec of AGENT_TOOL_SPECS) {
            expect(validateArgs(spec.inputSchema, samples[spec.name]).ok).toBe(
                true
            );
        }
    });

    it('selectTools는 가용 집합에 없는 툴을 뺀다', () => {
        const names = selectTools(new Set(['search_ticker', 'get_quote'])).map(
            s => s.name
        );
        expect(names).toEqual(['search_ticker', 'get_quote']);
    });

    it('get_quote는 지연 시세 규칙을, get_bars_indicators/get_cached_analysis는 새 지표·패턴을 설명한다', () => {
        expect(findToolSpec('get_quote')?.description).toContain(
            'quoteDelayMinutes'
        );
        expect(findToolSpec('get_quote')?.description).not.toContain('volume');
        expect(findToolSpec('get_bars_indicators')?.description).toContain(
            'Ichimoku'
        );
        expect(findToolSpec('get_bars_indicators')?.description).toContain(
            'candle patterns'
        );
        expect(findToolSpec('get_cached_analysis')?.description).toContain(
            'chart patterns'
        );
    });

    it('신규 데이터 툴 4종이 등록되어 있다', () => {
        expect(findToolSpec('get_fundamentals')?.costClass).toBe('cached');
        expect(findToolSpec('get_market_overview')?.costClass).toBe('cached');
        expect(findToolSpec('get_economy')?.costClass).toBe('cached');
        expect(findToolSpec('get_congress_trades')?.costClass).toBe('cached');
        expect(
            findToolSpec('get_economy')?.inputSchema.required
        ).toBeUndefined();
    });

    it('findToolSpec', () => {
        expect(findToolSpec('web_search')?.costClass).toBe('external');
        expect(findToolSpec('nope')).toBeUndefined();
    });

    it('siglens 결과 필드명을 정확히 담는다 — 컴퓨트된 값을 모델이 재계산하지 않도록', () => {
        expect(findToolSpec('get_bars_indicators')?.description).toContain(
            'derived'
        );
        expect(findToolSpec('get_bars_indicators')?.description).toContain(
            'higherTimeframe'
        );
        expect(findToolSpec('get_bars_indicators')?.description).toContain(
            'entryRuleMet/exitRuleMet'
        );
        expect(findToolSpec('get_cached_analysis')?.description).toContain(
            'sinceAnalysis'
        );
        expect(findToolSpec('get_my_portfolio')?.description).toContain('pnl');
        expect(findToolSpec('get_my_portfolio')?.description).toContain(
            'pnlPct'
        );
        expect(findToolSpec('get_my_portfolio')?.description).toContain(
            'weightPct'
        );
        expect(findToolSpec('get_fundamentals')?.description).toContain(
            'targetUpsidePct'
        );
        expect(findToolSpec('get_fundamentals')?.description).toContain(
            'daysToEarnings'
        );
        // A real turn read the old `nextQuarterEstimate` (an annual figure) as
        // "next quarter EPS"; the description now tells the model the period.
        expect(findToolSpec('get_fundamentals')?.description).toContain(
            'never call an annual figure quarterly'
        );
        expect(findToolSpec('get_news')?.description).toContain('tally');
        expect(findToolSpec('get_news')?.description).toContain('ageHours');
        expect(findToolSpec('get_economy')?.description).toContain(
            'spread2s10s'
        );
        expect(findToolSpec('get_market_overview')?.description).toContain(
            'rank'
        );
        // `sectorBreadth`, not `breadth` (spec 2026-09-18 coordinator item
        // C4) — the field is the sector ETFs' own up/down/flat counts, not
        // market-wide advancers/decliners, and the old name read as the latter.
        expect(findToolSpec('get_market_overview')?.description).toContain(
            'sectorBreadth'
        );
        expect(findToolSpec('get_market_overview')?.description).toContain(
            'not market-wide advancers/decliners'
        );
    });

    it('리뷰 1라운드: sinceAnalysis 필드 전체·옵션 정밀 필드·시세 asOfIsFetchTime·섹터 name/spread를 담는다', () => {
        const cachedAnalysis = findToolSpec('get_cached_analysis')?.description;
        expect(cachedAnalysis).toContain('analysisPrice');
        expect(cachedAnalysis).toContain('priceNow');
        expect(cachedAnalysis).toContain('movePct');
        expect(cachedAnalysis).toContain('levelsBroken');
        expect(cachedAnalysis).toContain('nearestSupport');
        expect(cachedAnalysis).toContain('nearestResistance');
        expect(cachedAnalysis).toContain('planNow may be null');

        const options = findToolSpec('get_options_summary')?.description;
        expect(options).toContain('daysToExpiration');
        expect(options).toContain('maxPainDistancePct');
        expect(options).toContain('impliedMoveRange');
        expect(options).toContain('distancePct/side');
        expect(options).toContain('callSpreadPct/putSpreadPct');

        const overview = findToolSpec('get_market_overview')?.description;
        expect(overview).toContain('`name`');
        expect(overview).toContain('bestWorstSpreadPp');

        const quote = findToolSpec('get_quote')?.description;
        expect(quote).toContain('asOfIsFetchTime');
        expect(quote).toContain('as of <time>');
        expect(quote).toContain('never as the trade time');
    });

    it('툴 설명의 턴당 숫자는 AGENT_TURN_CAPS에서 온다 — 상한을 바꾸면 모델이 읽는 문장도 따라간다', () => {
        const fresh = AGENT_TOOL_SPECS.find(
            t => t.name === 'run_fresh_analysis'
        );
        const web = AGENT_TOOL_SPECS.find(t => t.name === 'web_search');
        expect(fresh?.description).toContain(
            `at most ${AGENT_TURN_CAPS.maxFreshAnalysis} per turn`
        );
        expect(web?.description).toContain(
            `At most ${AGENT_TURN_CAPS.maxWebSearch} per turn`
        );
    });
});
