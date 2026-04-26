# @y0ngha/siglens-core

Pure TypeScript core library for the [Siglens](https://github.com/y0ngha/siglens) stock analysis platform — technical indicators, candle patterns, AI analysis prompt builders, and thin infrastructure wrappers.

This package contains **no UI, no React, no Next.js**. It is consumed by other projects (web apps, workers, CLIs) via npm and exposes a stable, tier-classified API surface.

## Installation

```bash
yarn add @y0ngha/siglens-core
```

Node 20 or newer is required.

### Peer dependencies

The package declares optional peer dependencies for the integrations it wraps. Install only what you actually use.

```bash
# If you use the Gemini AI provider
yarn add @google/genai

# If you use Upstash Redis (cache + job queue + cooldown)
yarn add @upstash/redis
```

## Quick start

The public API is grouped into four tiers. See [`docs/PUBLIC_API.md`](./docs/PUBLIC_API.md) for the full classification, semver policy, and rationale.

### Tier 1 — Application entrypoints

High-level use-case functions called from Server Actions / API handlers / workers.

```typescript
import { submitAnalysis, pollAnalysis } from '@y0ngha/siglens-core';

const submission = await submitAnalysis('AAPL', '1Day');
if (submission.status === 'cached') {
    return submission.result;
}

const result = await pollAnalysis(submission.jobId);
```

### Tier 2 — Domain building blocks

Synchronous pure-function entry points for indicator and signal computation.

```typescript
import { calculateIndicators, detectSignals, classifyTrend } from '@y0ngha/siglens-core';
import type { Bar } from '@y0ngha/siglens-core';

declare const bars: Bar[];

const indicators = calculateIndicators(bars);
const signals = detectSignals(bars, indicators);
const trend = classifyTrend(bars, indicators);
```

### Tier 3 — Infrastructure factories

Dependency-injection entry points for cache, AI providers, and other external systems.

```typescript
import {
    createCacheProvider,
    createMarketDataProvider,
    FileSkillsLoader,
} from '@y0ngha/siglens-core';

const cache = createCacheProvider();
const market = createMarketDataProvider();
const skills = new FileSkillsLoader('./skills');
```

### Tier 4 — Types

Every public function's parameter and return types are exported from the package root.

```typescript
import type {
    Bar,
    Timeframe,
    IndicatorResult,
    Signal,
    AnalysisResponse,
    SubmitAnalysisResult,
} from '@y0ngha/siglens-core';
```

## API documentation

Generated TypeDoc reference is available locally:

```bash
yarn doc          # generate to docs/api/
yarn doc:watch    # regenerate on change
```

Open `docs/api/index.html` in a browser. Internal helpers are filtered out automatically — only symbols re-exported from `src/index.ts` appear in the documentation. See [`docs/PUBLIC_API.md`](./docs/PUBLIC_API.md) for the full public/internal classification policy.

## Public vs. internal API

This package distinguishes between **public** (Tier 1–4, exported from `src/index.ts`) and **internal** (helper modules not re-exported) symbols.

- **Public symbols** have stable signatures. Breaking changes follow [semver](https://semver.org).
- **Internal symbols** can be renamed, restructured, or removed in any minor release.

**Do not deep-import internals.** The following is unsupported and will break:

```typescript
// ❌ Unsupported — will break in a future minor release
import { calculateRSI } from '@y0ngha/siglens-core/dist/domain/indicators/rsi';
```

If you need behaviour that is currently encapsulated inside a public function, open an issue or PR adding a new public entry point — never depend on internals via deep import.

The complete classification rules and per-symbol inventory live in [`docs/PUBLIC_API.md`](./docs/PUBLIC_API.md).

## Development

```bash
yarn typecheck      # tsc --noEmit
yarn lint           # eslint
yarn test           # vitest run
yarn build          # emit dist/
yarn doc            # regenerate docs/api/
```

For the architecture, layer dependency rules, and conventions, see:

- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — layer structure & dependency rules
- [`docs/PUBLIC_API.md`](./docs/PUBLIC_API.md) — public/internal classification & semver policy
- [`docs/CONVENTIONS.md`](./docs/CONVENTIONS.md) — coding conventions, JSDoc rules
- [`docs/DOMAIN.md`](./docs/DOMAIN.md) — indicator specs, candle patterns, business rules

## License

UNLICENSED — internal use within the Siglens project.
