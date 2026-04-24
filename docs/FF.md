# Frontend Fundamentals (FF)

Code quality principles from the Toss Frontend chapter.
Good code is **code that is easy to modify**.

Although "Frontend" is in the name, the four principles below apply to any codebase —
including a backend-only TypeScript library like `siglens-core`. All examples are
framework-free TS.

---

## 4 Principles Overview

```
Readability    Is it easy to read?
Predictability Can you predict the behavior?
Cohesion       Is code that should change together, kept together?
Coupling       Is the impact range of a change narrow?
```

It is hard to satisfy all 4 principles simultaneously.
The key is judging which principle to prioritize depending on the situation.

---

## 1. Readability

How easy the code is to read. You must understand it before you can modify it.
The fewer things the reader needs to hold in mind at once, and the more naturally it reads top to bottom, the better.

### 1-A. Separate code that doesn't run simultaneously

```typescript
// ❌ Different roles mixed in one function with branching on status
function formatJob(job: Job): string {
    if (job.status === 'pending')  return `${job.id}: pending`;
    if (job.status === 'running')  return `${job.id}: running (${job.progress}%)`;
    if (job.status === 'complete') return `${job.id}: done in ${job.durationMs}ms`;
    return `${job.id}: unknown`;
}

// ✅ Separate formatters by status — each one knows only its own shape
const FORMAT: Record<JobStatus, (job: Job) => string> = {
    pending:  (job) => `${job.id}: pending`,
    running:  (job) => `${job.id}: running (${job.progress}%)`,
    complete: (job) => `${job.id}: done in ${job.durationMs}ms`,
};

function formatJob(job: Job): string {
    return FORMAT[job.status](job);
}
```

### 1-B. Abstract implementation details

```typescript
// ❌ Caller knows all implementation details
async function runAnalysis(symbol: string, timeframe: Timeframe) {
    const bars = await provider.fetchBars(symbol, timeframe);
    const normalized = bars.filter(b => b.volume > 0).map(toNormalizedBar);
    const hasEnoughData = normalized.length >= MIN_BARS_FOR_ANALYSIS;
    if (!hasEnoughData) throw new Error('Not enough bars');
    return analyze(normalized);
}

// ✅ Abstract details behind a named helper
async function loadAnalyzableBars(symbol: string, timeframe: Timeframe): Promise<Bar[]> {
    const bars = await provider.fetchBars(symbol, timeframe);
    const normalized = bars.filter(b => b.volume > 0).map(toNormalizedBar);
    if (normalized.length < MIN_BARS_FOR_ANALYSIS) throw new Error('Not enough bars');
    return normalized;
}

async function runAnalysis(symbol: string, timeframe: Timeframe) {
    const bars = await loadAnalyzableBars(symbol, timeframe);
    return analyze(bars);
}
```

### 1-C. Name complex conditions

```typescript
// ❌ Reader must mentally evaluate the condition to understand it
if (bars.length >= 14 && closes[closes.length - 1] !== null) {
    // ...
}

// ✅ Intent is revealed through the name
const hasEnoughDataForRSI = bars.length >= 14;
const hasLatestClose = closes[closes.length - 1] !== null;

if (hasEnoughDataForRSI && hasLatestClose) {
    // ...
}
```

### 1-D. Name magic numbers

```typescript
// ❌ No way to know what 14 means
const result = new Array(14).fill(null);

// ✅ Meaning is clear
const RSI_PERIOD = 14;
const result = new Array(RSI_PERIOD).fill(null);
```

### 1-E. Keep ternary operators simple

```typescript
// ❌ Nested ternaries are hard to read
const label = isLoading ? 'Loading...' : isError ? 'Error' : isSuccess ? 'Done' : 'Idle';

// ✅ Replace with early return or object map
const statusLabel: Record<Status, string> = {
    loading: 'Loading...',
    error: 'Error',
    success: 'Done',
    idle: 'Idle',
};
const label = statusLabel[status];
```

### 1-F. Write range conditions left to right

When checking whether a value falls within a range, write conditions in the same direction as mathematical notation (b ≤ a ≤ c) — left to right — so the reader can grasp the range at a glance.

```typescript
// ❌ The middle value appears first, causing unnecessary mental effort
if (a >= b && a <= c) { ... }
if (score >= 80 && score <= 100) { ... }

// ✅ Reads naturally left to right, like b ≤ a ≤ c
if (b <= a && a <= c) { ... }
if (80 <= score && score <= 100) { ... }
if (minPrice <= price && price <= maxPrice) { ... }
```

