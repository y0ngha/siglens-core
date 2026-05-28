# application/

Orchestration layer. Composes domain and infrastructure into complete use-case flows.

## Responsibility

Each module in this layer is a **use-case** — a named, end-to-end operation that
a library consumer can call without knowing which infrastructure modules or domain
functions are involved.

Current use-cases:

| Sub-directory | Use-cases |
|---|---|
| `market/` | `submitAnalysis`, `pollAnalysis`, `cancelAnalysisJob`, `submitBriefing`, `pollBriefing` |
| `ticker/` | Ticker-related orchestration |
| `dashboard/` | Dashboard-related orchestration |

## Dependency Rules

```
application ← MAY import from domain/
              MAY import from infrastructure/
              MAY NOT be imported by domain/ or infrastructure/   (ESLint enforced)
```

**Allowed:**
```typescript
import { buildAnalysisPrompt } from '@/domain/analysis/prompt';
import { createCacheProvider } from '@/infrastructure/cache/redis';
```

**Prohibited:**
```typescript
// ❌ domain importing application
// src/domain/analysis/prompt.ts
import { submitAnalysis } from '@/application/market/submitAnalysis'; // never

// ❌ infrastructure importing application
// src/infrastructure/jobs/queue.ts
import { pollAnalysis } from '@/application/market/pollAnalysis'; // never
```

## What Belongs Here

A function belongs in `application/` when it must coordinate **two or more** infrastructure
modules, or when it sequences a domain call followed by an infrastructure call.

```typescript
// ✅ application: cache lookup (infra) → domain prompt → infra enqueue → infra cache write
export async function submitAnalysis(params: SubmitAnalysisParams): Promise<string> {
    const cache = createCacheProvider();           // adapter factory → CacheProvider | null
    const cached = await cache?.get<AnalysisResponse>(buildAnalysisCacheKey(params));
    if (cached) return cached.jobId;
    const prompt = buildAnalysisPrompt(params.symbol, params.bars, params.indicators);
    // … enqueue, write cache, etc.
}
```

If the logic touches only a single infrastructure module with trivial glue, it may belong
in that infrastructure module instead. Do not promote it to `application/` prematurely.

## Adapter Composition

Use-cases call **infrastructure adapter factories** directly (e.g. `createCacheProvider()`).
Factories return values typed as the corresponding **domain port** (`CacheProvider`,
`MarketDataProvider`, …), so the contract between application and infrastructure is
enforced by the compiler — application code is written against the port, never
against an adapter's concrete shape.

For modules that have not yet been migrated to a domain port, the adapter is still
constructed directly. Treat those as temporary — they should be replaced with a
`create<Port>Provider()` factory when the module's port migration lands.

Do **not** push every dependency through a `deps: { … }` parameter. Library
consumers call use-cases with domain inputs only (`submitAnalysis(params)`) and
should not be burdened with adapter wiring. The library owns wiring; the consumer
owns the call site.

**Intentional exception — externally-owned I/O providers:**
`MarketDataProvider` (and `callAiProvider` before it, see Phase 4.5 in
`docs/PUBLIC_API.md`) are injected as explicit parameters because the *consumer*
owns the real external I/O implementation; core only owns the port contract.
Injecting them is the right boundary: core must not hard-wire a specific FMP or
Alpaca adapter, just as it must not hard-wire a specific AI provider SDK.
These parameters are required when a cache miss occurs (the fetch path) and must
be supplied by the siglens app call site.
This is an intentional, permanent exception to the "library owns wiring" rule —
do not revert it to a factory call.

The general test-seam exception still applies: when a factory's return value is a
singleton or otherwise hard to substitute at runtime, mock the factory module with
`vi.mock` (see Testing).

## Coding Rules

**Define types in the module's `types.ts`**, not inside function files.

**Exported functions must declare explicit return types.**

**No hardcoded literals** — extract to constants.

**Error propagation:** application functions should not swallow errors from infrastructure.
Let them propagate to the caller. Only catch when you need to transform or add context.

```typescript
// ❌ Silently swallowing
try {
    await cache.set(key, result, TTL);
} catch {
    // ignored — no retry, no log, no rethrow
}

// ✅ Let it propagate, or wrap with context
try {
    await cache.set(key, result, TTL);
} catch (err) {
    throw new Error(`Failed to cache analysis result for ${symbol}`, { cause: err });
}
```

## Testing

- Coverage target: **100% branch coverage** (required).
- Test file location: `src/__tests__/application/<sub-folder>/<file>.test.ts`
- Mock the **adapter factory module**, not the port interface — use-cases call
  factories directly, so `vi.mock` on the factory's module is the natural seam.
- Domain functions can be called directly (they are pure) — no need to mock them.
- Never hit real Upstash / Neon / AI endpoints in tests.

```typescript
import type { CacheProvider } from '@/domain/ports/cache';
import { createCacheProvider } from '@/infrastructure/cache/redis';

vi.mock('@/infrastructure/cache/redis');
const mockCreateCacheProvider = vi.mocked(createCacheProvider);

const stubCache: CacheProvider = {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
};

beforeEach(() => {
    mockCreateCacheProvider.mockReturnValue(stubCache);
});
```
