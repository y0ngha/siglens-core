# infrastructure/

External world boundary layer. Every outbound I/O call lives here — and nowhere else.

## Responsibility

Wrap external systems behind typed interfaces so the rest of the codebase never
touches raw HTTP, environment variables, or third-party SDKs directly.

Each sub-directory corresponds to exactly **one** external system.

## Dependency Rules

```
infrastructure ← MAY import from domain/
                 MAY NOT import from application/   (ESLint enforced)
                 MAY NOT import from other infrastructure sub-directories
                   in a way that creates transitive cycles
```

**Allowed:**
```typescript
import { Bar } from '@/domain/types';
import { calculateRSI } from '@/domain/indicators/rsi';
```

**Prohibited:**
```typescript
// ❌ Importing from application
import { runAnalysis } from '@/application/market/runAnalysis';

// ❌ Circular cross-module dependency (A → B → A)
// If two infra modules share state, extract to a third file
```

## Adapter Pattern

Every infrastructure module is an **adapter** that implements a **port** owned by
the domain. Ports live in `domain/ports/`; adapters import the port type and fulfill
its contract.

**Where contracts live:**
- `domain/ports/<port>.ts` — the port interface (`CacheProvider`,
  `MarketDataProvider`, `SkillsProvider`, …). Owned by the domain because the
  domain is the side that declares its needs.
- `infrastructure/<module>/types.ts` — **adapter-internal types only**. Examples:
  cached payload shapes (`CachedBriefingData`), result wrappers
  (`LoadSkillsCachedResult`). Do **not** redeclare port interfaces
  here.

**Adapter authoring:**
- Class adapters declare `implements <Port>` explicitly.
- Factory adapters annotate their return type as the port.
- Tag the adapter's JSDoc with `@adapter implements {@link <Port>}` so the
  port↔adapter link is greppable.
- Adapter-internal types live in the module's `types.ts`, never in implementation files and
  never in `domain/types.ts`.

**Example — cache module:**
```typescript
// domain/ports/cache.ts
/** @port */
export interface CacheProvider {
    get<T>(key: string): Promise<T | null>;
    set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
    delete(key: string): Promise<void>;
}

// infrastructure/cache/types.ts — adapter-internal only
/** @internal Cached payload for a market briefing entry. */
export interface CachedBriefingData {
    briefing: unknown;
    generatedAt: string;
}

// infrastructure/cache/redis.ts — adapter
import type { CacheProvider } from '@/domain/ports/cache';

/** @adapter implements {@link CacheProvider} */
export function createCacheProvider(): CacheProvider | null { ... }
```

This separation lets tests and application-layer callers inject stub implementations
of the port without touching the real external system, and makes "what does the
domain need from the outside world?" answerable by reading a single folder
(`domain/ports/`).

## Environment Variables

`process.env.*` reads are allowed **only inside infrastructure modules**.
Domain and application layers must never access `process.env` directly.

```typescript
// ✅ infrastructure/cache/redis.ts
const url = process.env.UPSTASH_REDIS_REST_URL;

// ❌ domain/indicators/rsi.ts
const key = process.env.API_KEY; // prohibited
```

<a id="INF-3"></a>
#### INF-3 — One config module per external system reads its env

Each external system's environment reads live in a single config module (for example
`infrastructure/upstash/config.ts` (`readUpstashConfig`) for `UPSTASH_*`); other modules import from it instead of
reading `process.env` themselves. When an env var or endpoint changes, update
`docs/API.md` (the full required and optional list) in the same change.

## Graceful Degradation

Missing env vars must not crash the library at construction time.
**Adapter factories** return `null` (or an empty result) when required configuration
is absent, so callers can continue without that dependency:

```typescript
// ✅ Factory returns null when Upstash env vars are missing
export function createCacheProvider(): CacheProvider | null {
    const config = readUpstashConfig();
    if (!config) return null;
    // … construct adapter against config
}
```

