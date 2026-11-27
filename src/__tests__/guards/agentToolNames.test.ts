import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Core ships no agent tools: the consumer owns its tool catalog, routing rows,
 * tool rules, result notes and executors (`AgentToolSet`), and core owns the
 * loop, the caps, the tool-agnostic prompt frame and the calculations. A
 * consumer tool name in the agent's source is a sign that tool text or a
 * name-keyed rule (`name === 'web_search'`) is creeping back into core.
 *
 * Scope: every non-test file under `src/domain/agent/` and
 * `src/application/agent/`, comments included (a JSDoc that names a tool ties
 * the code to one consumer's catalog just as a string does). Name a tool by
 * what it does ("the agent's swing-history tool"), or by the definition field
 * that drives the behaviour (`meter: 'webSearch'`, `dailyQuota`).
 *
 * No allow-list: nothing in these directories needs a consumer tool name.
 */

const REPO_ROOT = resolve(__dirname, '../../..');
const SCANNED_DIRS = ['src/domain/agent', 'src/application/agent'];

/** Consumer tool names: `get_*`, `propose_*` and the four other tool names. */
const TOOL_NAME =
    /\b(get_[a-z_]+|web_search|show_chart|search_ticker|run_fresh_analysis|propose_[a-z_]+)\b/g;

function sourceFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return sourceFiles(path);
        return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')
            ? [path]
            : [];
    });
}

describe('agent source names no consumer tool', () => {
    const files = SCANNED_DIRS.flatMap(dir =>
        sourceFiles(resolve(REPO_ROOT, dir))
    );

    it('scans the agent source files', () => {
        const scanned = files.map(f => relative(REPO_ROOT, f));
        expect(scanned).toContain('src/domain/agent/buildAgentSystemPrompt.ts');
        expect(scanned).toContain('src/application/agent/runAgentTurn.ts');
    });

    it('the pattern catches every kind of tool name', () => {
        const sample =
            "get_quote, get_x_posts, web_search, show_chart, search_ticker, run_fresh_analysis, propose_price_alert, name === 'web_search'";
        expect(sample.match(TOOL_NAME)).toEqual([
            'get_quote',
            'get_x_posts',
            'web_search',
            'show_chart',
            'search_ticker',
            'run_fresh_analysis',
            'propose_price_alert',
            'web_search',
        ]);
        expect('getQuote, webSearch, budget_target'.match(TOOL_NAME)).toBe(
            null
        );
    });

    it('no file names a consumer tool', () => {
        const hits = files.flatMap(file =>
            readFileSync(file, 'utf8')
                .split('\n')
                .flatMap((line, i) =>
                    [...line.matchAll(TOOL_NAME)].map(
                        m => `${relative(REPO_ROOT, file)}:${i + 1} ${m[0]}`
                    )
                )
        );
        expect(hits).toEqual([]);
    });
});
