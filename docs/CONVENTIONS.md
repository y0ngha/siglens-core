# Conventions

## Coding Paradigm

`siglens-core` follows **Declarative** and **Functional Programming** paradigms.

### Declarative Code

Focus on "what" rather than "how".

```typescript
// ❌ Imperative — prefer declarative when logic is simple
const result = [];
for (let i = 0; i < closes.length; i++) {
    if (closes[i] > 0) result.push(closes[i] * 2);
}

// ✅ Declarative
const result = closes.filter(c => c > 0).map(c => c * 2);
```

**Exception — `for (let i = 0; ...)` is allowed when it provides a clear advantage:**
- Sliding window algorithms (O(n) vs O(n²) with `.slice()` inside `.map()`)
- Algorithms where index arithmetic is central to the logic
- Cases where the imperative form is measurably more readable than the functional equivalent

```typescript
// ✅ Acceptable — sliding window where for-loop is more efficient and readable
for (let i = 0; i + period <= values.length; i++) {
    const window = values.slice(i, i + period);
    results.push(compute(window));
}
```

**Exception — `while` is allowed when the algorithm's termination condition is naturally expressed as a predicate, not as a counter:**
- Binary search (convergent boundary `low`/`high` pointers)
- Pointer-convergence loops (two pointers approaching each other)
- Cases where a `for` header equivalent would be an empty `for (; condition; )` — use `while` instead for clarity

```typescript
// ✅ Acceptable — binary search where while expresses the convergence condition directly
while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (bars[mid].time === time) return mid;
    if (bars[mid].time < time) low = mid + 1;
    else high = mid - 1;
}
```

