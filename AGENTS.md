# AGENTS.md

When working on this directory, read and follow the instructions in `CLAUDE.md` located in this same directory.

The CLAUDE.md file contains critical guidelines, constraints, and operational procedures that must be followed for all code changes and implementations.

**ALWAYS READ CLAUDE.md FIRST before taking any action.**

## Codex Sub-Agent Workflow Override

For Codex-based work in this repository, do not follow the Claude-specific
sub-agent routing table in `CLAUDE.md` after implementation is complete.
The Claude routing table refers to specialized `.claude/agents/*` agents that
are not directly available through Codex.

Instead, use this Codex workflow:

1. Implement the requested code change directly in the main Codex session.
2. Run the required local validation commands for the change.
3. When implementation is complete, spawn a code-review sub-agent.
   - Use a Codex `explorer` agent for review-only work.
   - Instruct the review agent to inspect the branch/diff and return findings only.
   - The review agent must not modify files.
4. If the code-review agent returns a list of required or recommended fixes,
   apply those fixes directly in the main Codex session.
5. Re-run the relevant validation commands.
6. Spawn the code-review agent again with the updated diff and the previous
   findings that were already fixed.
7. Repeat steps 4-6 until the code-review agent approves the changes.
8. After approval, proceed with the GitHub flow:
   - create a commit,
   - push the branch,
   - create or update the pull request.
9. When creating or updating a pull request, read
   `.github/PULL_REQUEST_TEMPLATE.md` first and use that template structure for
   the PR body. Fill every applicable section with the actual issue number,
   implementation summary, changed file lists, and validation results.

The main Codex session remains responsible for implementation and fixes.
The review sub-agent is responsible only for review feedback and approval.
