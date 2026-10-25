# Service Overview

`@y0ngha/siglens-core` is the **pure TypeScript core library** behind Siglens —
an AI analysis platform for U.S. stocks, Korean stocks and crypto. It contains the technical analysis domain
(indicators, candle patterns, chart patterns, analysis prompt builder) plus the
infrastructure wrappers (AI provider SDK adapters, Redis cache and counters, skills
loader) plus the in-process use cases that compose them.

This package has no UI. Presentation (charts, pages, components) lives in separate
consumer projects that depend on this library.

---

## Why This Exists

Keeping the analysis core in its own npm package gives us:

```
- One source of truth for indicator math and candle/pattern rules
- A testable, framework-free core (Vitest coverage thresholds of 90% on lines,
  functions, branches and statements across domain, infrastructure and application)
- Free choice of front-end or runtime (the Siglens web app, the ai.siglens.io agent,
  a CLI, etc.) without duplicating domain logic
```

## What This Library Provides

```
domain/         Pure calculations and contracts
                  - Indicators (RSI, MACD, Bollinger, DMI, Stochastic, VWAP, MA/EMA, etc.)
                  - Candle pattern and chart pattern detection, signal detection
                  - Analysis prompt construction and AI response validation
                  - Tier gating policies (analysis/chatbot usage limits)
                  - Shared types and market constants
                  - Port interfaces (cache, market data, news, repositories, ...)

infrastructure/ I/O adapters
                  - AI provider SDK adapters (Anthropic, Gemini, OpenAI, DeepSeek)
                    with retry; server-owned keys are read from env, BYOK keys
                    are passed in by the caller
                  - Skills loader (reads markdown skill files)
                  - Cache, chat token store, period counters, re-analysis
                    cooldown (Upstash Redis)

application/    In-process use cases (run* functions)
                  - Call the model directly and return the finished result
                  - Caching, in-flight de-duplication (Redis lock), tier gating,
                    usage limits and BYOK handling
                  - No job queue and no external worker
```

## What This Library Does NOT Provide

```
❌ UI components, chart rendering, or styling
❌ Order / trade execution
❌ Real-time data feeds
❌ Investment advice or buy/sell recommendations

❌ User authentication, session management, OAuth flows
❌ Email delivery / verification token storage
❌ Drizzle ORM schema, Neon/Postgres client, migrations
❌ Concrete database adapters — only repository interfaces are exposed
❌ Market, news, fundamentals, options, congress and investor-flow data fetchers —
   only the provider ports are exposed; consumers supply the implementations
❌ Skill files — the loader is included, the skill content is supplied by the consumer
❌ Korean ticker translation / asset translation
❌ BYOK (user-supplied LLM API key) storage and validation
❌ User tier CRUD operations (read-only policy interface only)
❌ Contact form / inquiry handling

These all live in consumer applications (e.g. the Siglens web app).
```

---

## Consumers

```
Any project that needs Siglens' analysis capabilities.
Typical consumers are:

- A Next.js web app that renders charts and shows AI analysis
- The ai.siglens.io agent
- A background process or CLI that runs analyses outside a web server
```

Consumers import from the package's public entry:

```typescript
import {
    calculateIndicators,
    detectSignals,
    runAnalysis,
    createCacheProvider,
} from '@y0ngha/siglens-core';
```

`calculateIndicators` is the high-level Tier 2 entry point that returns a structured
`IndicatorResult` with all indicators (RSI, MACD, Bollinger Bands, etc.) precomputed
from a single OHLCV candle array. Prefer it over calling individual indicator
calculators directly.

The server entry (`dist/index.js`) targets the **Node.js runtime** and exports the full
API. Bundlers select the browser entry (`dist/index.client.js`) through the `browser`
export condition; it is a pure, browser-safe subset with no application or
infrastructure runtime code. The library does not depend on DOM or React.

---

## Tech Stack

```
TypeScript  7.0 (native compiler — `tsc` from the `typescript7` devDependency)
Node.js     >=22 (package.json `engines`)
yarn        4.x (see `packageManager` in package.json)
```

TypeScript 7 ships no JS API (`typescript/lib/typescript.js`), but typescript-eslint, typedoc
and the guard tests (`importCycles`, `publicApiInventory`) `require('typescript')` for it. So the
`typescript` devDependency is an alias of `@typescript/typescript6` (the TS 6 API, `tsc6` bin)
and the TS 7 compiler is installed as `typescript7`, whose `tsc` bin the scripts run. Type
checking and the build are TS 7; only those tools read code through the TS 6 API. Drop the
alias once they support TS 7 (typescript-eslint#10940).

```
Linting     ESLint + Prettier
Tests       Vitest (90% threshold for lines, functions, branches and statements,
            enforced by vitest.config.ts)
Build       tsc → dist/
```

No bundler, no dev server. The package exposes `dist/index.js` and `dist/index.d.ts`
(plus the browser entry `dist/index.client.js`) as declared in `package.json`:

```
"main":  "dist/index.js",
"types": "dist/index.d.ts",
"files": ["dist"]
```

Runtime dependencies are the AI provider SDKs (`@anthropic-ai/sdk`, `@google/genai`,
`openai`) and `jsonrepair`. `@upstash/redis` is an optional peer dependency, needed only
for the Redis-backed adapters.

---

## Skills System

Siglens extends its analysis capabilities through `.md` files inside `/skills/` and
its subdirectories. New analysis techniques are applied simply by adding a Markdown
file — no code changes required.

### Directory Location

The loader reads `.md` files recursively from a `skills/` directory under the process
working directory (`join(process.cwd(), 'skills')`). The skill files are supplied by the
consumer; this repository does not ship them. Skills are declarative configuration, not
source code.

### Layer Responsibility

Skills files are **not** read by `domain/` — domain has no file I/O.
Reading and parsing skills `.md` files is the responsibility of
**`infrastructure/skills/loader.ts`** (`FileSkillsLoader`, `createSkillsProvider`,
`loadSkillsCached`).
The parsed `Skill[]` is passed into `domain/analysis/prompt.ts` as a plain data structure.

```
infrastructure/skills/loader.ts
  → recursively scans skills/ subdirectories for .md files
    (file I/O — allowed in infrastructure layer)
  → parses frontmatter + body
  → returns Skill[]
  → loadSkillsCached() memoizes the result and falls back to an empty list if loading fails

application run* use cases (e.g. runAnalysis)
  → call loadSkillsCached()
  → pass Skill[] to domain/analysis/prompt.ts

domain/analysis/prompt.ts
  → builds the prompt (pure function, no file access)
```

### When Working on Skills-related Tasks

- Read all `.md` files in the `skills/` directory
- Check the `indicators` field in each file's frontmatter to identify required indicators
- `confidence_weight` maps to a Low/Medium/High display label in the prompt; there is no weight floor that excludes a skill. The set passed to the prompt can be capped per tier by `infrastructure/skills/sampling.ts` (`sampleSkillsForTier`).
- Refer to the Skills System section in `docs/DOMAIN.md` for the full file format spec,
  type definitions, and `Skill` interface
