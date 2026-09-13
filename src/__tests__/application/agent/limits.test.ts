import { describe, expect, it } from 'vitest';
import {
    AGENT_GLOBAL_LIMITS,
    AGENT_LIMITS,
    AGENT_TURN_CAPS,
    TOOL_TIMEOUT_MS,
    agentLimit,
} from '@/application/agent/limits';

describe('AGENT_LIMITS', () => {
    it('free(게스트)는 턴만 소량 허용하고 계량 툴·대화 저장은 0', () => {
        expect(agentLimit('free', 'turnsPerDay')).toBe(10);
        expect(agentLimit('free', 'premiumModelTurnsPerDay')).toBe(0);
        expect(agentLimit('free', 'freshAnalysisPerDay')).toBe(0);
        expect(agentLimit('free', 'webSearchPerDay')).toBe(0);
        expect(agentLimit('free', 'conversationsMax')).toBe(0);
    });
    it('스펙 §4-5 값', () => {
        expect(agentLimit('member', 'turnsPerDay')).toBe(60);
        expect(agentLimit('pro', 'turnsPerDay')).toBe(200);
        expect(agentLimit('member', 'premiumModelTurnsPerDay')).toBe(10);
        expect(agentLimit('pro', 'premiumModelTurnsPerDay')).toBe(20);
        // SIGLENS sets no daily analysis limit for signed-in users.
        expect(agentLimit('member', 'freshAnalysisPerDay')).toBe(Infinity);
        expect(agentLimit('pro', 'freshAnalysisPerDay')).toBe(Infinity);
        expect(agentLimit('member', 'webSearchPerDay')).toBe(5);
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