The goal is readable, maintainable code — not mechanical adherence to a style. When `map`/`reduce` produces convoluted code or unnecessary O(n²) complexity, prefer `for (let i = 0; ...)`. When the loop condition is a convergence predicate rather than a counter, prefer `while`.
See [CP-5](#CP-5) for when a `for` loop with `push` is right and for the loop patterns to avoid.

```typescript
// ❌ Nested conditionals
let label;
if (trend === 'bullish') label = '상승';
else if (trend === 'bearish') label = '하락';
else label = '중립';

// ✅ Object map
const TREND_LABEL: Record<Trend, string> = {
    bullish: '상승',
    bearish: '하락',
    neutral: '중립',
};
const label = TREND_LABEL[trend];
```

### Functional Programming

```typescript
// ✅ Pure function — same input → same output, no side effects
function calculateRSI(closes: number[], period: number): (number | null)[] { ... }

// ✅ Immutability — use immutable methods for all array/object mutations
// ❌ bars.push(newBar)       ✅ [...bars, newBar]
// ❌ bar.close = 100         ✅ { ...bar, close: 100 }
// ❌ arr.reverse()           ✅ arr.toReversed()
// ❌ [...arr].reverse().find(fn)  ✅ arr.findLast(fn)   (no copy; target is ES2023)
// ❌ arr.sort()              ✅ arr.toSorted()
//    ⚠️ Browser-reachable code (anything `src/index.client.ts` reaches) must stay ES2022 —
//    the consumer does not polyfill ES2023 and Chrome 109 crashed on `toSorted`. There:
//    arr.toSorted(fn) → arr.slice().sort(fn)   (or .sort(fn) on a fresh map/filter/Array.from result)
//    arr.toReversed() → arr.slice().reverse()
//    arr.findLast(fn) / findLastIndex(fn) → findLast(arr, fn) / findLastIndex(arr, fn) from @/domain/arrayCompat
//    `yarn typecheck` enforces this via tsconfig.client.json (lib ES2022). Server-only code keeps ES2023.
// ❌ arr.splice(i, 1)        ✅ arr.filter((_, idx) => idx !== i)
// Applies to: push, pop, shift, unshift, splice, reverse, sort

// ✅ Extract nested functions to module-level with explicit parameters
// ❌ function parent() { function child() { uses parentVar } }
// ✅ function child(parentVar: T) { ... }  // extracted, explicit params
```

**Exception — Local state-accumulator mutation is allowed when `reduce + spread` causes O(N²) complexity:**

State-machine based indicators where each step depends on the previous accumulated result
cannot use `reduce + [...acc, value]` without incurring O(N²) time complexity.
In these cases, a function-local mutable accumulator (pre-allocated array + index assignment,
or a `for` loop with index) is permitted.

The following conditions must all be satisfied:
1. The function maintains a pure contract (same input → same output, no side effects)
2. Input arguments (`bars`, `state`, etc.) are never mutated
3. The return value is a completed, externally immutable array

```typescript
// ❌ O(N²) — spread inside reduce creates a new array on every iteration
const results = bars.reduce((acc, bar) => {
    return [...acc, compute(bar)];
}, [] as Result[]);

// ✅ O(N) — pre-allocated array with index assignment (local mutation only)
const results: Result[] = new Array(bars.length);
let state = initialState;
for (let i = 0; i < bars.length; i++) {
    const { state: next, result } = nextState(state, bars[i]);
    results[i] = result;
    state = next;
}
return results;
```

### Priority by Layer

```
domain/         Functional required — pure functions, immutability, higher-order functions
infrastructure/ Functional recommended — separate internal logic into pure functions
```

### Paradigm Gotchas

Recurring mistakes that the rules above do not catch on their own. IDs are stable and
never renumbered; cite them as `CONVENTIONS.md#CP-5`.

<a id="CP-1"></a>
#### CP-1 — Reuse before writing

Grep for an existing helper (`src/domain`, and `infrastructure/ai/utils.ts` for provider
logic) before adding a function. When the same filter or calculation appears at several
call sites, extract one shared pure helper (`domain/` preferred) or a module-level const.
Split `number[]`-based cores from `Bar[]`-based wrappers so both shapes share one
implementation. Logic shared by a pair of AI providers belongs in
`infrastructure/ai/utils.ts`.

Why: duplicated helpers drift apart, and the copy nobody remembers keeps the old bug.

Two checks that feed one decision (a status, a verdict) read the same value from one
source. If the prompt prints a level, the status logic uses that printed level, not a
second derivation of it (a sloped line for one check, the flat figure for another).

<a id="CP-2"></a>
#### CP-2 — Compute a value once

Query or compute an identical value once, then reuse it: `map.get(key)` called twice,
`array.length` read on every loop iteration, a derived value recomputed per item. When the
value is derived per item, compute it once in the mapping step and pass it down as a
parameter.

```typescript
// ❌ const a = map.get(key); const b = map.get(key);
// ✅ const value = map.get(key); // reuse value
// ❌ counts.map(c => tag(c)) ... levels(c) ... levels(c)  // per-item value recomputed
// ✅ counts.map(c => { const levels = levelsOf(c); return build(c, levels); })
```

<a id="CP-3"></a>
#### CP-3 — Use the callback parameter

Never discard a callback parameter and re-read the element through an outer array index.

```typescript
// ❌ lines.reduce((acc, _line, idx) => { const line = lines[idx]; ... })
// ✅ lines.reduce((acc, line) => { ... })
```

<a id="CP-4"></a>
#### CP-4 — Delete logic that has no effect

Remove code whose removal cannot change behavior:

- a `filter`/`map` whose predicate is guaranteed by the previous step;
- a fallback after narrowing (`options.tier ?? DEFAULT_TIER` after a guard that already
  proved `options.tier` is defined);
- an optional chain or truthiness check the type already rules out (`!!info?.name` when
  `name` is required);
- files, types and exports orphaned by a refactor (a `types.ts` with no consumers, an
  `export` on a helper only its own file uses). When you remove the last consumer, remove
  the leftovers in the same change. Re-exports of internals are covered by
  `PUBLIC_API.md#API-2`.

<a id="CP-5"></a>
#### CP-5 — When a loop with push is right, and when it is not

Prefer `map`/`filter`/`flatMap` for one-item-to-one-result transformations. A `for` loop
with `push` is the right call when:

- each iteration conditionally appends zero to several items and `flatMap` + spread would
  add intermediate arrays without clarity;
- async work must run sequentially (chunks, rate limits);
- state is tracked across steps in a single pass.

```typescript
// ✅ 0–2 items per iteration; flatMap + spread would only add noise
for (let i = period; i < n - period; i++) {
    if (bars[i].high === winMax[i]) result.push({ type: 'high', index: i });
    if (bars[i].low === winMin[i]) result.push({ type: 'low', index: i });
}
```

Never use `reduce` with a spread accumulator (O(N²)), and never re-`slice()` a window on
every step. Track state in one pass instead.

```typescript
// ❌ reduce((acc, v) => [...acc, f(v)], [])      // copies the array every step
// ❌ steps.map((_, i) => all.slice(i).some(...))  // re-scans per step
```

Also prefer `.find()`/`.some()` over a `for…of` loop whose only purpose is an early
return.

<a id="CP-6"></a>
#### CP-6 — Name complex anonymous expressions

Extract an IIFE, a multi-statement ternary, or an inline option-validation conditional
into a named helper. The name documents intent and lets the helper be tested directly.

<a id="CP-7"></a>
#### CP-7 — Prefer `const` expressions over `let` reassignment

Assign conditionally with a ternary or a `.then().catch()` that returns the full value
instead of reassigning a `let`, including flags set from inside a `.catch()` handler.

```typescript
// ❌ let degraded = false; load().catch(() => { degraded = true; });
// ✅ const { skills, degraded } = await load()
//        .then(s => ({ skills: s, degraded: false }))
//        .catch(() => ({ skills: [], degraded: true }));
```

<a id="CP-8"></a>
#### CP-8 — Destructure with rest instead of field-by-field copies

When dropping or overriding a few fields, use `const { omit: _omit, ...rest } = source`.
Copying the remaining fields by hand silently drops any field added to the source later;
rest-destructuring carries it along and keeps the type checker honest.

<a id="CP-9"></a>
#### CP-9 — When one sibling changes approach, change all of them

Functions in one module that solve the same problem use one approach (a recursive file
collector next to a non-recursive file counter disagree on what exists). Parallel field
lists inside one prompt or instruction block are updated together. After changing one,
search the module for the others.

<a id="CP-10"></a>
#### CP-10 — State that drives control flow is assigned on every path

A value that defaults to success and is reassigned only inside a guarded branch makes
every other exit return the success default. Default to the failure or "no event" value,
assign it explicitly on every path, and validate before use. When you fix one entry point,
audit initialization and every other conditional branch for the same defect.

```typescript
// ❌ let outcome = 'completed'; if (e.type === 'terminal') outcome = classify(e);
//    return outcome; // no terminal event → still 'completed'
// ✅ let outcome: Outcome = 'no_event'; ... if (!isValidOutcome(outcome)) throw ...
```

<a id="CP-11"></a>
#### CP-11 — Constants: one source, no baked-in literals

- Extract magic numbers and repeated literals (descriptions, messages, config values) to
  named module-level constants.
- Never bake a literal into a name (`computeSecondsUntilKst17`); the name must stay true
  when the value changes.
- A finite literal set has one source of truth: derive the union type from a
  `Record<Kind, true>`-backed constant instead of re-listing the members in the loader,
  the resolver and the type.
- Data that changes together lives together (one object keyed by level, not parallel
  `level`/`icon`/`tooltip` constants). Unrelated data goes in separate modules.
- Prompt wording that deliberately differs from a similar key gets its own named
  constant with a comment saying it is prompt wording.

<a id="CP-12"></a>
#### CP-12 — A constant duplicated across a hard boundary says so

When a value cannot be imported (a different runtime, a published type, a prompt string
that mirrors a code constant), duplicate it with a comment naming the original and the
sync requirement.

```typescript
// Mirrors ANALYSIS_CACHE_TTL in infrastructure/cache/config.ts; update both if changed.
const TTL_HINT_SECONDS = 3600;
```

<a id="CP-13"></a>
#### CP-13 — Rename when behavior changes

A name that no longer describes what the function does is a bug (`fetchBars` that now
reads the cache becomes `loadBars`). After replacing an implementation or moving code
between layers, re-read the names, not only the bodies.

<a id="CP-14"></a>
#### CP-14 — One instance per resource per module

Create an expensive or stateful resource once per module and reuse it: one Redis client
unless a second token is genuinely different, one `Intl.DateTimeFormat` cache. Two caches
or two clients for the same thing diverge.

```typescript
// ❌ const reader = new Redis(config); const writer = new Redis(config);
// ✅ const writer = new Redis(config); const reader = altConfig ? new Redis(altConfig) : writer;
```

<a id="CP-15"></a>
#### CP-15 — No defensive copy of an array you just created

When rewriting `toSorted`/`toReversed` for ES2022, `.slice()` is only needed when the source
may be shared. A fresh `map`/`filter`/`Array.from`/function-result array can take
`.sort()`/`.reverse()` directly. Keep the copy when the source's type is `readonly`
(typecheck requires it).

```typescript
// ❌ clusterLevels(levels).slice().reverse()   // clusterLevels already returns a fresh array
// ✅ clusterLevels(levels).reverse()
```

---

## File / Directory Naming

```
Util/function     camelCase       calculateRSI.ts
Type files        camelCase       types.ts
Test files        original.test   rsi.test.ts
Directories       lowercase kebab indicators/, signals/
```

`siglens-core`에는 React 컴포넌트나 훅 파일이 존재하지 않는다. 모든 `.ts` 파일은
모듈 단위 함수/타입 정의 파일이다.

<a id="N-1"></a>
#### N-1 — Public type names differ by more than a plural suffix

Two exported types named `ExtremeZoneEpisode` and `ExtremeZoneEpisodes` are one typo apart
and read as the same thing at a call site. Give each a name that states its role
(`ExtremeZoneEpisodeSummary`). Rename before the first release; afterwards a rename is a
breaking change (`PUBLIC_API.md#API-5`).

---

## TypeScript Rules

```typescript
// ✅ Prefer interface; use type alias for unions
interface Bar { time: number; open: number; }
type Timeframe = '1Min' | '5Min' | '15Min' | '1Hour' | '1Day';

// ❌ No any
const data: any = response;

// ✅ Return types must be explicitly declared on exported functions
function calculateRSI(closes: number[], period: number): (number | null)[] { ... }

// ✅ Initial period values must be null
// (null = "no value yet"; 0 would be a valid-looking value and mislead consumers)
const result: (number | null)[] = new Array(period - 1).fill(null);

// ✅ Interface fields must be camelCase
// Even if the external source (e.g. YAML frontmatter) uses snake_case,
// define domain types in camelCase and transform in the infrastructure layer.
interface Skill { confidenceWeight: number; }

// ✅ Extract union literals with 2+ members into a type alias
type SignalStrength = 'strong' | 'moderate' | 'weak';
interface Signal { strength: SignalStrength; }

// Callback parameter type annotations are required when TypeScript cannot infer
// the type from context. When the type is already inferred from the surrounding
// expression, explicit annotations are optional (but allowed for clarity).
// bars.map(bar => ...)                   ✅ inferred from Bar[] — annotation optional
// bars.map((bar: Bar) => ...)            ✅ explicit — also fine
// items.map((p: Omit<T, 'id'>) => ...)  ✅ required — Omit<> not inferrable from context

// ✅ No hardcoded literals — extract to constants
// ❌ period = 14
// ✅ period = RSI_DEFAULT_PERIOD  (domain/indicators/constants.ts)

// ✅ Types must be declared at the top of the file, not inside functions
// ❌ function process() { interface Item { id: string; } ... }
// ✅ interface Item { id: string; }
//    function process() { ... }

// ✅ Return named interfaces instead of inline object types
// ❌ function getCredentials() { return { apiKey, secretKey }; }
// ✅ interface Credentials { apiKey: string; secretKey: string; }
//    function getCredentials(): Credentials { ... }

// ✅ Prefer type guards over `as` type assertions
// ❌ const user = data as User;
// ✅ if ('name' in data) { /* data is User */ }
// Exception: provably safe casts and third-party library return types (add a
// comment explaining why; see TS-2)

// ✅ Hardcoded array indices → named constants
// ❌ result.split('\n\n')[1]
// ✅ const SECTION_INDEX = 1; result.split('\n\n')[SECTION_INDEX]

// ✅ Related interfaces with shared fields must use extends
// ❌ interface B { ...all fields of A...; extra: string }
// ✅ interface B extends A { extra: string }
```

### TypeScript Gotchas

<a id="TS-1"></a>
#### TS-1 — Compute narrowed values inside the guard

A value that is only valid inside a conditional branch is computed inside that branch.
Computing it above the guard loses the narrowing and forces a `!`.

```typescript
// ❌ const at = usage !== undefined ? new Date(usage.occurredAt) : new Date();
//    if (usage !== undefined) record(at);
// ✅ if (usage !== undefined) { const at = new Date(usage.occurredAt); record(at); }
```

<a id="TS-2"></a>
#### TS-2 — `as` only for provably safe casts, always with a comment

A cast is safe only when TypeScript cannot express a constraint that the surrounding code
already guarantees at runtime (`Object.keys(CONFIG) as SkillType[]` where `CONFIG` is a
`Record<SkillType, …>`; `Object.fromEntries(pairs) as Record<K, V>`). It is never a way to
silence a value that could really be `null`, `undefined` or a different shape
(`fetchData() as MyType`, `someString as Literal`). Prefer a type guard, `satisfies`, or a
`!` when null is logically impossible.

Every safe cast carries a comment with two parts: why the cast exists, and why it is safe
at runtime. "Suppress TS error" is not an explanation.

```typescript
// ✅ // Array.isArray(field) narrowed to the object branch; TS cannot narrow the
//    // literal, but the shape is guaranteed to match NewsAxisOptions.
//    field as NewsAxisOptions
```

Test files are exempt (`as unknown as Dirent` stubs implement only the part of an interface
the test uses). When integrating an SDK that ships a discriminated union of events or
responses, import its native types instead of hand-rolling `unknown` plus a `type` check:
the union exposes every terminal case, and a missing handler becomes a compile error.

<a id="TS-3"></a>
#### TS-3 — Interface optionality matches runtime

A field the implementation defaults (`bars ?? []`) is optional in the interface; a field
that is always present is not marked `?`. Keep the JSDoc consistent with the type (see
[JD-1](#JD-1)).

<a id="TS-4"></a>
#### TS-4 — Sibling fields use one declaration strategy; discriminants are distinct

Fields of one interface use the same strategy: all named aliases, not an alias next to an
inline literal union. In a discriminated union, each branch carries its own distinct error
type, and discriminant values never collide across variants, otherwise narrowing yields a
union instead of one variant.

```typescript
// ❌ { ok: false; error: ChatErrorCode | UsageLimitError }
// ✅ { ok: false; error: ChatErrorCode } | { ok: false; error: UsageLimitError }
// ❌ { status: 'error'; message: string } | { status: 'error'; limit: true }
// ✅ { status: 'error'; message: string } | { status: 'limit_error'; limit: true }
```

<a id="TS-5"></a>
#### TS-5 — Prefer direct named types over inference chains

When a type can be imported by name, import it rather than deriving it with
`Awaited<ReturnType<typeof fn>>` or `Omit` chains. Chains hide the contract and block
narrowing. Likewise model a family of results as a discriminated union of concrete shapes
(`{ code: 'analysis' } | { code: 'chatbot' }`) instead of one wide union field.

<a id="TS-6"></a>
#### TS-6 — Imports: top-level, merged

Not lint-enforced; checked in review.

- Imports (including `import type`) sit at the top of the file, before any declaration.
- Never write inline `import('./x').T` in a type position; add a top-level
  `import type`.
- One import block per specifier: merge `import type { A }` and `import type { B }` from
  the same module into one.

Import order within an alias group is **not** a rule — the codebase does not keep it and no
lint rule checks it, so reviewers must not flag ordering.

<a id="TS-7"></a>
#### TS-7 — Close finite value sets with literal unions

A set with a known finite membership (model IDs, labels, kinds) is typed as a literal union,
not `string`/`ReadonlySet<string>`, so a typo fails to compile. Template literal types
cover labels with a variable part (`` `target ${number}%` ``).

<a id="TS-8"></a>
#### TS-8 — Type-only changes are proven by `yarn typecheck`

When a change reaches callers only through the type system (a field widened through an
untyped spread, a narrowed `Pick`), runtime tests pass before and after. Do not write
runtime tests believing they guard it; run `yarn typecheck` and treat its error as the
check.


---

## Domain Function Rules

```typescript
// ✅ Pure functions only
// ❌ No side effects: fetch, console.log, Date.now(), process.env all prohibited
function calculateRSI(closes: number[], period = RSI_DEFAULT_PERIOD): (number | null)[] {
    // pure calculation only
}
```

---

## Infrastructure Function Rules

```typescript
// ✅ All external I/O lives here; define an interface first
// infrastructure/cache/types.ts
export interface AnalysisCache {
    get(key: string): Promise<string | null>;
    set(key: string, value: string, ttlSeconds: number): Promise<void>;
}

// infrastructure/cache/redis.ts
export class UpstashAnalysisCache implements AnalysisCache { ... }

// ❌ Infrastructure may not import from other infrastructure modules transitively
//    in a way that creates cycles. Keep each module responsible for one external system.

// ✅ process.env is read only in infrastructure modules; never in domain.

// ✅ Graceful degradation — missing env vars / network failure must not crash the library.
//    Return null / empty / fallback value and let the caller decide.
```

---

## Test Rules

Tests run on **Vitest**.

### File Locations

```
src/__tests__/domain/indicators/rsi.test.ts
src/__tests__/infrastructure/cache/redis.test.ts
```

### Coverage Targets

```
domain/         90% (필수)
infrastructure/ 90% (필수)
application/    90% (필수)
```

`domain/`, `infrastructure/`, and `application/` are all measured for coverage; the
threshold is 90% branch coverage, enforced as a global aggregate in `vitest.config.ts`.
Pure type/interface files (`domain/ports/**`, `*/types.ts`, `index.ts`) are excluded.

### Test Structure

```typescript
import { describe, it, expect } from 'vitest';
import { calculateRSI } from '@/domain/indicators/rsi';

// ✅ 2 levels: describe → it (simple cases)
describe('formatVolume', () => {
    it('returns "1.2M" for 1200000', () => { ... });
    it('returns "0" for 0', () => { ... });
});

// ✅ 3 levels: describe → describe(context) → it
describe('calculateRSI', () => {
    describe('when input length is less than period', () => {
        it('returns an all-null array', () => {
            expect(calculateRSI([100, 101], 14)).toEqual([null, null]);
        });
    });
    describe('when input is valid', () => {
        it('returns null for the first period - 1 values', () => { ... });
        it('returns values between 0 and 100', () => { ... });
    });
});

// ✅ 4 levels: describe(module) → describe(function) → describe(context) → it
describe('prompt', () => {
    describe('buildAnalysisPrompt', () => {
        describe('current market section', () => {
            it('includes "No data available" when bars is empty', () => { ... });
        });
    });
});

// ✅ 5 levels: for complex modules requiring fine-grained context separation
describe('candle-detection', () => {
    describe('detectCandlePatternEntries', () => {
        describe('multi-candle pattern detection', () => {
            describe('when a 3-bar pattern exists', () => {
                it('excludes single patterns on involved bars', () => { ... });
            });
        });
    });
});
```

Test structure allows **2 to 5 levels**. Choose the appropriate depth based on module complexity.
6+ levels are prohibited — merge context into describe text to reduce nesting.

### Required Test Cases for Period-Based Indicators

| Case | it description |
|------|----------------|
| Empty array | 빈 배열을 반환한다 |
| Input shorter than period | 전부 null인 배열을 반환한다 |
| Initial null range | 처음 period - 1개의 값은 null이다 |
| Valid value range | period번째 이후 값은 null이 아닌 숫자다 |
| Calculation accuracy | 첫 번째 값이 명세와 일치한다 |

<a id="TE-10"></a>
#### TE-10 — Period-based indicators assert reference values

Besides sign and shape, every period-based indicator test checks values with
`toBeCloseTo` against expected numbers computed independently. Warm-up constants are
imported from source, and boundary constants account for the whole dependency chain of
the algorithm (nested windows).

```typescript
// ❌ expect(values[idx]).toBeGreaterThan(0);          // no actual value verified
// ✅ expect(values[minBarsIdx]).toBeCloseTo(expected);
```

### External Dependency Mocking

Use Vitest's `vi.mock` / `vi.fn` to stub out external services.
Never hit real Upstash / Neon / AI endpoints in tests.

```typescript
import { vi } from 'vitest';
import type { AnalysisCache } from '@/infrastructure/cache/types';

const stubCache: AnalysisCache = {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
};
```

For modules that read `process.env`, set the values inside `beforeEach` and restore
afterwards — do not rely on a global setup file to mutate process-wide state.

### Test Gotchas

<a id="TE-1"></a>
#### TE-1 — Tests follow the contract

When a return type becomes nullable (`T[]` → `(T | null)[]`), add a null case. Every new
field or indicator gets at least one `it()` asserting it. Mocks and fixtures are updated
with the interface; a fixture that no longer matches the type is a test of something that
does not exist.

<a id="TE-2"></a>
#### TE-2 — Hooks live inside `describe`

`beforeEach`/`beforeAll` go inside the `describe` they serve, not at module level.

<a id="TE-3"></a>
#### TE-3 — Import production constants and functions; never redefine them

```typescript
// ❌ const TEST_PERIOD = 14;                 // drifts from the source
// ✅ import { RSI_DEFAULT_PERIOD } from '@/domain/indicators/constants';
// ❌ const shouldShowAd = (x) => x.enabled;  // tests a local copy, not production
```

Expected values that come from module exports are imported too, not hardcoded.

<a id="TE-4"></a>
#### TE-4 — Each module tests its own edge cases

When a function moves between modules, its edge-case tests move with it. Do not rely on
another module's test to cover it.

<a id="TE-5"></a>
#### TE-5 — Every branch has a test only it satisfies

Each new guard, sentinel check, early return, retry window, throw path, per-builder sign
and cache-key argument needs a test that fails when that branch is removed or inverted.
The 90% branch threshold counts these branches, including ones that look dead in the main
flow.

The input must be one that only the guard rejects. If an earlier step already rejects it,
the test proves nothing:

```typescript
// formatNullableNumber already turns NaN into 'N/A', so NaN does not prove the
// `total > 0` guard in shareOf; a negative total does.
```

Verify by reverting the guard (or flipping the sign): the test must fail. When a value is
set per builder, pin it per builder.

A guard added to block a specific false positive gets a near-miss fixture of that case,
and mirrored branches (left/right edge, bullish/bearish) each get their own.
A per-locale (or per-key) behaviour iterates the constant's keys so every member is pinned,
not a hand-picked subset that silently omits one.

<a id="TE-6"></a>
#### TE-6 — Test inclusive and exclusive boundaries on the boundary

A filter that must be inclusive (`>=`) or exclusive (`>`) needs one item exactly on the
boundary and one just outside it. Mutate the comparator to confirm the test fails.

Include the near-miss from the opposite side: a state named for one side of a line (for
example "failed") must not trigger from the other side, so a slack tolerance needs a test
for each side.

<a id="TE-7"></a>
#### TE-7 — One behavior per `it()`

Each `it()` asserts one unique behavior. A parameter object repeated across calls is
extracted to a `const` at the top of the test.

<a id="TE-8"></a>
#### TE-8 — Test names promise only what the assertions check

A `describe`/`it` title must not claim more than its assertions verify. A guard test that
names a class of inputs covers every instance of that class (scan all quoted strings, not
only the ones labelled "example").

<a id="TE-9"></a>
#### TE-9 — No vacuous tests

Delete or rewrite placeholders (`expect(true).toBe(true)`, a lone `toBeDefined()`).
Do not wrap assertions in `if (row)`: assert the row exists, then its value. A loop that
may `continue` asserts a count showing it checked something. Cover both signs or
directions of a rule, and mutation-check wiring tests so they fail when the wiring is
removed.

Numeric assertions must fail on `NaN`: `toBe(Math.min(a, b))` passes for `NaN` (`Object.is`),
so assert `Number.isFinite(x)` plus a bound. Every advertised gate constant has a near-miss
row on each side of the threshold; a constant that can be mutated with all tests green is
untested.

<a id="TE-11"></a>
#### TE-11 — Mock time for date-dependent code

Code that reads `Date.now()` or `new Date()` is tested under `vi.useFakeTimers()` /
`vi.setSystemTime(...)`. Hardcoded expected values (a TTL in seconds) without a fixed clock
are flaky.

<a id="TE-12"></a>
#### TE-12 — Do not pin bugs with negative assertions

A test asserting that an option has no effect keeps passing when the option starts
working. Assert positively: the option is accepted, and it changes the output measurably.
A `not.toContain` guard on text that was deliberately removed to fix model misbehavior is
the exception: it makes a revert fail the suite.

<a id="TE-13"></a>
#### TE-13 — Synchronize with background work via `vi.waitFor`

Fire-and-forget work (cache writes, background logs) is awaited with
`await vi.waitFor(() => expect(spy).toHaveBeenCalled...)`, never a bare
`setTimeout`, which ignores fake timers and is flaky on slow CI.

<a id="TE-14"></a>
#### TE-14 — Prompt rules are asserted through the integrating formatter

A new prompt rule or rendered line gets assertions on the rendered output of the
function consumers call (not only on the section helper). When a rendered label must match
a definition (guideline line names, overlay labels), assert that parity.

<a id="TE-15"></a>
#### TE-15 — Concurrency fixes get regression tests

Lock ownership, generation binding and similar coordination fixes need tests that fail
without the fix. In-memory stubs honour TTL, or the test cannot see expiry bugs.


---

## Import Path Rules

```typescript
// ✅ Use path aliases
import { calculateRSI } from '@/domain/indicators/rsi';

// ❌ No relative paths spanning layers
import { calculateRSI } from '../../../domain/indicators/rsi';

// ✅ Relative imports inside a single module folder are fine
import { helper } from './helper';
```

The published package (`@y0ngha/siglens-core`) exposes symbols only through
`src/index.ts`. Inside this repository, use `@/...` aliases. Consumers never
import via deep paths.

---

## Layer Dependency Rules

`→ see docs/ARCHITECTURE.md` for the authoritative layer dependency rules and folder structure.

---

## Iteration Protocol

Use JavaScript's iteration protocol (`Symbol.iterator`) and generators to compose data pipelines.

### When to Use

| Situation | Approach |
|---|---|
| Applying multiple transforms in a single pass over an array | Generator pipeline |
| Making a custom data structure consumable with `for...of` | Implement `Symbol.iterator` |
| Exposing domain data as an iterable to external consumers | `Iterable` interface |
| Processing thousands of Bar records step by step | Lazy evaluation (see section below) |

### Symbol.iterator — Custom Iterables

```typescript
// ✅ Custom iterable — expose results as an iterable from pure domain/indicators/ functions
class SlidingWindow<T> implements Iterable<T[]> {
    constructor(private items: T[], private size: number) {}

    [Symbol.iterator](): Iterator<T[]> {
        let index = 0;
        const { items, size } = this;
        return {
            next(): IteratorResult<T[]> {
                if (index + size > items.length) return { done: true, value: undefined };
                return { done: false, value: items.slice(index++, index + size - 1) };
            },
        };
    }
}

// ✅ Consume naturally with for...of
for (const window of new SlidingWindow(closes, 14)) {
    // window: number[]
}
```

### Generator Functions

```typescript
// ✅ Express a sliding window as a generator — used purely in the domain layer
function* slidingWindow<T>(items: T[], size: number): Generator<T[]> {
    for (let i = 0; i + size <= items.length; i++) {
        yield items.slice(i, i + size);
    }
}

// ✅ Compose generators — iterable pipeline with no intermediate arrays
function* map<T, U>(iter: Iterable<T>, fn: (v: T) => U): Generator<U> {
    for (const item of iter) yield fn(item);
}

function* filter<T>(iter: Iterable<T>, pred: (v: T) => boolean): Generator<T> {
    for (const item of iter) if (pred(item)) yield item;
}

// ✅ Usage — pipeline with no intermediate arrays
const gains = filter(
    map(slidingWindow(closes, 2), ([prev, curr]) => curr - prev),
    (delta) => delta > 0,
);
```

### Pitfalls

```typescript
// ❌ Do not define generators directly in infrastructure/ modules.
//    Generator-based iterables belong in domain/ pure functions only.

// ❌ Do not consume a generator more than once — iterators are one-shot
const gen = slidingWindow(closes, 14);
const a = [...gen]; // consumed
const b = [...gen]; // ❌ b is always an empty array

// ✅ When reuse is needed, materialize to an array or wrap in a factory function
const windows = () => slidingWindow(closes, 14); // new generator on each call
```

---

## Lazy Evaluation

Use lazy evaluation when data is large (thousands of Bars or more) or when multiple transformation stages would create many intermediate arrays.

### When to Choose Lazy Evaluation

```
✅ Use lazy evaluation when:
- The Bar array has 1,000+ items and requires multi-stage transforms (filter → map → reduce)
- Only the first N results are needed — generators short-circuit without processing the rest
- Computing streaming indicators one value at a time

❌ Skip lazy evaluation when:
- There is only one transformation stage or the dataset is small (a few hundred items or fewer)
  → plain .map() / .filter() is more readable
- The result must be shared across multiple consumers
  → materialize to an array first, then share
```

### Pattern 1 — Generator Pipeline

```typescript
// ✅ domain/indicators/utils.ts — reusable lazy utilities
function* lazyMap<T, U>(iter: Iterable<T>, fn: (v: T) => U): Generator<U> {
    for (const item of iter) yield fn(item);
}

function* lazyFilter<T>(iter: Iterable<T>, pred: (v: T) => boolean): Generator<T> {
    for (const item of iter) if (pred(item)) yield item;
}

function* lazyTake<T>(iter: Iterable<T>, n: number): Generator<T> {
    let count = 0;
    for (const item of iter) {
        if (count++ >= n) return;
        yield item;
    }
}

// ✅ Extract the first N closing prices from bullish candles — no intermediate arrays
function getFirstNBullishCloses(bars: Bar[], n: number): number[] {
    const bullish = lazyFilter(bars, (b) => b.close > b.open);
    const closes = lazyMap(bullish, (b) => b.close);
    return [...lazyTake(closes, n)];
}
```

### Pattern 2 — Streaming Accumulation

```typescript
// ✅ Compute a cumulative average in a single pass over the input
function* cumulativeAverage(values: Iterable<number>): Generator<number> {
    let sum = 0;
    let count = 0;
    for (const v of values) {
        sum += v;
        count++;
        yield sum / count;
    }
}
```

### Pattern 3 — Explicit Materialization Point

```typescript
// ✅ Define the pipeline lazily; materialize only at the final consumption point
function calculateLazyRSI(closes: number[], period: number): (number | null)[] {
    // Pipeline definition — nothing runs yet
    const windows = slidingWindow(closes, period);
    const rsiValues = lazyMap(windows, computeRSIFromWindow);

    // Materialize here — actual computation happens at this point
    const prefix: null[] = new Array(period - 1).fill(null);
    return [...prefix, ...rsiValues];
}

// ❌ Do not create an intermediate array at every stage
function calculateEagerRSI(closes: number[], period: number): (number | null)[] {
    const windows = closes                     // intermediate array
        .map((_, i) => closes.slice(i, i + period))
        .filter((w) => w.length === period);   // intermediate array
    return windows.map(computeRSIFromWindow);  // intermediate array
}
```

### Lazy Evaluation and Layer Rules

```
domain/         Lazy pipeline definitions allowed (pure generator functions)
                Materialize (spread / Array.from) only as the last step inside the function
infrastructure/ Call domain generator functions and consume their results.
                Do not define new lazy pipelines — they belong in domain/.
```

---

## JSDoc Rules

`siglens-core` is consumed as an npm package. Every symbol exported from `src/index.ts`
must carry JSDoc that lets a consumer understand the function from IDE hover or generated
docs without reading the source. Internal helpers carry only the `@internal` tag.

The boundary between public (Tier 1–4) and internal symbols is defined in
[`docs/PUBLIC_API.md`](./PUBLIC_API.md). This section defines **how to write the JSDoc**.

### Required Tags by Tier

| Tier | Required | Recommended | Language |
|---|---|---|---|
| Tier 1 (application entrypoints) | description, `@param`, `@returns` | `@throws`, `@example`, `@see` | English |
| Tier 2 (domain building blocks) | description, `@param`, `@returns` | `@example`, `@see` | English |
| Tier 3 (infra factories & config) | description, `@param`, `@returns` | `@throws` (when env is missing), `@see` | English |
| Tier 4 (types) | type-level description, one-line per field | `@example` (composite types) | English |
| Internal | `@internal` tag | (free) | (free) |

Public-facing JSDoc is written in **English** because the npm package is published
publicly and may be consumed by non-Korean developers. Internal-only JSDoc may be
written in either language.

### Standard Template (Tier 1 example)

```typescript
/**
 * Submit an analysis job for a given symbol/timeframe.
 *
 * Returns immediately with one of two outcomes:
 * - `cached`: a recent analysis is reused (within `ANALYSIS_CACHE_TTL`).
 * - `submitted`: a new job has been enqueued; poll with {@link pollAnalysis}.
 *
 * @param symbol - U.S. equity ticker (e.g. `"AAPL"`).
 * @param timeframe - Alpaca timeframe literal (`"5Min" | "15Min" | ... | "1Day"`).
 * @returns Submission outcome — see {@link SubmitAnalysisResult}.
 *
 * @throws {Error} If FMP/Alpaca credentials are missing in env.
 *
 * @example
 * ```ts
 * const result = await submitAnalysis("AAPL", "1Day");
 * if (result.status === "cached") return result.data;
 * const polled = await pollAnalysis(result.jobId);
 * ```
 *
 * @see pollAnalysis
 * @see cancelAnalysisJob
 */
```

### Internal Marker

Every function that is **not** re-exported from `src/index.ts` must carry the
`@internal` tag. This keeps TypeDoc output clean (`excludeInternal: true`) and
warns consumers if they happen to grep through `dist/`.

```typescript
/**
 * @internal
 * Helper used by calculateIndicators(); not part of the public API.
 */
export function calculateRSI(closes: number[], period: number): (number | null)[] {
    // ...
}
```

A bare `/** @internal */` is acceptable but a one-line note describing the role
is preferred. When tagging during a cleanup or sweep, enumerate every `export` in each
touched file instead of tagging from a removal list (`PUBLIC_API.md#API-4`).

### Don'ts

```typescript
// ❌ Don't write JSDoc that just restates the type signature.
/**
 * Get the symbol.
 * @param symbol - The symbol.
 * @returns The symbol.
 */
function getSymbol(symbol: string): string { ... }

// ❌ Don't reference the current PR/issue/caller — write timeless docs.
/**
 * Added in PR #123 for the X feature. Used by the Y page.
 */

// ❌ Don't duplicate type info that the parameter type already conveys.
/**
 * @param bars - An array of bars (Bar[]). Each bar is a Bar object with time, open, etc.
 */

// ✅ Do explain the *why*, edge cases, and side effects the type cannot express.
/**
 * Calculates RSI with Wilder's smoothing.
 * The first `period - 1` values are `null` because RSI is undefined before
 * a full period of data is available.
 */
```

### Accuracy & Placement

<a id="JD-1"></a>
#### JD-1 — Every JSDoc claim matches the implementation and is tested

`@returns`, `@param` discriminants, `@throws`, `@example` and prose claims such as "never
throws" or "dynamic TTL" are checked against the code, and each documented branch or
exception has a test. A claim that outlives a refactor misleads callers (a function split
in two keeps describing both halves).

When a contract changes (cache-hit semantics, error behavior, a default), grep for every JSDoc,
doc table and sibling entry point that restates it and update them in the same change — a
restatement left behind is the most common stale claim.

For an optional field (`x?: T`), do not write "Required"; write "Must be provided when …".
Tag requirements per tier are in [Required Tags by Tier](#required-tags-by-tier).

<a id="JD-2"></a>
#### JD-2 — JSDoc sits directly above its target

Never insert a declaration between a JSDoc block and the symbol it documents; the comment
then documents the wrong thing and the target is left bare. Splitting a function splits its
JSDoc: each piece gets its own comment describing that piece. After any change that adds
declarations, re-check adjacency.

```ts
// ❌ the new constant lands between the doc and its function
/** Detects a bull flag. */
const FLAG_MAX_AGE = 20;
function detectFlag() {}

// ✅ the doc stays attached; the constant gets its own line above the block
const FLAG_MAX_AGE = 20;
/** Detects a bull flag. */
function detectFlag() {}
```

<a id="JD-3"></a>
#### JD-3 — Tag syntax

- One block tag per line: `@port` and `@internal` never share a line, because parsers read
  the second tag as the first one's description. `@internal <one-line role>` is a single
  tag with text and is fine.
- `@throws {ErrorType} description`: always include the type.
- Put `@deprecated` at the end of the description, directly before `@param`/`@returns`.
  Placed first, TSDoc folds the whole description into the deprecation note.

<a id="JD-4"></a>
#### JD-4 — Silently excluded inputs are documented

If a public function drops an input case from its result (sessions after a warm-up gap
belong to no episode, so `ongoing` stays `false`), state it in the function's JSDoc, in the
docs of the affected fields, and in `PUBLIC_API.md`. A test alone is not documentation.

<a id="JD-5"></a>
#### JD-5 — Wrap JSDoc at the neighbouring width

Wrap multi-line descriptions to the width of the surrounding code (about 80–100
characters) with a continuation indent; do not leave a 150-character single line.

<a id="JD-6"></a>
#### JD-6 — Keep doc density consistent across sibling helpers

If sibling helpers in a module carry JSDoc, a new sibling does too. A bare helper among
documented ones reads as an oversight.

<a id="JD-7"></a>
#### JD-7 — A changed default is documented and tested

When an overload or option changes a default of an exported function, document the new
default in JSDoc (`defaults to X when omitted`) and assert it in a test.


## Comments & Documentation Sync

<a id="DS-1"></a>
#### DS-1 — Comments describe current code

After a rename, a model switch or a move, grep the old name repo-wide (including public
types) and fix or drop every comment that still says it; drop model names from comments
that do not need them. After moving content into a variable or another section, re-read
the comments about that variable or section.

<a id="DS-2"></a>
#### DS-2 — External-API limitation claims name the endpoint and are re-verified

A comment such as "provider X does not support json_schema" is true for one endpoint or SDK
version. Name the endpoint, and re-check the claim when the SDK or the endpoint set changes;
a half-true claim silently disables a feature.

<a id="DS-3"></a>
#### DS-3 — Algorithmic and causal claims are recomputed

A claim about convergence, tie handling or why a score changed is checked by computation,
and a causal claim lists every contributing factor. Attributing a delta to one source while
ignoring another is a stale bug waiting to be read as fact.

<a id="DS-4"></a>
#### DS-4 — Position claims name the layer and hold on every branch

"The article sits last in the prompt" must say whose output it describes (the builder or
the dispatched prompt) and stay true when a caller appends a locale reminder or another
branch reorders content.

<a id="DS-5"></a>
#### DS-5 — When a contract or rule changes, update every doc and restatement

Update every doc on the changed type (interface block, field docs, record types, the
`PUBLIC_API.md` entry) and every line that restates a rule that gained an exception.
Examples follow the rules: an example that shows what a rule forbids, or a time zone the
new rule replaced, makes the reader guess which is right.

This includes prose inside one prompt: a section intro and the "Writing Rules" below it
state the same behavior, so changing one without the other leaves contradicting
instructions (the intro says unlisted patterns get `geometry: null`, the rules still say
to fill the geometry). After editing either, re-read the other.

Tracked design specs (`docs/superpowers/specs/`) restate contracts too: grep them for the
old behavior when an invalidation, qualification or threshold rule changes.

`PUBLIC_API.md` restates the surface in several places: the export inventory, the change
log, and itemized counts or lists ("16 models", "N exports"). A new export, a removed
entry or a prompt-version bump updates all of them; grep the old count and list.

<a id="DS-6"></a>
#### DS-6 — No process residue in code

Review-round or coordinator tags ("review R6", "coordinator item C3") do not belong in
comments or test names. Do not copy measurement numbers from an issue into JSDoc; state
the conclusion and point to the spec when provenance matters.


---

## ESLint Rules

`eslint.config.mjs` enforces `typescript-eslint` recommended, `no-unused-vars` (names
prefixed `_` are exempt) and the layer `no-restricted-imports` rules from
`docs/ARCHITECTURE.md`. Everything else in this document is checked in review, including
import position ([TS-6](#TS-6)), shadowing of Node globals (`process`,
`global`, `Buffer`, `URL`, `module`, `require`, `exports`) and `domain/` purity.

Never use `eslint-disable` or `eslint-disable-next-line` comments.
When a rule produces a warning, fix the root cause in the code rather than suppressing the rule.

EOF newline: every file must end with `\n`. Auto-fixed by `yarn format`.

---

## HTTP Status Codes

`siglens-core` does not own HTTP routing. If an infrastructure module needs to
inspect or return HTTP status codes (e.g. when wrapping a fetch call), use the
standard constants from `node:http2`.

```typescript
// ✅ Use built-in node:http2 constants — no external packages needed
import { constants } from 'node:http2';
const { HTTP_STATUS_BAD_REQUEST, HTTP_STATUS_NOT_FOUND } = constants;

// ❌ No local constant redefinition — node:http2 already provides standard constants
const HTTP_STATUS = { BAD_REQUEST: 400 };

// ❌ No hardcoded literals
if (response.status === 400) { ... }
```
