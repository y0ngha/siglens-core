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
| `analysisFieldsEval.ts` | Analysis-fields evaluation CLI (also the `htf`, `htf-forward` and `weekly-hygiene` modes of WP-19): `trend`, `skills` and `plan` modes (WP-15, gates T1-T5, P1-P6, S1-S3, S5, S6), `gating` and `output` modes (WP-16, gates D1-D3, D5, D6, D8, D9 and D7, O1, O2, F1, F2, L1, L2, V1-V5) and `claims` and `zone` modes (WP-18, gates C1, C2, F1, F2, L1, O1, V1 and Z1, Z2, N2, N3). |
| `analysisFieldsEvalCompute.ts`, `analysisFieldsEvalPlan.ts`, `analysisFieldsEvalSkills.ts`, `analysisFieldsEvalTypes.ts` | The pure parts per mode and the pre-registered constants. |
| `analysisFieldsEvalGating.ts`, `analysisFieldsEvalCards.ts`, `analysisFieldsEvalPrompt.ts` | `gating` mode: which pattern and candle guides reach a prompt against what it prints, the card checks recomputed from the printed lines and OHLC, and the readers of the prompt text. |
| `analysisFieldsEvalOutput.ts`, `analysisFieldsEvalCatalog.ts` | `output` mode: paired comparison of an after, a before and a repeat run with bootstrap intervals, and the skill-file frontmatter reader it matches pattern names with. |
| `analysisFieldsEvalRender.ts` | Renders the technical prompt of a case for both tiers through `runAnalysis` without a model call (the `skills` and `gating` modes). |
| `analysisFieldsEvalClaims.ts`, `analysisFieldsEvalZone.ts` | `claims` and `zone` modes (WP-18): positive reliability claims and strong-level wording (C1, C2), and where the close sits against the entry zone under the 1% tolerance and under exact edges (Z1, Z2, N2, N3). |
| `htfEvalCompute.ts`, `htfEvalPrompt.ts` | WP-19 pure parts: the instrument's own ISO-week and month aggregation, trend, RSI, SMA, unfinished-period and market-backdrop recomputation, and the readers of the weekly rows, the higher-timeframe block and the backdrop block a prompt prints. |
| `htfEvalGates.ts`, `htfEvalWeekly.ts`, `htfEvalForward.ts` | WP-19 gates: `htf` mode (W1, W2, H1, H1b, H2a, H2b, H4, H4k), `weekly-hygiene` mode (K1 to K3) and `htf-forward` mode (the case table and M1). |
| `levelEval.ts` | Price-level evaluation CLI (WP-18): held rate of the printed levels against a date-transplant placebo, the score fit with a time split, the structural-ratio anchors and the non-positive-level count (gates L0, L-gate, G42). |
| `levelEvalCompute.ts`, `levelEvalTypes.ts` | The pure parts of `levelEval.ts` and its pre-registered constants. |
| `baseRateTable.ts`, `baseRateTableCompute.ts`, `baseRateTableRender.ts` | Generator of `src/domain/analysis/measuredBaseRates.ts` from the engine and level evaluations of one set (WP-18 §4.1). |

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

## Analysis-fields evaluation (`trend`, `skills`, `plan`, `gating`, `output`)

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
  uses the state table's exact edges, since WP-18; a run made before that shipped a 1% band above the
  zone top, so pass `--legacy-zone` (plan mode only) to recompute its stored `planState` with that
  band, otherwise P1 fails on every plan the band called `in_zone`; the output `inputs.zoneRule`
  records which rule was used), the volatility grade
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

### `gating` and `output` (WP-16)

