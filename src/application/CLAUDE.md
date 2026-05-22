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
import { FileSkillsLoader } from '@/infrastructure/skills/loader';
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
// ✅ application: sequences infra (load skills) → domain (build prompt) → infra (AI call) → infra (cache)
export async function submitAnalysis(params: SubmitAnalysisParams): Promise<string> {
    const cache = createCacheProvider();           // adapter factory → CacheProvider | null
    const skills = await new FileSkillsLoader().loadSkills();
    const prompt = buildAnalysisPrompt(params.symbol, params.bars, params.indicators, skills);
    // … enqueue, cache, etc.
}
```

If the logic touches only a single infrastructure module with trivial glue, it may belong
in that infrastructure module instead. Do not promote it to `application/` prematurely.

## Adapter Composition

Use-cases call **infrastructure adapter factories** directly (`createCacheProvider()`,
`new FileSkillsLoader()`, etc.). Factories return values typed as the corresponding
**domain port** (`CacheProvider`, `SkillsProvider`, …), so the contract between
application and infrastructure is enforced by the compiler — application code is
written against the port, never against an adapter's concrete shape.

Do **not** push every dependency through a `deps: { … }` parameter. Library
consumers call use-cases with domain inputs only (`submitAnalysis(params)`) and
should not be burdened with adapter wiring. The library owns wiring; the consumer
owns the call site.

The exception is test seams: when a factory's return value is a singleton or otherwise
hard to substitute at runtime, mock the factory module with `vi.mock` (see Testing).

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
const mockCreateCacheProvider = createCacheProvider as Mock;

const stubCache: CacheProvider = {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
};

beforeEach(() => {
    mockCreateCacheProvider.mockReturnValue(stubCache);
});
```
