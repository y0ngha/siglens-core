import {
    DEFAULT_ANALYSIS_LOCALE,
    type AnalysisLocale,
} from '@/domain/analysis/outputLocale';
import type {
    DashboardTimeframe,
    MarketSessionSpec,
    NewsFeedCategory,
    OptionsExpirationFilter,
    PositionBucket,
    StatementPeriod,
    Timeframe,
} from '@/domain/types';
import {
    SECONDS_PER_DAY,
    SECONDS_PER_HOUR,
    SECONDS_PER_MINUTE,
} from '@/domain/constants/time';
import {
    computeSecondsUntilCacheExpiry,
    secondsUntilNextEtRegularOpen,
} from '@/domain/utils';
import { isRegularSessionOpen, US_EQUITY_SESSION } from '@/domain/session';

/**
 * @internal TTL for cached market briefings (in seconds).
 *
 * Set to one hour so all callers within a given hour share a single AI
 * briefing for the same dashboard summary. The briefing cache key
 * incorporates the ISO date+hour, so rollover happens automatically.
 */
export const MARKET_BRIEFING_CACHE_TTL = SECONDS_PER_HOUR;

/** @internal 1시간봉 섹터 시그널 캐시 TTL(분) — 데이터 갱신 주기에 맞춤. */
export const SECTOR_SIGNALS_1HOUR_TTL_MINUTES = 15;
/** @internal 15분봉 섹터 시그널 캐시 TTL(분) — 데이터 갱신 주기에 맞춤. */
export const SECTOR_SIGNALS_15MIN_TTL_MINUTES = 5;

/** @internal 타임프레임별 섹터 시그널 캐시 TTL(초) 매핑. */
export const SECTOR_SIGNALS_TTL_BY_TIMEFRAME: Record<
    DashboardTimeframe,
    number
> = {
    '1Day': SECONDS_PER_HOUR,
    '1Hour': SECTOR_SIGNALS_1HOUR_TTL_MINUTES * SECONDS_PER_MINUTE,
    '15Min': SECTOR_SIGNALS_15MIN_TTL_MINUTES * SECONDS_PER_MINUTE,
};

/**
 * @internal Per-timeframe TTL (seconds) for cached symbol analyses.
 *
 * Keyed by {@link Timeframe} — shorter timeframes get shorter TTLs so
 * stale results never stay cached longer than the underlying bar
 * resolution. {@link computeEffectiveTtl} clamps these values further when
 * the daily KST cache-expiry boundary is approaching.
 */
export const ANALYSIS_CACHE_TTL: Record<Timeframe, number> = {
    '5Min': 5 * SECONDS_PER_MINUTE,
    '15Min': 15 * SECONDS_PER_MINUTE,
    '30Min': 30 * SECONDS_PER_MINUTE,
    '1Hour': SECONDS_PER_HOUR,
    '4Hour': 4 * SECONDS_PER_HOUR,
    '1Day': SECONDS_PER_DAY,
};

/**
 * @internal Daily cache-expiry boundary in KST hours (24-hour clock).
 *
 * KST 05:00 = UTC 20:00 (prev day) = EDT 16:00 — aligned with U.S.
 * regular-session close so cached analyses expire as the final price is
 * printed, and the next request after close receives fresh results.
 *
 * @remarks
 * **Known asymmetry vs the usage day boundary.** The analysis cache rolls over
 * at KST 05:00 (= UTC 20:00 of the previous calendar day), but the daily usage
 * counter in {@link hashUsageIp} (`infrastructure/usage/hash.ts`) buckets by
 * UTC `YYYY-MM-DD`, i.e. it rolls over at UTC 00:00. This produces a 4-hour
 * window each day where new requests hit fresh cache (post-close) but still
 * count against the *previous* UTC usage day (until UTC 00:00 ticks over).
 * Aligning the two boundaries requires a stakeholder decision on which axis to
 * move; until then this comment is the documented source of truth.
 */
export const CACHE_EXPIRY_HOUR_KST = 5;

/**
 * @internal Compute the effective analysis-cache TTL for a given timeframe at `now`.
 *
 * Returns the smaller of:
 * - `ANALYSIS_CACHE_TTL[timeframe]` — the static per-timeframe ceiling.
 * - Seconds remaining until the next `CACHE_EXPIRY_HOUR_KST` boundary —
 *   ensures cached results don't survive into the next trading day.
 *
 * @param timeframe - Bar resolution.
 * @param now - The "now" reference; useful in tests.
 * @returns Effective TTL in seconds.
 */
export function computeEffectiveTtl(timeframe: Timeframe, now: Date): number {
    return Math.min(
        ANALYSIS_CACHE_TTL[timeframe],
        computeSecondsUntilCacheExpiry(now, CACHE_EXPIRY_HOUR_KST)
    );
}

/** @internal Cache TTL (seconds) for bars during a regular NYSE session (09:30–16:00 ET). */
export const BARS_OPEN_TTL_SECONDS = SECONDS_PER_MINUTE;
/** @internal Max cache TTL (seconds) for bars outside a regular session; caps "time until next open" when the next session is >24h away. */
export const BARS_OFFHOURS_TTL_CEILING_SECONDS = SECONDS_PER_DAY;

/**
 * Computes the effective cache TTL (seconds) for bars (OHLCV + indicators) at `now`.
 *
 * - During regular session: 60 s (`BARS_OPEN_TTL_SECONDS`) — the last bar is
 *   still forming; stale data must not survive past the next bar's close.
 * - Off-hours / weekends: `min(BARS_OFFHOURS_TTL_CEILING_SECONDS, seconds until next open)` —
 *   completed bars do not change until the next session opens, so the cache can
 *   survive exactly until that boundary.
 *
 * Unlike the analysis-cache TTL policy (which clamps to the session **close**
 * boundary), this function uses the session **open** boundary.
 *
 * **ET-only limitation**: the off-hours fallback (`secondsUntilNextEtRegularOpen`)
 * is hard-wired to the US Eastern Time schedule. Currently only
 * {@link US_EQUITY_SESSION} and {@link CRYPTO_SESSION} (which short-circuits to
 * `BARS_OPEN_TTL_SECONDS`) are fully supported; a spec for another timezone would
 * need a spec-driven next-open calculation in the off-hours fallback.
 *
 * @param _timeframe - Bar resolution. Currently all timeframes share the same policy;
 *   the parameter is kept for signature consistency with the analysis-cache TTL helper.
 * @param now - Reference time for market-session detection. Pass explicitly for
 *   deterministic testing.
 * @param session - Market session schedule determining open vs off-hours TTL.
 *   Defaults to US_EQUITY_SESSION; pass CRYPTO_SESSION for 24/7 assets (always
 *   returns BARS_OPEN_TTL_SECONDS). Off-hours fallback timing is ET-based; a
 *   non-ET scheduled spec would fall back to ET next-open timing.
 * @returns Effective TTL in seconds.
 */
export function computeBarsEffectiveTtl(
    _timeframe: Timeframe,
    now: Date,
    session: MarketSessionSpec = US_EQUITY_SESSION
): number {
    // Fast path: 24/7 assets are always open; skip the getSessionStatus/isRegularSessionOpen call chain.
    if (session.kind === 'always-open') return BARS_OPEN_TTL_SECONDS;
    if (isRegularSessionOpen(session, now)) return BARS_OPEN_TTL_SECONDS;
    return Math.min(
        BARS_OFFHOURS_TTL_CEILING_SECONDS,
        secondsUntilNextEtRegularOpen(now)
    );
}

