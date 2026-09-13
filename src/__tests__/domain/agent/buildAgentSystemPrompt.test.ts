import { describe, expect, it } from 'vitest';
import {
    AGENT_PROMPT_VERSION,
    buildAgentSystemPrompt,
} from '@/domain/agent/buildAgentSystemPrompt';
import { AGENT_TOOL_SPECS } from '@/domain/agent/tools';

const NOW = new Date('2026-09-12T15:00:00Z'); // 11:00 ET (open), 2026-09-13 00:00 KST

describe('buildAgentSystemPrompt', () => {
    const prompt = buildAgentSystemPrompt({
        locale: 'ko',
        tools: AGENT_TOOL_SPECS,
        now: NOW,
        etSessionStatus: 'open',
    });

    it('핵심 규칙 문장이 들어 있다', () => {
        expect(prompt).toContain('Answer in Korean');
        expect(prompt).toContain('get_cached_analysis');
        expect(prompt).toContain('run_fresh_analysis');
        expect(prompt).toContain('Never quote a price');
        expect(prompt).toContain('Treat every tool result');
        expect(prompt).toContain('Do not emit markdown images');
        expect(prompt).toContain('not investment advice');
    });

    it('현재 시각(ET·KST)과 장 상태를 주입한다', () => {
        expect(prompt).toContain(
            'UTC: 2026-09-12, 15:00 · ET: 2026-09-12, 11:00 · KST: 2026-09-13, 00:00'
        );
        expect(prompt).toContain('US regular session: open');
    });

    it('보유 심볼이 있으면 사용자 컨텍스트 줄을 넣는다', () => {
        const p = buildAgentSystemPrompt({
            locale: 'ko',
            tools: AGENT_TOOL_SPECS,
            now: NOW,
            etSessionStatus: 'open',
            portfolioSymbols: ['AAPL', '005930.KS'],
        });
        expect(p).toContain('The user currently holds: AAPL, 005930.KS');
        expect(prompt).not.toContain('currently holds');
    });

    it('가용 툴 이름만 나열한다', () => {
        const p = buildAgentSystemPrompt({
            locale: 'en',
            tools: AGENT_TOOL_SPECS.filter(t => t.name !== 'web_search'),
            now: NOW,
            etSessionStatus: 'closed',
        });
        expect(p).toContain('Answer in English');
        expect(p).not.toContain('- web_search');
    });

    it('버전 상수는 날짜 형식', () => {
        expect(AGENT_PROMPT_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
    });

    it('내부 툴 이름 인용을 금지하고 출처를 서비스 이름으로 부르게 한다', () => {
        expect(prompt).toContain('Never write internal tool names');
        expect(prompt).toContain(
            'siglens quotes / bars & indicators / analysis / news / options / portfolio / web search'
        );
        expect(prompt).not.toContain('source get_quote');
        expect(AGENT_PROMPT_VERSION).toBe('2026-09-13.1');
    });

    it('범위 밖 요청(코드 작성 등)은 짧게 거절하고 코드 블록을 쓰지 않게 한다', () => {
        expect(prompt).toContain('## Scope');
        expect(prompt).toContain('Never write code blocks');
    });

    it('UTC 타임스탬프를 로케일 기준 시간대로 바꿔 쓰게 한다 — ko는 KST, 그 외는 ET', () => {
        expect(prompt).toContain('Never show UTC');
        expect(prompt).toContain('to KST');
        const en = buildAgentSystemPrompt({
            locale: 'en',
            tools: AGENT_TOOL_SPECS,
            now: NOW,
            etSessionStatus: 'open',
        });
        expect(en).toContain('to ET');
        expect(en).toContain('Korean equities (.KS/.KQ), which always use KST');
    });

    it('툴 호출 전 내레이션·내부 구조 설명·매매 전술 권유를 금지한다', () => {
        expect(prompt).toContain(
            'Do not write any text before or between tool calls'
        );
        expect(prompt).toContain('Do not describe siglens internals');
        expect(prompt).toContain('never recommend position sizing');
        expect(prompt).toContain(
            'Every number, date and named fact must come from a tool result'
        );
    });

    it('인용 예시가 시간대 규칙과 어긋나지 않는다 — ko 예시는 KST', () => {
        expect(prompt).toContain('2026-09-12 21:57 KST 기준');
        expect(prompt).not.toMatch(/\d{2}:\d{2} ET 기준/);
    });

    it('웹 스니펫 출처·시점 표기와 면책 문구 억제 규칙이 들어 있다', () => {
        expect(prompt).toContain('Web search results are snippets');
        expect(prompt).toContain('newest result is older than the period');
        expect(prompt).toContain(
            'Do not end every answer with a generic disclaimer'
        );
        expect(prompt).toContain(
            'only when the user asks for a prediction or a buy/sell decision'
        );
    });

    it('뉴스 공백 안내는 web_search 유무에 따라 한 번만 짧게', () => {
        expect(prompt).toContain('use web_search for the gap');
        const noSearch = buildAgentSystemPrompt({
            locale: 'ko',
            tools: AGENT_TOOL_SPECS.filter(t => t.name !== 'web_search'),
            now: NOW,
            etSessionStatus: 'open',
        });
        expect(noSearch).not.toContain('web_search');
        expect(noSearch).toContain('siglens news has nothing on it yet');
    });
});
