# Issue Implementation Flow

## Orchestration Rules

You (the main orchestrator) own this workflow end-to-end.
You **directly implement** code, then invoke sub-agents for review and git operations.
Never ask the user "shall I proceed?" between steps — route automatically.

### Routing Table

| Signal received | Next action |
|---|---|
| Your implementation complete | Invoke `review-agent` (round 1) |
| `review-agent` · `status: approved` | Invoke `mistake-managing-agent` |
| `review-agent` · `status: changes_requested` | **You** fix findings directly, then re-invoke `review-agent` |
| `review-agent` · `status: loop_limit_reached` | Stop and report to user |
| `mistake-managing-agent` · `status: done` | Invoke `git-agent` |
| `git-agent` · `status: done` | Report PR URL to user and stop |
| Any · `status: failed` | Stop and report the failure reason to user |

---

## Step-by-Step Flow

### Step 1 — Direct Implementation

#### 1-1. Repository

```
REPO=y0ngha/siglens-core
```

Use this value directly in all `gh` commands.

#### 1-2. Load Required Documents

Always read (targeted):
- Rule docs — read only the parts relevant to the task scope (rule IDs are listed in `CLAUDE.md` under Rule Homes):

| Modified area | Read |
|---|---|
| domain/ | `src/domain/CLAUDE.md` + `docs/CONVENTIONS.md` Gotchas: Paradigm (CP), TypeScript (TS), JSDoc Accuracy & Placement (JD), Comments & Documentation Sync (DS) |
| application/ | `src/application/CLAUDE.md` + CONVENTIONS.md CP, TS, JD, DS |
| infrastructure/ | `src/infrastructure/CLAUDE.md` + CONVENTIONS.md CP, TS, JD, DS |
| \_\_tests\_\_/ | CONVENTIONS.md Test Gotchas (TE) |
| `src/index.ts`, `src/index.client.ts`, any `export` added or removed | `docs/PUBLIC_API.md` Export 변경 체크리스트 (API) |

Multiple areas → read the union.

Additional documents by scope:
- domain/ related → `docs/DOMAIN.md` + `docs/ARCHITECTURE.md`
- infrastructure/ → `docs/API.md` + `docs/ARCHITECTURE.md`
- Layer structure check needed → `docs/ARCHITECTURE.md`

Read existing similar implementations first for pattern recognition:
```bash
# e.g. When implementing MA, check EMA first
# src/domain/indicators/ema.ts
# src/__tests__/domain/indicators/ema.test.ts
```

#### 1-3. Understand the Issue

```bash
gh issue view {number} --repo y0ngha/siglens-core
```

**If the issue cannot be found, stop and report to user.**

Verify:
- Implementation scope: which layers are touched (domain, infrastructure)
- File paths to create or modify
- Function signatures and feature specifications
- Reference docs: read only items checked (`[x]`) in the issue body
- Completion criteria

#### 1-4. Create Branch

```bash
git checkout main && git pull origin main
git checkout -b {type}/{issue number}/{one-line summary}
```

Branch naming: `feat/2/도메인-공통-타입-정의`, `refactor/32/candlestick-pattern-domain-분리` format. Korean allowed, spaces replaced with hyphens.

| Type | When to use |
|---|---|
| `feat` | New feature or capability |
| `refactor` | Code restructuring without behavior change |
| `chore` | Build, config, dependency changes |
| `docs` | Documentation only |
| `test` | Test additions or fixes |
| `style` | Formatting, naming, no logic change |

#### 1-5. Implement Code + Tests