/** @internal Fallback model identifier used in cache keys when no specific model is tracked. */
export const DEFAULT_ANALYSIS_MODEL_ID = 'analysis-worker';

/**
 * @internal Cache-key suffix for the per-request reasoning ("deep-thinking")
 * toggle (member-reasoning-toggle spec, Part A). Reasoning ON and OFF produce
 * materially different LLM output for the same inputs, so the two must never
 * share a cache entry — but OFF must stay indistinguishable from the
 * pre-toggle keyless behavior so existing cached entries and SSR peeks that
 * omit `reasoning` keep hitting the same key. Only `true` appends a suffix;
 * `false` and `undefined` are treated identically (no suffix), matching the
 * existing `skillFingerprint`-style "append only when supplied" convention
 * used throughout this file.
 */
function reasoningKeySuffix(reasoning?: boolean): string {
    return reasoning === true ? ':reason=on' : '';
}

/**
 * @internal Cache-key suffix for the AI **output language**.
 *
 * 같은 심볼·타임프레임·모델이라도 언어가 다르면 산출물이 다르므로 캐시를
 * 공유하면 안 된다 — 한국어 결과가 `/en` 요청에 그대로 나간다.
 *
 * `reasoningKeySuffix`와 같은 규약을 쓴다: **기본 로케일(ko)은 접미가 없다.**
 * 이 기능이 들어오기 전 키와 바이트가 같아야 이미 쌓인 한국어 캐시가 전부
 * 살아 있고, 로케일을 넘기지 않는 기존 호출부·SSR peek도 같은 키를 맞힌다.
 */
function localeKeySuffix(locale?: AnalysisLocale): string {
    return locale === undefined || locale === DEFAULT_ANALYSIS_LOCALE
        ? ''
        : `:lang=${locale}`;
}

/**
 * @internal Cache-key suffix for the member position-bucket hint
 * (personalized-analysis-by-position-bucket spec, Subsystem C). A member's
 * unrealized-P&L band (see {@link PositionBucket} / `bucketizePosition`)
 * personalizes the prompt, so a bucketed request must never share a cache
 * entry with the base (no-bucket) request or with a different bucket — but
 * omitting the bucket must stay indistinguishable from the pre-feature
 * keyless behavior so existing cached entries and SSR peeks that omit
 * `positionBucket` keep hitting the same key. Only a defined bucket appends a
 * suffix; `undefined` is a no-op, matching the `reasoningKeySuffix` "append
 * only when supplied" convention.
 */
function positionKeySuffix(bucket?: PositionBucket): string {
    return bucket ? `:pos=${bucket}` : '';
}

/**
 * @internal
 * Fixed model identifier for the market briefing. Core owns this choice and
 * sends it on the dispatch body; it is also folded into the briefing cache key
 * so a model change misses the old cache.
 */
export const BRIEFING_MODEL_ID = 'deepseek-v4-flash' as const;

/**
 * Prompt-template version folded into the technical and fundamental analysis
 * cache keys.
 *
 * This is a **separate invalidation axis** from {@link CACHE_KEY_SCHEMA_VERSION}:
 * the schema version tracks the cached *response shape*, while this tracks the
 * *prompt template* fed to the LLM. The technical/fundamental keys carry no
 * input/prompt hash (unlike news/overall, which fold a skill fingerprint into
 * their input hash), so without this lever editing a prompt template would not
 * invalidate already-cached analyses until the TTL elapsed.
 *
 * Bump this string whenever a technical or fundamental prompt template changes
 * in a way that would make previously cached results stale. Old keys (e.g.
 * `p1`) are simply never looked up after a bump and naturally expire via TTL.
 *
 * @remarks
 * **Distinct from the skill-catalog fingerprint axis.** The chart and
 * fundamental keys also carry an optional `skillFingerprint` segment (see
 * {@link buildAnalysisCacheKey} / `hashSkillCatalog`). That fingerprint folds the
 * *entire loaded catalog's* selection metadata (every skill's
 * `name`/`gating`/`tokenCost`), so editing the frontmatter of ANY single skill
 * changes the fingerprint and therefore busts the chart + fundamental cache for
 * EVERY symbol and timeframe at once — opening a cold-cache window (a burst of
 * regeneration / LLM cost) after any skill edit until the cache re-warms. This is
 * a separate invalidation axis from this `PROMPT_TEMPLATE_VERSION` string: bump
 * this lever for prompt-template wording changes; the skill-fingerprint axis
 * moves automatically on any skill-frontmatter edit. Stage skill edits with that
 * fleet-wide cold-cache cost in mind.
 *
 * @remarks
 * **`p2` = PROMPT_DIGEST activation.** This version was bumped when
 * `skill.content` switched from the full skill body to the condensed
 * `PROMPT_DIGEST` section, since that changes the prompt bytes sent to the
 * LLM and therefore must invalidate previously cached results.
 *
 * @remarks
 * **`p3` = selection-engine activation (spec §3.2).** This constant covers the
 * technical AND fundamental keys, and both templates' bytes change: the
 * technical prompt gains the category/type whitelist, the core/selected split
 * (always_on core first, fired skills relevance-ordered after), and fail-closed
 * gating; the fundamental prompt's skills are now name-sorted by the shared
 * selector instead of catalog order.
 *
 * @remarks
 * **`p4` = stable/dynamic assembly split, Design C ("skills-to-system
 * split", spec §3.4).** Both `buildAnalysisPrompt` (technical) and
 * `buildFundamentalAnalysisPrompt` now return `AssembledPrompt { stable,
 * dynamic }` instead of a single string; `stable` carries ONLY the
 * `always_on` skill digests (moved out of the user prompt into the system
 * prompt), and `dynamic` is the ENTIRE rest of the prompt in the same,
 * unchanged production order — the intent/guidelines/guardrail sections and
 * every other user-prompt section keep their original position. The
 * fingerprint only covers skill metadata (`{name, gating, tokenCost}`), so
 * relocating the skill digests changes prompt bytes without changing that
 * fingerprint, requiring a manual bump per the versioning policy (spec §4).
 *
 * @remarks
 * **`p5` = output-rules prose dedup (spec §3.5), TECHNICAL ONLY this round.**
 * `buildAnalysisRequest` (in `prompt.ts`, feeding `buildAnalysisPrompt`) drops
 * several field-by-field prose enumerations that only restated what
 * `TECHNICAL_RESPONSE_SCHEMA` already enforces (required-ness, the `"skill"`
 * literal enum, the trend enum) — see that function's inline comments for the
 * exact deleted/kept lines. Behavioral rules the schema cannot express (bias
 * mapping for non-detected patterns, the neutral fallback, cross-field name
 * matching, Korean/content constraints) and the minimal "respond with a single
 * JSON object" directive are kept verbatim. `buildFundamentalAnalysisPrompt`
 * has its own, separate output-rule prose (not shared with
 * `buildAnalysisRequest`) and was NOT touched this round, so its bytes are
 * unchanged — unlike `p3`/`p4`, which changed both templates. Bumping this
 * shared constant still cold-starts the fundamental cache as a side effect of
 * the shared invalidation axis; that is accepted per spec §4's "per-PR
 * warm-cache cold start is acceptable" policy, not a sign that the
 * fundamental template changed.
 *
 * @remarks
 * **`p6` = free-tier skill sampling (free-analysis-tier-gating spec).** The
 * loaded skill catalog is now deterministically sampled per tier before
 * assembly (`sampleSkillsForTier` via `createSkillSamplingPlan`): free-tier
 * requests cap each skill-type group to at most 3 skills, changing which
 * skills' digests reach both the technical AND fundamental prompts. Callers
 * now pass `${tier}:${sampledSkillFingerprint}` as the `skillFingerprint`
 * segment (see {@link buildAnalysisCacheKey} / {@link buildFundamentalCacheKey}),
 * so free and non-free requests, and different sampled subsets, never share a
 * cache entry. Bumped to invalidate warm caches carrying pre-tier-gating
 * (unfiltered) content.
 *
 * @remarks
 * **`p6` did NOT bump for the member position-bucket hint's *introduction***
 * (personalized-analysis-by-position-bucket spec, Subsystem C). When the hint
 * was first added it only *appended* a distinct `:pos=<bucket>` segment (see
 * {@link buildAnalysisCacheKey} / `positionKeySuffix`) that was never written
 * before, so it landed on a brand-new key namespace — no previously-cached
 * entry became stale, and the no-bucket path stayed byte-identical to the
 * pre-feature key. Bumping then would have needlessly cold-started the entire
 * warm cache (every symbol/timeframe/model, anonymous included) for zero
 * correctness gain.
 *
 * @remarks
 * **`p7` = position-hint reframed to position-management (Subsystem C
 * follow-up).** `formatPositionHintSection` was strengthened from a single
 * passive "참고: … 구간에 있습니다." reference line into an instructive holder /
 * position-management framing (보유자 관점 — 보유 지속 / 부분 익절 / 추가매수 / 손절
 * 규율 시나리오). This changes the technical prompt's bytes for EVERY bucketed
 * request, so — unlike the hint's introduction above — warm bucketed entries
 * carrying the old passive line MUST be invalidated. The bump is shared by the
 * technical AND fundamental cache keys AND the SSR peek path, so it also
 * cold-starts non-bucketed and fundamental entries as a side effect; that
 * fleet-wide re-warm is accepted per the versioning policy (no way to scope the
 * lever to only the `:pos=*` namespace). Still bucket-qualitative (no digits)
 * and disclaimer-safe — see `positionHintSection.ts`.
 *
 * @remarks
 * **`p8` = pure-Korean output rule + holder-consistent position framing.** Two
 * technical-prompt byte changes ship together: (1) `buildAnalysisRequest` (in
 * `prompt.ts`) gains a STRICT output-language rule forbidding 한자(漢字)/Chinese
 * characters in Korean prose (all fields must be pure Hangul), fixing observed
 * Sino-Korean 한자 leakage (e.g. `附近` → `부근`); and (2)
 * `formatPositionHintSection` is reframed from the p7 parallel "보유자는… /
 * 신규 진입자는…" hedge to a holder-CONSISTENT framing — the reader is treated
 * as the holder throughout, the conclusion/strategy leads with an explicit
 * holder opener ("현재 '<구간>' 구간에 계신 보유자 관점에서"), and position
 * management is the primary frame with new-entrant commentary demoted to brief
 * secondary. Rule (1) changes the technical prompt bytes for EVERY request (not
 * just bucketed ones); rule (2) changes them for bucketed requests. The bump is
 * shared by the technical AND fundamental cache keys AND the SSR peek path, so
 * warm entries carrying the old bytes are invalidated fleet-wide; that re-warm
 * is accepted per the versioning policy. Still bucket-qualitative (no digits)
 * and disclaimer-safe — see `positionHintSection.ts`.
 *
 * @internal
 */
