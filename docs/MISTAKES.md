# Common Mistakes

Mistakes that Claude Code repeatedly makes.
Review before implementation and ensure these are not repeated.

Rules already documented in CONVENTIONS.md, FF.md, ARCHITECTURE.md, or DOMAIN.md are NOT repeated here.
This file contains only **recurring gotchas** that agents keep missing despite existing documentation.

`siglens-core` is a pure TypeScript library — UI / React / Next.js concerns are out of scope
and have been removed from this file.

---

## Coding Paradigm

```
1. Reimplementing the same algorithm
   → Check for existing helpers before writing a new function
   → Separate number[]-based helpers from Bar[]-based wrappers for reuse
   → Across provider pairs: extract shared logic to infrastructure/ai/utils.ts

2. Identical values queried or computed multiple times in a single function
   → Extract to a local const or assign once before using repeatedly
   → Applies to loop boundaries, array calculations, and function returns
   ❌ map.get(key) called twice with the same key
   ❌ for (let i = 0; i < array.length; i++) with length queried each iteration
   ❌ computeBbWidth(lastBB) called in loop setup and inside loop body (when checking lastIdx)
   ✅ const value = map.get(key); reuse value
   ✅ for (let i = 0; i < lastIdx; i++) { ... }; widthLast = computeBbWidth(lastBB) after loop
   ✅ const length = array.length; for (let i = 0; i < length; i++)

3. Discarding the callback parameter and re-accessing via external array index
   ❌ lines.reduce((acc, _line, idx) => { const line = lines[idx]; ... })
   ✅ lines.reduce((acc, line) => { ... })

4. Leaving logic that has no effect
   → filter/map that doesn't change the result, catch-all conditions that never execute
   ❌ data.flatMap(...).filter(x => x.id === uniqueId)  // uniqueId guaranteed from flatMap
   ✅ data.flatMap(...)

5. Array/object mutation via push/splice or direct property assignment
   → Use spread syntax for arrays; destructure and spread for objects
   ❌ keywords.push(value)  // direct mutation
   ❌ obj.property = newValue  // direct mutation of object created moments before
   ✅ const keywords = [...keywordList, value]
   ✅ const obj = { ...source, property: newValue }

6. Repeating identical filtering/calculation logic across multiple call sites
   → Extract to a shared pure helper (domain/ preferred) or module-level const

6.5. State / function / documentation divergence — parts of the system not synchronized when requirements change
   → When function implementation changes, all related functions in the same module must use a consistent approach
   → When prompt/instruction fields are updated, all field lists and documentation must stay synchronized
   ❌ collectMdFiles uses recursion but countSkillFiles uses non-recursive readdir
   ❌ Prompt field added to first list but omitted from second list in same instruction block
   ✅ countSkillFiles reuses collectMdFiles for consistency
   ✅ All field lists synchronized when new fields are added

7. Tight coupling between interface props and dependent files
   → Group related prop pairs into a single type

8. Complex anonymous expressions (IIFE, multi-statement ternary)
   → Extract to a named helper function

9. Function/interface names become inaccurate after architectural changes
   → When replacing implementations, renaming patterns, or moving code, update the names
   ❌ fetchBars (no longer a fetch — now reads from cache)
   ✅ loadBars (accurate to new implementation)
   → Also applies when external dependencies are removed: submitAnalysisAction + pollAnalysisAction are no longer Next.js server actions, should be renamed
   ✅ submitAnalysis + pollAnalysis when migrated to general infrastructure layer

9.5. Module-internal exports missing @internal JSDoc tag
   → Every function/constant exported from a module but not re-exported in src/index.ts must have /** @internal */ JSDoc
   → Enables IDE tooling and consumers to distinguish public API from internal helpers
   ❌ export function createSessionCookie(user) { ... }  // in sessionCookie.ts, not in src/index.ts
   ❌ export const DEFAULT_SESSION_TTL_SECONDS = 2592000;  // private constant, no @internal tag
   ✅ /** @internal */ export function createSessionCookie(user) { ... }
   ✅ /** @internal */ export const DEFAULT_SESSION_TTL_SECONDS = 2592000;

9.6. Bare @internal tag without descriptive comment
   → Bare /** @internal */ is valid but a one-line role description is preferred for clarity
   → Helps developers understand the module-internal helper's purpose without diving into implementation
   ❌ export function createSessionCookie(user) { /** @internal */ ... }
   ✅ /** @internal Helper to attach session cookie to response. */ export function createSessionCookie(user) { ... }

10. Using .sort() instead of .toSorted()
    → .sort() mutates the original array and violates immutability
    ❌ arr.sort() // in-place mutation
    ✅ arr.toSorted() // returns new sorted array

11. eslint-disable suppresses lint warnings instead of fixing root cause
    → Never suppress warnings with eslint-disable-next-line or inline comments
    → Always restructure the code to fix the actual issue

12. Using let + if/catch for conditional assignment instead of declarative const expressions
    → Prefer ternary/conditional expressions (const) over imperative reassignment (let)
    → Applies to both if-reassignment and .catch() handler reassignment patterns
    ❌ let result = value; if (condition) result = newValue; return result;
    ❌ let skillsDegraded = false; loadSkills().catch(() => { skillsDegraded = true; });
    ✅ const result = condition ? newValue : value; return result;
    ✅ const { skills, skillsDegraded } = await loadSkills().then(s => ({ skills: s, skillsDegraded: false })).catch(() => ({ skills: [], skillsDegraded: true }));

13. Hardcoded literals in function names or calculations
    → All magic numbers and constant values must be extracted to module-level constants
    → Function names must remain accurate when the underlying constant value changes
    ❌ function computeSecondsUntilKst17() { ... } where 17 is hardcoded; renaming breaks if constant changes
    ❌ Math.round(rawPrice * 100) / 100 with no constant for decimal factor
    ✅ const CACHE_EXPIRY_HOUR_KST = 17; function computeSecondsUntilCacheExpiry() { ... }
    ✅ const PRICE_DECIMAL_FACTOR = 100; Math.round(rawPrice * PRICE_DECIMAL_FACTOR) / PRICE_DECIMAL_FACTOR

14. Defaulting to imperative for-loop + push when a higher-order function is equally readable and efficient
    → Prefer map, filter, flatMap, reduce for straightforward one-item → one-result transformations
    → for-loop + push is acceptable when:
      · The functional equivalent would increase time complexity (see #14.5 — spread inside flatMap/reduce causes O(N²))
      · Conditional multi-push per iteration makes flatMap + spread harder to read without measurable clarity gain
    ❌ const result = []; for (const item of data) { result.push(transform(item)); } return result;
       → replace with data.map(transform); no complexity difference, declarative wins
    ✅ const result = data.map(transform); return result;
    ✅ const result: T[] = [];
       for (let i = period; i < n - period; i++) {
           if (bars[i].high === winMax[i]) result.push({ type: 'high', ... });
           if (bars[i].low  === winMin[i]) result.push({ type: 'low',  ... });
       }
       → each iteration conditionally appends 0–2 items; flatMap + spread equivalent adds intermediate arrays without clarity gain

14.5. Reduce + spread operator causing O(N²) array accumulation
    → When reducing values into an array, use pre-allocated array + for loop or for loop + push, NOT reduce + spread
    → Applies to sliding windows, EMA calculations, and any cumulative sequence building
    ❌ reduce((acc, val) => [...acc, transform(val)], [])  // O(N²) — new array copied each iteration
    ❌ .slice().map() inside reduce — recomputes slice for each reduction step
    ✅ const result = []; for (const val of values) { result.push(transform(val)); } return result;
    ✅ Use pre-allocated typed array for performance-critical indicators (ATR, EMA, MA)

15. Domain / infrastructure functions incomplete test coverage — missing unit tests entirely or covering <90% branches
    → Every new domain / infrastructure function must have dedicated unit tests with at least 90% branch coverage
    ❌ callGeminiWithKeyFallback added to infrastructure/ai/gemini.ts without src/__tests__/infrastructure/ test file
    ❌ extractReconciledActionLines added to domain/analysis/ without corresponding unit tests for 8+ cases
    ✅ src/__tests__/domain/analysis/actionRecommendation.test.ts with cases: undefined rec, missing levels, duplicates, zero values, empty result
    ✅ New infrastructure functions tested in parallel src/__tests__/infrastructure/ test file with all branches covered

16. Inadequate defensive checks on financial data (division by zero, negative values, bounds)
    → Financial values require explicit guards before use — null/undefined checks insufficient
    → takeProfit, entryPrice, stoploss must be validated for sensible ranges (>0, within bounds)
    → Prevent negative R:R, invalid leverage, or meaningless outputs
    ❌ Number.isFinite(tp) only; allows tp = 0 or tp < 0 which breaks logic downstream
    ❌ const reward = tp - entryPrice; no guard for tp <= entryPrice, can yield negative R:R
    ✅ Number.isFinite(tp) && tp > 0 && tp !== entryPrice; return early if invalid
    ✅ if (tp <= entryPrice) return ''; // meaningless result, prevent

17. Shared constants duplicated across module boundaries without documentation
    → When a module cannot import shared constants (environment constraints), duplicate with explicit JSDoc linking to the source
    → Every duplicate must reference the original constant and document the sync requirement
    ❌ worker/src/index.ts: JOB_TTL_SECONDS = 3600  // matches queue.ts but no link or comment
    ✅ // Matches JOB_TTL_SECONDS in queue.ts; update both if changed
       const JOB_TTL_SECONDS = 3600;
```

