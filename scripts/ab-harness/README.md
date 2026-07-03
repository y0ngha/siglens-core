# A/B Prompt Quality Harness

Proves, before the digest-only skill loader ships, that analyses built from
**digest** prompts are `>=` analyses built from **full-body** prompts on a
blind AI-judge rubric. Implements plan Task 2.5
(`docs/superpowers/plans/2026-07-03-prompt-size-quality-redesign.md`, spec
§3.6 `docs/superpowers/specs/2026-07-03-prompt-size-quality-redesign-design.md`).

All 3 stages are plain `npx tsx` scripts — nothing here runs in CI or in the
regular `vitest` gate; it's a manual pre-merge quality check.

## How the two variants are built

Both modes go through the REAL production `FileSkillsLoader` for every
skill field (`name`/`category`/`gating`/`tokenCost`/`confidenceWeight`) — only
`content` differs:

- **digest** mode: `content` = the current production `PROMPT_DIGEST` section
  (what `loader.ts` injects today).
- **full** mode: `content` = the skill's full body with the `PROMPT_DIGEST`
  block (markers included) stripped back out — reconstructing exactly what
  production injected **before** the digest work landed.

See `skillCatalog.ts` for the implementation (`stripDigestBlock`,
`loadSkillCatalog`).

## Fixtures

`fixtures/*.json` — 8 frozen cases, generated deterministically (no
`Math.random()`, see `fixtures/generate.ts`) so re-running the generator
reproduces byte-identical files:

| caseId | Scenario |
|---|---|
| `tech-trend` | Clean uptrend (AAPL) |
| `tech-range` | Sideways/range-bound chop (MSFT) |
| `tech-highvol` | High-volatility whipsaw (TSLA) |
| `tech-lowliq` | Thin, low-volume drift, small-cap (GEVO) |
| `tech-pattern-hs` | Head-and-shoulders forming near the end (NVDA) |
| `tech-pattern-doubletop` | Double top forming near the end (AMD) |
| `news-earnings` | Earnings-beat scenario, analyst upgrades (NFLX) |
| `news-macro` | Macro-shock / rate-hike sector selloff (INTC) |

Regenerate the technical fixtures with:

```bash
npx tsx scripts/ab-harness/fixtures/generate.ts
```

(News fixtures are hand-authored prose, not generated.)

## Run sequence

```bash
# 1. Build prompts for both variants (repeat with --mode digest).
#    --skills defaults to ../siglens-digests/skills (sibling of this repo);
#    point it at the real production catalog, e.g.:
npx tsx scripts/ab-harness/buildPrompts.ts --mode full   --out /tmp/prompts-full.json   --skills ../siglens/skills
npx tsx scripts/ab-harness/buildPrompts.ts --mode digest --out /tmp/prompts-digest.json --skills ../siglens/skills

# 2. Run both prompt sets through the production default analysis model
#    (gemini-2.5-flash-lite — resolved from the siglens frontend's
#    useSelectedModel DEFAULT_MODEL, NOT infrastructure/cache/config.ts's
#    DEFAULT_ANALYSIS_MODEL_ID, which is just a cache-key placeholder string).
GEMINI_API_KEY=... npx tsx scripts/ab-harness/runModels.ts --in /tmp/prompts-full.json   --out /tmp/results-full.json
GEMINI_API_KEY=... npx tsx scripts/ab-harness/runModels.ts --in /tmp/prompts-digest.json --out /tmp/results-digest.json

# 3. Blind-judge both result sets with Claude Opus and generate the report.
ANTHROPIC_API_KEY=... npx tsx scripts/ab-harness/judge.ts --a /tmp/results-full.json --b /tmp/results-digest.json --out /tmp/report.md
```

`--a`/`--b` may be passed in either order — each result's own `mode` field
(written by `runModels.ts`) determines which is `full` and which is
`digest`, not the flag name or file name.

## Env vars

| Var | Used by | Required |
|---|---|---|
| `GEMINI_API_KEY` | `runModels.ts` | Yes — fails fast with a clear message if unset. |
| `ANTHROPIC_API_KEY` | `judge.ts` | Yes — fails fast with a clear message if unset. |

## Pass criteria (spec §3.6)

`judge.ts` scores every case on 4 axes (1-5): `dataGroundedness`,
`hallucinationFreedom`, `actionability`, `patternJudgmentAccuracy`, blind
(labels A/B are assigned deterministically per caseId, not
`Math.random()`), then unblinds and averages per variant per axis.

**PASS** iff, on **every** axis:

1. `digest_mean >= full_mean - 0.1` (a small tolerance — digest doesn't have
   to beat full, just not meaningfully trail it), **AND**
2. `full_mean - digest_mean <= 0.25` (belt-and-braces: catches a case that
   technically clears the floor but is still a real regression).

The generated `report.md` prints the per-axis full/digest means, the delta,
and the `ok`/`NO` verdict for each axis transparently, plus a final
`PASS (digest >= full)` / `FAIL` line.

## Cost note

Each full run makes: 8 Gemini calls x 2 variants (`runModels.ts`) + 8 Opus
judge calls (`judge.ts`) = 24 model calls total. Gemini 2.5 Flash Lite calls
are cheap; the 8 Opus judge calls are the dominant cost (full-body prompts in
particular can run into the hundreds of KB, so budget accordingly before
running against a real API key). No network call is made by any script until
the corresponding API key env var is confirmed present — a missing key fails
fast with zero cost.