export const PROMPT_TEMPLATE_VERSION = 'p8' as const;

/**
 * @internal Build the Redis key for a cached symbol (technical) analysis.
 *
 * Format: `analysis:<symbol>:<timeframe>:<modelId>:<promptVersion>`. Symbol is
 * used verbatim — pass the canonical uppercase form. Including the model
 * identifier ensures results from different AI models are cached independently;
 * the trailing {@link PROMPT_TEMPLATE_VERSION} segment invalidates the cache
 * when the technical prompt template changes.
 *
 * The optional `skillFingerprint` segment (a hash of the skill catalog's
 * selection metadata, see `hashSkillCatalog`) folds the active skill catalog
 * into the key: changing the gating frontmatter or the set of injected skills
 * busts the cache instead of serving a stale analysis for the full TTL. It is
 * appended only when supplied, so callers that do not load skills keep the
 * legacy key shape.
 *
 * @param symbol - U.S. equity ticker.
 * @param timeframe - Bar resolution.
 * @param modelId - LLM model identifier. Defaults to {@link DEFAULT_ANALYSIS_MODEL_ID}
 *   so existing callers that do not pass a model remain backward-compatible.
 * @param skillFingerprint - Optional hash of the skill catalog's selection
 *   metadata. When provided, appended as the final key segment.
 * @param reasoning - Per-request deep-thinking toggle (member-reasoning-toggle
 *   spec, Part A). `true` appends a distinct `:reason=on` suffix so reasoning
 *   ON never collides with the OFF result; `false`/`undefined` produce the
 *   exact same key as omitting the parameter entirely (backward compatible).
 * @param positionBucket - Member position-bucket hint
 *   (personalized-analysis-by-position-bucket spec, Subsystem C). When
 *   supplied, appends a distinct `:pos=<bucket>` suffix AFTER the reasoning
 *   suffix so each bucket (and the base/no-bucket request) reads/writes a
 *   distinct cache entry; `undefined` produces the exact same key as omitting
 *   the parameter entirely (backward compatible — this is the v1 scope: only
 *   the technical/chart analysis key composes this axis, see the spec's
 *   cross-repo split).
 * @param locale - AI output language. Omit (or pass the default `ko`) to get
 *   the exact key this builder produced before the parameter existed, so the
 *   Korean cache stays valid; other locales append `:lang=<locale>`.
 * @returns The cache key.
 *
 * @example
 * ```ts
 * const key = buildAnalysisCacheKey('AAPL', '1Day', 'gemini-2.5-flash');
 * // → 'analysis:AAPL:1Day:gemini-2.5-flash:p1'
 * const keyed = buildAnalysisCacheKey('AAPL', '1Day', 'gemini-2.5-flash', 'a1b2');
 * // → 'analysis:AAPL:1Day:gemini-2.5-flash:p1:a1b2'
 * const reasoned = buildAnalysisCacheKey('AAPL', '1Day', 'gemini-2.5-flash', 'a1b2', true);
 * // → 'analysis:AAPL:1Day:gemini-2.5-flash:p1:a1b2:reason=on'
 * const bucketed = buildAnalysisCacheKey('AAPL', '1Day', 'gemini-2.5-flash', 'a1b2', true, 'profit');
 * // → 'analysis:AAPL:1Day:gemini-2.5-flash:p1:a1b2:reason=on:pos=profit'
 * ```
 */
export function buildAnalysisCacheKey(
    symbol: string,
    timeframe: Timeframe,
    modelId = DEFAULT_ANALYSIS_MODEL_ID,
    skillFingerprint?: string,
    reasoning?: boolean,
    positionBucket?: PositionBucket,
    locale?: AnalysisLocale
): string {
    const base = `analysis:${symbol}:${timeframe}:${modelId}:${PROMPT_TEMPLATE_VERSION}`;
    const withFingerprint =
        skillFingerprint !== undefined ? `${base}:${skillFingerprint}` : base;
    return `${withFingerprint}${reasoningKeySuffix(reasoning)}${positionKeySuffix(positionBucket)}${localeKeySuffix(locale)}`;
}