**Adapter operations** (the methods on the returned port), however, do **not**
silently swallow runtime errors. Surface the underlying client's error to the
caller — the application layer decides whether a cache outage should degrade to
a miss, retry, or propagate. Hiding errors at the adapter level makes those
decisions impossible upstream and lets failures masquerade as cache misses.

```typescript
// ✅ Adapter operation surfaces the error; caller decides
async get<T>(key: string): Promise<T | null> {
    return this.client.get<T>(key);  // throws → caller handles
}

// ❌ Adapter swallowing the error — caller has no way to distinguish miss vs outage
async get<T>(key: string): Promise<T | null> {
    try { return await this.client.get<T>(key); }
    catch { return null; }
}
```

## Data & Logging

IDs are stable and never renumbered; cite them as `src/infrastructure/CLAUDE.md#INF-4`.

<a id="INF-1"></a>
#### INF-1 — Every code path writes the same shape

The main path, retries and background jobs write the same fields. A background refresh that
caches `{ symbol, name }` where the main path caches `{ symbol, name, fmpSymbol }` leaves
readers with a shape that depends on which path ran last.

<a id="INF-2"></a>
#### INF-2 — No untagged or debug logging; operational logs carry a source tag

Do not leave `console.log` debugging or timing prints without a tag. Intentional
operational logs are allowed and must start with a bracketed source tag so they can be
attributed and filtered: provider call timing (`[Claude] Response time: …`), usage summaries
(`[Usage]`), degradation warnings (`[Gemini] Empty text response`). If something does not
deserve a stable tag, it does not belong in a log line; expose it through the return type
if callers need it.

<a id="INF-7"></a>
#### INF-7 — Validate persisted state before use

State read back from a store (Redis, cache, a token record) is validated for format and
length before comparison or use. A malformed value produces the same invalid result as any
other bad input; it never throws from deep inside a comparison (`chat/tokenStore.ts`
validates before comparing).

## Cache Keys & Versions

<a id="INF-4"></a>
#### INF-4 — Cache keys follow the rendered bytes

- Every LLM-output cache key embeds a `*_PROMPT_TEMPLATE_VERSION` (or a fingerprint that
  embeds one). Bump it whenever the rendered prompt bytes change, including through shared
  formatters; without a bump, stale entries are served until the TTL expires.
- An input hash covers the data snapshot, not the prompt. Changing which rows a prompt
  builder selects, caps or orders (calendar selection, top-N, filters) changes the bytes
  even though the snapshot and the template text are untouched, so it needs the same bump.
  Make the version bump part of the same change as the byte change, and check it before
  review, not after.
- After any bump, audit every `build*Key` in `cache/config.ts`, not just the one you
  touched. Deterministic non-LLM keys (identifier-only concatenation) are exempt.
- A shared prompt fragment (a common system base, language contract, formatter) changes the
  bytes of every prompt that embeds it. List the bump set by rendering each consuming
  template before and after (non-default locales included), not by recalling which ones
  you edited, and give each bumped constant a key-format test.
  ❌ Bump `OVERALL_*` only because its file was edited while financials/options prompts also
  changed through the shared base. ✅ Bump every template whose rendered output differs.
- A read path that rebuilds a key tests each key argument with a case where a mismatch on
  that argument alone misses (`CONVENTIONS.md#TE-5`).
- A second reader of an existing cache entry applies the same validity guards as the first
  (empty-after-normalize, degraded flag); share the guard helper instead of copying it.

<a id="INF-5"></a>
#### INF-5 — Cross-instance coordination is owner-bound

- Release a distributed lock by comparing its owner token and deleting only on a match
  (`deleteIfEquals`). An unconditional `DEL` after the TTL expired deletes another
  instance's lock.
