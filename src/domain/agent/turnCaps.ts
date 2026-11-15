/**
 * Per-turn hard caps. Ceilings, not targets: the model decides how
 * many lookups a question needs, so simple questions still end in one or two
 * steps. Sized so a "news + overall + options + technical +
 * fundamentals" question on a few symbols fits in one turn. `maxWebSearch`
 * stays low because the global Brave budget (`AGENT_GLOBAL_LIMITS` by default) is shared
 * by every user.
 *
 * Lives in `domain/` (re-exported from `application/agent/limits.ts`) because
 * the tool descriptions the model reads (`tools.ts`) quote these numbers, and
 * `domain/` cannot import `application/` — one source keeps them in step.
 */
export const AGENT_TURN_CAPS = {
    maxSteps: 10,
    maxToolCalls: 30,
    maxWebSearch: 4,
    maxFreshAnalysis: 3,
    /**
     * Filing texts one turn may read through `get_company_filings` (a call
     * with `accession`). A text is up to `AGENT_FILING_TEXT_MAX_CHARS`, so a
     * third read would crowd the context the answer still needs. Listing
     * filings (no `accession`) is not counted.
     */
    maxFilingReads: 2,
    /**
     * `get_x_posts` calls one turn may make. Each call reads up to two
     * accounts' recent posts and X bills per post read, so a comparison across
     * many symbols must not fan out. Every call counts, including one that
     * finds no account (the budget cannot know the outcome when it reserves),
     * so the cap leaves room for a three-symbol comparison. The global daily
     * budget is the consumer's to enforce.
     */
    maxXPostCalls: 3,
    maxDistinctSymbols: 5,
    turnDeadlineMs: 600_000,
} as const;