/**
 * @internal Build the Redis key for a cached market briefing.
 *
 * Format: `briefing:market:<dateHour>:<model>:<inputHash>`. The `dateHour`
 * argument is the ISO date+hour prefix (e.g. `"2026-04-26T14"`) so callers
 * within a given hour share a cached briefing; the `model` segment scopes the
 * cache to the briefing model so a model change produces a new key (cache miss)
 * instead of serving a briefing generated by a different model; and `inputHash`
 * folds in a deterministic hash of the index/sector values so changed
 * underlying data within the same hour also produces a new key.
 *
 * Note: `inputHash` must be derived by the library's internal hashing pipeline.
 *   Do not construct or depend on this key format from outside the core
 *   library — the format is an internal implementation detail.
 * @param dateHour - ISO date+hour prefix.
 * @param model - Briefing model identifier scoping the cache.
 * @param inputHash - Short hash of the index/sector values used as prompt input.
 * @returns The cache key.
 */
/**
 * Prompt-template version for the market-briefing cache key.
 *
 * **Why this axis exists.** Sibling keys (`analysis`, `economic-event`,
 * `fundamental`, `financials`) all carry one; market briefing did not, so a
 * prompt change took up to a full TTL (1h) to take effect — within that window
 * a cache HIT returns a response the *old* prompt produced. For the 2026-08-19
 * change that meant English sector tickers and a fabricated VIX number still
 * being served after deploy.
 *
 * Bump whenever `buildMarketBriefingPrompt`'s output changes in a way that
 * would make a previously cached briefing wrong or stale. `p1` is the first
 * version to carry the axis at all.
 *
 * @internal
 */
export const MARKET_BRIEFING_PROMPT_TEMPLATE_VERSION = 'p1' as const;

export function buildBriefingCacheKey(
    dateHour: string,
    model: string,
    inputHash: string
): string {
    return `briefing:market:${dateHour}:${model}:${inputHash}:${MARKET_BRIEFING_PROMPT_TEMPLATE_VERSION}`;
}

/** @internal TTL for cached macro (economy) briefings. dateHour-bucketed. */
export const MACRO_BRIEFING_CACHE_TTL = SECONDS_PER_HOUR;

/**
 * @internal Build the Redis key for a cached macro (economy) briefing.
 *
 * Format: `briefing:macro:<dateHour>:<model>:<inputHash>`. Same bucketing
 * contract as {@link buildBriefingCacheKey} (date+hour share, model scopes,
 * input hash folds in the indicator/calendar snapshot) but a distinct `macro:`
 * namespace so market and economy briefings never collide.
 */
export function buildMacroBriefingCacheKey(
    dateHour: string,
    model: string,
    inputHash: string
): string {
    return `briefing:macro:${dateHour}:${model}:${inputHash}`;
}

/**
 * Prompt-template version for the economic-event AI analysis cache keys.
 *
 * Bump this string whenever the economic-event prompt template changes in a way
 * that would make previously cached results stale. Old keys (e.g. `p1`) are
 * simply never looked up after a bump and naturally expire via TTL.
 *
 * @remarks
 * **`p2` → `p3` (2026-08-19): sentiment 규칙·few-shot·정밀도.** 라벨 규칙이
 * `actual − estimate`의 부호가 아니라 발표의 경제적 의미를 보도록 바뀌었고(옛 규칙은
 * `bearish: … OR …` 비대칭 때문에 금리 인하 서프라이즈와 낮은 CPI를 bearish로
 * 붙였다), few-shot이 반전 지표·`bearish` 라벨·`estimate` 없음까지 덮도록 교체됐으며,
 * 발표치가 2자리 반올림 없이 게시된 자릿수로 들어간다(`4.415`가 `4.42`로 나가던 문제).
 * `p2` 엔트리는 옛 라벨 규칙의 산물이라 서빙하면 안 된다.
 *
 * @remarks
 * **`p1` → `p2` (2026-08-19): region.** The prompt gained a `Region` line, a
 * rule forbidding a United States / Federal Reserve / USD assumption, and a
 * second few-shot in another economy; `region` also entered
 * `hashEconomicEventInput`. Entries cached under `p1` were produced by a
 * US-assuming prompt, so they must not be served — that is what the bump buys.
 *
 * @remarks
 * Two earlier changes deliberately did **not** bump this constant, and the
 * reasoning still holds for them: the `PROMPT_DIGEST` activation (this builder
 * interpolates no `skill.content`) and the stable/dynamic assembly split (spec
 * §3.4 — `stable` is `''` and `dynamic` is byte-identical to the previous
 * plain-string prompt). Both were no-op cache churn; this one is not.
 *
 * @internal
 */
export const ECONOMIC_EVENT_PROMPT_TEMPLATE_VERSION = 'p3' as const;

/**
 * @internal TTL for cached economic-event AI analysis results.
 *
 * Once an event is announced its figures do not change, so a 24-hour TTL is
 * appropriate. Mirrors `FUNDAMENTAL_CACHE_TTL_SECONDS` and siblings.
 */
export const ECONOMIC_EVENT_CACHE_TTL = SECONDS_PER_DAY;

/**
 * @internal Build the Redis key for a cached economic-event AI analysis result.
 *
 * Format: `{version}:analysis:economic-event:<inputHash>:<promptVersion>`.
 *
 * The key folds a deterministic hash of the event identity and announced
 * figures (`EconomicEventAnalysisInput`) so different events and different
 * figure combinations always produce distinct keys. The prompt-version suffix
 * allows prompt-template changes to invalidate the cache independently.
 *
 * Note: `inputHash` must be derived by the library's internal hashing pipeline
 * (`hashEconomicEventInput`). Do not construct this key format externally.
 *
 * @param inputHash - 16-char hex hash of the serialized {@link EconomicEventAnalysisInput}.
 * @returns The cache key.
 *
 * @example
 * ```ts
 * buildEconomicEventCacheKey(hashAnalysisInput(JSON.stringify(input)));
 * // → 'v1:analysis:economic-event:deadbeefdeadbeef:p3'
 * ```
 *
 * Note: In production, `inputHash` is derived via `hashEconomicEventInput(input)`
 * — NOT `hashAnalysisInput(JSON.stringify(input))`. `hashEconomicEventInput`
 * serializes fields in a FIXED order (region → event → impact → actual →
 * estimate → previous → unit) to guarantee a deterministic hash regardless of
 * insertion order. Raw `JSON.stringify` is insertion-order-dependent and must not be used
 * directly to construct this key.
 */
export function buildEconomicEventCacheKey(inputHash: string): string {
    return `${CACHE_KEY_SCHEMA_VERSION}:analysis:economic-event:${inputHash}:${ECONOMIC_EVENT_PROMPT_TEMPLATE_VERSION}`;
}

/** @internal 타임프레임+버킷+종목 목록 기준 섹터 시그널 캐시 키 빌더. */
export function buildSectorSignalsCacheKey(
    timeframe: DashboardTimeframe,
    bucket: string,
    stockListHash: string
): string {
    return `dashboard:signals:${timeframe}:${bucket}:${stockListHash}`;
}