---

## TypeScript

```
0. Pre-computing a conditional value outside its guard block causes type narrowing loss
   → When a value is only valid inside a conditional branch, compute it inside that branch
   → TypeScript cannot narrow the type to the non-null/non-undefined value outside the block
   ❌ const usageOccurredAt = usage !== undefined ? new Date(usage.occurredAt) : new Date();
      if (usage !== undefined) {
        recordUsage(usageOccurredAt);  // TS cannot narrow usageOccurredAt to Date without `!`
      }
   ✅ if (usage !== undefined) {
        const usageOccurredAt = new Date(usage.occurredAt);
        recordUsage(usageOccurredAt);  // TS knows usageOccurredAt is Date
      }

1. Object.fromEntries return type mismatch
   → Type assertion required: Object.fromEntries(pairs) as Record<K, V>

2. Missing fields in domain interface that exist in data source
   → When parsing new fields in infrastructure, add them to the domain interface immediately

3. Unused/missing type imports
   → Remove unused type imports; add missing ones for explicit annotations
   → When TypeScript infers automatically, the import is unnecessary

3.5. Multiple import blocks from the same module
   → Merge all imports from a single specifier into one block
   ❌ import type { SiglensDatabase } from './types';
      // ... code ...
      import type { AuthUserRecord, CreateEmailUserInput } from './types';
   ✅ import type { SiglensDatabase, AuthUserRecord, CreateEmailUserInput } from './types';

4. Interface field declaration does not match runtime behavior
   → Required fields marked `?` in the interface or absent fields declared as required
   → When tests and implementation show a field is optional, update interface to `fieldName?`
   ❌ interface Bars { bars: BarData[] }  // but implementation checks bars ?? []
   ✅ interface Bars { bars?: BarData[] }  // interface reflects runtime reality
   → Recurring mistake (fix/post-210a423 PR #75 R8): JSDoc field descriptions contradict actual type optionality.
      When a field is optional (?), JSDoc must use conditional language ("Must be provided when...") not "Required".
      Verified: Task 4 @param status discriminant mismatch, Task 6 FUNDAMENTAL_CACHE_TTL claims vs actual code.

5. Inline type annotations used instead of named type aliases
   → Extract repeated or reusable type patterns to named type aliases
   ❌ interface Options { size?: 'sm' | 'lg'; fields: readonly { label: string; key: string }[] }
   ✅ type Size = 'sm' | 'lg'; interface FieldDef { label: string; key: string }; interface Options { size?: Size; fields: readonly FieldDef[] }

6. Union literals with 3+ occurrences in different files → not extracted to named type
   → Domain indicators frequently repeat trend/direction unions across result types
   → When a union appears in 2+ result types, extract to domain/types.ts
   ❌ ParabolicSARResult { trend: 'up' | 'down' | null }; SupertrendResult { trend: 'up' | 'down' | null }
   ✅ type TrendDirection = 'up' | 'down' | null; ParabolicSARResult { trend: TrendDirection }; SupertrendResult { trend: TrendDirection }

7. Using `as` type assertions instead of type guards or non-null assertion operators
   → Prefer type guards, `!` operator, or satisfies keyword over `as` casts
   → Prefer `!` operator when null is logically impossible, or narrowing guards for conditional paths
   ❌ const value = getValue() as number;  // hides null check
   ✅ const value = getValue()!;  // non-null assertion when null is logically impossible
   ✅ const value: number = getValue() ?? 0;  // type guard with fallback
   ⚠️  Safe-cast exception: `as` is allowed when TypeScript's type system structurally widens a
      value whose runtime type is already guaranteed by the surrounding type — NOT to force-cast
      a value that could genuinely be null, undefined, number, or string at runtime.
   → The key distinction:
      Safe  — TS cannot express the constraint, but the runtime value is provably correct
      Unsafe — the runtime value could actually be a different type; `as` hides the real problem
   ❌ const value = fetchData() as MyType;       // runtime value may be null/undefined/wrong shape
   ❌ const x = someString as SpecificLiteral;   // string may not satisfy the union at runtime
   ✅ // Object.keys widens to string[], but SKILL_STAT_CONFIG: Record<SkillType, …> guarantees keys
      const SKILL_TYPES = Object.keys(SKILL_STAT_CONFIG) as SkillType[];  // TS limitation, not runtime risk
   → Mandatory: every safe-cast `as` must be accompanied by a comment explaining TWO elements:
      (a) WHY the cast exists (the narrowing/structural guarantee)
      (b) WHY it's safe at runtime (the runtime invariant that TS cannot express)
   ❌ newsField as NewsAxisOptions  // comment only states "suppress TS error" without explaining runtime guarantee
   ✅ // Array.isArray(newsField) narrowed to object branch; TS cannot auto-narrow object literal type,
      //  but structural match with NewsAxisOptions is guaranteed
      newsField as NewsAxisOptions
   ❌ inputs as { newsOptions?: NewsAxisOptions }  // comment explains intent (suppress deprecation) but not safety
   ✅ // Property spread from validated inputs; newsOptions when present is structurally identical to NewsAxisOptions
      inputs as { newsOptions?: NewsAxisOptions }
   ⚠️  Test file exception: `as` casts in `*.test.ts` files (e.g. test stubs typed with
      `as unknown as SomeType`, `vi.fn() as Mock<...>`) do NOT require a comment.
      Test stubs intentionally implement only the subset of an interface exercised by the test;
      adding a comment to every stub cast adds noise without safety value.
      ✅ `}) as unknown as Dirent;` — no comment needed in test files
   → Recurring mistake (fix/post-210a423 Tasks 1, 7, PR #76 R2): as-casts without accompanying safety comment,
      especially in guard branches (normalize*.ts sentinel checks, dependency resolver type narrowing).
      Review every `as` during code review to ensure inline explanation is present covering BOTH intent AND runtime guarantee.

8. Sibling types in the same error/result shape follow inconsistent declaration patterns
   → When multiple related type fields appear in the same interface, they must all use the same strategy (domain alias or inline literal)
   → Inconsistency creates maintenance burden and breaks pattern-matching across siblings
   ❌ interface ErrorShape { code: DomainErrorCode; field: 'email' | 'password' }  // code uses alias, field uses inline
   ✅ interface ErrorShape { code: RegisterErrorCode; field: RegisterErrorField }  // both use named aliases
   ✅ interface Result { ok: boolean; error: ChatErrorCode | ChatUsageLimitError }  // discriminated at top-level; each branch narrows error type
   → When return types have discriminated union branches, each branch must have its own distinct error type annotation
   → Mixing multiple error types in a single discriminant field prevents type narrowing and pattern-matching
   ❌ { ok: false; error: ChatErrorCode | ChatUsageLimitError }  // error field accepts both; callers must typeof-guard
   ✅ Split into separate union branches:
      { ok: false; error: ChatErrorCode } | { ok: false; error: ChatUsageLimitError }
   → Discriminator field values must be distinct across all union variants — colliding discriminants break type narrowing
   ❌ type Result = { status: 'error'; message: string; axis?: string } | { status: 'error'; limitError: true }
      // Both variants share status:'error'; result.status==='error' yields union, not single type
   ✅ type Result = { status: 'error'; message: string; axis: OverallAxis } | { status: 'limit_error'; limitError: true }
      // Each variant has unique status discriminant; narrowing resolves to single type (PR #76 B2)

9. Complex type inference chains instead of importing direct types
   → When a function's return type can be expressed as an imported concrete type, prefer direct import over inference chains
   → Inference chains (Awaited<ReturnType<typeof fn>>, Omit<T, K>, etc.) prevent type narrowing and obscure the actual contract
   ❌ type SkillProvider = Awaited<ReturnType<typeof skillsLoader.loadSkills>>;  // infers Promise<Skill[]> → Skill[]
      → but then helper is called with `SkillProvider | undefined` — caller cannot narrow through destructuring
   ❌ UsageLimitError builder preserves union { code: 'analysis' | 'chatbot'; ... } instead of discriminated { code: 'analysis'; ... } | { code: 'chatbot'; ... }
      → caller receives union type and must runtime-check even though builder could narrow
   ✅ type SkillProvider = Skill[];  // import Skill directly; explicit and preserves narrowing
   ✅ UsageLimitError as discriminated union: type AnalysisLimitError { code: 'analysis'; ... } | type ChatbotLimitError { code: 'chatbot'; ... }
      → callers can now narrow with type discriminator without runtime typeof/field checks

9.5. Inline dynamic type import in generic argument instead of top-level static import
   → Type imports used in generic arguments or type positions must be top-level imports, not inline dynamic imports
   → Inline dynamic imports (import('...').Type) work at runtime but harm readability and type checking
   ❌ type Result = T extends SomeCondition ? import('./module').DynamicType : null;
   ❌ function process<T>(input: T): Promise<import('./other').PromiseType>  // dynamic type in return position
   ✅ import type { DynamicType, PromiseType } from './module';
      type Result = T extends SomeCondition ? DynamicType : null;
      function process<T>(input: T): Promise<PromiseType>
```

