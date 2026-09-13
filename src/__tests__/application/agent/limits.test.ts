import { describe, expect, it } from 'vitest';
import {
    AGENT_GLOBAL_LIMITS,
    AGENT_LIMITS,
    AGENT_TURN_CAPS,
    TOOL_TIMEOUT_MS,
    agentLimit,
} from '@/application/agent/limits';

describe('AGENT_LIMITS', () => {
    it('SIGLENS 정책: 분석·웹 검색은 모든 등급 무제한, 로그인 사용자 턴도 무제한', () => {
        for (const tier of ['free', 'member', 'pro'] as const) {
            expect(agentLimit(tier, 'freshAnalysisPerDay')).toBe(Infinity);
            expect(agentLimit(tier, 'webSearchPerDay')).toBe(Infinity);
        }
        expect(agentLimit('member', 'turnsPerDay')).toBe(Infinity);
        expect(agentLimit('pro', 'turnsPerDay')).toBe(Infinity);
    });
    it('비회원(free)은 대화 턴만 하루 10회, 대화 저장은 0', () => {
        expect(agentLimit('free', 'turnsPerDay')).toBe(10);
        expect(agentLimit('free', 'conversationsMax')).toBe(0);
    });
    it('그 밖의 값', () => {
        expect(agentLimit('member', 'premiumModelTurnsPerDay')).toBe(10);
        expect(agentLimit('pro', 'premiumModelTurnsPerDay')).toBe(20);
        expect(AGENT_LIMITS.messagesPerConversation).toBe(200);
        expect(AGENT_GLOBAL_LIMITS).toEqual({
            webSearchPerDay: 33,
            webSearchPerMonth: 1000,
        });
        expect(AGENT_TURN_CAPS).toMatchObject({
            maxSteps: 10,
            maxToolCalls: 30,
            maxWebSearch: 4,
            maxFreshAnalysis: 3,
            maxDistinctSymbols: 5,
        });
        expect(AGENT_TURN_CAPS.turnDeadlineMs).toBe(600_000);
        expect(TOOL_TIMEOUT_MS.expensive).toBe(300_000);
    });
});