/**
 * Schema version prefix applied to every analysis cache key (fundamental,
 * news, news-card, overall).
 *
 * Bump this string whenever any cached response shape changes; it serves as a
 * global cache invalidation lever — old keys (e.g. `v1:...`) are simply never
 * looked up after a bump and naturally expire via TTL.
 *
 * Examples of what should trigger a bump:
 * - Adding/removing/renaming a field on `FundamentalAnalysisResponse`,
 *   `NewsAnalysisResponse`, `NewsCardAnalysis`, or `OverallAnalysisResponse`.
 * - Changing the semantics of an existing field (units, enum value, etc.).
 *
 * **Exception — additive, runtime-defaulted fields do NOT require a bump.**
 * When a new field is added to a cached response type AND `normalizeFinancialsAnalysisResponse`
 * (or the equivalent normalizer) fills it with a safe default for stale cache reads
 * (e.g. `financialsBulletsKo` defaults to `[]`), a bump is unnecessary.
 * Stale cached entries remain valid because the normalizer repairs the missing field
 * on every read; bumping would flush the entire cache fleet for no correctness gain.
 *
 * @internal
 */
export const CACHE_KEY_SCHEMA_VERSION = 'v1' as const;

/** @internal TTL for fundamental analysis cache results. Default: 24 hours. */
export const FUNDAMENTAL_CACHE_TTL_SECONDS = SECONDS_PER_DAY;
/** @internal TTL for financials (multi-year statement) analysis cache results. Default: 24 hours. */
export const FINANCIALS_CACHE_TTL_SECONDS = SECONDS_PER_DAY;
/** @internal TTL for news analysis aggregate cache results. Default: 24 hours. */
export const NEWS_CACHE_TTL_SECONDS = SECONDS_PER_DAY;
/** @internal TTL for overall (three-axis) analysis cache results. Default: 24 hours. */
export const OVERALL_CACHE_TTL_SECONDS = SECONDS_PER_DAY;
/** @internal TTL for options analysis cache results. Default: 24 hours. */
export const OPTIONS_CACHE_TTL_SECONDS = SECONDS_PER_DAY;

/**
 * Build the Redis key for a cached fundamental analysis result.
 *
 * Format: `{version}:analysis:fundamental:<symbol>:<modelId>:<promptVersion>`.
 *
 * The key is intentionally free of an input hash so that the cache lookup
 * can happen before any FMP data fetch — avoiding 13 parallel API calls on
 * every page load when a warm result already exists. Cache freshness is
 * governed by the 24-hour TTL ({@link FUNDAMENTAL_CACHE_TTL_SECONDS}), the
 * schema-version prefix ({@link CACHE_KEY_SCHEMA_VERSION}) for response-shape
 * changes, and the trailing {@link PROMPT_TEMPLATE_VERSION} segment for
 * prompt-template changes: bump the relevant axis whenever a change would make
 * old cached results incorrect.
 *
 * The optional `skillFingerprint` segment folds the active skill catalog into
 * the key (see {@link buildAnalysisCacheKey}); appended only when supplied so
 * callers that do not load skills keep the legacy key shape.
 *
 * @internal
 * @param symbol - U.S. equity ticker (canonical uppercase).
 * @param modelId - LLM model identifier.
 * @param skillFingerprint - Optional hash of the skill catalog's selection
 *   metadata. When provided, appended as the final key segment.
 * @param reasoning - Per-request deep-thinking toggle (member-reasoning-toggle
 *   spec, Part A). `true` appends a distinct `:reason=on` suffix; `false`/
 *   `undefined` produce the exact same key as omitting the parameter.
 * @param locale - AI output language. Omit (or pass the default `ko`) to get
 *   the exact key this builder produced before the parameter existed, so the
 *   Korean cache stays valid; other locales append `:lang=<locale>`.
 * @returns The cache key.
 */
export function buildFundamentalCacheKey(
    symbol: string,
    modelId: string,
    skillFingerprint?: string,
    reasoning?: boolean,
    locale?: AnalysisLocale
): string {
    const base = `${CACHE_KEY_SCHEMA_VERSION}:analysis:fundamental:${symbol}:${modelId}:${PROMPT_TEMPLATE_VERSION}`;
    const withFingerprint =
        skillFingerprint !== undefined ? `${base}:${skillFingerprint}` : base;
    return `${withFingerprint}${reasoningKeySuffix(reasoning)}${localeKeySuffix(locale)}`;
}

/**
 * Prompt-template version for the financials (multi-year statement) analysis cache keys.
 *
 * Parallel to {@link PROMPT_TEMPLATE_VERSION} but scoped to the financials analysis type
 * so that prompt-template changes for financials can be invalidated independently
 * without busting technical or fundamental caches.
 *
 * Bump this string whenever the financials system prompt or user prompt template changes
 * in a way that would make previously cached results stale.
 *
 * @remarks
 * **`p2` = PROMPT_DIGEST activation** (see {@link PROMPT_TEMPLATE_VERSION}'s
 * remark) — `skill.content` switched from the full skill body to the
 * condensed `PROMPT_DIGEST` section, changing this template's prompt bytes.
 *
 * @remarks
 * **`p3` = selection-engine activation (spec §3.2)** — the financials builder
 * now routes skills through the shared selector (whitelist + fail-closed
 * gating), so injected fundamental skills are name-sorted instead of catalog
 * order, changing this template's prompt bytes.
 *
 * @remarks
 * **`p4` = stable/dynamic assembly split, Design C ("skills-to-system
 * split", spec §3.4).** `buildFinancialsAnalysisPrompt` now returns
 * `AssembledPrompt { stable, dynamic }`; ONLY the always_on-only "Financial
 * Analysis Frameworks" (Active Skills) section moved out of the user prompt
 * into `stable` (relocated to the system prompt) — Data Boundary/Output
 * Schema/Rules and every other section stay in `dynamic`, in the unchanged
 * production order, changing this template's prompt bytes.
 *
 * @remarks
 * **`p5` = free-tier skill sampling (free-analysis-tier-gating spec).** The
 * financials builder now routes its loaded skills through
 * `createSkillSamplingPlan` before assembly, capping each skill-type group to
 * at most 3 skills for the free tier and changing this template's prompt
 * bytes. The financials cache key now folds `${tier}:${sampledSkillFingerprint}`
 * as its `skillFingerprint` segment (see {@link buildFinancialsCacheKey}),
 * so free and non-free requests never share a cache entry. Bumped to
 * invalidate warm caches carrying pre-tier-gating (unfiltered) content.
 *
 * @internal
 */
export const FINANCIALS_PROMPT_TEMPLATE_VERSION = 'p5' as const;

