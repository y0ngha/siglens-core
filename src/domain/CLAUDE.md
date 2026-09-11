# domain/

Pure business logic layer. Zero I/O, zero side effects, zero external dependencies.

## Responsibility

This layer owns all calculation logic: technical indicators, candle pattern detection,
chart pattern analysis, signal detection, and prompt construction.
If it can be expressed as a pure function, it belongs here.

The layer also owns the **port interfaces** (`domain/ports/`) — contracts the domain
requires from the outside world (caches, repositories, providers, dispatchers).
Adapters that fulfill these ports live in `infrastructure/`; the domain never imports
them, only the port type.

## Ports

`domain/ports/` declares every external-system contract the library needs. Each port
is a pure interface — no behavior, no implementation, no SDK references. Adapters in
`infrastructure/<module>/` import the port and implement it (`implements` for classes,
explicit return-type annotation for factory functions).

**Target file layout (ports are migrated module-by-module — only files listed
under "Currently migrated" actually exist today):**

```
domain/ports/
  aiProvider.ts        → CallAiProvider, CallAiProviderOptions, ... ✅ migrated
  cache.ts             → CacheProvider           ✅ migrated
  chatTokenStore.ts    → ChatTokenStore           ✅ migrated
  fundamentalDataProvider.ts → FundamentalDataProvider ✅ migrated
  jobStateStore.ts     → JobStateStore (@internal), JobStateSetOpts ✅ migrated
  marketDataProvider.ts → MarketDataProvider, GetBarsOptions   ✅ migrated
  newsProvider.ts      → NewsProvider, NewsTimeRange ✅ migrated
  optionsDataProvider.ts → OptionsDataProvider     ✅ migrated
  skillsProvider.ts    → SkillsProvider                         ✅ migrated
  usageLogRepository.ts → UsageLogRepository, CreateUsageLogInput ✅ migrated
  usageRepository.ts   → UsageRepository, RecordUsageInput ✅ migrated
  userTierRepository.ts → UserTierRepository      ✅ migrated
  ...
```

Until a module is migrated, its port interface still lives in
`infrastructure/<module>/types.ts`. Do not import from a `domain/ports/<x>` path
that is not yet listed under "✅ migrated".

**Authoring rules:**
- One conceptual contract per file. Co-locate option / argument types used by that
  contract (e.g. `GetBarsOptions` next to `MarketDataProvider`) — do not push them
  to `domain/types.ts`.
- Tag the interface JSDoc with `@port` so adapters and reviewers can identify it.
- Keep the existing naming convention (`Provider`, `Repository`, `Dispatcher`,
  `Store`) — natural language over a forced `Port` suffix.
- DTOs the port returns or receives (`Bar`, `MarketQuote`, `Skill`, …) stay in
  `domain/types.ts`. Ports reference them via import.

**Example:**
```typescript
// domain/ports/cache.ts
/**
 * @port
 * Generic key-value cache contract the domain depends on for memoizing
 * expensive analyses.
 */
export interface CacheProvider {
    get<T>(key: string): Promise<T | null>;
    set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
    delete(key: string): Promise<void>;
}

// infrastructure/cache/redis.ts — adapter
import type { CacheProvider } from '@/domain/ports/cache';

/** @adapter implements {@link CacheProvider} */
export function createCacheProvider(): CacheProvider | null { ... }
```

## Indicator Confluence (`signals/confluence.ts`)

`evaluateConfluence(bars, options)` owns the multi-signal entry/exit rule that consumers
(the trading system, the backtest generator) used to each re-implement. It is pure: the
caller fetches every bar series, including the higher-timeframe one, and passes them in.
Fetching is a consumer concern; the rule is not.

Three things it does that a naive "count the signals" version does not:

- **Counts indicator families, not signal types.** The 36 members of `SignalType` derive
  from 14 indicators — RSI contributes 4, MACD 4, Bollinger 6 — so counting types treats
  transforms of one close series as independent votes. `SIGNAL_FAMILY` collapses them;
  unmapped types fall back to their own name so a new detector is never worth zero.
- **Weighs `expected` phase at half.** `support_proximity_bullish` is a positional state,
  not a completed cross. Phase is recovered from the type name (the two unions are
  disjoint), which keeps `phase` out of the snapshot so previously stored snapshots stay
  re-scorable.