```bash
# gating: render every case (no model call) and read which pattern and candle guides, and
# which computed cards, a prompt carries; --baseline compares the member prompts with an
# earlier gating output byte for byte once the guide parts are removed (D3)
npx tsx scripts/replay/analysisFieldsEval.ts --mode gating --set <set-dir> --skills <app>/skills --out <dir> [--tier free|member] [--limit N] [--baseline <gating out dir>]
# output: per-case pairs of an after and a before run; --repeat (a second run of the before arm)
# gives the noise floor the non-inferiority gates need
npx tsx scripts/replay/analysisFieldsEval.ts --mode output --set <set-dir> --skills <app>/skills --run <after> --before <before> [--repeat <run>] --out <dir>
```

- **`gating`.** Per prompt: the chart-pattern ids printed under `## Chart Pattern Candidates`
  and the candle names printed under `## Detected Candle Patterns`, the pattern and candle
  guides whose heading the prompt carries, and the guides no printed id selects (hint-only
  patterns, unprinted candles) or that a printed id lacks (free: within the cap of 3). D1 and
  D2 are zero such prompts. D3 compares `sha256` of the dynamic prompt without exactly the pattern
  and candle sections, the four pattern and candle rule blocks (each with its list) and the
  candidate instruction paragraph, and of the stable part, with the baseline output. Blank
  lines are folded only where a removal joined them; the hash of the plain remainder is
  reported beside it. D1 and D2 are undecided when the catalog has no gated guide of the family. D9 needs the indicator rule
  block and the cycle strategies gone from the prompt and `indicatorResults` gone from the
  response schema. D5, D6 and D8 read the cards of the assembled prompt record
  (`AssembledPromptRecord.indicatorCards` and `cycleCards`, typed `@internal` fields that
  `runAnalysis` hands out; the render reads them typed and `analysisFieldsEvalRender.test.ts`
  pins the field names): one card per injected tagged guide, and, for each of the 36 indicator
  kinds, a reader of that kind's own printed lines (`## Indicator Values`, `## Indicator State`,
  `## Pro-Indicator Agreement`, `## Market Regime & Risk Context`, `## Volume Analysis`, and
  the `Bullish signals:` / `Bearish signals:` lists for the event kinds) with the instrument's
  own thresholds: the values are printed numbers (the close comes from `## Analysis Snapshot`),
  the state is recomputed from them, and the trend is the trend of the printed state. Where the
  prompt does not print the history a state needs (the previous Force Index sign, the Elder-Ray
  turn, a Chandelier flip within three bars, a volatility regime against its 20-bar mean) the
  reading is `partial`: the card's state must be one the printed lines allow, a necessary
  condition rather than a recomputation, and the number of such cards is reported. D8 reads a
  cycle card against the printed `- MA cycle` / `- MACD cycle` line (stage, printed values, the
  MA order), the stage history recomputed from the closes of the bars the prompt saw, and the
  set of cards against the strategy-block note that names the cycles code builds. They are
  `null` ("core without cards") while the catalog has no `computed_card` tag, and D6 is `null`
  while a card is of a kind without a reader: add the reader to `analysisFieldsEvalCards.ts`
  rather than reading the card as its own reference. The cycle history (the orchestrator's decision): window = the
  last 120 bars by count including the current bar, bars with no stage are ignored (they
  neither end a run nor count as a change), `previousStage` is the stage of the run before
  the current one, `barsInStage` counts the bars of the current run and is `null` when it
  reaches the first bar of the window.
- **`output`.** Needs `--set` (key levels are measured in ATR of the case's bar) and
  `--skills` (pattern names and trigger ids, read from the files). Model-written characters
  are the result minus what code attaches (`id`, `confidenceWeight`, `renderConfig`,
  `reconciledLevels`, `planCheck`, `planState`, and the cards that carry a `reading` or a
  `cycle`), compact JSON, an absent field counting 0; the figures of WP-16 §1 are reproduced
  within ~0.4 pp of share (the design's script counted `null` as 4 characters). Intervals are
  percentile bootstraps (2000 resamples, seed in `analysisFieldsEvalTypes.ts`). L1, L2 and the
  detected-candidate part of V3 are non-inferiority differences against the repeat run and
  are `null` without `--repeat`; the rate gates (F1, F2, V5) use the repeat run's drift from
  the before run as their floor, else `--noise-pp`. A `--repeat` run whose `skillsSha256`
  differs from the before run is accepted only when every prompt hash matches. D7 reads the
  before run's per-card trends against the rule of the skill's kind (`computed_card` tag,
  else the core-0 baseline names) on its stored prompt lines; a skill with at least 30
  readings and more than 5% opposite maps to `neutral` before the live run (applied, in core
  and in the instrument's `NEUTRAL_AFTER_D7`, to stochastic, stoch_rsi, williams_r, bollinger,
  macd_v, elder_ray and chandelier after the member run `2026-11-22-wp15-c2-after2`). A tagged kind
  without a trend rule makes D7 undecided. O1, O2, L1, L2 and V1 to V5 are undecided when
  fewer than 90% of the cases are paired. An unknown run tier is an error. `proseSample` lists the 40 cases the manual prose read (P)
  takes. Both modes: gates `D1`, `D2`, `D3`, `D5`, `D6`, `D8`, `D9` and `D7`, `O1`, `O2`, `F1`, `F2`, `L1`, `L2`,
  `V1` to `V5` respectively; a baseline on `main` is expected to fail D1, D2 and D9.

Headline numbers use one row per case (repeat 1) and, for plans, the rows a report counts
(`labels.jsonl` headline). The `T1` "every B day" part of the design (the shipped function
against the rule on every day) is a unit test of the PR that ships the function; the
instrument checks the results a run returned.

## Price levels and measured base rates (WP-18)

A placebo-controlled measurement of the levels a prompt prints, and the generator of the table
that replaces literature weights and verdict-bearing ratios with measured base rates. Offline,
no model call, no network, no cost; output outside the repository.

```bash
# the level evaluation: ~7 minutes on set B (65 symbols, step 3), ~5 GB of heap
NODE_OPTIONS=--max-old-space-size=12288 npx tsx scripts/replay/levelEval.ts --set <set-dir> --out <dir> [--step 3] [--arm <name>] [--gate L0,L-gate,G42|all]
# the table, from clean runs of one set and one commit (engineEval --gate geometry, engineEval --gate c9, levelEval)
npx tsx scripts/replay/baseRateTable.ts --engine <dir> --candles <dir> --levels <dir> --date <YYYY-MM-DD> --out <file> [--json <file>]
# claims: an after run against a before run (and an optional repeat of the before arm)
npx tsx scripts/replay/analysisFieldsEval.ts --mode claims --set <set> --skills <app>/skills --run <after> --before <before> [--repeat <run>] [--lang ko|en] --out <dir>
# zone: where the close sits against the entry zone; --restate exact re-derives an old run's positions
npx tsx scripts/replay/analysisFieldsEval.ts --mode zone --set <set> --run <run> [--before <run>] [--restate exact] [--lang ko|en] --out <dir>
```

- **`levelEval`.** Every `--step`-th bar from bar 300 (20 forward bars needed) is a study day. The
  production 500-bar window ending at the bar gives `computeMarketReference` (the bar is a finished
  session); every level `printedLevelsOnSide` returns gets features from `bars[0..t]` only (distinct
  kind families within 0.25 ATR, touch episodes and reactions over 120 bars, recency, volume density
  at the level, side, distance) and its outcome from `labelLevelOutcome` on the 20 bars after (touch
  within 0.1 ATR; held = a close 0.5 ATR back on the level's side before a close 0.5 ATR through it,
  within 10 bars). The placebo is the date transplant: the same side and distance in ATR from the close
  on 3 other study days of the symbol more than 30 and at most 250 bars away (a nearer day shares the real
  level's outcome window) (picks keyed by `sha256(symbol|t|side|rank)`),
  labelled with the instrument's own copy of the labeller (`labelAgreement` counts how often it differs
  from `labelLevelOutcome` on the real levels; 0 expected). A feature function that read a bar after `t`
  would change when the future is poisoned, and a unit test does exactly that.
  - Tables: held rate with `n`, the transplant rate and their difference with an ISO-week cluster
    interval, by kind family, confluence, touch episodes, reactions, side, distance, volume quintile,
    recency, market and period; the labeller's own 0.5 ATR shift placebos beside them; the touch rate
    by distance; a barrier sweep (0.5 and 1.0 ATR, the groups of WP-18 section 1, on one level in five).
  - The score: a logistic model fitted on days before 2022-01-01 minus a 20-bar embargo, scored from
    2022-01-01, banded by the training quintiles; AUC, top minus bottom, top minus its own transplant
    placebo, by market and by half of the test period.
  - `structural`: the anchors the removed structural R:R block chose (nearest level each side), its
    ratio and Spearman against the 10-session return. `nonPositive`: levels with a price that is not
    positive in a horizon, in `printedLevelsOnSide` and in the Fibonacci overlay levels, per day.
  - Gates: **L0** (not computable while the instrument and `labelLevelOutcome` disagree on a real level) the instrument reproduces WP-18 section 1 (held 49.65%, transplant 49.70%, test AUC
    0.515, top minus transplant -0.6 pp, each within 0.2 pp) and is `null` for any other set, step or a
    `--symbols` subset; **L-gate** a score's top quintile beats its own transplant placebo out of sample
    (interval low bound above 0, the wider of the week and 13-week-block intervals, positive point estimate
    in both markets and both halves of the test period, split 2024-07-01); **G42** no non-positive level anywhere. `--gate` picks the gates that
    decide the exit code (2 on a failed or uncomputable one, 1 on an error).
- **`baseRateTable`.** `--engine` is an `engineEval` run with `--gate geometry`, `--candles` one with
  `--gate c9`, `--levels` a `levelEval` of the whole set at step 3; each is a run directory or its
  `summary.json`, and the engine runs need their `events.jsonl` (per-family shares are recomputed from
  it and its counts are checked against the summary). It refuses (exit 1) a dirty checkout (`+dirty` sha
  or a dirty-diff hash), runs of different bars or different core commits, a run whose own gate did not
  pass, a level run that is not the reference population and events that do not match their summary.
  `--allow-dirty` lets uncommitted runs through for a look (never to the committed path, and the header
  keeps the `+dirty` sha). `--out` outside the repository, or exactly
  `src/domain/analysis/measuredBaseRates.ts`; `--json` (outside) keeps every number the verdict rule
  read. The file is formatted with the repository's prettier config and is byte-identical for the same
  inputs and `--date`.
  - Verdict (WP-17 G3, one rule): `insufficient_sample` below 100 events (the row then carries the
    pooled figures under `key: 'pooled'`); `beats_placebo` iff the Holm-adjusted test rejects zero at
    5%, the difference is positive, its interval's low bound is above zero (patterns: the wider of the
    week and 13-week-block intervals) and the sign holds in both time halves and in the US and Korean
    markets; otherwise `no_edge`. A half or market the data does not cover fails the rule.
  - The `measuredBaseRates.ts` the generator writes holds the types, the tables (aggregate statistics
    only), `PATTERN_POOLED_BASE_RATE` / `CANDLE_POOLED_BASE_RATE` for a key without an own row, and
    `measuredBaseRateFor`; the template lives in `baseRateTableRender.ts`.
- **`claims`.** C1: positive reliability claims per detected pattern and candle card (`신뢰도가 높`,
  `높은 신뢰`, `확률이 높`, `신뢰할 만`, `승률` not preceded by `상`, `적중률`; English equivalents with
  `--lang en`), a sentence with a negation (`높지 않`, `낮`, `차이가 없`) or a condition ahead of the match
  (`면`) does not count; the raw count of the pre-registered list is reported beside it, after minus before,
  case-clustered bootstrap, pass iff the 95% upper bound is below 0. C2: results calling a level strong,
  firm or heavy (`강한|강력한|견고한|두터운` + `지지|저항`, in the summary or a level reason), the same test;
  the broad wording (`핵심`, `중요한`) is reported beside it. Both are `null` below 90% paired cases. The
  mode also decides F1, F2, L1 and V1 as `output` mode does and O1 with the WP-18 bound (median
  output-token ratio at most 1.05). Needs `--set`, `--skills`, `--run` and `--before`.
- **`zone`.** For each plan of a run: the position under the 1% tolerance (WP-15), under exact edges
  (`zoneLow <= close <= zoneTop`) and as stored, the geometry of the close for the plans the tolerance
  calls `in_zone` (strictly inside, at the top, at the low, within the 1% band above or below), the
  distance above the top and the zone width in ATR, and the share of plans whose prose reads as a
  pullback plan (`되돌림|눌림|조정 시|조정을|조정이|조정 후|지지 확인 후|대기`, English with `--lang en`) by group. Gates: **Z1**
  the stored state equals the exact rule, `in_zone` is inside the edges and the labeller's approach
  `inside` agrees (100% of each; needs `labels.jsonl` for the last part); **Z2** (with `--before`) the share of exact-edge `in_zone` plans written as pullbacks is no higher in the after arm than in the before arm, same regex and rule, on the paired cases (null below 90% paired); **N3** no position above 85% of the headline rows (stored
  positions, or exact ones with `--restate exact`), `in_zone` reported with its interval; **N2** (with
  `--before`) the share of plans whose first target is at least 1 ATR above the zone top does not fall by
  more than 5 pp. `n1Sample` lists the 40 cases the manual read (N1) takes: 15 `in_zone`, 15 `above_zone`
  within 0.5 ATR, 10 others, by smallest `sha256(caseId|group)`.

## Weekly bars and the higher-timeframe block (WP-19)

`run.ts --timeframe <tf>` analyses every case at `tf` (default `1Day`, the set's own); the
timeframe is part of the run identity and `run.json` records it (a run made before WP-19 has none
and counts as `1Day`). `--timeframe` accepts only what core's `TIMEFRAMES` lists (`1Week` since
WP-19 core-1), so a value core does not know is refused and a weekly run never silently becomes a
daily one. The modes below take the same `--timeframe` and fail the same way. A render at a
timeframe a tier may not open (free at `1Week`) turns the timeframe gate off for that tier only, so
the free prompt (skill cap) is still measured.

```bash
# gates of the weekly and higher-timeframe work, all offline (no model call, no network)
npx tsx scripts/replay/analysisFieldsEval.ts --mode htf --set <set> --skills <app>/skills --out <dir> \
  --timeframe 1Day|1Week [--tier free|member] [--limit N] [--baseline <earlier htf out dir>] \
  [--benchmark-bars <dir>] [--run <run of this timeframe>] --gate W1,W2,H1,H4
npx tsx scripts/replay/analysisFieldsEval.ts --mode weekly-hygiene --set <set> --skills <app>/skills --out <dir> \
  [--run <weekly run> --before <daily run>] --gate K1,K2,K3
npx tsx scripts/replay/analysisFieldsEval.ts --mode htf-forward --set <set> --out <dir> [--stride N] --gate M1
```

Which gates a PR runs, and what each can compute today:

| Gate | Needs | Computable |
|---|---|---|
| H2a (`1Day` render byte-identical to `main`) | `--baseline` = an `htf --timeframe 1Day` output made by other code (a differing code diff or skills is enough) | now |
| M1 (wording gate of "no measured forward edge") | `htf-forward` | now |
| W1, W2, K1, K3 (weekly bars, unfinished week, hygiene) | core-1 | now (core-1). W2 and the pivot clause of K1 use the replay's KR session, which has no KRX holiday calendar (N3/N24), so a KR week with a holiday or the year-end closure fails them; the US cases are the exact check |
| K2 (`riskLevel` equals the daily one) | a weekly and a daily **run** (a render has no model answer); `--run`/`--before` | after core-1 and a run |
| H1, H4 (block values, US backdrop), H2b (renders with the two registered blocks cut equal the core-1 render) | core-2; H2b needs `--baseline` = a core-1 `htf` output with the same `--skills` | after core-2 |
| H1b (the attached `higherTimeframe` reading) | a run of the timeframe | after core-2 and a run |
| H4k (Korean backdrop) | `--benchmark-bars <dir>` with `KS11.json` **and** `KQ11.json` stored-bars files | only when those exist (none are fetched: decision of 2026-11-22) |

**`--gate all` resolves per input.** It selects the gates this input can decide: W1 and W2 only at
`--timeframe 1Week`, H1b only with `--run`, H2a and H2b only with `--baseline`, H4k only when both
index files are supplied, K2 only with `--run` and `--before`. What it leaves out is printed and
written as `deferred: [{id, reason}]` to `run.json` and `summary.json`; H4k reads
`no KR index bars (orchestrator decision 2026-11-22; final combined A/B)` and rejoins `all` by
itself once `--benchmark-bars` supplies both files. Naming a gate in `--gate H4k` still computes it
and exits 2 when it cannot.

**H2a and H2b are chosen by stage.** A render that carries the two registered blocks (any sample
whose stripped hash differs from its raw hash) is judged by H2b and H2a is deferred
(`render carries the registered blocks: H2b applies`); a render without them is judged by H2a and
H2b is deferred (`identical to H2a before the blocks exist`). Otherwise one of the two would fail
every correct run. H2b is also not computable (`null`) against a baseline that already carries the
blocks, since a cut render cannot equal it; `rows.jsonl` records the stripped hash of every sample
so the baseline's stage can be read back.

**A baseline is refused when it was made by the same code.** `htf` records `coreGitSha`,
`dirtyDiffSha256` and `skillsSha256` in `run.json`. `--baseline` reads them back, refuses an output
whose whole identity (`coreGitSha`, `dirtyDiffSha256` and `skillsSha256`) equals the current run's
(an identity check of a render against itself passes whatever the change did) or that records none;
a change of the skills alone is a different identity and is allowed, and prints both identities beside H2a and H2b (in the
log and in the gate's `value`). The stable half is compared byte for byte and fails on its own when
the skills differ.

**H4 applies at `1Week` too.** The brief (§4.3, §9.2) builds the backdrop from the benchmark's
daily bars in `runAnalysis` for every analysis timeframe and lists H4 for `1Day` and `1Week`
renders; nothing there omits it on weekly. A weekly analysis prints the same backdrop block (the
symbol's daily series comes from `fearGreedBars`), so H4 is computed on whatever timeframe is
rendered and tested at `1Week`.

`htf --self-check` renders twice in one process and reports how many samples hash alike
(`summary.htf.selfCheck`, and a log line). It is a reported figure, never a gate: a difference means
an identity gate against another process's render would be noisy.

How the gates are built (TE-16):

- Every figure is recomputed in `htfEvalCompute.ts` from the set's stored bars with the
  instrument's own aggregation, EMA, ATR, RSI and SMA. `computeAnalysisTrend`,
  `aggregateBarsToWeekly` and the prompt builders are never called to produce a reference; the
  tests cross-check the instrument's functions against them on seeded series (all three trend
  labels, weekly and monthly OHLCV). The one exception is M1, which asks whether the claim holds
  for what the engine prints, so it injects the shipped functions.
- A gate over a population (every case at both tiers) is not computable until every sample was
  judged: a case with no later stored bar, a period still open at the end of the stored bars (its
  session total is unknown: this includes a short stored month), a prompt whose block cannot be
  found or has a line the readers do not know, a missing baseline row. It exits 2.
- W1 checks the printed rows (the last 26 weeks) and the figures that depend on the whole weekly
  series in `## Long-term Context`: the bar count, the period high and low with their bar dates and
  the first-to-last return. A Korean price must equal the instrument's own tick-rounded value
  exactly, not lie within a tick of it.
- The prompt forms the readers expect are the design's registered text (WP-19 §3.4, §4.4;
  `htfEvalPrompt.ts`). A core PR that words a block differently changes the reader in the same
  PR.
- K1 registers the daily-only sentences in `htfEvalWeekly.ts` (`DAILY_ONLY_PATTERNS`), including
  the WP-18 core-3 base-rate text: `- Measured on this engine (`, `[Measured: ...]`,
  `[Measured over every ...]`, `[Not measured on intraday bars]`, `- Not measured on intraday bars.`,
  the two base-rate writing-rule sentences and the two level-hold framing sentences. Core-1 decided
  the weekly wording: one label (`unmeasuredBarsLabel`) makes the same sentences say `weekly` on a
  weekly chart and `intraday` elsewhere, so K1 also fails any "not measured on X bars" sentence
  whose X is not weekly (`unmeasuredNamesOtherBars`) and the intraday confluence reliability
  sentence. A bare `intraday` match was dropped: 1,056 weekly prompts carry the word inside the
  siglens skills' own prose, which core does not write. The VWAP clause matches the session VWAP
  (`\bVWAP\b`), not the anchored `AVWAP (swing high|low)` levels, and the pullback clause matches
  the printed block header at a line start, not a skill's prose that names it. The pivot clause compares every printed pivot with the last finished week and K1
  is not computable when no pivot was printed anywhere (the lists are filtered by distance). Fear &
  Greed must be printed and equal the daily render's; its absence is allowed only below 260 daily
  bars of history (the set's own selection rule; every case of set v1 prints one).
- H2a compares raw hashes. H2b strips exactly the two registered blocks and compares the stripped
  hash with the earlier render's raw hash; `rows.jsonl` holds the raw and the stripped hash of
  every sample, and the stable half is compared separately and must be identical.
- M1 gates **two cells**: aligned bullish and aligned bearish, each against the all-day mean, with
  a week-clustered 95% interval; it passes when neither interval clears 1 pp in the textbook
  direction (a bound of exactly 1 pp is inside). This is narrower than "agreement has no edge".
  The other seven cells and two paired contrasts (daily bullish: weekly bullish minus weekly
  bearish; daily bearish: weekly bearish minus weekly bullish) are reported, not gated. On set v1
  the aligned-bearish excess is +0.31 pp against the brief's +0.00 pp: the brief's script used
  approximate full-series EMA and ATR seeds, this run uses the shipped functions on each day's own
  window.
- `--benchmark-bars <dir>` adds `<SYMBOL>.json` stored-bars files (`KS11`, `KQ11`) next to the
  set's own SPY. The renderer serves them to the call behind the same `asOf` barrier and passes
  the `benchmark` option of the case's market; core ignores the option until WP-19 core-2. With
  benchmarks the stored provider serves the case's own bars only for the case's own symbol and
  throws for any other symbol it was not given.
- Unfinished week: the set keeps 20 bars after every case, so whether a later session of the
  week exists and how many sessions the week had are read from those bars, not from a calendar.
  A week with an unscheduled closure the calendar does not know (a special closure day) has fewer
  stored sessions than core's calendar total: W2 can report a mismatch for that class of week, and
  the instrument counts what traded. The Korean exchange's special days (N3/N24) are the known
  case.
- Set v1 has 131 Korean cases (106 `.KS`, 25 `.KQ`) of 838, not 167; the brief's figure counted
  differently. H4k's population is those 131 cases at both tiers.
