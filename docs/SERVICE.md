# Service Overview

`@y0ngha/siglens-core` is the **pure TypeScript core library** behind Siglens —
a U.S. stock AI analysis platform. It contains the technical analysis domain
(indicators, candle patterns, chart patterns, analysis prompt builder) plus the
thin infrastructure wrappers needed to feed those functions.

This package has no UI. Presentation (charts, pages, components) lives in separate
consumer projects that depend on this library.

---

## Why This Exists

The Siglens platform originally shipped as a single Next.js app. Splitting the
analysis core into its own npm package gives us:

```
- One source of truth for indicator math and candle/pattern rules
- A testable, framework-free core (100% branch coverage on domain + infrastructure)
- Free choice of front-end or runtime (Next.js app, Node worker, CLI, Cloud Run, etc.)
  without duplicating domain logic
```

## What This Library Provides

```
domain/         Pure calculations
                  - Indicators (RSI, MACD, Bollinger, DMI, Stochastic, VWAP, MA/EMA, etc.)
                  - Candle pattern detection (single + multi)
                  - Analysis prompt construction for AI providers
                  - Tier gating policies (analysis/chatbot usage limits)
                  - Shared types and market constants

infrastructure/ I/O wrappers + abstract interfaces
                  - AI provider type contracts (consumers supply concrete SDK adapter)
                  - Skills loader (reads markdown skill files)
                  - Cache (Upstash Redis)
                  - Job queue primitives (Upstash Redis)
                  - Market data provider interface (consumers supply fetch impl)
                  - Abstract repository interfaces (UsageRepository,
                    UsageLogRepository, UserTierRepository) — consumers
                    implement against their own database
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
❌ Korean ticker translation / asset translation
❌ BYOK (user-supplied LLM API key) storage and validation
❌ User tier CRUD operations (read-only policy interface only)
❌ Contact form / inquiry handling

These all live in consumer applications (e.g. the `siglens` Next.js app).
```

---

## Consumers

```
Any project that needs Siglens' analysis capabilities.
Typical consumers are:

- A Next.js web app that renders charts and shows AI analysis
- A Node worker that runs scheduled AI re-analysis jobs
- A CLI that runs one-shot analyses from a terminal
```

Consumers import from the package's public entry:

```typescript
import {
    calculateIndicators,
    detectCandlePattern,
    buildAnalysisPrompt,
    createMarketDataProvider,
} from '@y0ngha/siglens-core';
```

`calculateIndicators` is the high-level Tier 2 entry point that returns a structured
`IndicatorResult` with all indicators (RSI, MACD, Bollinger Bands, etc.) precomputed
from a single OHLCV candle array. Prefer it over calling individual indicator
calculators directly.

The library targets **Node.js runtime**; it does not depend on DOM or React.

---

## Tech Stack

```
TypeScript  latest
Node.js     25.x
yarn        4.12.0
```

```
Linting     ESLint + Prettier
Tests       Vitest (domain + infrastructure — 100% branch coverage required)
Build       tsc → dist/
```

No bundler, no dev server. The package exposes `dist/index.js` and `dist/index.d.ts`
as declared in `package.json`:

```
"main":  "dist/index.js",
"types": "dist/index.d.ts",
"files": ["dist"]
```

---

## Skills System

Siglens extends its analysis capabilities through `.md` files inside `/skills/` and
its subdirectories. New analysis techniques are applied simply by adding a Markdown
file — no code changes required.

### Directory Location

`/skills/` lives at the **project root**, not inside `src/`. Skills are declarative
configuration files, not source code.

```
skills/                        ← project root (not src/)
├── patterns/
│   ├── head-and-shoulders.md
│   ├── inverse-head-and-shoulders.md
│   ├── double-top.md
│   ├── double-bottom.md
│   ├── ascending-wedge.md
│   └── descending-wedge.md
├── indicators/
│   └── (향후 보조지표 시그널 스킬)
└── strategies/
    └── (향후 대순환 분석 등)
```

### Layer Responsibility

Skills files are **not** read by `domain/` — domain has no file I/O.
Reading and parsing skills `.md` files is the responsibility of
**`infrastructure/skills/loader.ts`** (`FileSkillsLoader`).
The parsed `Skill[]` is passed into `domain/analysis/prompt.ts` as a plain data structure.

```
infrastructure/skills/loader.ts (FileSkillsLoader)
  → recursively scans skills/ subdirectories for .md files
    (file I/O — allowed in infrastructure layer)
  → parses frontmatter + body
  → returns Skill[]

consumer (web app / worker / CLI)
  → calls FileSkillsLoader.loadSkills()
  → passes Skill[] to domain/analysis/prompt.ts

domain/analysis/prompt.ts
  → buildAnalysisPrompt(symbol, bars, indicators, skills)
  → applies confidence label (Low/Medium/High); all skills included regardless of weight
  → builds the prompt (pure function, no file access)
```

### When Working on Skills-related Tasks

- Read all `.md` files in the `skills/` directory
- Check the `indicators` field in each file's frontmatter to identify required indicators
- `confidence_weight` maps to a Low/Medium/High display label in the prompt; there is no exclusion floor — all skills are included regardless of weight
- Refer to the Skills System section in `docs/DOMAIN.md` for the full file format spec,
  type definitions, and `Skill` interface