- **Separates the validated part from the invented part.** The trigger snaps (92 / 8)
  come from a backtested rule; the continuous 50 ± `span` band does not. The band stays
  narrow for that reason, and `scoreConfluence` clamps a corrupt `span` or
  `expectedWeight` rather than letting a round-tripped snapshot invert the score.

**Every tightening is entry-only, by design.** The higher-timeframe and volume gates make
a trigger harder to reach — the point for entries, exactly backwards for exits. A missed
entry costs opportunity; a missed exit costs money. `exitTrigger` therefore references
neither gate, **and carries its own threshold** (`CONFLUENCE_EXIT_MIN`, lower than
`CONFLUENCE_MIN`).

The separate threshold is not cosmetic. When entry and exit shared one, raising the entry
bar silently raised the exit bar with it and cut liquidation signals by 80% in production —
the gates were correctly entry-only while the *constant behind them* was not. Any future
tightening has to declare which side it lands on; "it's just a threshold" is how the last
one slipped through.

Every tunable is an option, and the resolved set is written back onto the snapshot as
`params`. A stored snapshot is then self-describing: it records not just what was
detected but the thresholds it was judged against, which is what makes before/after
comparison possible when a consumer tunes the rule.

## Deterministic Metrics in the analysis prompt (`analysis/confluenceSection.ts`)

The chart prompt used to instruct the model to tally confluence itself — *"Count
confirming signals from different categories … Strong confluence: 3+ categories agree."*
Two problems. The tally happened inside the model, so only the count reached the output
and nothing about it could be checked. And the categories were coarser than the data
warrants: every trend indicator was one bucket, while RSI, StochRSI and Connors RSI —
three transforms of the same close series, all rendered separately in `## Indicator
Values` — could each be read as independent confirmation. `evaluateConfluence` already
answers that question correctly and is the same engine the trading consumer scores with,
so the section renders its output and the instruction now says *do not recount*.

`CONFLUENCE_PARAMS_BY_TIMEFRAME` is the one place the rule varies by chart. `1Day`
restores the thresholds the original backtest used (3 families, `expected` at full
weight); every intraday row runs 2.5 / 0.5. **Neither is the backtested rule** — that one
counted signal types — so the rendered reliability line says which part is measured and
which is inherited by argument. Writing "70% win rate" next to a modified rule is the
specific mistake this wording exists to prevent. `exitMin` stays at the module default on
every timeframe, including the daily one where `min` rises: raising an entry bar must not
raise the exit bar with it.

The section also renders **structural risk:reward from the current price**, computed off
the reference levels rendered immediately above it. That ordering is the point — the model
sees the inputs, then the conclusion, and can check one against the other. The reason it
exists at all is measurement from the downstream trader: over 426 production ticks the
nearest resistance sat *below* the current price 14.6% of the time, and risk:reward was
inversely related to signal strength (median 1.27 in a middling composite-score band,
**0.00** in the highest). Strong confluence is therefore not evidence that entering now is
attractive, and the model cannot notice that unless the ratio precedes its verdict.

The ratio skips levels closer than **half the mean bar range of the last 14 bars**. Without
that floor it divided by whichever level happened to touch the price — hourly AAPL paired a
0.06% "resistance" with a 0.01% "support", a 15-minute NVDA chart printed 180.38 — which is
noise divided by noise, and the model was then told to put stops on those levels. Two
upstream fixes remove most such levels at the source: intraday pivots are computed from the
**prior session** (not the prior bar, whose pivot sits on the price) grouped by the
listing's own calendar date (Eastern for U.S. equities, KST for KRW, UTC for crypto), and
round-number steps follow one continuous rule — the smallest 1/2.5/5×10ⁿ at or above 2% of
price (a flat 10 put `Round 77110` next to BTC; the old $1–$1,000 tier table jumped 20× at
its seams).

`splitBySide` flags levels inside that band `atPrice` and keeps at most two of them **outside**
the six-per-side cap. Capping first let an at-price cluster fill every slot, and the
risk:reward block then found no usable level and vanished; it now says "not measurable"
instead. Its legs use raw distances — the noise band already bounds both. A full-bar-range
floor on the risk leg alone was tried and removed: it flipped 34 of 90 real-chart verdicts
below 1.0 and made the verdict sentence false.