---

## Domain Functions

```
1. Hidden selection/filtering rules left implicit
   → Expose explicitly (e.g. per-timeframe EMA selection)

2. Silent fallback without exposing degradation to caller
   ❌ skillsLoader.loadSkills().catch(() => [])
   ✅ .catch(error => { console.error(...); return []; }) + expose skillsDegraded on return

3. Sentinel values wrapped in functions that silently break the contract
   → Sentinel values (-1, null, undefined) must propagate unchanged through call chains
   ❌ Math.max(0, sentinel ?? fallback)  // Math.max converts -1 to 0, breaking sentinel behavior
   ✅ sentinel === -1 ? -1 : Math.max(0, sentinel)  // explicit guard before wrapping

4. Date.now() / process.env / fetch called from domain/
   → domain/ must remain pure. All time / environment / I/O reads belong in infrastructure/.
   → If a calculation genuinely needs the current time, pass it as a parameter.

4.5. Bare new Date() in domain/infrastructure bypasses injected clock parameter
   → When a function accepts `now` or `occurredAt` as a parameter for testability and injection, use it consistently
   → Mixing bare new Date() calls with injected time parameters breaks clock mocking in tests
   ❌ function analyzeSnapshot(snapshot, options: { now?: Date }) { const time = new Date(); ... }
      // ignores options.now, so tests cannot control time
   ✅ function analyzeSnapshot(snapshot, options: { now?: Date }) { const time = options.now ?? new Date(); ... }
   ✅ Better: if now is required, make it non-optional: (snapshot, options: { now: Date }) => { const time = options.now; ... }
```

