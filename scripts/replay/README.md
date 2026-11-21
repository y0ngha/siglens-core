# Replay tooling

Runs the production analysis path (`runAnalysis`) over a **frozen set** of past days,
labels each result with the deterministic outcome labeller and the plan checks, and reports
the rates with their `n`. It is a measuring instrument: nothing here changes what a user
sees, and every number is a measurement with its sample size, never a performance claim.

Nothing in `scripts/` is published: the package ships only `dist` (`package.json`
`files: ["dist"]`) and `tsconfig.build.json` compiles `src/**` only. No market data, bars or
keys belong in this repository. The set and every run live outside it and are passed by path.
Every writer that takes an output path (`fetchBars`, `buildSet`, `run`, `label`,
`report --out`) refuses a path inside this repository, and `run` also refuses a set or run
path inside the parent directory of `--skills` (the app checkout). A separate private data
repository outside both is the intended home of sets and runs.

All scripts run with `npx tsx scripts/replay/<name>.ts`. They import `src/` directly, so a
replay never waits for a core release; to compare two prompt versions, run the same set from
two checkouts.

## Files

| File | Role |
|---|---|
| `fetchBars.ts` | Fetches US daily bars and company names from FMP into one `<SYMBOL>.json` each (operator step). |
| `buildSet.ts` | Pure case selection, hashes the bars files, writes `manifest.json` and `bars/`. |
| `run.ts` | The runner. Dry run by default; `--execute` needs `--approved-calls`. |
| `label.ts` | Labels a run's results into `labels.jsonl`. |
| `report.ts` | Markdown report of a labelled run, optionally compared with another. |
| `reportCompute.ts` | The numbers behind the report (pure). |
| `clock.ts` | `AsyncLocalStorage` `Date` shim, the only place that touches `globalThis.Date`. |
| `exchangeRecorder.ts` | Records the model provider's HTTP exchanges (token usage, `--keep-raw`). |
| `storedProvider.ts` | Market-data provider that serves stored bars up to a case's `asOf`. |
| `markets.ts` | US / KRX session, currency, tick table and the clock instant of a case. |
| `symbols.ts` | The 65 symbols. |
| `engineEval.ts` | Engine evaluation CLI: candle and chart-pattern detection over a bars set, matched placebo, week-clustered intervals, G1 counters. |
| `engineEvalCandles.ts`, `engineEvalPatterns.ts` | The candle and chart-pattern passes (pure). |
| `engineEvalCompute.ts`, `engineEvalStats.ts`, `engineEvalTypes.ts` | Pools, bootstrap, seeded randomness and the pre-registered constants. |
| `engineEvalCompare.ts` | Before/after comparison of two evaluation runs (G2). |
| `analysisFieldsEval.ts` | Analysis-fields evaluation CLI (WP-15): `trend`, `skills` and `plan` modes, gates T1-T5, P1-P6, S1-S3, S5, S6. |
| `analysisFieldsEvalCompute.ts`, `analysisFieldsEvalPlan.ts`, `analysisFieldsEvalSkills.ts`, `analysisFieldsEvalTypes.ts` | The pure parts per mode and the pre-registered constants. |
| `analysisFieldsEvalRender.ts` | Renders the technical prompt of a case for both tiers through `runAnalysis` without a model call (the `skills` mode). |

## The set

```
<set>/manifest.json
<set>/bars/<SYMBOL>.json      { ticker, companyName, fetchedAt, from, to, bars }
```

