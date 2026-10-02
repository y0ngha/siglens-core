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
import { submitAnalysis } from '@/application/market/submitAnalysis';

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
  cached payload shapes (`CachedBriefingData`), validated config (`WorkerConfig`),
  result wrappers (`LoadSkillsCachedResult`). Do **not** redeclare port interfaces
  here.

**Adapter authoring:**
- Class adapters declare `implements <Port>` explicitly.
- Factory adapters annotate their return type as the port.
- Tag the adapter's JSDoc with `@adapter implements {@link <Port>}` so the
  port↔adapter link is greppable.

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
