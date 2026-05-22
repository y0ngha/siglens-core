# domain/

Pure business logic layer. Zero I/O, zero side effects, zero external dependencies.

## Responsibility

This layer owns all calculation logic: technical indicators, candle pattern detection,
chart pattern analysis, signal detection, and prompt construction.
If it can be expressed as a pure function, it belongs here.

The layer also owns the **port interfaces** (`domain/ports/`) — contracts the domain
requires from the outside world (caches, repositories, providers, dispatchers).
Adapters that fulfill these ports live in `infrastructure/`; the domain never imports
them, only the port type.

## Ports

`domain/ports/` declares every external-system contract the library needs. Each port
is a pure interface — no behavior, no implementation, no SDK references. Adapters in
`infrastructure/<module>/` import the port and implement it (`implements` for classes,
explicit return-type annotation for factory functions).

**Target file layout (ports are migrated module-by-module — only files listed
under "Currently migrated" actually exist today):**

```
domain/ports/
  aiProvider.ts        → CallAiProvider, CallAiProviderOptions, ... ✅ migrated
  cache.ts             → CacheProvider           ✅ migrated
  chatTokenStore.ts    → ChatTokenStore           ✅ migrated
  fundamentalDataProvider.ts → FundamentalDataProvider ✅ migrated
  jobStateStore.ts     → JobStateStore (@internal), JobStateSetOpts ✅ migrated
  newsProvider.ts      → NewsProvider, NewsTimeRange ✅ migrated
  optionsDataProvider.ts → OptionsDataProvider     ✅ migrated
  marketDataProvider.ts → MarketDataProvider, GetBarsOptions   ⏳ planned
  skillsProvider.ts    → SkillsProvider                         ✅ migrated
  ...
```

Until a module is migrated, its port interface still lives in
`infrastructure/<module>/types.ts`. Do not import from a `domain/ports/<x>` path
that is not yet listed under "✅ migrated".

**Authoring rules:**
- One conceptual contract per file. Co-locate option / argument types used by that
  contract (e.g. `GetBarsOptions` next to `MarketDataProvider`) — do not push them
  to `domain/types.ts`.
- Tag the interface JSDoc with `@port` so adapters and reviewers can identify it.
- Keep the existing naming convention (`Provider`, `Repository`, `Dispatcher`,
  `Store`) — natural language over a forced `Port` suffix.
- DTOs the port returns or receives (`Bar`, `MarketQuote`, `Skill`, …) stay in
  `domain/types.ts`. Ports reference them via import.

**Example:**
```typescript
// domain/ports/cache.ts
/**
 * @port
 * Generic key-value cache contract the domain depends on for memoizing
 * expensive analyses.
 */
export interface CacheProvider {
    get<T>(key: string): Promise<T | null>;
    set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
    delete(key: string): Promise<void>;
}

// infrastructure/cache/redis.ts — adapter
import type { CacheProvider } from '@/domain/ports/cache';

/** @adapter implements {@link CacheProvider} */
export function createCacheProvider(): CacheProvider | null { ... }
```

## Dependency Rules

```
domain ← NO external imports (npm packages, AI libraries, technical-indicator libs, etc.)
         NO imports from infrastructure/ or application/
         NO Date.now(), fetch, console.*, process.env
         Pure TypeScript only
```

**Allowed imports inside domain/:**
- Other files within `domain/` (e.g. `domain/types.ts`, peer files in same sub-folder)
- Node built-in types that are purely type-level (no runtime I/O)

**Prohibited:**
```typescript
// ❌ External library
import { RSI } from 'technicalindicators';

// ❌ Infrastructure import
import { redisCache } from '@/infrastructure/cache/redis';

// ❌ Side effects
const now = Date.now();
console.log(closes);
const key = process.env.API_KEY;
```

## Coding Rules

**Functions must be pure:** same input → same output, no side effects.

**Immutability:** never mutate input arguments.
```typescript
// ❌ bars.push(bar)      ✅ [...bars, bar]
// ❌ bar.close = 100     ✅ { ...bar, close: 100 }
// ❌ arr.sort()          ✅ arr.toSorted()
// ❌ arr.reverse()       ✅ arr.toReversed()
```

**Types live in `domain/types.ts`**, not in individual implementation files.
```typescript
// ❌ Define MACDResult inside macd.ts
// ✅ Define MACDResult in domain/types.ts, import it in macd.ts
```

**Subdirectory `types.ts` exception** — when a feature area introduces 10+ cohesive types
(currently `domain/options/types.ts`), defining them in a feature-local `types.ts` is
permitted **provided** `domain/types.ts` re-exports the full set, so all consumers still
use the canonical `@/domain/types` import path. The exception exists because inlining a
large feature's types would push `domain/types.ts` past 2,200 lines and dilute its
discoverability. Implementation files in that feature folder must still NOT define their
own types — they import from the feature-local `types.ts`.

```typescript
// ✅ domain/options/types.ts defines OptionsContract, OptionsChain, ...
// ✅ domain/types.ts re-exports the full set
// ✅ Consumers: import type { OptionsChain } from '@/domain/types'
// ❌ Define OptionsContract inside domain/options/sanitizeOptionsChain.ts
```

**No hardcoded literals:** extract to constants files.
```typescript
// ❌ period = 14
// ✅ period = RSI_DEFAULT_PERIOD  (domain/indicators/constants.ts or domain/constants/)
```

**Null for uninitialized periods:**
```typescript
// Initial period values must be null, not 0 or undefined
const result: (number | null)[] = new Array(period - 1).fill(null);
```

**Exported functions must declare explicit return types:**
```typescript
export function calculateRSI(closes: number[], period: number): (number | null)[] { ... }
```

**Named interfaces over inline return types:**
```typescript
// ❌ function compute(): { gain: number; loss: number } { ... }
// ✅ interface GainLoss { gain: number; loss: number }
//    function compute(): GainLoss { ... }
```

## Lazy Evaluation

Use generator pipelines for large datasets (1,000+ Bar records, multi-stage transforms).

```typescript
// ✅ Define lazy pipeline; materialize only at the final step
function* slidingWindow<T>(items: T[], size: number): Generator<T[]> {
    for (let i = 0; i + size <= items.length; i++) {
        yield items.slice(i, i + size);
    }
}
```

**Rule:** generator pipeline definitions belong in `domain/`. Materialization (spread / `Array.from`)
happens only as the last step inside the exported function.

## Performance Exceptions

A `for` loop with a local mutable accumulator is allowed when `reduce + spread` causes O(N²):
- All three conditions must hold: pure contract, no mutation of inputs, returned array is immutable to callers.

```typescript
// ✅ O(N) accumulator pattern (state-machine indicators)
const results: Result[] = new Array(bars.length);
let state = initialState;
for (let i = 0; i < bars.length; i++) {
    const { state: next, result } = nextStep(state, bars[i]);
    results[i] = result;
    state = next;
}
return results;
```

## Testing

- Coverage target: **100% branch coverage** (required).
- Test file location: `src/__tests__/domain/<sub-folder>/<file>.test.ts`
- No mocks needed — pure functions are trivially testable with direct inputs.

Required cases for period-based indicators:

| Case | description |
|------|-------------|
| Empty array | returns empty array |
| Input shorter than period | returns all-null array |
| Initial null range | first `period - 1` values are null |
| Valid value range | values from index `period - 1` onward are non-null numbers |
| Calculation accuracy | first computed value matches the spec |