/**
 * Build the Redis key for a cached financials (multi-year statement) analysis result.
 *
 * Format: `{version}:analysis:financials:<symbol>:<period>:<modelId>:<promptVersion>`.
 *
 * Mirrors {@link buildFundamentalCacheKey} but uses the `financials` path segment,
 * folds the `period` axis (`'annual'` | `'quarter'`) between `symbol` and `modelId`
 * so annual and quarterly analyses for the same symbol are cached independently, and
 * uses {@link FINANCIALS_PROMPT_TEMPLATE_VERSION} so the two analysis types can be
 * invalidated separately.
 *
 * The optional `skillFingerprint` segment folds the active skill catalog into
 * the key (see {@link buildAnalysisCacheKey}); appended only when supplied so
 * callers that do not load skills keep the legacy key shape.
 *
 * @internal
 * @param symbol - U.S. equity ticker (canonical uppercase).
 * @param modelId - LLM model identifier.
 * @param period - Statement period (`'annual'` or `'quarter'`). Annual and quarterly
 *   analyses cover different data and must not share a cache entry.
 * @param skillFingerprint - Optional hash of the skill catalog's selection
 *   metadata. When provided, appended as the final key segment.
 * @param reasoning - Per-request deep-thinking toggle (member-reasoning-toggle
 *   spec, Part A). `true` appends a distinct `:reason=on` suffix; `false`/
 *   `undefined` produce the exact same key as omitting the parameter.
 * @param locale - AI output language. Omit (or pass the default `ko`) to get
 *   the exact key this builder produced before the parameter existed, so the
 *   Korean cache stays valid; other locales append `:lang=<locale>`.
 * @returns The cache key.
 *
 * @example
 * ```ts
 * buildFinancialsCacheKey('AAPL', 'gemini-2.5-flash', 'annual');
 * // → 'v1:analysis:financials:AAPL:annual:gemini-2.5-flash:p1'
 * buildFinancialsCacheKey('AAPL', 'gemini-2.5-flash', 'quarter', 'sk1');
 * // → 'v1:analysis:financials:AAPL:quarter:gemini-2.5-flash:p1:sk1'
 * ```
 */
export function buildFinancialsCacheKey(
    symbol: string,
    modelId: string,
    period: StatementPeriod,
    skillFingerprint?: string,
    reasoning?: boolean,
    locale?: AnalysisLocale
): string {
    const base = `${CACHE_KEY_SCHEMA_VERSION}:analysis:financials:${symbol}:${period}:${modelId}:${FINANCIALS_PROMPT_TEMPLATE_VERSION}`;
    const withFingerprint =
        skillFingerprint !== undefined ? `${base}:${skillFingerprint}` : base;
    return `${withFingerprint}${reasoningKeySuffix(reasoning)}${localeKeySuffix(locale)}`;
}

/**
 * Prompt-template version for the congressional-trade trend analysis cache keys.
 *
 * Parallel to {@link FINANCIALS_PROMPT_TEMPLATE_VERSION} but scoped to the
 * congress analysis type so its prompt-template changes invalidate
 * independently. Bump whenever the congress system/user prompt template changes
 * in a way that would make previously cached results stale.
 *
 * @remarks
 * **`p2` = PROMPT_DIGEST activation** (see {@link PROMPT_TEMPLATE_VERSION}'s
 * remark) — `skill.content` switched from the full skill body to the
 * condensed `PROMPT_DIGEST` section, changing this template's prompt bytes.
 * Intentionally NOT bumped for the §3.2 selection engine: the congress builder
 * keeps its own private `category === 'congress'` filter and does not call
 * `selectSkills`, so its prompt bytes are unchanged.
 *
 * @remarks
 * **`p3` = stable/dynamic assembly split, Design C ("skills-to-system
 * split", spec §3.4).** `buildCongressTrendPrompt` now returns
 * `AssembledPrompt { stable, dynamic }`; ONLY the catalog-deterministic
 * "Domain Skills (Active)" section (filtered purely by category, never by
 * chart/symbol state) moved out of the user prompt into `stable` (relocated
 * to the system prompt) — role framing/Data Boundary/Caveats/Output
 * Schema/Rules and every other section stay in `dynamic`, in the unchanged
 * production order, changing this template's prompt bytes.
 *
 * @remarks
 * **`p4` = free-tier skill sampling (free-analysis-tier-gating spec).** The
 * congress builder now routes its loaded skills through
 * `createSkillSamplingPlan` before assembly, capping each skill-type group to
 * at most 3 skills for the free tier and changing this template's prompt
 * bytes. The congress cache key now folds `${tier}:${sampledSkillFingerprint}`
 * as its `skillFingerprint` segment (see {@link buildCongressTrendCacheKey}),
 * so free and non-free requests never share a cache entry. Bumped to
 * invalidate warm caches carrying pre-tier-gating (unfiltered) content.
 *
 * @internal
 */
export const CONGRESS_PROMPT_TEMPLATE_VERSION = 'p4' as const;

/** @internal TTL for congressional-trade trend analysis cache results. Default: 24 hours. */
export const CONGRESS_CACHE_TTL_SECONDS = SECONDS_PER_DAY;

/**
 * Build the Redis key for a cached congressional-trade trend analysis result.
 *
 * Format: `{version}:analysis:congress:<symbol>:<modelId>:<promptVersion>`.
 *
 * Mirrors {@link buildFundamentalCacheKey} (no `period` axis — congress trend
 * has a single shape per symbol) and uses {@link CONGRESS_PROMPT_TEMPLATE_VERSION}
 * so the congress analysis type can be invalidated separately from the others.
 *
 * The key is intentionally free of an input hash so the cache lookup can happen
 * before any provider fetch — avoiding the senate/house FMP calls when a warm
 * result already exists. Freshness is governed by the 24-hour TTL
 * ({@link CONGRESS_CACHE_TTL_SECONDS}), the schema-version prefix
 * ({@link CACHE_KEY_SCHEMA_VERSION}), and the trailing prompt-version segment.
 *
 * The optional `skillFingerprint` segment folds the active skill catalog into
 * the key (see {@link buildAnalysisCacheKey}); appended only when supplied so
 * callers that do not load skills keep the legacy key shape.
 *
 * @internal
 * @param symbol - U.S. equity ticker (canonical uppercase).
 * @param modelId - LLM model identifier.
 * @param skillFingerprint - Optional hash of the skill catalog's selection
 *   metadata. When provided, appended as the final key segment.
 * @param reasoning - Per-request deep-thinking toggle (member-reasoning-toggle
 *   spec, Part A). `true` appends a distinct `:reason=on` suffix; `false`/
 *   `undefined` produce the exact same key as omitting the parameter.
 * @param locale - AI output language. Omit (or pass the default `ko`) to get
 *   the exact key this builder produced before the parameter existed, so the
 *   Korean cache stays valid; other locales append `:lang=<locale>`.
 * @returns The cache key.
 *
 * @example
 * ```ts
 * buildCongressTrendCacheKey('AAPL', 'gemini-2.5-flash');
 * // → 'v1:analysis:congress:AAPL:gemini-2.5-flash:p1'
 * buildCongressTrendCacheKey('AAPL', 'gemini-2.5-flash', 'sk1');
 * // → 'v1:analysis:congress:AAPL:gemini-2.5-flash:p1:sk1'
 * ```
 */
export function buildCongressTrendCacheKey(
    symbol: string,
    modelId: string,
    skillFingerprint?: string,
    reasoning?: boolean,
    locale?: AnalysisLocale
): string {
    const base = `${CACHE_KEY_SCHEMA_VERSION}:analysis:congress:${symbol}:${modelId}:${CONGRESS_PROMPT_TEMPLATE_VERSION}`;
    const withFingerprint =
        skillFingerprint !== undefined ? `${base}:${skillFingerprint}` : base;
    return `${withFingerprint}${reasoningKeySuffix(reasoning)}${localeKeySuffix(locale)}`;
}