---

## Infrastructure Functions

```
1. Conditional logic branches must all update shared data consistently
   → Background jobs and retry paths must produce same data shape as main path
   → When caching results, all code paths must store the same fields
   ❌ Main path: cache.set(symbol, { symbol, name, koreanName, fmpSymbol })
      Background job: cache.set(symbol, { symbol, name, koreanName })  // fmpSymbol missing
   ✅ Both paths: cache.set(symbol, { symbol, name, koreanName, fmpSymbol })

2. Infrastructure functions must have at least 90% branch coverage
   → All if/else, optional chaining (?.), nullish coalescing (??) paths tested
   → Test edge cases like subsecond boundaries, zero values, Math.max guard behavior
   → Includes guard branches, sentinel-check paths, and throw branches that appear to be dead code in the main flow
   ❌ Math.max(1, Math.floor(diffMs / 1000)) guard that converts 0→1 untested
   ❌ Sentinel guard checking `in` predicate or exception handler lacks dedicated test case
   ❌ throw new Error(...) path when guard condition fails not covered by any test case
   ✅ Add test case: diffMs = 500ms covers the Math.max(1, 0) = 1 path
   ✅ Sentinel guard paths: if (fieldName in object) return normalize(...) as SafeType; add test case triggering the guard
   ✅ Throw paths: add test(..., () => { expect(fn()).toThrow(); }) for every error branch
   → Recurring mistake (fix/post-210a423 Tasks 2, 7, PR #76 R2): Guard, sentinel, and throw branches skipped in test coverage,
      causing surprise bugs when guard condition occurs in production (Task 2 error paths, Task 7 r1 sentinel checks, PR #76 B3 throw branch).

3. No debug artifacts (console.log) in infrastructure files
   → Infrastructure functions are utilities; logging belongs in higher layers
   ❌ getBars() { console.log(...timing...); return bars; }
   ✅ Remove logging; expose metrics via return type if needed

4. Environment variable reads scattered across infrastructure/ modules
   → Centralize each external system's env reads in a single config module
   → e.g. infrastructure/cache/config.ts reads UPSTASH_* vars; other modules import from config

5. Drizzle onConflictDoUpdate must explicitly set updatedAt and use excluded values
   → db.insert().onConflictDoUpdate() SET clauses must reference excluded.* for conflict values
   → Drizzle's $onUpdateFn hook (auto-timestamp via updatedAt: sql`now()`) applies only to db.update().set(), NOT to onConflictDoUpdate()
   → Conflict resolution must explicitly include updatedAt: sql`now()` in the SET clause and use excluded.* for all value columns
   ❌ .onConflictDoUpdate({ target: [table.id], set: { symbol: table.symbol, name: table.name } })
      → updatedAt not refreshed; symbol/name not replaced with new values (references old table columns)
   ✅ .onConflictDoUpdate({ target: [table.id], set: { symbol: excluded.symbol, name: excluded.name, updatedAt: sql`now()` } })
      → updatedAt refreshed on conflict; new values applied from excluded row
```

---

## Fire-and-Forget Operations

```
1. Fire-and-forget fetch requests must have timeouts
   → fetch() without timeout can block indefinitely on network delay
   → Apply AbortSignal.timeout(ms) to prevent blocking and allow cancellation via AbortController
   → Match the timeout duration to the operation's criticality (e.g. 5sec for I/O ops, 30sec for polling)
   ❌ fetch('/cancel', { method: 'POST' })  // no timeout; can block indefinitely
   ❌ fetch(url, { signal: AbortSignal.timeout(Infinity) })  // infinite timeout defeats the purpose
   ✅ fetch('/cancel', { method: 'POST', signal: AbortSignal.timeout(5000) })
   ✅ fetch(url, { method: 'POST', signal: AbortSignal.timeout(30000) })  // 30sec for batch jobs

2. Fire-and-forget async calls must swallow errors
   → Error propagation from background tasks blocks the caller
   → Wrap in try-catch, log warning, and return normally
   ❌ async function cancelJob() { await fetch('/cancel'); }  // throws to caller if fetch fails
   ✅ async function cancelJob() { try { await fetch(...); } catch (e) { console.warn('Background action failed', e); } }
```

---

## Tests

```
1. Not updating tests when return type changes
   → Nullable changes (T[] → (T | null)[]) require a null test case

2. New field/indicator without corresponding test cases
   → Every new field needs at least one it() verifying its presence

3. beforeEach/beforeAll at module level instead of inside describe block

4. Boundary test constant redefined locally instead of imported from source
   ❌ const TEST_PERIOD = 14;
   ✅ import { RSI_DEFAULT_PERIOD } from '@/domain/indicators/constants';

5. Missing edge case coverage when refactoring or moving functions
   → Each module must test its own edge cases directly

6. Test duplication — each it() must test exactly one unique behavior

7. Provider pair must have symmetric error handling, test coverage, and naming
   → When one Provider changes, apply the same change to all Providers

8. Repeated identical parameter object passed to multiple function calls
   → Extract to const at the top of the test

9. Test describe text promises assertions not verified by its it() cases

10. Type field added but test mock objects not updated
    → All mock/fixture objects must match the updated interface

11. External dependencies in production code without corresponding test mocks
    → When adding external packages to infrastructure files, mock them in all corresponding test files using Vitest's `vi.mock`
    → `vi.mock('@package-name', ...)` must be added to every test file that tests the module with the external dependency

12. Period-based indicator tests only verify sign (positive/negative) without toBeCloseTo reference values
    → Every period-based indicator test must include toBeCloseTo checks against manually-calculated expected values
    → Warming-up period constants must be imported from source, not manually redefined in tests
    → Boundary constants must account for full algorithm dependency chains (e.g. nested window calculations)
    ❌ test('trend is positive', () => expect(values[idx]).toBeGreaterThan(0))  // no actual value verification
    ✅ test('first value matches reference', () => expect(values[minBarsIdx]).toBeCloseTo(expectedValue))

13. Redefining production functions/constants locally in tests
    → Tests must import and verify production code directly; local redefinitions become tautological
    ❌ test('shouldShowAd', () => { const shouldShowAd = (x) => x.enabled; expect(shouldShowAd(mock)).toBe(true); })
    ✅ import { shouldShowAd } from '@/domain/ads'; test('shouldShowAd', () => { expect(shouldShowAd(mock)).toBe(true); })
    → Expected values from module exports must also be imported, not hardcoded

13.5. Vacuous test assertions with no meaningful verification
    → Every test must contain at least one meaningful assertion that exercises production logic
    → Placeholder tests like `expect(true).toBe(true)` or `expect(fn).toBeDefined()` are dead and add no value
    → Either delete the test or rewrite it to exercise the real behavior path being tested
    ❌ test('usage 미제공 시', () => { expect(true).toBe(true); })  // placeholder, no actual assertion
    ❌ test('result shape', () => { const result = submitAnalysis(...); expect(result).toBeDefined(); })  // trivial
    ✅ test('usage 미제공 시', () => { const result = submitAnalysis(input, { /* no usage */ }); expect(result.status).toBe('submitted'); expect(result.jobId).toMatch(/^[a-z0-9-]+$/); })
    → Recurring mistake (PR #76 R2 S1): submitFundamentalAnalysis test was a stub with expect(true).toBe(true); rewritten to assert status and jobId shape

14. Time-dependent functions in tests must be explicitly mocked
    → Functions using Date.now(), new Date() must be mocked (vi.useFakeTimers / vi.setSystemTime)
    → Hard-coded expected values (e.g., TTL seconds) without mocking time sources cause flaky tests
    ❌ analyzeAction test: expect(ttl).toBe(86400); without mocking new Date()
    ✅ vi.setSystemTime(new Date('2024-01-01T00:00:00Z')); expect(ttl).toBe(expectedTtl);

15. Reaching out to real external services inside tests
    → Tests must never hit Upstash, Neon, AI provider endpoints, or any real network destination
    → Replace each infrastructure interface (AnalysisCache, AiProvider, etc.) with a stub / vi.fn mock
```

