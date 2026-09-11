import { describe, expect, it } from 'vitest';
import {
    AGENT_GLOBAL_LIMITS,
    AGENT_LIMITS,
    AGENT_TURN_CAPS,
    TOOL_TIMEOUT_MS,
    agentLimit,
} from '@/application/agent/limits';

describe('AGENT_LIMITS', () => {
    it('free 티어는 전부 0(회원 전용)', () => {
        expect(agentLimit('free', 'turnsPerDay')).toBe(0);
        expect(agentLimit('free', 'freshAnalysisPerDay')).toBe(0);
    });
    it('스펙 §4-5 값', () => {
        expect(agentLimit('member', 'turnsPerDay')).toBe(60);
        expect(agentLimit('pro', 'turnsPerDay')).toBe(200);
        expect(agentLimit('member', 'premiumModelTurnsPerDay')).toBe(10);
        expect(agentLimit('pro', 'premiumModelTurnsPerDay')).toBe(20);
        expect(agentLimit('member', 'freshAnalysisPerDay')).toBe(6);
        expect(agentLimit('member', 'webSearchPerDay')).toBe(5);
        expect(AGENT_LIMITS.messagesPerConversation).toBe(200);
        expect(AGENT_GLOBAL_LIMITS).toEqual({
            webSearchPerDay: 33,
            webSearchPerMonth: 1000,
        });
        expect(AGENT_TURN_CAPS.maxSteps).toBe(6);
        expect(AGENT_TURN_CAPS.turnDeadlineMs).toBe(600_000);
        expect(TOOL_TIMEOUT_MS.expensive).toBe(300_000);
    });
});