## Prompt number rendering (`analysis/promptFormat.ts`)

Every price-axis value in the chart prompt renders at one precision picked from the
snapshot close by `priceDecimalPlaces`: cents at or above one unit and four significant
digits below it for equities, five significant digits for crypto, whole won for `KRW`. A
fixed two decimals rendered SHIBUSD's bars as `O:0.00 H:0.00 L:0.00 C:0.00`. Differences of
prices (MACD, ATR, momentum, Elder-Ray) take `differenceDecimalPlaces` instead — three
significant digits of ATR, never fewer decimals than the prices — because whole-won
precision erased KRX crossovers. `formatNullableNumber` renders non-finite values as `N/A`
and drops the sign from a value that rounds to zero.

Currency is **supplied**, never inferred from the symbol (see `CurrencyCode`): builders take
the listing currency as a parameter and `equityListingContext(currency)` picks the framing —
the U.S. sentence stays byte-identical. Statement amounts are a second currency: they carry
the filer's `reportedCurrency` (an ADR files in its home currency — TSM in TWD) and stay
unlabelled when it is unknown.

## Overall axis weighting (`analysis/overallScore.ts`)

The overall prompt hands five axis reports to one model and asks it to synthesize. The only
thing telling it how to weigh them was a prose sentence per timeframe — *"Technical,
fundamental, and news inputs carry roughly equal weight"*. Prose weighting cannot be
diffed, cannot be tuned, and leaves no record of what a past synthesis actually weighed.

`OVERALL_AXIS_WEIGHTS` is that sentence as numbers: technical dominates intraday,
fundamental and financials climb toward the daily chart. They are **judgment, not
measurement** — no backtest sets them; the integers encode relative emphasis and the sum
is meaningless because this is a weighted average.

Two decisions worth keeping:

- **Three-value axes map to 25/50/75, not 0/50/100.** A `bullish` from the news axis is a
  direction, not a magnitude. On the wider scale one axis drags the composite fifty points
  on evidence that distinguishes three states.
- **An absent axis abstains — weight 0, out of the denominator — it does not vote
  neutral.** A crypto symbol has no fundamentals by definition, and a neutral vote would
  pull every crypto composite toward the middle for a reason unrelated to the asset. Same
  pattern as the confluence axis in the trading consumer.

**No verdict threshold is attached, deliberately.** Over three-value enums the composite
lands on a small discrete set, and no cutoff has been measured on that distribution.
Naming one would repeat the mistake of picking a boundary from intuition about a single
axis instead of from the distribution it actually produces. The prompt says as much to the
model, and a test holds the wording.

Congress is **not** an axis here and was not added. The trading consumer zeroed its weight
after measuring 31/31 identical verdicts, but the reason was that a 30–45 day disclosure
lag cannot answer a 30-minute question — on a daily chart the data may still carry
information. Adding it would mean plumbing the congress report into
`buildOverallAnalysisPrompt`, which nothing does today.

## Plan check (`analysis/planCheck.ts`)

`buildPlanCheck` attaches deterministic arithmetic to **every** recommendation, comparing
the plan against the price that actually exists. It exists because `riskReward` is an
LLM-authored prose string — the single most decision-relevant number in the analysis was
neither computed nor checkable — and because the one deterministic risk:reward this
codebase did produce lived on `reconciledLevels`, which is populated *only when a level
fails validation*. The arithmetic was missing from every healthy analysis.

`riskRewardAtEntry` and `riskRewardAtCurrent` are reported separately on purpose: a
take-profit above the recommended entry passes validation while sitting below the price
the reader is looking at. `0` and `null` are different answers — `0` means the targets
exist and the market has passed all of them, `null` means the inputs cannot support a
ratio — and collapsing them would turn a finding into a shrug. `belowStopLoss` exists for
the same reason: without it, a plan the market has already stopped out of is
indistinguishable from one with no stop at all.

It is **not** in `TECHNICAL_RESPONSE_SCHEMA`. Asking the model to emit a field the domain
always overwrites spends tokens and invites it to author the very number the field exists
to take away from it. It rides the `stoploss`+`target` tier gate, since it is arithmetic
over exactly those two fields.

## Dependency Rules

```
domain ← NO external imports (npm packages, AI libraries, technical-indicator libs, etc.)
         NO imports from infrastructure/ or application/
         NO Date.now(), fetch, console.*, process.env
         Pure TypeScript only
```

