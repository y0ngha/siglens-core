import { describe, expect, it } from 'vitest';
import { buildAgentSystemPrompt } from '@/domain/agent/buildAgentSystemPrompt';
import { AGENT_TOOL_SPECS } from '@/domain/agent/tools';

/**
 * Size budgets of the agent's static request prefix (ko, guest, all tools).
 *
 * Raising a budget is a deliberate act: change the constant, and add one dated
 * line below saying why. Each budget is the measured size rounded up to the
 * next 500, and a floor (budget - 2,000) makes a stale, too-generous budget
 * visible as well.
 *
 * - 2026-11-20: set after the oscillator-zone, basis-date, per-share, lookup
 *   and turn-note changes (system prompt 52,039 -> 54,071 chars; tool specs
 *   63,757 -> 63,896 chars of JSON; longest description 6,941 -> 7,007).
 * - 2026-11-20 (review round 1): trimmed redundant wording and re-triggered
 *   the overbought/oversold rule; budgets are now the measured size plus a
 *   small slack (system prompt 54,193, tool specs 63,891, longest
 *   description 7,002).
 * - 2026-11-20 (A/B follow-up): the per-share exemption names what it covers
 *   and the "## Now" pointer bans converting zones (system prompt 54,193 ->
 *   54,452; tool specs unchanged).
 * - 2026-11-21 (WP-08 core-2): computed-fact fields (earnings tally, put/call
 *   reading, level ladder, news session and priceMoves) and the `holder`
 *   lookup are described, the level rule is rewritten and a news-causality
 *   rule is added (system prompt 54,452 -> 55,576 chars; tool specs
 *   63,891 -> 65,879 chars of JSON; longest description stays
 *   `get_fundamentals`, 6,941 -> 7,127, still under its 7,150 limit).
 * - 2026-11-21 (WP-08 review round 1): clearer news-causality, ladder and
 *   holder wording (system prompt 55,576 -> 55,861; tool specs 65,879 ->
 *   66,046; longest description `get_fundamentals` 7,127 -> 7,191, so its
 *   limit goes 7,150 -> 7,500 and the tool specs budget 66,000 -> 66,500).
 * - 2026-11-21 (WP-09 core-2): the `get_price_stats` tool, its routing row
 *   with the swings and index tails, the chart and index mirror sentences, the
 *   guest-line clause and the computed-figures field list (system prompt
 *   55,861 -> 57,798 chars; tool specs 66,104 -> 71,615 chars of JSON; longest description `get_bars_indicators` 7,002 -> 7,262, above `get_fundamentals` 7,191).
 */
const SYSTEM_PROMPT_CHAR_BUDGET = 58_000;
const TOOL_SPECS_JSON_CHAR_BUDGET = 72_000;
const TOOL_DESCRIPTION_MAX_CHARS = 7_500;
const FLOOR_SLACK = 2_000;

const guestPrompt = (
    tools: readonly (typeof AGENT_TOOL_SPECS)[number][] = AGENT_TOOL_SPECS
): string => buildAgentSystemPrompt({ locale: 'ko', tools, guest: true });

describe('agent prompt size budgets', () => {
    const systemChars = guestPrompt().length;
    const toolSpecsChars = JSON.stringify(AGENT_TOOL_SPECS).length;
    const longestDescription = Math.max(
        ...AGENT_TOOL_SPECS.map(t => t.description.length)
    );

    it('system prompt stays within its budget', () => {
        expect(systemChars).toBeLessThanOrEqual(SYSTEM_PROMPT_CHAR_BUDGET);
        expect(systemChars).toBeGreaterThan(
            SYSTEM_PROMPT_CHAR_BUDGET - FLOOR_SLACK
        );
    });

    it('tool specs stay within their budget', () => {
        expect(toolSpecsChars).toBeLessThanOrEqual(TOOL_SPECS_JSON_CHAR_BUDGET);
        expect(toolSpecsChars).toBeGreaterThan(
            TOOL_SPECS_JSON_CHAR_BUDGET - FLOOR_SLACK
        );
    });

    it('no single tool description outgrows its budget', () => {
        expect(longestDescription).toBeLessThanOrEqual(
            TOOL_DESCRIPTION_MAX_CHARS
        );
        expect(longestDescription).toBeGreaterThan(
            TOOL_DESCRIPTION_MAX_CHARS - FLOOR_SLACK
        );
    });
});

describe('tool names in the rendered system prompt', () => {
    const TOOL_NAME_RE = /\b(?:get|run|show|search|web)_[a-z_]+\b/g;
    const specNames = new Set(AGENT_TOOL_SPECS.map(t => t.name));

    it('every tool-shaped name is a spec name', () => {
        const mentioned = new Set(guestPrompt().match(TOOL_NAME_RE) ?? []);
        const unknown = [...mentioned].filter(name => !specNames.has(name));
        expect(unknown).toEqual([]);
    });

    /**
     * Lines (by their opening words) that still name a tool the model may not
     * have this turn. Known gaps, kept explicit so a NEW leak fails the test:
     * each entry is `<removed tool>: <line start>`.
     */
    const KNOWN_UNGATED = [
        // The "Never write internal tool names" list is a ban, not a route.
        'get_quote: - Never write internal tool names',
        'get_news: - Never write internal tool names',
        'run_fresh_analysis: - Never write internal tool names',
    ];

    it.each([...specNames])(
        'rendering without %s leaves no routing row or rule that names it',
        removed => {
            const prompt = guestPrompt(
                AGENT_TOOL_SPECS.filter(t => t.name !== removed)
            );
            const section = prompt.slice(
                prompt.indexOf('### Which tools to call'),
                prompt.indexOf('## Data boundary')
            );
            const named = new RegExp(`\\b${removed}\\b`);
            const leaks = [
                ...prompt
                    .split('\n')
                    .filter(line => named.test(line))
                    .filter(line => section.includes(line))
                    .map(line => `${removed}: ${line}`),
            ].filter(
                leak => !KNOWN_UNGATED.some(known => leak.startsWith(known))
            );
            expect(leaks).toEqual([]);
        }
    );
});