---

## File Format

```
1. Files missing EOF newline
   → All files must end with a newline character (CONVENTIONS.md requirement)
   → Generated files (migrations, configs) often omit the trailing newline
   ❌ drizzle/0001_sharp_triathlon.sql missing newline at EOF
   ✅ Add newline manually after generation; configure generator to emit EOF newline
```

---

## Documentation Sync

```
1. Skill document metadata and body content out of sync
   → Frontmatter indicators list must include all indicators referenced in the document body
   → AI instructions must reflect the system's actual capabilities, not idealized requirements
   ❌ mean-reversion.md body uses 2×ATR but frontmatter indicators omits atr
   ✅ Frontmatter includes all body references; update AI instructions to match actual RECENT_BARS_COUNT=30

2. External service usage changes not reflected in docs/API.md
   → When env vars or endpoints change in infrastructure/, update docs/API.md the same PR
   → Include the full list of required / optional env vars

3. Inline code comments reference removed or changed implementation
   → Module-level JSDoc blocks must document current behavior, not legacy/removed code
   → When changing function implementation, update related comments immediately

4. Tier 1 public exports missing required JSDoc tags
   → Tier 1 functions require @param and @returns tags for IDE hover documentation
   → Recommended tags (@example, @see) improve consumer guidance
   ❌ export function loginUser(input, deps) { ... }  // missing all JSDoc
   ❌ export function registerUser(...) { /** description only */ }  // no @param/@returns/@example/@see
   ✅ export function loginUser(...) { /** description. @param input deps. @returns result. @example usage. @see related */ }
   → Also applies to Tier 2 functions: description + @param + @returns required

4.5. Tier 2 and Tier 4 public functions/methods missing @param/@returns JSDoc
   → Tier 2 functions and Tier 4 interface methods require @param and @returns JSDoc tags
   → Per-method documentation is mandatory for public contracts; single-line description alone is insufficient
   → JSDoc statements must match actual implementation behavior: @returns type, @param discriminants, @example usage must be verified against current code
   ❌ export function getProvider(id) { ... }  // only description, no @param/@returns
   ❌ interface UserRepository { getUserTier(userId) { ... } }  // no per-method JSDoc
   ❌ /** @returns boolean */ export function cancel(jobId) { ... } // actually returns void or Promise<void>
   ❌ /** @param status The job status ('processing'|'completed') */ when status is actually 'submitted' not 'processing'
   ✅ /** Get provider by ID. @param id The model provider identifier. @returns The provider spec. */ export function getProvider(id) { ... }
   ✅ interface UserRepository { /** Get user tier. @param userId The user ID. @returns The tier or null. */ getUserTier(userId); }
   → Recurring mistake (fix/post-210a423 Task 4, Task 6): JSDoc claims diverge from actual implementation.
      Task 4: cancel @returns boolean (actually void), @example using wrong type (pendingJobs as array), @param status 'processing' (actually 'submitted').
      Task 6: FUNDAMENTAL_CACHE_TTL JSDoc claims dynamic TTL (hardcoded constant, no dynamic behavior).
      Always verify @returns type, @param discriminants, and @example code against actual function before approval.

4.7. Tier 2/Tier 4 public symbols documented in Korean instead of English
   → All exported public functions, types, constants, and interfaces must have English JSDoc and comments
   → Package consumers read TypeDoc and IDE autocomplete in English; non-English documentation is inaccessible and breaks contract clarity
   ❌ export function getEtSessionStatus(date: Date) { /** 세션 상태 조회 */ ... }  // Korean description
   ❌ export type EtSessionStatus = 'open' | 'closed'; // 시장 세션 상태  // Korean comment
   ❌ // 미국 마켓 오픈 시간 / export const MARKET_OPEN_HOUR = 9;  // Korean comment
   ✅ export function getEtSessionStatus(date: Date) { /** Get current ET market session status. @param date ... @returns ... */ ... }
   ✅ export type EtSessionStatus = 'open' | 'closed'; // US market session state
   ✅ // US market open time (9:30 ET) / export const MARKET_OPEN_HOUR = 9;
   → Recurring (PR #103 R1–R2): 4+ instances across getEtSessionStatus, isEtRegularSessionOpen, EtSessionStatus type, and MARKET_* constants.
      Pattern: public functions and types have Korean JSDoc; block comments above constants are in Korean.
      Checkpoint before approving: scan all new public exports for Korean text; rewrite to English if found.

5. JSDoc tags reference specific call-sites instead of describing timeless purpose
   → @internal, @param, @returns must describe the function's role independent of any caller
   → JSDoc is documentation for all consumers, not a call-site comment
   ❌ /** @internal session expiry calculation used in loginUser */ export function addSeconds(...) { ... }
   ✅ /** @internal Helper to add seconds to a Date. */ export function addSeconds(...) { ... }

6. @throws JSDoc tag missing error type annotation
   → @throws must include type annotation: @throws {ErrorType} description
   → Bare @throws description omits the type annotation needed by IDE tooling and consumers
   ❌ /** @throws description of error */ export function doSomething() { ... }
   ✅ /** @throws {Error} description of error */ export function doSomething() { ... }
```

---

## Predictability