**Allowed imports inside domain/:**
- Other files within `domain/` (e.g. `domain/types.ts`, peer files in same sub-folder)
- Node built-in types that are purely type-level (no runtime I/O)

**Prohibited:**
```typescript
// ❌ External library
import { RSI } from 'technicalindicators';

// ❌ Infrastructure import
import { redisCache } from '@/infrastructure/cache/redis';

// ❌ Side effects
const now = Date.now();
console.log(closes);
const key = process.env.API_KEY;
```

## Coding Rules

**Functions must be pure:** same input → same output, no side effects.

**Immutability:** never mutate input arguments.
```typescript
// ❌ bars.push(bar)      ✅ [...bars, bar]
// ❌ bar.close = 100     ✅ { ...bar, close: 100 }
// ❌ arr.sort()          ✅ arr.toSorted()
// ❌ arr.reverse()       ✅ arr.toReversed()
```

**Types live in `domain/types.ts`**, not in individual implementation files.
```typescript
// ❌ Define MACDResult inside macd.ts
// ✅ Define MACDResult in domain/types.ts, import it in macd.ts
```

**Subdirectory `types.ts` exception** — when a feature area introduces 10+ cohesive types
(currently `domain/options/types.ts`), defining them in a feature-local `types.ts` is
permitted **provided** `domain/types.ts` re-exports the full set, so all consumers still
use the canonical `@/domain/types` import path. The exception exists because inlining a
large feature's types would push `domain/types.ts` past 2,200 lines and dilute its
discoverability. Implementation files in that feature folder must still NOT define their
own types — they import from the feature-local `types.ts`.

```typescript
// ✅ domain/options/types.ts defines OptionsContract, OptionsChain, ...
// ✅ domain/types.ts re-exports the full set
// ✅ Consumers: import type { OptionsChain } from '@/domain/types'
// ❌ Define OptionsContract inside domain/options/sanitizeOptionsChain.ts
```

**No hardcoded literals:** extract to constants files.
```typescript
// ❌ period = 14
// ✅ period = RSI_DEFAULT_PERIOD  (domain/indicators/constants.ts or domain/constants/)
```

**Null for uninitialized periods:**
```typescript
// Initial period values must be null, not 0 or undefined
const result: (number | null)[] = new Array(period - 1).fill(null);
```

**Exported functions must declare explicit return types:**
```typescript
export function calculateRSI(closes: number[], period: number): (number | null)[] { ... }
```

**Named interfaces over inline return types:**
```typescript
// ❌ function compute(): { gain: number; loss: number } { ... }
// ✅ interface GainLoss { gain: number; loss: number }
//    function compute(): GainLoss { ... }
```

## Lazy Evaluation

Use generator pipelines for large datasets (1,000+ Bar records, multi-stage transforms).

```typescript
// ✅ Define lazy pipeline; materialize only at the final step
function* slidingWindow<T>(items: T[], size: number): Generator<T[]> {
    for (let i = 0; i + size <= items.length; i++) {
        yield items.slice(i, i + size);
    }
}
```

**Rule:** generator pipeline definitions belong in `domain/`. Materialization (spread / `Array.from`)
happens only as the last step inside the exported function.

## Performance Exceptions

A `for` loop with a local mutable accumulator is allowed when `reduce + spread` causes O(N²):
- All three conditions must hold: pure contract, no mutation of inputs, returned array is immutable to callers.

```typescript
// ✅ O(N) accumulator pattern (state-machine indicators)
const results: Result[] = new Array(bars.length);
let state = initialState;
for (let i = 0; i < bars.length; i++) {
    const { state: next, result } = nextStep(state, bars[i]);
    results[i] = result;
    state = next;
}
return results;
```

## Testing

- Coverage target: **90% branch coverage** (required).
- Test file location: `src/__tests__/domain/<sub-folder>/<file>.test.ts`
- No mocks needed — pure functions are trivially testable with direct inputs.

Required cases for period-based indicators:

| Case | description |
|------|-------------|
| Empty array | returns empty array |
| Input shorter than period | returns all-null array |
| Initial null range | first `period - 1` values are null |
| Valid value range | values from index `period - 1` onward are non-null numbers |
| Calculation accuracy | first computed value matches the spec |
