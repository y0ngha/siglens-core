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
import { UpstashAnalysisCache } from '@/infrastructure/cache/redis';
import { ClaudeClient } from '@/infrastructure/ai/claude';
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
    const skills = await skillsLoader.load();
    const prompt = buildAnalysisPrompt(params.symbol, params.bars, params.indicators, skills);
    const jobId = await jobQueue.enqueue(prompt);
    return jobId;
}
```

If the logic touches only a single infrastructure module with trivial glue, it may belong
in that infrastructure module instead. Do not promote it to `application/` prematurely.

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

**Dependency injection over direct instantiation:** accept infrastructure clients as
parameters or via a factory so tests can inject stubs.

```typescript
// ✅ Accept dependencies as parameters
export async function submitAnalysis(
    params: SubmitAnalysisParams,
    deps: { skillsLoader: SkillsLoader; jobQueue: JobQueue },
): Promise<string> { ... }
```

## Testing

- Coverage target: **100% branch coverage** (required).
- Test file location: `src/__tests__/application/<sub-folder>/<file>.test.ts`
- Inject stub infrastructure implementations via interfaces — never hit real external systems.
- Domain functions can be called directly (they are pure) — no need to mock them.

```typescript
const stubJobQueue: JobQueue = {
    enqueue: vi.fn().mockResolvedValue('job-123'),
    dequeue: vi.fn().mockResolvedValue(null),
    status: vi.fn().mockResolvedValue('pending'),
};
```