```
1. Including unrelated changes in a PR without documented justification
   → Each commit/PR should focus on a single concern
   → Unrelated changes must be moved to separate PRs or reverted
   → If a related change is necessary, document the reason in a comment or commit message

2. Conditional checks that duplicate type system guarantees
   → If a type system guarantees a field is present, do not add optional chaining or truthiness checks
   ❌ !!assetInfo?.name  // when AssetInfo.name is required
   ✅ !!assetInfo  // sufficient when name is guaranteed

3. Documentation examples contradict actual business logic
   → Skill documents must reflect actual system capabilities and conditions
   → Example scenarios must match the signal conditions they describe

4. Destructive dependent writes racing ahead of prerequisite reads
   → When multiple operations are part of the same use-case, prerequisite reads must complete before dependent destructive writes
   ❌ await revokeOAuthTokens() (fire-and-forget) → await deleteUser() (user row deleted) → tokens no longer exist for lookup
   ✅ const tokens = await loadOAuthAccounts(); await deleteUser(); await revokeTokens(tokens) (fire-and-forget);

5. Related use-cases with the same lifecycle concept returning inconsistent shapes
   → Session termination (logout, delete account) must return the same metadata shape
   ❌ logoutUser returns { ok: true, cookie: AuthSessionCookie } but deleteAccount returns { ok: true }
   ✅ Both return identical shape so callers can chain the same downstream logic

6. Paid-tier analytics not covering all billable tiers
   → Usage tracking must record every paid tier that has feature/model access, not just one tier
   ❌ Premium model usage tracking records only 'member' tier, skips 'pro'
   ✅ Record premium model usage for all non-free tiers (member, pro, enterprise)

7. Public helper return ordering depends on container structure instead of stable order
   → Lists returned from public APIs must maintain stable iteration order independent of underlying config structure
   ❌ model list order depends on Record<string, ...> insertion order in tier config
   ✅ Sort deduplicated results with toSorted() before returning

8. Malformed persisted state handled inconsistently with other invalid inputs
   → Persisted token state (Redis, cache) must validate before use, producing consistent invalid-token result as other bad inputs
   ❌ safeCompareTokenHashes accepts non-hex 64-char string, throws during timingSafeEqual
   ✅ Validate format (hex check, length) before comparison; return false/invalid on format error

9. Optional JSDoc fields mislabeled with "Required" in JSDoc when the type is optional (?)
   → Optional fields must use conditional language in JSDoc: "Must be provided when..." instead of "Required"
   ❌ userApiKey?: string with JSDoc "Required for..." — type says optional but doc says required
   ❌ paidApiKey?: string with JSDoc "Required for non-'pro'-tier users..." — contradicts optional type marker
   ✅ userApiKey?: string with JSDoc "Must be provided when using user-managed models"
   ✅ paidApiKey?: string with JSDoc "Must be provided when tier is not 'pro'"
   → Clarifies that the field is optional at the type level but required under specific conditions
```

---

## Design & Cohesion

```
1. Related data with shared keys/dependencies scattered into multiple constants
   → Data that must be updated together should live in a single object/constant
   ❌ const CONFIG = { level: [...], icon: [...] };  const TOOLTIP = { level: [...], text: [...] };
   ✅ const BADGE_DATA = { level: [{ icon, tooltip }, ...] };
   → When a new level is added, only one constant needs updating

2. Same resource created multiple times when a single instance would suffice
   → Cache resource creation or check for duplicates before creating
   ❌ const reader = new Redis(config); const writer = new Redis(config);
   ✅ const writer = new Redis(config); const reader = !token ? writer : new Redis(altConfig);

3. Deleting code marked with TODO without updating all references
   → TODO comments indicate intentional preservation for future references
   → Removing such code breaks commented-out code that still references it; restore or update all references first

4. Unrelated data mixed in a single constant
   → Constants with different purposes/domains should be in separate modules

5. Repeated literal values in the same module across multiple locations
   → Extract to a named constant; prevents silent divergence when updating
   → Applies to descriptions, messages, configuration values, and metadata strings

6. Dead code and orphaned files left behind after module refactoring
   → When code is ejected or refactored out, ALL related files and exports must be removed together
   → Orphaned type files (types.ts) or unnecessary helper exports left in place cause ambiguity and waste maintenance effort
   ❌ email/, oauth/ modules ejected but types.ts files left behind with no consumers
   ❌ Single-file utility function exported from module even though only that one file imports it
   ✅ Remove type files when consumers of those types are deleted
   ✅ Don't export file-private helpers; keep them internal with no export keyword
   → Also audit and remove unnecessary re-exports from public API and module barrels after refactoring

15. Dead code / unreachable fallback inside type-narrowed guard
   → When TypeScript narrows a type inside a guard block, fallback code outside or after the guard becomes unreachable
   → Remove dead fallback operators after establishing type safety
   ❌ if (options.tier !== undefined) { useTier(options.tier); }
      const tier = options.tier ?? DEFAULT_TIER;  // unreachable fallback; options.tier is already narrowed
   ✅ const tier = options.tier ?? DEFAULT_TIER;  // guard uses narrowed value directly
   ✅ Or better: if (options.tier === undefined) return; const tier = options.tier;  // non-null assertion guaranteed
```

---

## I/O & Error Handling

```
1. Unguarded I/O operations at different call depths
   → When one I/O operation in a module is protected with try-catch, all I/O operations at the same call depth must be equivalently protected
   → Prevents asymmetric failure modes where some operations degrade gracefully while others throw uncaught
   ❌ recordUsage wrapped in safe-try helper, but checkUsageAllowed calls getUsageToday without guard
   ✅ Add try-catch (fail-open) to checkUsageAllowed; protect all I/O at the same call depth
```

---

## Configuration & State Management

```
1. Configuration parameter accepted from multiple sources with divergent fallback chains
   → A single configuration option should have exactly one authoritative source
   → When the same config is accepted from both outer and inner function options, callers can set conflicting values
   ❌ SubmitAnalysisOptions.tierConfig and AnalysisUsageOptions.tierConfig both accepted; outer/inner could differ
   ✅ Accept tierConfig once at the entry point; pass it into all downstream helpers
   → Prevents hidden inconsistencies between gating decisions that should use the same config
```

---

## Public API & Module Exports

