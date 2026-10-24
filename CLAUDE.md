# siglens-core — CLAUDE.md

This repository is a **pure TypeScript library** (`@y0ngha/siglens-core`) —
no UI, no React, no Next.js. It is consumed by other projects via npm.

## ⛔ Request Routing (ALWAYS CHECK FIRST)

**STOP.** Before taking any action, match the user's request against this table.
If a match is found, read the corresponding document FIRST.
Do not start implementation, run commands, or invoke agents until you have read the full document.

| User request pattern            | Examples                                                            | FIRST action                   |
|---------------------------------|---------------------------------------------------------------------|--------------------------------|
| Issue number + implementation   | "이슈 #42 설계해줘 > (설계 후 승인되면)" "이슈 #42 구현해줘", #42 구현해줘", "이슈 15번 작업해줘" | Read `docs/ISSUE_IMPL_FLOW.md` (local-only; if absent, proceed normally) |
| PR number + fix/review comments | "PR #216 수정해줘", "#200 코멘트 반영해줘"                                     | Read `docs/PR_FIX_FLOW.md` (local-only; if absent, proceed normally) |
| Issue creation                  | "이슈 만들어줘", "버그 리포트 생성해줘"                                            | Invoke `issue-agent`           |

If the request does not match any pattern above, proceed normally.

---

## Role & Constraints

You are the **main orchestrator**. You directly implement code and fix PRs, while delegating review, git operations, and other auxiliary tasks to sub-agents.