`bars` is oldest first, daily, stamped at UTC midnight (core's `Bar`). The manifest holds
`setId: "replay-v1"`, `frozen: true`, one entry per bars file (`file`, `sha256`, `from`, `to`,
`count`, `market`, `currency`) and the cases (`caseId = "<symbol>|<asOf>"`, `timeframe`,
`asOf`, `regime`, `variance`). `run.ts` and `label.ts` refuse a set whose bars files do not
hash to the manifest values, also in a dry run.

**Symbols (65):** the 40 tickers of the published daily-AI backtest, 15 US additions
(`IWM JPM XOM UNH WMT CAT PFE KO SOUN IONQ UPST RIOT MARA JOBY ACHR`) and 10 Korean listings
(`005930.KS 000660.KS 005380.KS 035420.KS 035720.KS 105560.KS 051910.KS 207940.KS 086520.KQ
058470.KQ`). Bars run from 2017-01-03 to the freeze date so that 2020 cases have a full MA200.

**Case selection** (`buildSet.ts`, no random numbers): a candidate date has at least 260 bars
before it and 20 after it. Its regime comes from the symbol's own bars, first match wins:
`crash` (20-bar return <= -20%), `downtrend` (close below SMA200 and 60-bar return <= -10%),
`uptrend` (close above SMA200 and 60-bar return >= +10%), else `range`. Per symbol, regimes
are taken in the order crash, downtrend, uptrend, range: 2 crash dates and 4 of each other
regime, evenly spaced over that regime's candidate dates, and a date fewer than 20 bars from
a date already chosen for the symbol is dropped (forward windows never overlap). The
variance subset is the first 25 cases of each regime ordered by sha256 of the case id.

## Operator steps

### 1. US bars (network, production key)

```bash
SIGLENS_ENV_FILE=<path to env file> \
  npx tsx scripts/replay/fetchBars.ts --symbols all-us --from 2017-01-03 --to <freeze date> --out <bars-dir>
```

Without `--execute` this prints the plan (55 symbols, 110 requests: bars and profile per
symbol, and the worst case with retries: `FETCH_ATTEMPTS` attempts each) and requests nothing. Add `--execute` to fetch. The key comes from `FMP_API_KEY` or
the env file; it is never printed and error messages carry the HTTP status only. An existing
`<SYMBOL>.json` is kept unless `--force`.

### 2. Korean bars (consumer side)

Core has no Yahoo provider. Produce one `<bars-dir>/<SYMBOL>.json` for each of the ten Korean
symbols in the same shape the US files have:

```
{ "ticker": "005930.KS", "companyName": "...", "fetchedAt": "<iso>",
  "from": "YYYY-MM-DD", "to": "YYYY-MM-DD", "bars": [ { "time", "open", "high", "low", "close", "volume" } ] }
```

`bars` is oldest first, one daily bar per trading day, `time` in Unix seconds at **UTC
midnight** of the trading date (`buildSet` rejects any other stamp), no bar after the freeze
date, from 2017-01-03. `companyName` is the name the consumer shows for the listing.

An illustration of a consumer-side script (the provider class belongs to the consuming
application and is not a dependency of this repository; adapt it to whatever daily-bars
source that application has):

```ts
// Illustration only: `provider.getBars` stands for the consumer's Yahoo-backed daily-bars call.
const bars = await provider.getBars({ symbol, timeframe: '1Day', from: '2017-01-03' });
const kept = bars.filter(b => b.time <= Date.parse('<freeze date>T00:00:00Z') / 1000);
writeFileSync(`<bars-dir>/${symbol}.json`, JSON.stringify({
    ticker: symbol, companyName: NAMES[symbol] ?? symbol, fetchedAt: new Date().toISOString(),
    from: iso(kept[0].time), to: iso(kept[kept.length - 1].time), bars: kept,
}));
```

### 3. Build the set

```bash
npx tsx scripts/replay/buildSet.ts --bars <bars-dir> --out <set-dir> [--created-at <iso>]
```

Needs all 65 files (`--allow-partial` builds from the files present). It refuses an existing
set unless `--force`. Same bars and `--created-at` give a byte-identical manifest.

### 4. Plan, then run

```bash
# dry run: set hashes, planned call count, token and USD estimate; no provider call
npx tsx scripts/replay/run.ts --set <set-dir> --out <run-dir> --subset variance --repeat 3

# execute: the approved count must equal the planned count exactly
DEEPSEEK_API_KEY=... npx tsx scripts/replay/run.ts --set <set-dir> --out <run-dir> \
  --skills <app checkout>/skills --subset variance --repeat 3 --execute --approved-calls <planned>
```

Options: `--tier free|member` (default `member`; the tier the analyses run as, part of the
run identity so a resumed run must use the same tier), `--subset variance`, `--repeat N`,
`--limit N` (the N cases with the smallest
sha256 of the case id, so two arms given the same limit run the same spread of cases),
`--concurrency 4`, `--keep-raw` (gzipped request body and response text per call),
`--retry-errors` (redo calls that failed).

- The planned count is the calls still to make: cases x repeats minus result files that
  exist. A resumed run therefore needs the new, smaller count as its approval. A failed call
  is a result too and is skipped on resume; it is never retried automatically (a retry is a
  cost).
- **One symbol at a time.** `runAnalysis` joins concurrent callers on one in-process
  promise keyed by the analysis cache key (`analysis:<symbol>:<timeframe>:<model>:<prompt
  version>:<tier>:<skills>`), even with `cache: null`, and that key has no date or bars hash.
  Two concurrent jobs of one symbol (two dates, or two repeats of one case) would therefore
  run a single generation and both would receive its reply: a result built from another
  date's prompt, and a repeat that is not independent. The runner keeps one ordered queue
  per symbol (a case's repeats run one after another) and runs up to `--concurrency` symbols
  in parallel. A call that reports success without having assembled its own prompt is stored
  as an error (`joined another generation`), and `label.ts` never labels such a result.
- **One call is not one request.** The approved count is `runAnalysis` calls. A call bills
  at most 2 complete generations (`callAnalysisAi` generates once more when the first reply is
  not parseable JSON), and each generation can send several HTTP requests: `withRetry` makes
  up to `AI_RETRY_MAX_ATTEMPTS` attempts, and the OpenAI-compatible client may retry each one
  itself (assumption: it is built without `maxRetries`, so the SDK default of 2 extra tries
  applies). The dry run prints both facts: at most 2 generations per call, and up to
  `2 x AI_RETRY_MAX_ATTEMPTS x 3` HTTP requests per call (30 with the current constants) and
  for the whole plan. A finished run prints how many exchanges each job needed. The USD
  estimate assumes one request per call.
- **One process per run directory.** `--execute` takes an exclusive lock file (`.run.lock`) in
  `--out` and removes it when the run ends, also after an error. A second `--execute` on the
  same directory is refused. After a crash that left the file behind, delete it by hand once
  no replay is running. A dry run takes no lock.
- **A failure stops the run.** If a job fails unexpectedly (for example a disk write error),
  no queue starts another job, the jobs in flight finish, and the command then fails with the
  first error and the number of jobs that had completed. Failed model calls are not such
  failures: they are stored as results.
- Before the first call the skills are loaded once; a wrong `--skills` directory (no skills,
  or a degraded load) stops the run, and the skill count is printed.
- The estimate uses the measured mean call size (35.7K input and 7.3K output tokens) and
  price ($0.0074 per call) of a daily analysis on the flash model with reasoning off, and
  doubles when the run starts inside a DeepSeek peak window (weekdays 01:00-04:00 and
  06:00-10:00 UTC). Prompts of another version may differ by about 20%.
- Per case the runner uses the stored bars cut at `asOf` (no later bar is ever served), no
  quote, no prior analyses, events or earnings dates (not reproducible), `cache: null`, and a
  clock set to that session's close plus one hour. `FileSkillsLoader` reads `<cwd>/skills`
  when core is first imported, so the process changes into the parent of `--skills` before
  importing core; every path argument is resolved first.
- Output: `<run>/run.json` (set id, core git sha with `+dirty` for an unclean tree, prompt
  template version, model, tier, sha256 of the skills tree, repeat count),
  `<run>/results/<symbol>_<asOf>.r<k>.json` (`unfilteredResult`, prompt hashes, dynamic prompt,
  token usage, exchange count, latency, error; provider error text is capped at 500
  characters and key-shaped strings (`sk-...`, `Bearer ...`, runs of 32 or more
  hex/base64 characters) are masked). A run directory made with a different identity (set and
  bars hash, code, prompt version, model, tier, skills, repeat count, subset, limit) is
  refused.

### 5. Label and report

```bash
npx tsx scripts/replay/label.ts --set <set-dir> --run <run-dir>
npx tsx scripts/replay/report.ts --run <run-dir> [--compare <other-run-dir>] [--noise <variance-run-dir>] [--out <report.md>]
```

`label.ts` writes `<run>/labels.jsonl`: per result the outcome subject and labels (anchor =
the case's own `asOf` bar, closed), the price-provenance check against the result's own prompt
and against another symbol's prompt (the control), the plan invariants it breaks, and the
symbol's period baseline.

## How the report reads the labels

- Every rate is printed with its `n` and split by `plan.recommendation`; nothing is pooled
  across verdicts.
- Headline sections use repeat 1 of each case only: repeats of one case are not independent
  observations and would shrink every standard error. The variance section uses all repeats
  and says how many cases have how many usable runs; a case with fewer runs than the repeat
  count is used with the runs it has.
- A model-minus-null difference (target_first share against the mean `rwNullTargetFirst`) and
  a real-minus-placebo difference come from one run and are printed with a sampling standard
  error (per-plan or per-pair differences, sample SD over the square root of n), not with the
  run-to-run flip rate, which measures something else.
- `target_first` is compared with the mean `rwNullTargetFirst` over **all** triggered plans
  (`target_first`, `stop_first`, `ambiguous`, `open_at_horizon`): the null has no horizon.
  `not_triggered`, `void_at_entry` and `no_plan` are shown apart and never count as wins.
- A level's `respected` share is compared with the placebo only on levels where both the real
  level and the placebo were evaluated.
- Rows anchored on `generated_at`, or with `plan.anchorBarUnobserved`, are excluded from every
  headline number and counted in a separate bucket. In a replay every anchor is a closed
  `asOf` bar, so the bucket should be empty; the report warns when it is not.
- The pattern skip reasons `target_reached` and `target_reached_on_breakout` are separate
  columns.
- Gap exits are shown apart from level exits wherever a mean return is printed.
- Provenance is read from the stored result, which for Korean listings holds tick-snapped
  prices; a made-up Korean price can therefore look grounded.
- **Noise.** The noise floor is the pairwise flip rate of a case's repeats (variance mode:
  `--subset variance --repeat 3`). In `--compare`, a difference between two runs smaller than
  the flip rate of its label is printed as "within run-to-run noise". With no repeats anywhere the report says the noise
  floor is unknown; it does not imply significance. `--noise` takes the flip rates from
  another run, for a full replay that has one repeat per case.
- `--compare` pairs two runs by case (repeat 1) and prints the flips per label and the paired
  difference (B minus A) of each rate with its standard error. It fails when the two runs
  used different sets or bars, and warns when the models differ or when core sha and prompt
  version are identical (nothing differs but sampling). Level and pattern flips, and the
  key-level overlap, match items on exact role and price (or pattern name) only.

## Limitations

Read every number with these in mind.

- The model may know history after a case's `asOf` date from its training data, and the
  ticker and company name identify the stock, so a replay is not a clean out-of-sample test.
- `companyName` is the name today, not the name on the case date.
- The symbol list was chosen in hindsight and leans toward companies that did well or grew
  large (survivorship and selection); it is not a random sample of the market.
- Some symbols have bars from before a merger (for example a SPAC listing) that describe a
  different business than the name suggests.
- Prices are adjusted for later splits (and, depending on the source, dividends), so a stored
  price is not the price printed on the day.
- Standard errors assume independent cases. Cases of one symbol, or of one date, are
  correlated, and no clustering is applied, so the errors are too small.
- Level flips, the key-level overlap and the pairwise comparisons match levels on exact role
  and price only; a level that moved by one tick is a different level.
- The case count is below the nominal quota (4 per regime and 2 for crashes, per symbol)
  because dates closer than 20 bars to one already chosen are dropped without replacement.
- Provenance is read from the stored result; Korean prices are tick-snapped before storage.

## The clock shim

`runAnalysis` has no `now` option and cuts its bar window at `new Date()`, so a past day needs
the clock moved. `clock.ts` installs a `Date` proxy when the first replay starts and puts the
previous `Date` back when the last one ends, also when the replayed function throws. Inside a
call only the async chains it started see the shifted time (an `AsyncLocalStorage` offset);
every other chain reads the real clock through the same proxy. `date.constructor === Date` is
false for dates made under the shim.

## Tests

`src/__tests__/scripts/replay/`. No test reaches a provider or the network: the fetch path
runs on a stubbed `fetch` that rejects by default, the runner on a stub analyzer, and bars
are synthetic.

## Engine evaluation (candle and chart-pattern engines)

A placebo-controlled measurement of what `detectCandlePatternEntries` and the chart-pattern
walk-forward (`screenChartPatterns`, `qualifyPatterns`, `computeCandidateGeometry`) print. No
model call, no network, no cost; the only randomness is a seeded placebo draw (mulberry32,
seed 20261121, one stream per event keyed by `sha256(symbol|t|pattern[|start time])`), so
identical events draw identical placebos in every arm. An arm is a checkout: run the same set
from two checkouts and compare.

```bash
npx tsx scripts/replay/engineEval.ts --set <set-dir> --out <run-dir> --arm before --gate c9
npx tsx scripts/replay/engineEval.ts --bars <bars-dir> --out <run-dir> --arm before   # plain <SYMBOL>.json files
npx tsx scripts/replay/engineEvalCompare.ts --before <run-dir> --after <run-dir> --out <dir>
```

`--only candles|patterns` and `--symbols A,B` narrow a run; `--gate c9|pivots|geometry` scores
G1 for one PR (below); `engineEval.ts` then exits 2 when the gate did not pass (0 otherwise, 1 on an error). The output lives outside the repository (`--out` inside it is
refused): `run.json` (core sha, a sha256 of the dirty diff when the tree is dirty, data
fingerprint, every constant), `events.jsonl` (one row per candle event and per
first-appearance pattern instance) and `summary.json` (with the bootstrap's week list, taken
from the bars so a narrowed run resamples the same weeks).

- **Candles.** Events are the entries ending at bar `t` on the production 500-bar window.
  Outcome `Y_h = d x (close[t+h] - close[t]) / ATR14[t]`, `h` in 1, 5, 10 (primary 5), percent
  beside it. Placebo: 20 dates of the same symbol within 250 bars, matched on the prior-move
  bucket (decline / none / advance, 10 bars, 1 ATR, read at the same offset before the
  pattern's first bar). Edge `E = mean(Y - mean placebo)`; the interval clusters by ISO week
  (percentile, 2,000 resamples, resamples without any observation of a pool are counted and
  skipped); pools are bullish, bearish and pooled, Holm-adjusted; per pattern from n = 100,
  with its US/KR and time-half splits and a Holm adjustment across the families.
- **Chart patterns.** A 500-bar window every day from bar 500, directed instances at their
  first appearance. Outcome: measured target (and the 50% target) touched within 60 bars before
  a close beyond the invalidation. Placebo: the same levels transplanted by ATR% to 20 dates of
  the same symbol matched on the 20-bar / 2 ATR prior-trend bucket. `D` = hit share minus the
  placebo's, with the ISO-week interval and a 13-week-block interval beside it (G3 reads the
  wider). The WP-06 `labelPatternOutcome` result (20 bars) is reported beside it.
- **Placebo dates leave out the event's forward window** (an approved deviation from the
  brief): a date within 10 bars of a candle event, or 60 bars of a pattern event, shares its
  outcome window, so it is not drawn. The rule is arm-independent.
- **G1 counters** (deterministic, recomputed from OHLC, never from the classifier they check):
  candle context / setup-body / doji-setup / tweezers-close violations (on the 500-bar window
  the detector sees); chart-pattern wrong-side, non-positive, moving post-break levels,
  unexplained status flips, days where `isFailedBreakout` disagrees with the same test on the
  level frozen at the recomputed break bar, self-confirmed pivots that the close does not
  prove (in the engine's effective ATR), pivot repaints. `--gate` picks the counters one PR is
  scored on: `c9` the four candle counters, `pivots` the proof and repaint counters,
  `geometry` wrong side, non-positive, moving, status flips and repaints. A gated run passes
  only when those counters are 0 and its half was measured and evaluated something (`--only`
  never scores the missing half as zero; 0 pattern days or 0 candle events is a failure, not a
  pass). Under a gate, a case with no bar at its `asOf` date fails the run (exit 2) unless
  `--allow-skipped-cases`; `--symbols` naming a symbol absent from the data is an error.
- **Robustness (reported, never gating):** prior move 0.5 and 1.5 ATR (violations and the
  pooled edge over the re-matched placebo), body floor 0.1 and 0.5 ATR (violations).
- **G2** (`engineEvalCompare.ts`): `Delta = E_after - E_before` inside each resample of one
  shared week bootstrap; the upper bound of the pooled Delta must be >= 0 (a bound that cannot
  be computed fails when both arms measured the half); qualified instances may fall by at most
  25% (reported per family, not an automatic fail); detected candle events per pattern are
  listed before and after. Compare refuses runs whose data fingerprint, symbol list, `only`
  or constants differ, and warns about a `+dirty` checkout. `before` and `after` must be made with the same `--gate` (a mismatch is refused), and the
  `after` run must have one (without it compare exits 1: G1 cannot be scored). Exit codes: 0 when G1 and G2 both
  pass, 2 when either fails, 1 on an error (including a refused comparison).

The WP-17 thresholds are the instrument's own copy (`engineEvalTypes.ts`), deliberately
independent of the arm under test; everything the engine defines (the 500-bar window, the
detection window, the pivot reversal multiple) is read from core and recorded in `run.json`.

## Analysis-fields evaluation (`trend`, `skills`, `plan`)

Deterministic measurement of the fields a consumer reads as conclusions: `trend`, the plan
state with its stop and `entryRecommendation`, and the skills a tier's prompt carries. It
makes no model call and needs no network. The rules, thresholds and gates are the
pre-registered ones of WP-15 (`analysisFieldsEvalTypes.ts`); every definition is recomputed
here from OHLC and from the fields a stored result carries, and the stored field under test is
only ever what is compared with, never the reference. The one thing read from core is
the calendar lookback of a daily analysis (730 days). A replay prompt sees the bars of that
lookback, 485 to 506 daily bars (the stored provider ignores the bar-count limit and cuts by
date), so the rules at a labelled bar are computed on those bars, not on the last 500.

```bash
# trend: all days from bar 300 for a set, and a run's stored trend against the rule
npx tsx scripts/replay/analysisFieldsEval.ts --mode trend --set <set-dir> --run <run-dir> --out <dir>
# trend on stored daily decisions (a decisions.csv with date, ticker, kind, trend) and their bars
npx tsx scripts/replay/analysisFieldsEval.ts --mode trend --bars <bars-dir> --labels <decisions.csv> --out <dir>
# skills: render every case for free and member (no model call) and read the skills off the prompt
npx tsx scripts/replay/analysisFieldsEval.ts --mode skills --set <set-dir> --skills <app>/skills --out <dir> [--limit N]
# plan: distributions and the independent recomputation of the state; --before pairs two runs
npx tsx scripts/replay/analysisFieldsEval.ts --mode plan --set <set-dir> --run <run-dir> --out <dir> [--before <run-dir>]
```

Outputs (outside the repository, like every writer here): `run.json` (core sha, dirty-diff
hash, inputs including the sha256 of a `--labels` file, constants), `summary.json` (`summary` and `gates`) and `rows.jsonl` (one line per
located label, per plan or per rendered prompt).

- **`trend`.** The shipped rule R4 (EMA20 move over 20 bars in ATR(14), 2 dp, at least 1.00,
  and the close beyond EMA20) and two references, R1 (the audit's 3-line rule) and R3 (the
  percent rule of `classifyTrend`). For every day from bar 300: label distribution,
  day-to-day change, hard flips, prior-10-day sign match. Against stored labels (a run's
  `trend`, one row per case; or `--labels`): agreement, opposites and the confusion table
  per regime and market, and the day-to-day change of the stored label and of each rule on
  consecutive labelled bars (at most 5 bars apart, so it needs labels made nearly every
  session; a run's cases give none). For a run: `plumbing` (stored `trend`, and `trendBasis`
  when present, against the rule) and the summary-words check (T5).
- **`skills`.** Both tiers of every case through `runAnalysis` with `fetch` replaced by a
  function that throws and the call aborted at the prompt hook. A skill "reaches the
  prompt" when its `### <name> ` heading is in the text. Per tier: skills per prompt, by group,
  always-on coverage, stable and dynamic size, distinct stable prefixes. Order for S2 is the
  order of appearance in the member prompt. With `--run <free after> --before <free before>`
  (and `--member-run <member run>`): S5 (failure and missing-plan rates, median uncached input
  tokens, median latency) and S6 (level overlap with member within 0.25 ATR, paired).
- **`plan`.** For each result: the state table of WP-15 §3.3 recomputed from the stored zone,
  effective stop and targets and the Wilder ATR of the analysed bar, the verdict it implies
  (`in_zone` enter, `above_zone`/`below_zone` wait, `no_setup` avoid), the stop that
  WP-15 §3.2 prescribes (the model's stop when it lies in `[mid - 5 ATR, low - 1 ATR]`, else the
  highest support printed under a `Support (below):` heading of the stored prompt in that
  band, `at price` entries excluded, else `low - 1.5 ATR` quoted, to the KRX tick for Korean
  listings) and its basis, with the zone mid as the mean of the entry prices; a stop that
  differs, or is absent although the zone and the ATR are usable, is a P1 violation. The
  comparison with a stored `planState` when there is one covers position, reason, ATR, stop
  distance, distance beyond the zone and stop basis. Distributions: position, reason, stop basis, stop and target distances in ATR,
  verdict by position, where the close sits against the zone by stored verdict (`closeVsZoneByVerdict`
  uses the state table's 1% tolerance on both sides; `closeVsZoneByVerdictSection1` keeps the
  figure WP-15 §1 measured, with no tolerance below the zone, so a baseline reproduces the
  design's 420 / 277 / 104), the volatility grade
  against the next 10 sessions, outcomes by position from `labels.jsonl` (a `no_setup` plan is
  relabelled as `wait`). Distributions use the headline rows when `labels.jsonl` exists
  (`planAllResults` has every result; P1 and P3 always read every result with a plan, P2 the
  headline rows); `p7Sample` lists 10 case ids per position by smallest
  sha256 for the manual read of P7.

Gates are always computed and printed with their value and threshold. A gate is `pass: null`
when the input cannot decide it (T1 without `--run`, P4 to P6 without `--before`, S5 and S6
without a run pair, P1 without a `--before` run with labels to baseline the plan invariants).
`--gate all` (every gate of the mode) or `--gate T1,T2` selects the gates that decide the exit
code: **2** when a selected gate fails or cannot be computed (a selected id the input did not
produce counts as not computable; it is not a pass), 0 otherwise, **1** on an error. Without
`--gate` nothing decides the exit code, and the run prints a notice saying so (a baseline on
`main` is expected to fail some gates). `--gate` also makes stored label dates with no
bar fail the run unless `--allow-skipped-cases`. Fail-closed refusals (exit 1): an output path
inside the repository, a set hash mismatch, a run whose `run.json` names other bars, a
result of a case not in the set, a run that does not cover its subset, limit and repeat, two
runs compared case by case that differ in set, tier, model, subset, limit or repeat, labels of a
symbol without bars, a result whose analysed bar is not in the set, and an empty measurement
(no measurable day, no stored label, no plan, no rendered prompt). `--noise-pp <n>` is the
run-to-run noise floor in percentage points added to the 1 pp margin of P6 and S5 (read it
off `report.ts --noise`).

Headline numbers use one row per case (repeat 1) and, for plans, the rows a report counts
(`labels.jsonl` headline). The `T1` "every B day" part of the design (the shipped function
against the rule on every day) is a unit test of the PR that ships the function; the
instrument checks the results a run returned.