```
1. Public entrypoint exports become stale when module barrels are refactored
   → src/index.ts re-exports must stay synchronized with the module barrels they depend on
   ❌ src/index.ts exports DrizzleUserRepository, but infrastructure/db/index.ts later removes it
   ✅ After refactoring module barrels, verify all re-exports still exist in the barrel
   → src/index.client.ts must export the actual return type of functions, not a narrower/dead-code type
   ❌ src/index.client.ts exports SubmitAnalysisResult (missing TierTimeframeAccessError variant)
   ✅ Export SubmitAnalysisGatedResult (actual function return type) instead

2. New features add exports to one entrypoint but not to paired entrypoints
   → When adding a new feature's public API to src/index.ts, check if sibling entrypoints (src/index.client.ts, etc.) need the same exports
   → Different runtimes must have consistent public API coverage for stable tier model access
   ❌ Added tier model helpers to src/index.ts but omitted them from src/index.client.ts; browser consumers cannot render model choices
   ✅ After adding feature helpers to main entrypoint, verify all target-runtime entrypoints export them consistently

3. Tier 4 interface/type rename or deletion without deprecated alias (major semver bump required)
   → Renaming or deleting Tier 4 public types and interface fields breaks existing consumers at compile time (major version bump)
   → Must provide deprecated alias or fallback to maintain backward compatibility
   → When promoting Tier 4 types from one export status to another (@internal ↔ public), ensure consistency: types exported in src/index.ts must NOT carry @internal JSDoc
   ❌ Rename RequestChatCompletionDependencies.callGemini → callAiProvider without @deprecated alias; consumers passing { callGemini: fn } silently fail
   ❌ Hard rename CallGeminiWithKeyFallbackOptions → CallAiProviderOptions without re-export; existing imports error at compile
   ❌ Delete TierModel union members without @deprecated; code depending on those literals breaks
   ❌ Union variant types (SubmitFundamentalAnalysisCached, SubmitNewsAnalysisError) re-exported in src/index.ts but still tagged @internal; IDE autocomplete hides them
   ❌ FundamentalProfileInput.mktCap renamed to marketCap without @deprecated alias; code using old field name breaks
   ❌ FundamentalDataProvider.getGrades interface method removed without @deprecated retention (PR #76 B3)
   ✅ Keep old field with @deprecated JSDoc; implement fallback: const fn = deps.callAiProvider ?? deps.callGemini
   ✅ Export deprecated type alias: export type CallGeminiWithKeyFallbackOptions = CallAiProviderOptions
   ✅ Add deleted union members back with @deprecated tag; type checkers warn but code doesn't break
   ✅ Mark removed interface methods as optional @deprecated; consumers may omit implementation but call sites keep compiling
   ✅ Remove @internal from types that are re-exported in src/index.ts; @internal must not appear on public contract types
   → Also requires package.json version bump to 0.x.0 (major in 0.x semver) and CHANGELOG.md entry documenting BREAKING CHANGES
   → Recurring (PR #76 B1+B3): Type removal without deprecation for both type aliases (FundamentalProfileInput) and interface methods (getGrades).
      Pattern has appeared 3+ times across PR #75 R8, Task 1 R1, and PR #76; checkpoint needed in PR description template to verify
      deprecation aliases before approval. Before marking types public, verify: (1) all variant types are exported, (2) @internal tags removed from exported types,
      (3) old names preserved with @deprecated if renamed, (4) interface methods retained as optional @deprecated if removed.

6.5. Internal implementation constants/types leaked to public API via src/index.ts
   → Library public API must export only symbols consumers actually use
   → Implementation details (internal cache keys, Redis options, internal interfaces) must not be re-exported
   → Leaking internal symbols causes breaking changes when internals are refactored
   ❌ // cache/config.ts defines KOREAN_TICKERS_CACHE_KEY (internal implementation detail)
      // src/index.ts exports { KOREAN_TICKERS_CACHE_KEY } from '@/infrastructure/cache/config'
      // → consumers depend on internal constant; renaming breaks their code
   ❌ // jobs/types.ts defines RedisSetOpts (internal Upstash API options)
      // src/index.ts exports { RedisSetOpts } 
      // → consumers never use this; breaks when Upstash API changes
   ✅ Remove internal constants/types from src/index.ts export blocks
   ✅ Only export interfaces and functions consumers explicitly call (e.g., JobQueue, SkillsProvider)

7. PUBLIC_API.md documentation inventory becomes stale when exports change
   → Maintain a PUBLIC_API.md document listing all Tier 1–4 public exports
   → When refactoring or adding features to src/index.ts and sibling entrypoints, update PUBLIC_API.md the same commit
   → PUBLIC_API.md serves as source-of-truth for what's officially public; checks prevent accidental internal-symbol leaks
   ❌ src/index.ts exports SectorHistoricalPoint but PUBLIC_API.md lists it as internal-only
   ❌ Task 1.18 promotes AnalysisProvider to public but PUBLIC_API.md still lists it under @internal
   ❌ PUBLIC_API.md documents a symbol that no longer exists in src/index.ts after refactoring
   ✅ After changing src/index.ts exports, update PUBLIC_API.md document to match actual exports
   ✅ Use the document as a checklist before commits: all symbols exported must be listed

8. Public discriminated union variant types missing from src/index.ts or wrongly tagged @internal
   → When a public function returns a discriminated union (e.g. Result<Success | Error>), all variant types must be re-exported in src/index.ts
   → Union variants used as parameter or return types of public functions are themselves part of the public contract
   → Variant types must NOT carry @internal JSDoc if they are re-exported; @internal contradicts re-export visibility
   → When a provider interface returns data types (Raw* or Fundamental*Input), consumers must be able to import those types explicitly for type annotations
   ❌ submitAnalysis returns SubmitAnalysisResult with variants (Cached|Submitted|LimitError), but only SubmitAnalysisResult exported; variants require explicit imports
   ❌ SubmitOverallAnalysisPending, SubmitOverallAnalysisError, OverallAxis used in public type but @internal + not exported
   ❌ Union variants re-exported in src/index.ts but still tagged /** @internal */ in source files — IDE hides them from autocomplete
   ❌ FundamentalDataProvider.getIncomeStatement returns RawIncomeStatement @internal, but callers must type their variables — create domain-neutral IncomeStatementInput alias
   ✅ All union variants (SubmitFundamentalAnalysisCached|Submitted|LimitError|FetchError) explicitly exported from src/index.ts
   ✅ Variant types have no @internal tag if they are re-exported; keep @internal only for module-internal helpers
   ✅ Parameter/return types of public functions are public contracts; audit every public function's type signature and ensure all referenced types are exported
   ✅ Provider interfaces return domain-neutral Input aliases (FundamentalProfileInput) not Raw* (@internal) types
   → Recurring mistake (fix/post-210a423 PR #75 R8, Task 7 R3): 22+ union variant instances (14 Raw* types, 8 SubmitXxx variants, OverallAxis, usage option types).
      Each submission or provider function round-trip misses variants or contradicts @internal status.
      Process: (1) list all types in function signature, (2) verify each is exported from src/index.ts without @internal, (3) no aliases to internal types in public signatures.
```

---

## Architecture

