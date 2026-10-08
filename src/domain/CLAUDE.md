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

Ports are migrated module-by-module. Until a module is migrated, its port interface
still lives in `infrastructure/<module>/types.ts`. Do not import from a
`domain/ports/<x>` path that does not exist yet.

**Authoring rules:**
- One conceptual contract per file. Co-locate option / argument types used by that
  contract (e.g. `GetBarsOptions` next to `MarketDataProvider`) — do not push them
  to `domain/types.ts`.
- Tag the interface JSDoc with `@port` so adapters and reviewers can identify it.
- Keep the existing naming convention (`Provider`, `Repository`, `Dispatcher`,
  `Store`) — natural language over a forced `Port` suffix.
- DTOs the port returns or receives (`Bar`, `MarketQuote`, `Skill`, …) stay in
  `domain/types.ts`. Ports reference them via import.
- Document any data convention that callers' logic relies on (for example daily
  `Bar.time` at UTC midnight) on the port or on the consuming function. Behavior that
  silently depends on an undocumented provider convention breaks when a provider changes.

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
    // Optional `SET NX EX` — backs cross-instance generation dedupe.
    setIfAbsent?<T>(key: string, value: T, ttlSeconds: number): Promise<boolean>;
    // Optional atomic compare-and-delete — releases only a lock this caller owns.
    deleteIfEquals?(key: string, value: string): Promise<boolean>;
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

- **Counts indicator families, not signal types.** The 36 counted members of `SignalType`
  derive from 14 indicators — RSI contributes 4, MACD 4, Bollinger 6 — so counting types
  treats transforms of one close series as independent votes. `SIGNAL_FAMILY` collapses
  them; unmapped types fall back to their own name so a new detector is never worth zero.
  The four price-structure types (`new_52w_high`/`low`, `gap_up`/`down`) are the exception:
  they have never been measured as votes, so `CONFLUENCE_EXCLUDED_TYPES` keeps them out of
  the snapshot rather than letting each become a full-vote family.
- **Weighs `expected` phase at half.** `support_proximity_bullish` is a positional state,
  not a completed cross. Phase is recovered from the type name (the two unions are
  disjoint), which keeps `phase` out of the snapshot so previously stored snapshots stay
  re-scorable.
- **Separates the validated part from the invented part.** The trigger snaps (92 / 8)
  come from a backtested rule; the continuous 50 ± `span` band does not. The band stays
  narrow for that reason, and `scoreConfluence` clamps a corrupt `span` or
  `expectedWeight` rather than letting a round-tripped snapshot invert the score.

**The higher-timeframe gate has a mode (`htfMode`), and the default is not the measured
one.** `'uptrend'` (default) requires the higher timeframe to be rising; `'notUptrend'`
requires it *not* to be. The default exists because it is what every consumer already
runs — but the only forward-return measurement of this gate (16 US symbols × one year of
1-hour bars, entry window, first trigger per symbol-day, excess over each symbol's own
mean) found the uptrend requirement selecting entries at **−0.54% next-day** (n=230,
t −2.1), the gate off at +0.10% (noise) and the uptrend excluded at +0.45% (n=413,
t 2.2, median ≈ 0). Bullish hourly confluence on top of an already-extended daily trend
is a late chase; elsewhere it behaves like bounce confirmation. One year, one regime —
so it is an opt-in recorded in `params.htfMode`, not a new default. `params.htfMode` is
optional because snapshots stored before the option existed lack it (they all ran as
`'uptrend'`).

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
answers that question correctly, so the section renders its output and the instruction
now says *do not recount*.

**The tally is descriptive, not evidence.** It used to be rendered with backtest authority
because the trading consumer scored with the same engine. That consumer retired the rule on
2026-09-24, and a re-measurement of this exact daily configuration (point-in-time S&P 500
2000–2020 + large caps 2024–26) found entry-rule days *below* the baseline over 10 days in
all five periods and exit-rule days above it in three of five, level with it (−0.01
point) in a fourth and below it in 2007–09. Every `Reliability:`
line therefore says "descriptive only — no measured forward edge", and the verdict rules no
longer treat bullish confluence as a reason for "enter" or bearish confluence as a reason
for "avoid". Do not reintroduce authority without a forward-return-vs-baseline measurement
(spec 2026-09-25-pullback-washout-design.md).

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