- Bind a published result to its generation, so a waiter never reuses a stale one.
- Validate and cap LLM output before sharing it with other instances.
- Fail-open paths document the trade-off ([INF-10](#INF-10)). Regression tests:
  `CONVENTIONS.md#TE-15`.

## Outbound Calls & Providers

<a id="INF-6"></a>
#### INF-6 — Every outbound fetch has a timeout

A `fetch` without `AbortSignal.timeout(ms)` can block indefinitely, including
fire-and-forget calls. Size the timeout to the call's job (seconds for a cancel request,
longer for batch polling); never `Infinity`.

<a id="INF-8"></a>
#### INF-8 — Change one AI provider, apply to all; diff SDK unions on upgrade

When a behavior changes in one provider (error handling, tests, naming), apply it to every
provider. When upgrading an SDK, diff the enumerated response unions the adapter branches on
(`stop_reason`, `finishReason`) between the old and new `.d.ts`: a new value falls into a
catch-all and neither mock tests nor a live smoke test reveal it.

## HTTP Status Codes

Use constants from `node:http2` — no local redefinitions, no hardcoded numbers.

```typescript
import { constants } from 'node:http2';
const { HTTP_STATUS_BAD_REQUEST, HTTP_STATUS_NOT_FOUND } = constants;

// ❌ if (response.status === 400) { ... }
// ✅ if (response.status === HTTP_STATUS_BAD_REQUEST) { ... }
```

## Internal Logic

Extract pure calculation helpers into separate functions so they can be unit-tested
without triggering real I/O.

```typescript
// ✅ Pure helper — testable in isolation
export function buildCacheKey(symbol: string, timeframe: string): string {
    return `analysis:${symbol}:${timeframe}`;
}

// ✅ I/O function uses the helper
async function fetchAndCache(symbol: string, timeframe: string): Promise<string | null> {
    const key = buildCacheKey(symbol, timeframe);
    return this.cache.get(key);
}
```

Do not define generator pipelines in infrastructure — those belong in `domain/`.

<a id="INF-9"></a>
#### INF-9 — Pure helpers move to `domain/`; never re-export domain symbols

A helper that does no I/O (no env, network or filesystem) belongs in `domain/`, not in
`infrastructure/`. An infrastructure module is not a transit path: it never re-exports
`@/domain/...` symbols (`export { parseJsonResponse } from '@/domain/utils'`); callers
import them from `domain/` directly.

<a id="INF-10"></a>
#### INF-10 — Comment deliberate trade-offs

When you choose a fail-open acquire path, a recomputation instead of a memo, or another
optimization that gives something up, say in a comment what is traded and when to revisit
it (for example "concurrent winners may duplicate work; switch to a queue if that becomes
expensive").

<a id="INF-11"></a>
#### INF-11 — Optional peer dependencies are loaded lazily through `loadOptionalSdk`

`@anthropic-ai/sdk`, `@google/genai`, `openai` and `@upstash/redis` are optional peer dependencies. Never import
them as runtime values at module top level — use `import type` for their types and load the
module through `loadOptionalSdk(...)` (`infrastructure/optionalPeer/loadOptionalSdk.ts`) on first use, so
importing the package entry never requires an SDK the consumer did not install. After awaiting
the loader, re-check the caller's `AbortSignal` (`signal?.throwIfAborted()`): an abort that
arrives while the SDK loads would otherwise be lost. Never let an SDK type reach a public
declaration. Redis adapters get their client from `lazyRedisClient` (`infrastructure/upstash/client.ts`)
and await it inside the same `try` that handles Redis errors. `yarn verify:dist` loads each
package entry with every optional peer blocked, so a top-level import fails CI.

## Testing

- Coverage target: **90% branch coverage** (required).
- Test file location: `src/__tests__/infrastructure/<sub-folder>/<file>.test.ts`
- Never hit real Upstash / Neon / AI endpoints in tests.
- Inject stub implementations via the interface, not `vi.spyOn` on private members.

```typescript
import { vi } from 'vitest';
import type { CacheProvider } from '@/domain/ports/cache';

const stubCache: CacheProvider = {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
};
```

For modules that read `process.env`, set values inside `beforeEach` and restore afterwards.
Do not rely on a global setup file to mutate process-wide state.