### 1-G. Minimize viewpoint shifts

Every time a reader has to jump between different parts of the code — up and down the file, or across functions and variables — that is a **viewpoint shift**. The more shifts required, the harder the code is to follow.

Write code so it can be read top to bottom, in a single function or file.

```typescript
// ❌ Understanding why a trade is blocked requires 3 jumps:
// policy.canTrade → getPolicyByRole → POLICY_SET
function authorize(user: User, action: Action): boolean {
    const policy = getPolicyByRole(user.role);
    return policy[action];
}
function getPolicyByRole(role: Role) { return POLICY_SET[role]; }
const POLICY_SET = {
    admin:  { trade: true,  view: true },
    viewer: { trade: false, view: true },
};

// ✅ All logic visible in one place — no jumping required
function authorize(user: User, action: Action): boolean {
    const policy = {
        admin:  { trade: true,  view: true },
        viewer: { trade: false, view: true },
    }[user.role];
    return policy[action];
}
```

### 1-H. Don't group functions by logic type

Don't create a function just because it handles the same *type* of logic (e.g. "all config readers for this module"). A function whose responsibility is "everything of type X" will grow without bound and become hard to understand.

```typescript
// ❌ readConfig manages ALL env-based config — responsibility is unbounded
export function readConfig() {
    return {
        aiProvider:     process.env.AI_PROVIDER,
        anthropicKey:   process.env.ANTHROPIC_API_KEY,
        geminiKey:      process.env.GEMINI_API_KEY,
        redisUrl:       process.env.UPSTASH_REDIS_REST_URL,
        redisToken:     process.env.UPSTASH_REDIS_REST_TOKEN,
        databaseUrl:    process.env.DATABASE_URL,
        // grows every time a new env var is added
    };
}

// ✅ Each reader owns exactly one concern — clear name, narrow scope
export function readAiConfig(): AiConfig { /* only AI_* vars */ }
export function readRedisConfig(): RedisConfig | null { /* only UPSTASH_* vars */ }
export function readDatabaseConfig(): DatabaseConfig | null { /* only DATABASE_URL */ }
```

---

## 2. Predictability

How well you can predict behavior just from the name, parameters, and return value.
The more consistently rules are followed, the higher the predictability.

### 2-A. Avoid name collisions

```typescript
// ❌ Same name used in different contexts
// infrastructure/ai/claude.ts
export const http = fetch;

// infrastructure/cache/redis.ts
export const http = fetch;
// → import collision

// ✅ Include context in the name
export const claudeHttp = fetch;
export const upstashHttp = fetch;
```

### 2-B. Unify return types across functions of the same family

```typescript
// ❌ Same family of functions with different return types
function calculateRSI(closes: number[]): number[] { ... }
function calculateMACD(closes: number[]): MACDResult[] | null { ... }
function calculateBollinger(closes: number[]): BollingerResult[] | undefined { ... }

// ✅ All indicator calculation functions follow the same pattern
function calculateRSI(closes: number[], period: number): (number | null)[] { ... }
function calculateMACD(closes: number[]): (MACDResult | null)[] { ... }
function calculateBollinger(closes: number[]): (BollingerResult | null)[] { ... }
```

### 2-C. Expose hidden logic

```typescript
// ❌ Unexpected behavior occurs inside the function
function calculateIndicators(bars: Bar[]) {
    const closes = bars.map(b => b.close);
    const rsi = calculateRSI(closes);
    // Hidden API call → caller cannot predict this
    sendAnalyticsEvent('indicator_calculated');
    return { rsi };
}

// ✅ Caller explicitly controls side effects
function calculateIndicators(bars: Bar[]) {
    const closes = bars.map(b => b.close);
    return { rsi: calculateRSI(closes) };
}

// Caller handles side effects explicitly
const indicators = calculateIndicators(bars);
sendAnalyticsEvent('indicator_calculated');
```

---

## 3. Cohesion

How consistently code that needs to change together actually changes together.
High cohesion means modifying one place doesn't cause unexpected errors elsewhere.

### 3-A. Keep files that change together in the same directory

```
// ❌ Related files scattered across the project
src/
├── domain/indicators/rsi.ts
├── domain/types/rsi.ts
└── domain/utils/rsiHelpers.ts

// ✅ Files that change together placed in the same directory
src/
└── domain/
    └── indicators/
        ├── rsi.ts             ← implementation
        ├── types.ts           ← rsi-specific types (if not shared)
        └── constants.ts       ← rsi-specific constants
```

### 3-B. Centralize magic numbers as constants