## Short-term washout (`signals/pullback.ts`)

`evaluatePullback(bars)` reads the last daily bar as a washout inside a long-term uptrend
(close above MA200, Williams %R(14) ≤ −90), a near washout (−90 < %R ≤ −80 above MA200), a
washout below MA200, or none. It is the reading siglens-trader switched its rule to on
2026-09-24 (RSI(2) < 10 above MA200), re-measured on independent data: ahead of the
any-day-above-MA200 baseline in every period 2000–2026, with MA5-exit trades winning
66–75%. Williams %R is the classifier because it measured as well as or better than RSI(2)
and is the oscillator the chart prompt already prints; `rsi2` is reported for reference.

- **Daily only.** The measurement is on daily bars and MA200 on an intraday chart is a
  different object — `formatDeterministicMetricsSection` renders the block on `1Day` only,
  and consumers gate on the timeframe too.
- **Base rates travel with the reading.** `PULLBACK_BASE_RATES` holds the measured sentence
  per reading. Tool results and the prompt carry it verbatim so a model quotes the figures
  instead of inventing them. Each sentence opens with "Historical base rate, not an
  instruction" — the reading names a chart state, never an action.
- **The interaction with the tally is the point.** On washout days the confluence tally
  reads bearish about two thirds of the time; without the reading beside it the tally pulls
  the verdict the wrong way on exactly the charts with the measured edge.
- **The washout verdict is the rule engine's, not the model's.** Asked to judge it, the
  model never chose "enter" (0 of 6,070 production analyses, p9–p16): it read the reading's
  normal companions — a bearish tally, a sub-1.0 structural ratio, a red Elder Impulse — as
  missing confirmation. A `washoutInUptrend` block therefore prints `Entry verdict
  (computed): enter — sell-off path` and Step 1 tells the model to copy it
  (spec `2026-09-26-washout-entry-verdict-design.md`). Near and below-MA200 readings carry no
  verdict — their edge is too thin or their loss tail too heavy to decide in code.
- **News-driven drops suspend the verdict.** The measurement does not cover washouts caused
  by earnings, guidance or regulatory news — the setup's largest failures. The verdict tells
  the model not to re-judge, so it must not print on those days: `newsDrivenWashoutEvent`
  looks for such an event (impact high/medium, not bullish) in the last 3 sessions and the
  block then prints `Entry verdict (computed): none — …`. Consumers that pass no
  `marketEvents` get the ungated verdict — pass them wherever the drop could be news.

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

## Prompt Changes

IDs are stable; cite them as `src/domain/CLAUDE.md#DOM-7`.

<a id="DOM-7"></a>
#### DOM-7 — A prompt change meant to change model output is validated on real data

Unit tests that check the prompt text cannot tell whether the model's visible answer got
better. Render the new values over real charts, and for a change in model behavior run a
real-LLM A/B on the visible result (OLD against NEW, same inputs, enough runs). Count side
effects too (a card leaving its own field empty) and treat small differences at small n as
no improvement. When the visible output does not improve, revert the change.

Why: a floor on the structural risk:reward leg passed every unit test and still flipped a
third of verdicts on real charts (see the note under the confluence section above).

<a id="DOM-8"></a>
#### DOM-8 — Precomputed prompt values reuse the engine's own rules

A number rendered into a prompt uses the same thresholds, rounding and detector logic as
the engine that consumers (and the grounded-number checks) recompute from. Gap lines compare
`size >= GAP_MIN_ATR_MULT * atr` like the gap detector does. Use fixed tolerances, not ones
that scale with the value's magnitude, and round inputs to the displayed precision before
computing derived values, so a recomputation from the rendered text matches.

<a id="DOM-9"></a>
#### DOM-9 — Model-facing text is exact and internally consistent

