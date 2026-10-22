# application/

Orchestration layer. Composes domain and infrastructure into complete use-case flows.

## Responsibility

Each module in this layer is a **use-case** — a named, end-to-end operation that
a library consumer can call without knowing which infrastructure modules or domain
functions are involved.

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
`MarketDataProvider` and `callAiProvider` are injected as explicit parameters because the
*consumer* owns the real external I/O implementation; core only owns the port contract.
Injecting them is the right boundary: core must not hard-wire a specific FMP or
Alpaca adapter, just as it must not hard-wire a specific AI provider SDK.
These parameters are required when a cache miss occurs (the fetch path) and must
be supplied by the siglens app call site.
This is an intentional, permanent exception to the "library owns wiring" rule —
do not revert it to a factory call.

The general test-seam exception still applies: when a factory's return value is a
singleton or otherwise hard to substitute at runtime, mock the factory module with
`vi.mock` (see Testing).

## Dispatch contract — prompt assembly (Design C)

`submit*.ts` use-cases receive an `AssembledPrompt` (`{ stable, dynamic }`) from the
domain builder and dispatch it as **two separate fields**, not one combined user prompt:

- `system = AI_SYSTEM_PROMPT + '\n\n' + assembled.stable` (when `stable` is non-empty;
  otherwise just `AI_SYSTEM_PROMPT`) — the `always_on` skill digests live in the
  **system** prompt so providers (Gemini/OpenAI/Claude) cache the stable prefix.
  For technical analysis `stable` leads with the fixed Analysis Intent + Guidelines
  blocks (p22) — ahead of the per-symbol-sampled free-tier skill digests — so
  `persona → Intent → Guidelines` is byte-identical across symbols.
- `prompt = assembled.dynamic` — the per-call half (symbol framing, fetched data,
  gated skills, request block).
- `seed = analysisSeed(system + '\n\n' + prompt)` — computed over the full assembled
  content so the cache seed still reflects both halves.

## Coding Rules

**Define types in the module's `types.ts`**, not inside function files.

**Exported functions must declare explicit return types.**

**No hardcoded literals** — extract to constants.

**Error propagation:** application functions should not swallow errors from infrastructure.
Let them propagate to the caller. Only catch when you need to transform or add context.
The one exception is background work handed to `fireAndForget` (see `src/application/CLAUDE.md#APP-2`).

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

### Use-case Gotchas

IDs are stable and never renumbered; cite them as `src/application/CLAUDE.md#APP-2`.

<a id="APP-1"></a>
#### APP-1 — A fallback that degrades returns a flag

`loadSkills().catch(() => [])` turns an outage into an empty result the caller cannot tell
from "no skills". Log the failure and expose the degradation on the return value
(`skillsDegraded`).

```typescript
// ❌ const skills = await loadSkills().catch(() => []);
// ✅ .catch(error => { console.error(TAG, error); return DEGRADED; }) and return
//    skillsDegraded alongside the data
```

<a id="APP-2"></a>
#### APP-2 — Fire-and-forget: read first, write destructively, then background

When one use-case reads prerequisites, mutates, and then triggers background work, keep
that order: capture every read the later steps need, then perform the destructive write,
then start the background calls from the captured data. Reading after the write finds
nothing (a cascade delete removes the tokens you meant to revoke).

Background work is the one place errors are swallowed, and only at the seam
(`application/background.ts`): the promise handed to `fireAndForget` catches and logs its
own errors, so a background failure never reaches the caller. Everywhere else the
"don't swallow errors" rule above applies.

<a id="APP-3"></a>
#### APP-3 — I/O calls at the same call depth get the same protection

If one I/O call in a use-case is guarded (try/catch, fail-open), every I/O call at that
depth is guarded the same way. A guarded `recordUsage` next to an unguarded
`checkUsageAllowed` gives two failure modes for one outage.

<a id="APP-4"></a>
#### APP-4 — One authoritative source per configuration option

Accept a configuration option (`tierConfig`) once at the entry point and pass it down. If
both an outer and an inner options object accept it, callers can set conflicting values and
gating decisions diverge.

<a id="APP-5"></a>
#### APP-5 — Options that change model output flow into the key, the seed and every sub-call

`reasoning`, `skipEnqueueIfMiss` and similar options change what the model returns. Fold
them into the cache key and the sampling seed, and force them into every sub-axis option
object. Otherwise on/off variants collide on one cache entry and the first caller decides
the output for everyone until the TTL expires. Copy the pattern of the sibling use-case
(`buildNewsCacheKey(..., reasoning)` plus `reasoningSeedPart`); see
`src/infrastructure/CLAUDE.md#INF-4`.

<a id="APP-6"></a>
#### APP-6 — Related use-cases return the same shape for the same lifecycle concept

Use-cases that end the same kind of lifecycle (logout and account deletion both end a
session) return the same metadata shape, so a caller can chain the same follow-up logic.

## Testing

- Coverage target: **90% branch coverage** (required).
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