**Domain Layer Checklist** — verify after implementation:
- [ ] No external library imports (technicalindicators, lodash, etc. are all prohibited)
- [ ] Pure functions only (no fetch, console.log, Date.now(), process.env)
- [ ] Return types must be explicitly declared
- [ ] Initial period values must be null (never 0 or NaN)
- [ ] Prefer map, filter, reduce, flatMap; for/while only where CONVENTIONS.md allows it
  (sliding windows, pointer convergence, multi-push, sequential async — see CONVENTIONS.md#CP-5)
- [ ] Maintain immutability (no bars.push → use [...bars, newBar])
- [ ] Use path aliases (@/domain/... format)
- [ ] No hardcoded literals → extract to constants (domain/indicators/constants.ts)

**Infrastructure Layer Checklist** — verify after implementation:
- [ ] No reverse imports (domain → infrastructure is prohibited)
- [ ] Type imports from @/domain/types only
- [ ] process.env access is confined to this layer
- [ ] External dependencies are wrapped behind an interface in `types.ts`
- [ ] No untagged or debug logging (src/infrastructure/CLAUDE.md#INF-2)
- [ ] Graceful degradation on missing env vars / network failure
- [ ] All conditional branches have dedicated test cases

**Test Layer Checklist** — verify after implementation:
- [ ] Test file exists for every new domain/infrastructure file
- [ ] 90% branch coverage (domain, application and infrastructure)
- [ ] describe/it text is human-readable, not code expressions
- [ ] Period-based indicators include all 5 required test cases
- [ ] No if-guarded assertions (unconditional expect only)
- [ ] External services are stubbed via `vi.mock` / interface stubs (no real Upstash/Neon/AI calls)
- [ ] Time-dependent code uses `vi.setSystemTime` — no raw `Date.now()` assertions

Only check the checklists for file types you actually modified or created.

**Test writing** — file locations:
```
src/__tests__/domain/indicators/rsi.test.ts
src/__tests__/infrastructure/cache/redis.test.ts
```

Required test cases for period-based indicators:
- Empty array → return empty array
- Input shorter than period → all null
- Initial null range → first `period - 1` values are null
- Valid value range → non-null numbers after the period-th index
- Calculation accuracy → first computed value matches specification

When creating new files under `domain/indicators/`, add the export to
`src/domain/indicators/index.ts` and ensure it is re-exported from `src/index.ts`
if part of the public surface.

**Documentation updates** — if the change falls into:

| Change Type | Document to Update |
|---|---|
| New type or interface added | `docs/DOMAIN.md` |
| New indicator implemented | `docs/DOMAIN.md` |
| External service usage changed | `docs/API.md` |
| Layer structure or folder layout changed | `docs/ARCHITECTURE.md` |
| New coding convention established | `docs/CONVENTIONS.md` |

#### 1-6. Rule Self-Review

Before running validation, re-read the rule docs loaded in Step 1-2.
For each modified file, verify every rule in the matching sections:

| File type | Rules to verify |
|---|---|
| .ts (domain/) | `src/domain/CLAUDE.md` (DOM), CONVENTIONS.md CP, TS, JD, DS |
| .ts (application/) | `src/application/CLAUDE.md` (APP), CONVENTIONS.md CP, TS, JD, DS |
| .ts (infrastructure/) | `src/infrastructure/CLAUDE.md` (INF), CONVENTIONS.md CP, TS, JD, DS |
| .test.ts | CONVENTIONS.md TE |
| `src/index*.ts` | `docs/PUBLIC_API.md` API checklist |

**Procedure:**
1. List all files you modified or created.
2. For each file, re-read the matching rules.
3. Verify each rule against the file.
4. Fix any violations found before proceeding.

Do NOT attempt to verify all sections — focus only on the sections
matching the files you actually touched.

#### 1-7. Run Validation Scripts

Run in order. Each must pass before proceeding to the next.

```bash
# Always run
yarn lint
yarn format 2>&1 | grep -v "unchanged"
```

```bash
# Run only if .ts files were modified
# Vitest picks up tests matching changed files via --changed or explicit path
yarn test --run
```

```bash
# Always run — confirms the build emits dist/ cleanly
yarn typecheck
yarn build 2>&1 | tail -20
```

If any step fails, fix the issue and re-run that step before continuing.

---

### Step 2 — Invoke review-agent (round 1)

```
"Review the code on branch {branch}. This is round 1."
```

Wait for exit signal.

```
status: approved           → proceed to Step 3
status: changes_requested  → proceed to Step 2a
status: loop_limit_reached → stop, report to user
```

#### Step 2a — Findings exist: fix directly

1. Fix both `required` and `recommended` findings directly.
2. **Post-fix Self-Review**: For each file modified during this fix round:
   a. Run the matching checklist from Step 1-5 (Domain / Infrastructure / Test).
   b. Re-read the matching rule sections (Step 1-6) and verify no new violations
      were introduced by the fix.
   c. When fixing a pattern violation, verify the entire file for the same pattern —
      not just the specific line mentioned in the finding.
3. Re-run validation (Step 1-7).
4. Record to fix-log (Step 2b).

#### Step 2b — Record to Fix Log

Append each fix to `docs/__agents_only__/fix-log.md`. Create the file if it does not exist.

**Before recording any entry, check the destination docs first** (CONVENTIONS.md, PUBLIC_API.md, the layer CLAUDE.md files; see Rule Homes in `CLAUDE.md`).
If the violation is already documented there (same rule ID, same pattern), **skip that entry entirely**.
Only record violations that are not yet covered by an existing rule.

Format:
```md
## [Issue #{number} | {branch name} | {date YYYY-MM-DD}]
- Violation: {short description of what rule was violated}
- Rule: {rule ID in FILE#RULE-ID form, e.g. CONVENTIONS.md#TE-5; or FF.md section if no ID exists}
- Context: {one sentence describing where and why this happened in the code}
```

Then re-invoke review-agent with round incremented.
**You must include the explicit `modified_files` list** — the files you actually edited during the fix.
review-agent will only read these files, not the full diff.

```
Review the code on branch {branch}. This is round {N}.

Previous round findings (already fixed):
{previous findings JSON}

modified_files (files changed in this fix round):
{list of file paths you edited}

Focus only on modified_files above.
Do not re-review files that were already approved in the previous round.
```

**Loop detection:** After each `changes_requested` signal, compare the new findings against the previous round's findings. If the same `required` finding (same file + same issue description) appears in two consecutive rounds, stop immediately and report to the user.

---

### Step 3 — Invoke mistake-managing-agent

```
"Read docs/__agents_only__/fix-log.md and promote recurring violation patterns into CONVENTIONS.md / PUBLIC_API.md / the layer CLAUDE.md files."
```

Wait for exit signal.

```
status: done   → proceed to Step 4
status: failed → stop, report to user
```

### Step 4 — Invoke git-agent

```
"Commit the implementation on branch {branch} and open a PR. Issue title: {issue title}"
```

Wait for exit signal.

```
status: done   → report pr_url to user and stop
status: failed → stop, report to user
```