```typescript
// ❌ Same value scattered across files — changing one means missing the others
// rsi.ts
const result = new Array(14).fill(null);

// macd.ts
if (closes.length < 14) return null;

// ✅ Managed in one place
// domain/indicators/constants.ts
export const RSI_DEFAULT_PERIOD = 14;

// rsi.ts
const result = new Array(RSI_DEFAULT_PERIOD).fill(null);
```

### 3-C. Match validation cohesion to the unit of change

When validating structured input (a request payload, a parsed Skill frontmatter),
the right cohesion level depends on **what unit of change you expect**.

**Field-level cohesion** — each field owns its own validation logic independently.
Choose this when fields have unique validation rules or may be reused across schemas.

```typescript
const isValidSymbol = (s: string) => /^[A-Z]{1,5}$/.test(s);
const isValidTimeframe = (t: string): t is Timeframe => TIMEFRAMES.includes(t as Timeframe);
```

**Object-level cohesion** — all fields are validated together in a single schema.
Choose this when all fields belong to one business unit, or fields are interdependent.

```typescript
// All validation centralized in one parser
function parseAnalysisRequest(input: unknown): AnalysisRequest {
    // assert shape as a whole — cross-field rules (e.g. from < to) belong here
    // ...
}
```

The key question: **does change happen field-by-field, or does the whole object change together?**

---

## 4. Coupling

The size of the impact range when code is modified.
Lower coupling means the scope of changes is easier to predict.

### 4-A. Manage one responsibility at a time

```typescript
// ❌ One function carrying too many responsibilities
async function runFullAnalysis(symbol: string, timeframe: Timeframe) {
    const bars = await provider.fetchBars(symbol, timeframe);
    const indicators = calculateAllIndicators(bars);
    const skills = await skillsLoader.loadSkills();
    const prompt = buildAnalysisPrompt(symbol, bars, indicators, skills);
    const response = await aiProvider.send(prompt);
    await cache.set(cacheKey(symbol, timeframe), response, ttlFor(timeframe));
    return response;
    // data fetch + indicator calc + skills + prompt + AI + cache all here
    // → modifying one thing affects everything
}

// ✅ Separate responsibilities
async function loadBarsWithIndicators(symbol: string, timeframe: Timeframe) { ... }
async function loadSkills() { ... }
function buildPrompt(symbol: string, bars: Bar[], indicators: IndicatorResult, skills: Skill[]) { ... }
async function runAnalysis(prompt: string) { ... }
async function cacheResult(key: string, value: string, ttl: number) { ... }
```

### 4-B. Allow duplicate code (connected to the AHA principle)

```typescript
// ❌ Premature abstraction increases coupling
function calculateIndicator(type: 'rsi' | 'macd' | 'bollinger', closes: number[]) {
    // branching keeps growing with type
    // → changing one type's requirements affects all types
}

// ✅ Allow duplication until the pattern repeats three times
function calculateRSI(closes: number[]) { ... }
function calculateMACD(closes: number[]) { ... }
function calculateBollinger(closes: number[]) { ... }
// Abstract only after the common pattern becomes clear
```

### 4-C. Do not force callers to thread unrelated state through the call chain

```typescript
// ❌ Intermediate function passes arguments it never uses
async function runPipeline(symbol: string, timeframe: Timeframe, correlationId: string) {
    const bars = await loadBars(symbol, timeframe, correlationId);
    return analyze(bars, correlationId); // threaded through but not used inside loadBars
}

// ✅ Scope each parameter to where it is actually consumed
async function runPipeline(symbol: string, timeframe: Timeframe, correlationId: string) {
    const bars = await loadBars(symbol, timeframe);
    return analyze(bars, correlationId);
}
```

If many layers genuinely share the same context (e.g. a request-scoped logger),
consider an explicit context object rather than a growing parameter list.

---

## Priority Judgment When Principles Conflict

All 4 principles are hard to satisfy simultaneously. Judge based on the situation.

```
Cohesion vs Readability
└── High risk of bugs if not changed together
    → Prioritize Cohesion (abstraction, grouping)
└── Low risk
    → Prioritize Readability (allow duplication)

Coupling vs Cohesion
└── Allowing duplicate code lowers coupling but also lowers cohesion
    → Judge based on change frequency and impact range
```

**Priority in the siglens-core context**

```
domain/indicators   → Predictability first
                      (unified return types across same-family functions, consistent null handling)

domain/analysis     → Readability first
                      (prompt builders must be easy to scan; minimize conditional branching)

infrastructure/     → Cohesion first
                      (replacing a Provider should require modifying only one file)
```
