import { describe, expect, it } from 'vitest';
import { buildAgentSystemPrompt } from '@/domain/agent/buildAgentSystemPrompt';
import type { AgentToolSet } from '@/domain/agent/toolSet';
import { TEST_AGENT_TOOL_SET } from '@/__tests__/fixtures/agentToolSet';

/**
 * Size budget of the prompt frame core owns (ko, guest, the test tool set).
 *
 * The consumer's tool text (descriptions, routing rows, tool rules) and its
 * budgets live with the consumer's tool set; what is measured here is the
 * frame those pieces are spliced into, rendered with the short fixed test tool
 * set so only a frame edit moves the number.
 *
 * Raising the budget is a deliberate act: change the constant, and add one
 * dated line below saying why. The budget is the measured size rounded up to
 * the next 500, and a floor (budget - 2,000) makes a stale, too-generous
 * budget visible as well.
 *
 * - 2026-11-28 (WP-23 core-3): the built-in tool set was deleted; the budget
 *   now covers the frame only (measured 33,153 chars).
 */
const FRAME_CHAR_BUDGET = 33_500;
const FLOOR_SLACK = 2_000;

/** A tool set that contributes no text at all, to look at the frame alone. */
const EMPTY_TOOL_SET: AgentToolSet = {
    version: 'empty',
    tools: [],
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

describe('agent prompt frame size budget', () => {
    it('the frame stays within its budget', () => {
        const chars = buildAgentSystemPrompt({
            locale: 'ko',
            tools: TEST_AGENT_TOOL_SET.tools,
            toolSet: TEST_AGENT_TOOL_SET,
            guest: true,
        }).length;
        expect(chars).toBeLessThanOrEqual(FRAME_CHAR_BUDGET);
        expect(chars).toBeGreaterThan(FRAME_CHAR_BUDGET - FLOOR_SLACK);
    });
});

describe('tool names in the frame', () => {
    const TOOL_NAME_RE =
        /\b(?:get_[a-z_]+|web_search|show_chart|search_ticker|run_fresh_analysis|propose_[a-z_]+)\b/g;

    it.each(['ko', 'en', 'ja', 'zh'] as const)(
        'a tool set with no text leaves no tool name in the %s prompt',
        locale => {
            const prompt = buildAgentSystemPrompt({
                locale,
                tools: [],
                toolSet: EMPTY_TOOL_SET,
                guest: true,
                portfolioSymbols: ['AAPL'],
            });
            expect(prompt.match(TOOL_NAME_RE) ?? []).toEqual([]);
        }
    );
});