- Tool descriptions and rules say exactly what the engine does ("the bullish or the bearish
  trigger conditions all held", not "every condition" when the exit side has no such gate).
- Rules inside one prompt never contradict. Required wording (a mandated caveat) gets an
  explicit carve-out in any style rule that could suppress it.
- A rule split by condition (depth level, tool availability) keeps null and absence handling
  in every branch; otherwise the uncovered branch fills the gap with an unsupported guess.
- Style rules never override required content.
- A rule restated in two places (section intro and writing rules) changes in both together.
- Before adding a prohibition ("never say X"), read every existing rule that mentions the
  same output; a new ban must not contradict gap-reporting or required-wording rules.
- Keep internal-only signals (resemblance hints, scoring artifacts) out of the prompt
  instead of instructing the model not to mention them; listed text gets narrated.
- When content is split into stable and dynamic halves, each half reads on its own (a moved
  bullet list keeps a heading).
- Any change to rendered bytes also bumps the cache version
  (`src/infrastructure/CLAUDE.md#INF-4`).

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

Also exempted: `domain/indicators/marketFearGreed/types.ts` and
`domain/indicators/cryptoFearGreed/types.ts` — index-specific input/factor/snapshot types
kept beside their module; all public ones are re-exported from `domain/types.ts`.

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

### Numeric, Time & Semantics Guardrails

IDs are stable and never renumbered; cite them as `src/domain/CLAUDE.md#DOM-4`.

<a id="DOM-1"></a>
#### DOM-1 — Non-finite results are `null`, never `NaN`; validate inputs

A calculation whose result can be undefined (warm-up, division by zero) returns `null`.
`NaN` in a cached result or prompt corrupts parsing, sorting and rendering downstream.

- Financial inputs get range guards, not just `Number.isFinite`: prices `> 0`, a take-profit
  that equals the entry yields no ratio, `tp <= entry` on a long cannot produce a reward.
- Public numeric options that index arrays or define windows (horizons, periods) are
  filtered to valid integers (`Number.isInteger(n) && n > 0`) before use; derived values
  pass `Number.isFinite` before aggregation.

```typescript
// ❌ return (next - prev) / prev;                       // NaN when prev === 0
// ✅ const change = (next - prev) / prev; return Number.isFinite(change) ? change : null;
```

<a id="DOM-2"></a>
#### DOM-2 — Sentinel values propagate unchanged

A sentinel (`-1`, `null`) passes through the call chain unchanged. Wrapping it in
`Math.max(0, x)` or `?? fallback` before the check silently converts it into a real value.

```typescript
// ❌ Math.max(0, sentinel ?? fallback)                 // -1 becomes 0
// ✅ sentinel === -1 ? -1 : Math.max(0, sentinel)
```

<a id="DOM-3"></a>
#### DOM-3 — Use the injected clock everywhere

A function that takes `now` (or `occurredAt`) uses it for every time read; a bare
`new Date()` next to it breaks clock control in tests. When the clock is always needed,
make `now` required rather than optional.

```typescript
// ❌ const time = new Date();                          // ignores options.now
// ✅ const time = options.now ?? new Date();  // or take `now: Date` and use it directly
```

<a id="DOM-4"></a>
#### DOM-4 — Calendar-day differences use date components, not rounded milliseconds

`Math.round((target - now) / MS_PER_DAY)` is off by one depending on the time of day
(13:00 UTC today and midnight tomorrow round to 0, not 1). Reduce both sides to calendar
dates in one zone first, then subtract.

```typescript
// ✅ UTC calendar dates (use the ET session helpers when the market date matters)
function daysUntilCalendarDate(future: Date, now: Date): number {
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const target = Date.UTC(
        future.getUTCFullYear(),
        future.getUTCMonth(),
        future.getUTCDate()
    );
    return Math.round((target - today) / MS_PER_DAY);
}
```

<a id="DOM-5"></a>
#### DOM-5 — Encode semantics at build time instead of re-deriving them

When the code that builds a value knows its meaning (which side of a level counts as a
breach), store that meaning on the value. A later consumer that re-derives it from geometry
(`price` versus the last pivot) misreads the cases where the geometry is unusual, such as a
wave 5 that edges past its cap within tolerance.

<a id="DOM-6"></a>
#### DOM-6 — Error codes and types live in the layer that produces them

A code produced by application logic or infrastructure I/O (a duplicate-check failure, a
limit error) is defined in `application/` or `infrastructure/`, not `domain/`. The domain
holds only the error cases of its own pure validation.


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