```
0. Error codes and types must be defined in the layer that produces them
   → Application layer error codes (AUTH_ALREADY_EXISTS, registration failures) belong in application/auth/types.ts, not domain/
   → When a violation is produced by application logic or infrastructure I/O, it is NOT a domain concern
   → Domain layer contains only pure calculation/transformation logic and their error cases, never application-specific violations
   ❌ EMAIL_ALREADY_EXISTS_CODE in domain/auth/constants.ts (produced by application duplicate-check logic)
   ❌ AuthValidationErrorCode = '...' | 'email_already_exists' in domain (application concern, not domain validation)
   ✅ EMAIL_ALREADY_EXISTS_CODE in application/auth/constants.ts
   ✅ AuthValidationErrorCode = 'invalid_email' | 'weak_password' in domain (pure validation); RegisterUserErrorCode includes application variants

1. Type interfaces defined in implementation files instead of domain/types.ts
   → All shared domain types (interfaces, unions, enums) must be centralized in domain/types.ts
   → If multiple files reference the same type, move it to domain/types.ts for single source of truth
   ❌ interface Skill { ... } in domain/analysis/prompt.ts
   ✅ export interface Skill { ... } in domain/types.ts

2. Pure utility functions placed in infrastructure/ instead of domain/
   → Pure functions with no I/O belong in domain/
   → If a helper has no side effects and does not read env / network / filesystem, it must be in domain/

3. Infrastructure module reading from another infrastructure module in a way that creates implicit coupling
   → Each infrastructure module should handle one external system
   → Cross-module coordination belongs at the consumer level, not inside infrastructure/

4. Infrastructure module public interfaces defined in implementation files instead of types.ts
   → All infrastructure modules must follow the pattern: types.ts (interfaces first) + implementation files
   → Public interfaces like JobRedisClient, CallGeminiWithKeyFallbackOptions, UpstashEnvConfig must be in types.ts
   → This enables consumers and tests to reference the interface independently of implementation
   ❌ interface JobRedisClient { ... } defined in jobs/redis.ts
   ❌ interface CallGeminiWithKeyFallbackOptions { ... } defined in gemini.ts
   ❌ type AcquireReanalyzeCooldownResult { ... } defined in reanalyzeCooldown.ts
   ❌ type CachedBriefingData { ... } defined in domain/types.ts (infra concern, should be in infrastructure/cache/types.ts)
   ✅ interface JobRedisClient { ... } in jobs/types.ts; jobs/redis.ts imports and implements against it
   ✅ interface UpstashEnvConfig { ... } in cache/types.ts (shared across cache/redis.ts and jobs/redis.ts)
   ✅ type AcquireReanalyzeCooldownResult { ... } in infrastructure/market/types.ts; reanalyzeCooldown.ts imports it
   ✅ type CachedBriefingData { ... } in infrastructure/cache/types.ts; application/market imports from infra, not domain

5. Infrastructure module re-exporting domain symbols
   → Infrastructure modules must not act as transit paths for domain exports
   → Consumers must import domain symbols directly from domain/, not through infrastructure/
   ❌ // infrastructure/ai/utils.ts
      export { parseJsonResponse } from '@/domain/utils';
   ❌ // infrastructure/cache/config.ts
      export { computeSecondsUntilCacheExpiry } from '@/domain/utils';
   ✅ Consumers import directly: import { parseJsonResponse } from '@/domain/utils'

6. Individual domain indicator calculators exported to public API
   → Indicator calculation functions (calculateATR, calculateBollinger, calculateEMA, etc.) are implementation details
   → Only the aggregate calculateIndicators entry point should be exported to Tier 2 public API
   → Exporting individual calculators locks them into the public contract, blocking internal refactoring
   ❌ // src/index.ts Tier 2
      export { calculateATR, calculateBollinger, calculateBollingerMulti, calculateCCI, ... } from '@/domain/indicators'
      // → 26 indicator functions become public; cannot refactor calculation internals without breaking consumers
   ✅ Only export { calculateIndicators } as the entry point
   ✅ Keep individual calculateXXX functions internal (@internal JSDoc) for library-internal use

6.5. Internal implementation constants/types leaked to public API via src/index.ts
   → Library public API must export only symbols consumers actually use
   → Implementation details (internal cache keys, Redis options, internal interfaces) must not be re-exported
   → Leaking internal symbols causes breaking changes when internals are refactored
   ❌ // cache/config.ts defines KOREAN_TICKERS_CACHE_KEY (internal implementation detail)
      // src/index.ts exports { KOREAN_TICKERS_CACHE_KEY } from '@/infrastructure/cache/config'
      // → consumers depend on internal constant; renaming breaks their code
   ❌ // jobs/types.ts defines RedisSetOpts (internal Upstash API options)
      // src/index.ts exports { RedisSetOpts } 
      // → consumers never use this; breaks when Upstash API changes
   ✅ Remove internal constants/types from src/index.ts export blocks
   ✅ Only export interfaces and functions consumers explicitly call (e.g., JobQueue, SkillsProvider)

7. Tier 3 (factories/config) and Tier 4 (public types/constants) mixed in a single export block
   → src/index.ts must separate Tier 3 export blocks (factories, config, providers) from Tier 4 (schema objects, enums, constant arrays)
   → When adding new Tier 3 symbols (e.g. DrizzleUserRepository) to an existing export block, re-split if that block contains any Tier 4 symbols
   ❌ // src/index.ts — single export mixes factory (DrizzleUserRepository) with schema (users, sessions)
      export { DrizzleUserRepository, users, sessions, USER_TIER_VALUES } from '@/infrastructure/db'
   ❌ // Adding new Tier 3 to existing block without splitting schema/constants to Tier 4
      export { createDatabaseClient, DrizzleUserRepository, assetTranslations, USER_TIER_VALUES }
   ✅ // Tier 3: Factories & Config
      export { createDatabaseClient, DrizzleUserRepository } from '@/infrastructure/db'
      // Tier 4: Database schema & constants
      export { users, sessions, assetTranslations, USER_TIER_VALUES } from '@/infrastructure/db'

8. Transactional state transitions must validate and reserve one-time credentials before applying dependent account mutations
   → Auth use-cases operating on one-time tokens (password reset, account deletion with prerequisites) must consume/guard the token before mutating the account
   → Ensures cascade deletes or concurrent operations cannot invalidate the transaction mid-flight
   ❌ `completePasswordReset` updates user password, then checks if reset token was used (usedAt check after update)
   ❌ `deleteAccount` revokes OAuth tokens after user row is deleted; cascade delete removes tokens before lookup
   ✅ `completePasswordReset` consumes reset row first (`usedAt IS NULL` guard in transaction), then updates user password
   ✅ `deleteAccount` loads OAuth tokens before deleting user; keep revocation calls fire-and-forget after capture
```
