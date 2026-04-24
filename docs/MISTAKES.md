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

10. Using .sort() instead of .toSorted()
    → .sort() mutates the original array and violates immutability
    ❌ arr.sort() // in-place mutation
    ✅ arr.toSorted() // returns new sorted array

11. eslint-disable suppresses lint warnings instead of fixing root cause
    → Never suppress warnings with eslint-disable-next-line or inline comments
    → Always restructure the code to fix the actual issue

12. Using let + if for conditional assignment instead of declarative const expressions
    → Prefer ternary/conditional expressions (const) over imperative reassignment (let)
    ❌ let result = value; if (condition) result = newValue; return result;
    ✅ const result = condition ? newValue : value; return result;

13. Hardcoded literals in function names or calculations
    → All magic numbers and constant values must be extracted to module-level constants
    → Function names must remain accurate when the underlying constant value changes
    ❌ function computeSecondsUntilKst17() { ... } where 17 is hardcoded; renaming breaks if constant changes
    ❌ Math.round(rawPrice * 100) / 100 with no constant for decimal factor
    ✅ const CACHE_EXPIRY_HOUR_KST = 17; function computeSecondsUntilCacheExpiry() { ... }
    ✅ const PRICE_DECIMAL_FACTOR = 100; Math.round(rawPrice * PRICE_DECIMAL_FACTOR) / PRICE_DECIMAL_FACTOR

14. Domain functions using imperative for-loop + push instead of higher-order functions
    → Domain functions must use map, filter, flatMap, reduce — never direct mutation with push/splice
    ❌ const result = []; for (const item of data) { result.push(transform(item)); } return result;
    ✅ const result = data.map(transform); return result;
    ❌ const lines = []; for (const rec of reconciled) { lines.push(...extractLines(rec)); } return lines;
    ✅ const lines = reconciled.flatMap(extractLines); return lines;

15. Domain / infrastructure functions incomplete test coverage — missing unit tests entirely or covering <100% branches
    → Every new domain / infrastructure function must have dedicated unit tests with 100% branch coverage
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
1. Object.fromEntries return type mismatch
   → Type assertion required: Object.fromEntries(pairs) as Record<K, V>

2. Missing fields in domain interface that exist in data source
   → When parsing new fields in infrastructure, add them to the domain interface immediately

3. Unused/missing type imports
   → Remove unused type imports; add missing ones for explicit annotations
   → When TypeScript infers automatically, the import is unnecessary

4. Interface field declaration does not match runtime behavior
   → Required fields marked `?` in the interface or absent fields declared as required
   → When tests and implementation show a field is optional, update interface to `fieldName?`
   ❌ interface Bars { bars: BarData[] }  // but implementation checks bars ?? []
   ✅ interface Bars { bars?: BarData[] }  // interface reflects runtime reality

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
   → Mandatory: every safe-cast `as` must be accompanied by a comment explaining the guarantee.
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

2. Infrastructure functions must have 100% branch coverage
   → All if/else, optional chaining (?.), nullish coalescing (??) paths tested
   → Test edge cases like subsecond boundaries, zero values, Math.max guard behavior
   ❌ Math.max(1, Math.floor(diffMs / 1000)) guard that converts 0→1 untested
   ✅ Add test case: diffMs = 500ms covers the Math.max(1, 0) = 1 path

3. No debug artifacts (console.log) in infrastructure files
   → Infrastructure functions are utilities; logging belongs in higher layers
   ❌ getBars() { console.log(...timing...); return bars; }
   ✅ Remove logging; expose metrics via return type if needed

4. Environment variable reads scattered across infrastructure/ modules
   → Centralize each external system's env reads in a single config module
   → e.g. infrastructure/cache/config.ts reads UPSTASH_* vars; other modules import from config
```

---

## Fire-and-Forget Operations

```
1. Fire-and-forget fetch requests must have timeouts
   → fetch() without timeout can block indefinitely on network delay
   → Apply AbortSignal.timeout(ms) to prevent blocking
   ❌ fetch('/cancel', { method: 'POST' })  // no timeout
   ✅ fetch('/cancel', { method: 'POST', signal: AbortSignal.timeout(5000) })

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
   → Single-line summaries only; multi-paragraph docstrings must be condensed to one line per function
   → When changing function implementation, update related comments immediately
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
```

---

## Architecture

```
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
```