/**
 * Prompt-template version for the news analysis and market-news-digest cache
 * keys.
 *
 * Parallel to {@link FINANCIALS_PROMPT_TEMPLATE_VERSION} /
 * {@link CONGRESS_PROMPT_TEMPLATE_VERSION} but shared by BOTH
 * {@link buildNewsCacheKey} and {@link buildMarketNewsDigestCacheKey} — the
 * two builders route skills through the same `newsPrompt` /
 * `marketNewsDigestPrompt` template family, so their prompt-template changes
 * invalidate together.
 *
 * Bump this string whenever the news or market-news-digest system prompt or
 * user prompt template changes in a way that would make previously cached
 * results stale.
 *
 * @remarks
 * **`p2` = selection-engine activation** — the news and market-news-digest
 * builders now route skills through the shared `selectSkills` (whitelist +
 * fail-closed gating), so injected news skills are name-sorted via the
 * selection engine instead of whatever ordering existed before, changing
 * this template's prompt bytes. (There was an implicit unversioned "p1"
 * generation before this constant existed.)
 *
 * @remarks
 * **`p3` = stable/dynamic assembly split, Design C ("skills-to-system
 * split", spec §3.4).** Both `buildNewsAnalysisPrompt` and
 * `buildMarketNewsDigestPrompt` now return `AssembledPrompt { stable,
 * dynamic }`; ONLY the always_on-only "News Analysis Frameworks" (Active
 * Skills) section moved out of the user prompt into `stable` (relocated to
 * the system prompt) — role framing/Data Boundary/Output Schema/Rules and
 * every other section stay in `dynamic`, in the unchanged production order,
 * changing both templates' prompt bytes.
 *
 * @remarks
 * **`p4` = free-tier skill sampling (free-analysis-tier-gating spec).** Both
 * builders now route their loaded skills through `createSkillSamplingPlan`
 * before assembly, capping each skill-type group to at most 3 skills for the
 * free tier and changing both templates' prompt bytes. Since neither
 * {@link buildNewsCacheKey} nor {@link buildMarketNewsDigestCacheKey} carries a
 * separate `skillFingerprint` segment, `tier` and the sampled-skill
 * fingerprint are instead folded into the `inputHash` these functions already
 * take, so free and non-free requests never share a cache entry. Bumped to
 * invalidate warm caches carrying pre-tier-gating (unfiltered) content.
 *
 * @internal
 */
export const NEWS_PROMPT_TEMPLATE_VERSION = 'p4' as const;

/**
 * Build the Redis key for a cached market-news category digest.
 * Format: `{version}:analysis:market-news:${category}:${modelId}:${promptVersion}:${inputHash}`.
 *
 * Keyed by `category` (the {@link NewsFeedCategory} bucket), `modelId`,
 * {@link NEWS_PROMPT_TEMPLATE_VERSION}, and `inputHash` (a deterministic hash
 * of the article IDs and skill fingerprint) so different feed categories,
 * models, prompt-template generations, and article sets cache independently.
 *
 * @internal Consumer cannot construct `inputHash` themselves — it is derived
 *   inside `submitMarketNewsDigest`. Do not depend on this function from outside
 *   the core library.
 * @param category  - Feed-category bucket.
 * @param modelId   - LLM model identifier.
 * @param inputHash - Short hash of the news items used as prompt input.
 * @param reasoning - Per-request deep-thinking toggle. `true` appends a
 *   distinct `:reason=on` suffix; `false`/`undefined` produce the exact same
 *   key as omitting the parameter, so entries written before the digest
 *   accepted this option keep hitting. Mirrors {@link buildNewsCacheKey} —
 *   reasoning materially changes the digest's output depth, so an on/off pair
 *   must never share an entry.
 * @param locale - AI output language. Omit (or pass the default `ko`) to get
 *   the exact key this builder produced before the parameter existed, so the
 *   Korean cache stays valid; other locales append `:lang=<locale>`.
 * @returns The cache key.
 *
 * @example
 * ```ts
 * buildMarketNewsDigestCacheKey('crypto', 'deepseek-v4-flash', 'abc123');
 * // → 'v1:analysis:market-news:crypto:deepseek-v4-flash:p2:abc123'
 * buildMarketNewsDigestCacheKey('crypto', 'deepseek-v4-flash', 'abc123', true);
 * // → 'v1:analysis:market-news:crypto:deepseek-v4-flash:p2:abc123:reason=on'
 * ```
 */
export function buildMarketNewsDigestCacheKey(
    category: NewsFeedCategory,
    modelId: string,
    inputHash: string,
    reasoning?: boolean,
    locale?: AnalysisLocale
): string {
    return `${CACHE_KEY_SCHEMA_VERSION}:analysis:market-news:${category}:${modelId}:${NEWS_PROMPT_TEMPLATE_VERSION}:${inputHash}${reasoningKeySuffix(reasoning)}${localeKeySuffix(locale)}`;
}

/**
 * Build the Redis key for a cached news analysis result.
 *
 * Format: `{version}:analysis:news:<symbol>:<modelId>:<promptVersion>:<inputHash>`.
 *
 * Uses {@link NEWS_PROMPT_TEMPLATE_VERSION} so the news prompt-template
 * generation can be invalidated independently of the other analysis types.
 *
 * @internal Consumer cannot construct `inputHash` themselves — it is derived
 *   inside `submitNewsAnalysis`. Do not depend on this function from outside
 *   the core library.
 * @param symbol - U.S. equity ticker (canonical uppercase).
 * @param modelId - LLM model identifier.
 * @param inputHash - Short hash of the news items used as prompt input.
 * @param reasoning - Per-request deep-thinking toggle (member-reasoning-toggle
 *   spec, Part A). `true` appends a distinct `:reason=on` suffix; `false`/
 *   `undefined` produce the exact same key as omitting the parameter.
 * @param locale - AI output language. Omit (or pass the default `ko`) to get
 *   the exact key this builder produced before the parameter existed, so the
 *   Korean cache stays valid; other locales append `:lang=<locale>`.
 * @returns The cache key.
 *
 * @example
 * ```ts
 * buildNewsCacheKey('AAPL', 'gemini-2.5-pro', 'h2');
 * // → 'v1:analysis:news:AAPL:gemini-2.5-pro:p2:h2'
 * ```
 */
export function buildNewsCacheKey(
    symbol: string,
    modelId: string,
    inputHash: string,
    reasoning?: boolean,
    locale?: AnalysisLocale
): string {
    return `${CACHE_KEY_SCHEMA_VERSION}:analysis:news:${symbol}:${modelId}:${NEWS_PROMPT_TEMPLATE_VERSION}:${inputHash}${reasoningKeySuffix(reasoning)}${localeKeySuffix(locale)}`;
}

/**
 * Build the Redis key for a cached overall (3-axis) analysis result.
 *
 * Format: `analysis:overall:<symbol>:<timeframe>:<modelId>:<inputHash>`.
 * The `timeframe` distinguishes analyses run with different chart contexts.
 *
 * @internal Consumer cannot construct `inputHash` themselves — it is derived
 *   inside `submitOverallAnalysis`. Do not depend on this function from outside
 *   the core library.
 * @param symbol - U.S. equity ticker (canonical uppercase).
 * @param timeframe - Bar resolution used for the technical axis.
 * @param modelId - LLM model identifier.
 * @param inputHash - Short hash of the combined technical/fundamental/news inputs.
 * @param reasoning - Per-request deep-thinking toggle (member-reasoning-toggle
 *   spec, Part A). `true` appends a distinct `:reason=on` suffix; `false`/
 *   `undefined` produce the exact same key as omitting the parameter.
 * @param locale - AI output language. Omit (or pass the default `ko`) to get
 *   the exact key this builder produced before the parameter existed, so the
 *   Korean cache stays valid; other locales append `:lang=<locale>`.
 * @returns The cache key.
 */
