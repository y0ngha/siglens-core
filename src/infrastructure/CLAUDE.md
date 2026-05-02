# infrastructure/

External world boundary layer. Every outbound I/O call lives here — and nowhere else.

## Responsibility

Wrap external systems behind typed interfaces so the rest of the codebase never
touches raw HTTP, environment variables, or third-party SDKs directly.

Each sub-directory corresponds to exactly **one** external system:

| Sub-directory | External system |
|---|---|
| `ai/` | AI provider clients (Claude, Gemini) |
| `cache/` | Upstash Redis — TTL-based cache |
| `fmp/` | Financial Modeling Prep market data API |
| `jobs/` | Redis-based job queue (enqueue / dequeue / status) |
| `market/` | Market data provider abstraction |
| `skills/` | Filesystem Skills loader (`skills/*.md` → `Skill[]`) |
| `ticker/` | Ticker metadata persistence (Neon / PostgreSQL) |
| `upstash/` | Upstash Redis client factory |
| `usage/` | Daily-salt IP hashing helper for cross-DB usage tracking |

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

## Interface-First Pattern

Every module must define its contract in `types.ts` **before** writing the implementation.
The implementation class must explicitly implement the interface.

```typescript
// infrastructure/cache/types.ts
export interface AnalysisCache {
    get(key: string): Promise<string | null>;
    set(key: string, value: string, ttlSeconds: number): Promise<void>;
}

// infrastructure/cache/redis.ts
export class UpstashAnalysisCache implements AnalysisCache {
    async get(key: string): Promise<string | null> { ... }
    async set(key: string, value: string, ttlSeconds: number): Promise<void> { ... }
}
```

This allows tests and application-layer callers to inject stub implementations
without touching the real external system.

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

Missing env vars or network failures must not crash the library.
Return `null`, an empty result, or a sensible fallback, and let the caller decide.

```typescript
// ✅ Cache miss on connection failure — caller continues without cache
async get(key: string): Promise<string | null> {
    try {
        return await this.client.get(key);
    } catch {
        return null;
    }
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

- Coverage target: **100% branch coverage** (required).
- Test file location: `src/__tests__/infrastructure/<sub-folder>/<file>.test.ts`
- Never hit real Upstash / Neon / AI endpoints in tests.
- Inject stub implementations via the interface, not `vi.spyOn` on private members.

```typescript
import { vi } from 'vitest';
import type { AnalysisCache } from '@/infrastructure/cache/types';

const stubCache: AnalysisCache = {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
};
```

For modules that read `process.env`, set values inside `beforeEach` and restore afterwards.
Do not rely on a global setup file to mutate process-wide state.