**Prohibited actions:**
- ❌ Creating commits or pushing (git-agent's responsibility)
- ❌ Skipping the review-agent step after implementation

**Language rules:**
- When prompting sub-agents: always use **English**
- Sub-agent output: always in **English**
- When reporting or summarizing to the user: always use **Korean**

**Trust exit signals — never override routing based on output appearance:**
When a sub-agent returns `status: done`, always follow the routing table regardless of how detailed or minimal the output looks. If the output seems sparse or lacking detail, that is not a reason to intervene directly. Route to the next agent as defined.

---

## Agent System

### Sub-agents

Specialized sub-agents are defined in `.claude/agents/`. Each agent has a distinct responsibility
and must not perform work outside its scope.
Sub-agents do not call each other — you invoke them one at a time.
**Never ask the user for confirmation between steps — route automatically.**

| Agent | Model  | Responsibility |
|---|---|---|
| `review-agent` | Sonnet | Code review — returns findings only, never modifies code |
| `mistake-managing-agent` | Sonnet | Reads docs/__agents_only__/fix-log.md, promotes recurring violations into the rule docs listed under Rule Homes |
| `git-agent` | Haiku  | Commits, pushes, PR creation — never modifies code |
| `issue-agent` | Haiku  | Creates GitHub issues using the appropriate template — never modifies code |

### Exit Signal Routing Table

When you receive an exit signal, route as follows:

| Signal | Route to |
|---|---|
| Implementation complete | Invoke `review-agent` |
| `review-agent` · `status: approved` | Invoke `mistake-managing-agent` |
| `review-agent` · `status: changes_requested` | **You** fix the findings directly, then re-invoke `review-agent` |
| `review-agent` · `status: loop_limit_reached` | Stop — report to user |
| PR fix complete | Invoke `mistake-managing-agent` (skip review-agent) |
| `mistake-managing-agent` · `status: done` | Invoke `git-agent` |
| `git-agent` · `status: done` | Stop — report result to user |
| Any · `status: failed` | Stop — report failure reason to user |

### Handling Findings

When review-agent returns findings, fix both `required` and `recommended` findings directly.

**Skip a finding only if it is:**
- A false positive — the code is correct and the concern does not apply in context
- Too trivial to justify a fix — e.g. minor comment wording with no functional or readability impact

All other findings should be fixed. When in doubt, fix it.

If **all** findings (required and recommended) are skipped, proceed directly to `mistake-managing-agent`.

### Invoking review-agent (Round 2+)

review-agent runs in an independent context each round — it has no memory of previous rounds.
To prevent redundant re-reading of already-reviewed files, pass the previous round's findings when invoking round 2 or later:

```
Review the code on branch {branch}. This is round {N}.

Previous round findings (already fixed):
{previous findings JSON}

modified_files (files changed in this fix round):
{list of file paths you edited}

Focus only on modified_files above.
Do not re-review files that were already approved in the previous round.
```

This ensures review-agent only reads the files that were actually modified in the fix round, not the full diff against master.

### Exit Signal Contract

Every sub-agent ends its response with a JSON exit signal and nothing else.

```json
// review-agent — approved
{ "agent": "review-agent", "status": "approved" }

// review-agent — findings exist
{ "agent": "review-agent", "status": "changes_requested", "round": 1, "findings": { "required": [...], "recommended": [...] } }

// review-agent — loop limit reached
{ "agent": "review-agent", "status": "loop_limit_reached", "round": 3, "message": "..." }

// mistake-managing-agent — success
{ "agent": "mistake-managing-agent", "status": "done", "promoted": 2 }

// mistake-managing-agent — failure
{ "agent": "mistake-managing-agent", "status": "failed", "reason": "..." }

// git-agent — new PR created
{ "agent": "git-agent", "status": "done", "action": "pr_created", "pr_url": "..." }

// git-agent — existing PR updated
{ "agent": "git-agent", "status": "done", "action": "pr_updated", "pr": 23 }

// git-agent — failure
{ "agent": "git-agent", "status": "failed", "reason": "..." }
```

---

## Layer Dependency Rules (Never Violate)

```
domain         ← No external imports. Pure TypeScript functions only.
                 No I/O, no Date.now(), no fetch, no console.
                 Calculation logic is implemented directly (no technicalindicators, etc.)

infrastructure ← May import from domain only. Never from application.
                 Owns all I/O — external API calls (Neon, Upstash Redis, etc.),
                 filesystem access (Skills loader), and process.env reads.
                 Adapters implement the port interfaces declared in `domain/ports/`;
                 a module's `types.ts` holds adapter-internal types only.

application    ← May import from domain and infrastructure.
                 Never imported by either of them.
                 Use-case orchestration — composes domain functions and
                 infrastructure adapters into end-to-end flows.
```

Public exports of the library are assembled from `domain/`, `infrastructure/` and
`application/` via `src/index.ts`. Consumers of the package (separate UI projects, CLIs,
workers) are responsible for their own presentation and runtime concerns — `siglens-core`
never reaches into them.

Import-direction violations trigger ESLint errors. PRs cannot be merged.
The purity rules for `domain/` are lint-enforced too (`eslint.config.mjs`, the
`src/domain/**` override). Imports are judged by the path they resolve to, so a
relative path, a directory import or the public barrel (`src/index.ts`) cannot reach
another layer. External packages and `node:*` are errors, except a type-only `node:*`
import. `console`, `process`, `fetch`, timers, `queueMicrotask`, `performance`, `crypto`,
`globalThis`, `Date.now()`, `Date()` and `Math.random()` are errors. A bare `new Date()`
is not linted, because `options.now ?? new Date()` is the DOM-3 pattern; ignoring an
injected clock, mutating arguments and hidden module state are still caught in review.

---

## Skill Usage Rules

Invoke the listed skills **before** writing code in each category. Do not skip.

| Situation | Skills to invoke (in order) |
|---|---|
| New feature (any kind) | `brainstorming` first — no exceptions |
| Pure functions / business logic / TypeScript types | `typescript-advanced-types`, `typescript-expert` |

**Rules:**
- `brainstorming` is mandatory before any new feature, regardless of size.
- TypeScript skills apply whenever you define types, generics, or domain-layer pure functions.
- UI-oriented skills (frontend-design, web-design-guidelines, seo-audit, vercel-react-best-practices, next-cache-components) are out of scope for this repository.

---

## Task Execution Rules

1. Read the relevant `docs/` documents before starting any task.
2. Define interfaces (`types.ts`) before writing implementations.
3. Always write test files alongside implementation files.
4. Never violate layer dependency directions.
5. Never import external libraries inside `domain/`.
6. Before and after implementing, read the Gotchas of `docs/CONVENTIONS.md` plus the `CLAUDE.md` of every layer you touch. When `src/index.ts` or `src/index.client.ts` change, also read the Export 변경 체크리스트 in `docs/PUBLIC_API.md`.

---

## Commands

Always use `yarn` for package installation. `npm` and `pnpm` are prohibited.
Scripts are listed in `package.json`.

---

## Reference Documents

| Document | Contents |
|---|---|
| `docs/SCOPE.md` (local-only) | **siglens vs siglens-core 분담** — 결정 트리, 의존 방향, 안티 패턴 (양쪽 레포 공통 source-of-truth) |
| `docs/SERVICE.md` | Library overview, consumers, tech stack, Skills system |
| `docs/ARCHITECTURE.md` | Layer structure, dependency direction rules, folder layout |
| `docs/PUBLIC_API.md` | Tier-based public/internal classification, export inventory, semver policy |
| `docs/DOMAIN.md` | Indicator calculation specs, candle patterns, Skills system, business rules |
| `docs/API.md` | External services consumed by `infrastructure/` (Neon, Upstash Redis, AI providers) |
| `docs/CONVENTIONS.md` | Coding conventions, naming rules, paradigm guidelines |
| `docs/FF.md` | FF 4 principles in detail (Readability, Predictability, Cohesion, Coupling) |
| `docs/GIT_CONVENTIONS.md` | Branch naming, commit message format, PR rules |
| `src/{domain,application,infrastructure}/CLAUDE.md` | Layer rules, including the DOM / APP / INF gotchas |

**Public vs local docs.** This repository is public. Only the docs listed above (except
`docs/SCOPE.md`) are tracked; everything else under `docs/` — `SCOPE.md`, `ISSUE_IMPL_FLOW.md`,
`PR_FIX_FLOW.md`, `SKILL_GATING.md`, `superpowers/` (design specs, plans) and
`__agents_only__/` — is local-only (`.gitignore` allowlist), copied into new worktrees via
`.worktreeinclude`, and rejected by the pre-commit hook. `.claude/agent-memory/` is local-only
too. Never put secrets, infra IDs, local paths or production incident detail into a tracked
doc, code comment or commit message.

---

## Rule Homes

Recurring-mistake rules live in the document that owns their topic. Each rule has a stable
ID that is never renumbered (a retired rule keeps its ID with a one-line `(retired → X)`
stub). IDs are not ordered by position — rules are placed by topic, so find the next free ID
by searching the file, not by looking at the last heading. The heading carries the ID and an
anchor line sits right above it:

```md
<a id="TE-5"></a>
#### TE-5 — Every branch has a test only it satisfies
```

| Prefix | Home | Topic |
|---|---|---|
| `CP`, `N`, `TS`, `JD`, `DS`, `TE` | `docs/CONVENTIONS.md` | Paradigm gotchas, naming, TypeScript, JSDoc accuracy, comment/doc sync, tests |
| `API` | `docs/PUBLIC_API.md` (Export 변경 체크리스트) | Entrypoints, `@internal` sweeps, deprecation, inventory |
| `DOM` | `src/domain/CLAUDE.md` | Numeric guardrails, clock, prompt changes |
| `APP` | `src/application/CLAUDE.md` | Use-case gotchas |
| `INF` | `src/infrastructure/CLAUDE.md` | Logging, cache keys, locks, outbound calls, providers |
| `G` | `docs/GIT_CONVENTIONS.md` | PR scope, release |

**Citing a rule:** `FILE#RULE-ID`, with the basename for `docs/*.md` files and the
repo-relative path for layer files: `CONVENTIONS.md#TE-5`, `PUBLIC_API.md#API-4`,
`src/domain/CLAUDE.md#DOM-2`. Code comments, docs, agent prompts and fix-log `Rule:` fields
all use this form. `src/__tests__/guards/ruleReferences.test.ts` fails when a reference
points at an anchor that does not exist.