export function buildOverallCacheKey(
    symbol: string,
    timeframe: Timeframe,
    modelId: string,
    inputHash: string,
    reasoning?: boolean,
    locale?: AnalysisLocale
): string {
    return `${CACHE_KEY_SCHEMA_VERSION}:analysis:overall:${symbol}:${timeframe}:${modelId}:${inputHash}${reasoningKeySuffix(reasoning)}${localeKeySuffix(locale)}`;
}

/**
 * Prompt-template version for the indicator-translation AI cache keys.
 *
 * Bump this string whenever the indicator-translation prompt template changes
 * in a way that would make previously cached results stale. Old keys (e.g.
 * `p1`) are simply never looked up after a bump and naturally expire via TTL.
 *
 * @remarks
 * **Deliberately NOT bumped for the `p2` PROMPT_DIGEST activation** (see
 * {@link PROMPT_TEMPLATE_VERSION}'s remark). This prompt builder interpolates
 * no `skill.content` into its prompt, so switching skills over to the digest
 * body does not change this template's prompt bytes — bumping it would be
 * no-op cache churn.
 *
 * @remarks
 * **Deliberately NOT bumped for the stable/dynamic assembly split (spec
 * §3.4).** `buildIndicatorTranslationPrompt` now returns `AssembledPrompt {
 * stable, dynamic }` instead of a plain string, but this builder has no
 * skills to relocate for Design C — `stable` is simply `''` and `dynamic` is
 * byte-for-byte the same prompt text the plain-string version produced (only
 * the return-type wrapper changed). Bumping would be no-op cache churn.
 *
 * @internal
 */
export const INDICATOR_TRANSLATION_PROMPT_TEMPLATE_VERSION = 'p1' as const;

/** @internal Number of days an indicator translation result is kept in cache. */
const INDICATOR_TRANSLATION_CACHE_TTL_DAYS = 30;

/**
 * @internal TTL for cached indicator translation results (30 days, in seconds).
 *
 * Indicator name translations are permanent: the English name of an
 * economic indicator (e.g. "Core PCE Price Index YoY") maps to a fixed
 * Korean equivalent. A long TTL amortises the per-translation LLM cost
 * across thousands of requests without risking staleness.
 */
export const INDICATOR_TRANSLATION_CACHE_TTL =
    INDICATOR_TRANSLATION_CACHE_TTL_DAYS * SECONDS_PER_DAY;

/**
 * @internal Build the Redis key for a cached indicator translation result.
 *
 * Format: `{version}:translation:indicator:<nameHash>:<promptVersion>`.
 *
 * The key folds a deterministic hash of the normalizedName so different
 * indicator names always produce distinct keys. The prompt-version suffix
 * allows prompt-template changes to invalidate the cache independently.
 *
 * Note: `nameHash` is derived by the application layer via
 * `hashAnalysisInput(normalizedName)`. Do not construct this key format
 * externally.
 *
 * @param nameHash - 16-char hex hash of the normalized indicator name.
 * @returns The cache key.
 *
 * @example
 * ```ts
 * buildIndicatorTranslationCacheKey(hashAnalysisInput('Core PCE Price Index YoY'));
 * // → 'v1:translation:indicator:deadbeefdeadbeef:p1'
 * ```
 */
export function buildIndicatorTranslationCacheKey(nameHash: string): string {
    return `${CACHE_KEY_SCHEMA_VERSION}:translation:indicator:${nameHash}:${INDICATOR_TRANSLATION_PROMPT_TEMPLATE_VERSION}`;
}

/**
 * Build the **content-free** "peek" key for the latest cached overall analysis.
 *
 * Format: `{version}:analysis:overall:peek:<symbol>:<timeframe>:<modelId>`.
 *
 * Unlike {@link buildOverallCacheKey}, this key omits the input hash so it can
 * be reconstructed from `(symbol, timeframe, modelId)` alone — without
 * resolving the four dependency axes (which is the only way to derive the
 * input hash, and which would entail cache reads / potential generation).
 *
 * {@link pollOverallAnalysis} writes the normalized result under **both** keys:
 * the canonical hashed key (for the exact-input cache the submit path looks up)
 * and this peek key (an overwrite-latest pointer to the most recently generated
 * overall analysis for the symbol/timeframe/model). `peekOverallAnalysisCache`
 * reads this key to surface a cached overall analysis in SSR HTML at zero LLM
 * cost — accepting "latest cached" semantics because a content-free read cannot
 * reproduce the input hash.
 *
 * @internal
 * @param symbol - U.S. equity ticker (canonical uppercase).
 * @param timeframe - Bar resolution used for the technical axis.
 * @param modelId - LLM model identifier.
 * @param reasoning - Per-request deep-thinking toggle (member-reasoning-toggle
 *   spec, Part A). `true` appends a distinct `:reason=on` suffix so a
 *   reasoning-ON overall analysis never overwrites the reasoning-OFF "latest"
 *   pointer (or vice versa); `false`/`undefined` produce the exact same key
 *   as omitting the parameter.
 * @param locale - AI output language. Omit (or pass the default `ko`) to get
 *   the exact key this builder produced before the parameter existed, so the
 *   Korean cache stays valid; other locales append `:lang=<locale>`.
 * @returns The content-free peek cache key.
 */
export function buildOverallPeekCacheKey(
    symbol: string,
    timeframe: Timeframe,
    modelId: string,
    reasoning?: boolean,
    locale?: AnalysisLocale
): string {
    return `${CACHE_KEY_SCHEMA_VERSION}:analysis:overall:peek:${symbol}:${timeframe}:${modelId}${reasoningKeySuffix(reasoning)}${localeKeySuffix(locale)}`;
}

/**
 * @internal Build the Redis key for a cached options analysis result.
 *
 * Format: `{version}:analysis:options:<symbol>:<expirationDate>:<modelId>:<snapshotInputHash>`.
 *
 * The schema-version prefix ({@link CACHE_KEY_SCHEMA_VERSION}) ensures future
 * shape changes invalidate the cache automatically, matching the sibling
 * analysis cache-key builders above.
 *
 * @param symbol - Underlying ticker (uppercase).
 * @param expirationDate - {@link OptionsExpirationFilter} — `'YYYY-MM-DD'` or the
 *   `'all'` sentinel for aggregate analysis across every available expiration.
 * @param modelId - LLM model identifier scoping the cache.
 * @param snapshotInputHash - Hash of the snapshot inputs — a fresher snapshot
 *   produces a different hash and therefore a new cache entry.
 * @param reasoning - Per-request deep-thinking toggle (member-reasoning-toggle
 *   spec, Part A). `true` appends a distinct `:reason=on` suffix; `false`/
 *   `undefined` produce the exact same key as omitting the parameter.
 * @param locale - AI output language. Omit (or pass the default `ko`) to get
 *   the exact key this builder produced before the parameter existed, so the
 *   Korean cache stays valid; other locales append `:lang=<locale>`.
 * @returns The cache key.
 */
export function buildOptionsCacheKey(
    symbol: string,
    expirationDate: OptionsExpirationFilter,
    modelId: string,
    snapshotInputHash: string,
    reasoning?: boolean,
    locale?: AnalysisLocale
): string {
    return `${CACHE_KEY_SCHEMA_VERSION}:analysis:options:${symbol}:${expirationDate}:${modelId}:${snapshotInputHash}${reasoningKeySuffix(reasoning)}${localeKeySuffix(locale)}`;
}
