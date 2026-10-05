import {
    compareMarketEventPriority,
    MARKET_EVENT_CACHE_KEY_CAP,
    RANKED_IMPACTS,
} from '@/domain/analysis/marketEvents';
import {
    localeKeySuffixFor,
    type AnalysisLocale,
} from '@/domain/analysis/outputLocale';
import { PRIOR_ANALYSIS_WINDOW_BARS } from '@/domain/analysis/priorAnalysis';
import type {
    DashboardTimeframe,
    MarketEvent,
    MarketSessionSpec,
    NewsFeedCategory,
    OptionsExpirationFilter,
    PositionBucket,
    PriorAnalysis,
    StatementPeriod,
    Timeframe,
} from '@/domain/types';
import {
    TIMEFRAME_BARS_LIMIT,
    TIMEFRAME_LOOKBACK_DAYS,
} from '@/domain/constants/market';
import {
    KST_OFFSET_HOURS,
    MS_PER_DAY,
    MS_PER_HOUR,
    MS_PER_SECOND,
    SECONDS_PER_DAY,
    SECONDS_PER_HOUR,
    SECONDS_PER_MINUTE,
} from '@/domain/constants/time';
import {
    computeSecondsUntilCacheExpiry,
    secondsUntilNextRegularClose,
    secondsUntilNextRegularOpen,
    secondsUntilNextUtcMidnight,
} from '@/domain/utils';
import { isRegularSessionOpen, US_EQUITY_SESSION } from '@/domain/session';
import type {
    AnalysisHistoryAxis,
    AnalysisHistoryQuery,
    NarrowedMarketEvents,
    NarrowedPriorAnalyses,
} from '@/infrastructure/cache/types';
import { hashAnalysisInput } from '@/infrastructure/hash/analysisInput';

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
 * @internal Minutes after a regular close at which a session-aware analysis
 * expires, so a result generated off still-settling closing data (KRX quotes
 * from the free provider lag ~20 minutes; end-of-day bars publish after the
 * bell) does not survive into the next session.
 */
export const ANALYSIS_CACHE_SETTLE_BUFFER_MINUTES = 30;

/**
 * @internal Compute the effective analysis-cache TTL for a given timeframe at `now`.
 *
 * Returns the smaller of:
 * - `ANALYSIS_CACHE_TTL[timeframe]` — the static per-timeframe ceiling.
 * - Seconds remaining until the next daily expiry boundary — ensures cached
 *   results don't survive into the next trading day.
 *
 * The daily boundary depends on `session`:
 * - **Omitted** — the next `CACHE_EXPIRY_HOUR_KST` boundary (KST 05:00 = the
 *   U.S. close in summer). Exactly the pre-`session` behavior.
 * - **Scheduled** (US, KRX, …) — that session's next regular close (holidays
 *   and half days honored through `closeMinuteFor`) plus
 *   {@link ANALYSIS_CACHE_SETTLE_BUFFER_MINUTES}. One U.S.-shaped boundary for
 *   every market let an analysis written before the KRX close be reused all
 *   evening, and in winter the KST 05:00 boundary lands an hour before the U.S.
 *   close.
 * - **Always-open** (crypto) — the next 00:00 UTC, when the daily bar closes.
 *
 * The cache KEY is unaffected by `session`; only the lifetime of what is
 * written under it changes.
 *
 * @param timeframe - Bar resolution.
 * @param now - The "now" reference; useful in tests.
 * @param session - Market session of the analysed instrument.
 * @returns Effective TTL in seconds (always at least 1).
 */
export function computeEffectiveTtl(
    timeframe: Timeframe,
    now: Date,
    session?: MarketSessionSpec
): number {
    if (session === undefined) {
        return Math.min(
            ANALYSIS_CACHE_TTL[timeframe],
            computeSecondsUntilCacheExpiry(now, CACHE_EXPIRY_HOUR_KST)
        );
    }
    const secondsUntilBoundary =
        session.kind === 'always-open'
            ? secondsUntilNextUtcMidnight(now)
            : secondsUntilNextRegularClose(
                  session,
                  now,
                  ANALYSIS_CACHE_SETTLE_BUFFER_MINUTES
              );
    // A scheduled spec with no trading day in range (a misconfigured spec) has
    // no boundary to cut at; the per-timeframe ceiling is the safe fallback.
    return Math.max(
        1,
        Math.min(
            ANALYSIS_CACHE_TTL[timeframe],
            secondsUntilBoundary ?? ANALYSIS_CACHE_TTL[timeframe]
        )
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
 * The off-hours fallback (the seconds until the `session` spec's next regular
 * open) follows that spec's own time zone, weekend days and `closeMinuteFor`
 * calendar, so a KRX spec expires at the next KRX open rather than the next NYSE
 * one. A `CRYPTO_SESSION` short-circuits to `BARS_OPEN_TTL_SECONDS`.
 *
 * @param _timeframe - Bar resolution. Currently all timeframes share the same policy;
 *   the parameter is kept for signature consistency with the analysis-cache TTL helper.
 * @param now - Reference time for market-session detection. Pass explicitly for
 *   deterministic testing.
 * @param session - Market session schedule determining open vs off-hours TTL.
 *   Defaults to US_EQUITY_SESSION; pass CRYPTO_SESSION for 24/7 assets (always
 *   returns BARS_OPEN_TTL_SECONDS).
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
        secondsUntilNextRegularOpen(session, now)
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
    return localeKeySuffixFor(locale);
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
 * @internal Cache-key suffix for the prior-analysis-context fingerprint (see
 * `narrowPriorAnalysesForCacheKey`).
 *
 * Mirrors the sibling suffix helpers' "append only when supplied" convention:
 * `undefined` — no history was supplied, or every candidate fell inside the
 * current cache window and none survived to be fingerprinted — produces no
 * suffix at all, so a caller that never passes `priorAnalyses` reads/writes
 * the exact same key this builder produced before the parameter existed.
 */
function historyKeySuffix(fingerprint?: string): string {
    return fingerprint !== undefined ? `:hist=${fingerprint}` : '';
}

/**
 * @internal
 *
 * Cache-key segment for the market-events fingerprint.
 *
 * Absent when no qualifying event exists, so a symbol with no market-moving
 * news produces the exact same key this builder produced before the parameter
 * existed.
 */
function eventsKeySuffix(fingerprint?: string): string {
    return fingerprint !== undefined ? `:evt=${fingerprint}` : '';
}

/**
 * @internal
 * Start of the cache bucket `now` falls in — the boundary before which prior
 * analyses count toward the history key.
 *
 * **Anchored, not rolling.** A rolling boundary (`now - window`) moves every
 * millisecond, so any row generated in the previous window ages past it
 * partway through the current cache entry's life, changes the `:hist=`
 * survivor set, and orphans the entry — one extra generation per aging row,
 * per variant, every day. Buckets are aligned to the daily cache expiry
 * ({@link CACHE_EXPIRY_HOUR_KST}); every {@link ANALYSIS_CACHE_TTL} value and
 * {@link OVERALL_CACHE_TTL_SECONDS} divide a day evenly, so bucket edges also
 * coincide with that expiry. Within one bucket no row can newly qualify, so
 * the key is stable; it changes at most once, at the bucket edge.
 *
 * @param windowSeconds - The consuming axis' cache window.
 * @param now - Reference time (reuse the same instance for key and prompt).
 * @returns Epoch milliseconds of the bucket start.
 */
export function priorAnalysisWindowStartMs(
    windowSeconds: number,
    now: Date
): number {
    const windowMs = windowSeconds * MS_PER_SECOND;
    const offsetMs =
        (((CACHE_EXPIRY_HOUR_KST - KST_OFFSET_HOURS + 24) % 24) * MS_PER_HOUR) %
        windowMs;
    return (
        Math.floor((now.getTime() - offsetMs) / windowMs) * windowMs + offsetMs
    );
}

/**
 * @internal
 *
 * Stage 1 of the two-stage prior-analysis narrowing that backs the
 * prior-analysis-context feature (see `PriorAnalysis` in
 * `domain/types.ts` for the feature overview). Cuts a
 * caller-supplied history of past analyses down to the set that may
 * legitimately determine the CACHE KEY for the CURRENT cache window, and
 * derives a short fingerprint of that set for
 * {@link buildAnalysisCacheKey}'s `historyFingerprint` parameter (the
 * overall axis instead folds the fingerprint into the object it hashes into
 * `buildOverallCacheKey`'s `inputHash` — see `runOverallAnalysis.ts`).
 *
 * **Why the window exclusion happens here, in infrastructure, rather than in
 * `domain/`.** The exclusion boundary is `currentWindowSeconds` — a
 * cache-policy value (`ANALYSIS_CACHE_TTL[timeframe]` for the technical axis,
 * `OVERALL_CACHE_TTL_SECONDS` for the overall axis) that `domain/` is not
 * permitted to import (`domain` may not import `infrastructure` — an ESLint
 * error, see `src/domain/CLAUDE.md`). Stage 2
 * (`selectPriorAnalyses` in `domain/analysis/priorAnalysis.ts`, and its
 * caller `buildAnalysisPrompt`/`buildOverallAnalysisPrompt`) narrows THIS
 * function's output further — by bar anchor and bar dedup — for the PROMPT.
 * The two stages must be fed from the exact same already-window-filtered
 * list — this function's `candidates` return value — or the fingerprint
 * (which determines the cache key) and the prompt (which determines what is
 * actually inside the response written under that key) can silently
 * disagree: a request could read a cache entry keyed for one set of prior
 * analyses while a DIFFERENT request rendered a different set into the
 * prompt that produced it, because each computed its own filtered view
 * independently instead of sharing one.
 *
 * **Why the window exclusion exists at all.** Without it, an analysis
 * generated mid-window would change the fingerprint (and therefore the
 * cache key) the moment it lands, for every OTHER caller requesting the same
 * symbol/timeframe/model for the rest of the window — one user finishing an
 * analysis would invalidate everyone else's cache entry mid-flight,
 * defeating the point of caching. Entries generated BEFORE the current
 * window opened carry no such risk: they were already visible when the
 * window's first request computed its key, so every request within the
 * window sees the identical prior-analysis set and therefore computes the
 * identical key, all the way until the window rolls over.
 *
 * Concretely, in order:
 * 1. Drop every entry with `generatedAt.getTime() >= windowStartMs`, where
 *    `windowStartMs` is the anchored bucket start from
 *    {@link priorAnalysisWindowStartMs} (inside the current bucket — including
 *    the boundary instant itself, which counts as "inside"). Anchored rather
 *    than rolling (`now - window`) so no row ages across the boundary while a
 *    cache entry is alive.
 * 2. Sort survivors newest-first and cap at
 *    {@link PRIOR_ANALYSIS_WINDOW_BARS} (21) — the same slack multiplier
 *    `selectPriorAnalyses` applies to its bar-count window, so under
 *    the expected density of at most roughly one analysis per bar this stage
 *    keeps everything stage 2 could still use. The cap is by COUNT, not by
 *    bar, so the two are not equivalent in the limit: on a symbol analysed
 *    many times within the same few bars, the 21 newest can all belong to
 *    those bars and stage 2 then sees fewer than 7 distinct bars. That
 *    degrades to a shorter section, never to wrong data.
 * 3. Hash the survivors' `generatedAt` epoch milliseconds (comma-joined, in
 *    the already-sorted order) via {@link hashAnalysisInput} — reused
 *    rather than reimplemented, per this module's existing hashing
 *    convention. `generatedAt` alone is sufficient to fingerprint the SET:
 *    it is exactly the field this function filters and sorts on, so any
 *    change to the survivor set (an entry aging out of the window, a new
 *    entry appearing before it) changes at least one epoch value and
 *    therefore the hash. The fingerprint deliberately does NOT cover
 *    `trend`/`riskLevel`/prices — those feed the PROMPT via stage 2, not the
 *    key; folding them in here would bust the cache key every time a past
 *    analysis were retroactively edited in the consumer's own database, a
 *    case this feature has no reason to invalidate on.
 *
 * @param priorAnalyses - Full history for this symbol + timeframe (and, for
 *   the overall axis, this tab), as supplied by the consumer via
 *   `options.priorAnalyses`. Order does not matter — this function sorts.
 * @param currentWindowSeconds - Length of the CURRENT cache window in
 *   seconds. NOT a `Timeframe` — the technical and overall axes' windows
 *   diverge independently of timeframe (overall is a fixed day regardless of
 *   chart resolution), so the caller resolves and passes the right window.
 * @param now - Reference time for the window boundary. The caller MUST reuse
 *   the exact same `Date` instance (or millisecond value) for this call and
 *   for the sibling prompt-building call in the same request — computing the
 *   two from separate `new Date()` calls risks a boundary crossing between
 *   them, which would make the cache key and the rendered prompt disagree
 *   about which entries are "in the window".
 * @returns `candidates` — the window-filtered, capped, newest-first list.
 *   Feed it to BOTH this key's `historyFingerprint` segment (via
 *   `fingerprint`) AND, unfiltered by bar (that is stage 2's job), to
 *   `selectPriorAnalyses` for the prompt. `fingerprint` — `undefined` when
 *   `candidates` is empty, so the caller can omit the key segment entirely
 *   and stay byte-identical to a request with no usable history at all (see
 *   {@link historyKeySuffix}).
 *
 * **Input-size contract.** The caller is expected to have sized its own query
 * with {@link analysisHistoryQuery}, whose `limit` already caps the array at
 * {@link PRIOR_ANALYSIS_WINDOW_BARS}. Nothing here enforces that:
 * this function sorts whatever it is handed, so a caller that forgets the
 * limit and passes an unbounded result set pays an O(n log n) sort on every
 * request. The cap below bounds everything downstream — including
 * `selectPriorAnalyses`' per-candidate scan over `bars` — so an oversized
 * input costs one sort, not unbounded work in the prompt path.
 */
export function narrowPriorAnalysesForCacheKey(
    priorAnalyses: readonly PriorAnalysis[],
    currentWindowSeconds: number,
    now: Date
): NarrowedPriorAnalyses {
    const windowStartMs = priorAnalysisWindowStartMs(currentWindowSeconds, now);
    const cap = PRIOR_ANALYSIS_WINDOW_BARS;

    const candidates = priorAnalyses
        .filter(entry => entry.generatedAt.getTime() < windowStartMs)
        .toSorted((a, b) => b.generatedAt.getTime() - a.generatedAt.getTime())
        .slice(0, cap);

    if (candidates.length === 0) {
        return { candidates, fingerprint: undefined };
    }

    const fingerprint = hashAnalysisInput(
        candidates.map(entry => entry.generatedAt.getTime()).join(',')
    );
    return { candidates, fingerprint };
}

/**
 * @internal
 *
 * Stage 1 of the two-stage market-events narrowing: picks the events that can
 * reach the prompt and fingerprints them for the cache key.
 *
 * **Deliberately does not take bars.** The cache key must exist before the
 * cache is read, and bars are only fetched after a miss — the same ordering
 * constraint `narrowPriorAnalysesForCacheKey` works around. So stage 1 filters
 * on impact alone, and stage 2 ({@link selectMarketEvents}, called from
 * `formatMarketEventsSection`) applies the bar-window cut once bars exist.
 * Stage 1 is therefore the wider of the two, which is safe: two requests
 * looking at the same symbol with the same caller-supplied lookback see the
 * same candidates, so they agree on the key. It caps at
 * {@link MARKET_EVENT_CACHE_KEY_CAP} using the **same**
 * {@link compareMarketEventPriority} ordering stage 2 uses — cutting by
 * recency here would drop a lone `high` event behind fresher `medium` ones,
 * and stage 2 could never see it.
 *
 * Unlike prior analyses there is no TTL gate. Prior analyses need one because a
 * user's own freshly-finished analysis would otherwise invalidate every other
 * user's cache entry mid-window. Events are facts about the past, so that
 * cannot happen; the one thing that shifts the set is a late-arriving article,
 * which costs a single miss and buys a more accurate answer.
 *
 * The fingerprint covers publication times only — the same selection arriving
 * in a different order must not split the cache.
 */
export function narrowMarketEventsForCacheKey(
    events: readonly MarketEvent[]
): NarrowedMarketEvents {
    const candidates = events
        .filter(entry => RANKED_IMPACTS.includes(entry.impact))
        .toSorted(compareMarketEventPriority)
        .slice(0, MARKET_EVENT_CACHE_KEY_CAP);

    if (candidates.length === 0) {
        return { candidates, fingerprint: undefined };
    }

    // 분류값까지 해시에 넣는다 — `publishedAt`만으로는 부족하다.
    //
    // `narrowPriorAnalysesForCacheKey`는 `generatedAt`만 해시하는데, 그쪽은
    // 한 번 만들어진 분석이 다시 쓰이지 않아 시각이 곧 내용의 식별자다.
    // 뉴스는 다르다: 같은 기사가 나중에 다시 분류될 수 있고(운영 데이터에서
    // 14.6만 건이 수집 하루 뒤 이후에 분석됐다), 그때 `publishedAt`은 그대로인
    // 채 `impact`/`sentiment`/`category`만 바뀐다. 시각만 해시하면 그런 갱신이
    // 캐시 키를 바꾸지 못해, 렌더된 `## Market Events` 문구가 TTL이 끝날 때까지
    // 옛 분류를 그대로 보여 준다.
    //
    // 정렬한 뒤 해시하는 것은 같은 이유다 — 입력 순서가 캐시를 쪼개면 같은
    // 화면을 보는 두 요청이 항목을 공유하지 못한다.
    const fingerprint = hashAnalysisInput(
        candidates
            .map(
                entry =>
                    `${entry.publishedAt.getTime()}:${entry.category}:${entry.sentiment}:${entry.impact}`
            )
            .toSorted()
            .join(',')
    );
    return { candidates, fingerprint };
}

/**
 * @internal
 * Fixed model identifier for the market briefing. Core owns this choice and
 * sends it on the dispatch body; it is also folded into the briefing cache key
 * so a model change misses the old cache.
 */
export const BRIEFING_MODEL_ID = 'deepseek-v4.1-flash' as const;

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
 * @remarks
 * **`p9` = prior-analysis-context section.** `buildAnalysisPrompt` gains an
 * optional trailing `priorAnalyses` parameter; when the caller supplies a
 * usable history (narrowed by `narrowPriorAnalysesForCacheKey` for the key,
 * then `selectPriorAnalyses` for the prompt — see those functions' docs), a
 * new `## Prior Analyses` section plus the {@link
 * PRIOR_ANALYSIS_GUARDRAIL "prior-analysis guardrail"} line is appended to
 * the technical prompt's dynamic tail. This changes the technical prompt's
 * bytes ONLY for requests that actually carry usable prior-analysis history
 * (the section renders to `''` and is skipped otherwise, so a caller that
 * omits `priorAnalyses` — or supplies it with nothing surviving the two-stage
 * narrowing — gets byte-identical prompt output to before this parameter
 * existed). The bump is still required and still fleet-wide: this constant
 * has no per-history-presence axis to scope it to (unlike `positionBucket`'s
 * separate `:pos=*` key segment), so bumping cold-starts every technical AND
 * fundamental cache entry (and the SSR peek path) as a side effect, same
 * trade-off accepted for `p7`/`p8`. Without the bump, a symbol with a warm
 * `p8` cache entry would keep serving history-free analyses for the rest of
 * its TTL even once the consumer starts sending `priorAnalyses`.
 *
 * @remarks
 * **`p10` = bar timestamps rendered to the minute in both sections.**
 * `## Recent Bar Data` already printed `YYYY-MM-DD HH:mm`; `## Prior Analyses`
 * sliced the same value down to the date. On intraday timeframes that made
 * every call from one session collapse to a single string, leaving the
 * `N bars ago` count as the only ordering signal — and that count cannot be
 * turned back into elapsed time, because bar-indexed distance skips overnight
 * and weekend gaps (`20 bars ago` on a 15-minute chart reads as five hours but
 * can span a whole night). Both sections now share `formatBarDateTime`, so a
 * past call's stamp appears verbatim in the bar row it was made on.
 *
 * Scope is the same as `p9`, not wider: `formatBarRow` already produced this
 * exact string (local `DATETIME_DISPLAY_LENGTH` slice), so routing it through
 * the shared helper is a pure refactor with byte-identical output. The only
 * changed bytes are in `## Prior Analyses`, which `formatPriorAnalysisSection`
 * renders as `''` unless the request carries usable history. The bump is still
 * fleet-wide for the same reason `p9` was — the constant has no
 * per-history-presence axis to scope it to.
 *
 * @remarks
 * **`p11` = market-events context section.** `buildAnalysisPrompt` gains a
 * trailing `marketEvents` parameter; when the caller supplies qualifying
 * events, a `## Market Events` block renders between the bar data and the
 * prior-analysis section, naming what landed on those bars (category,
 * sentiment, impact — never the headline). Bytes change only for requests
 * carrying events, since `formatMarketEventsSection` returns `''` otherwise —
 * the same scope as `p9`/`p10`. The bump is still fleet-wide because the
 * constant has no per-request axis to scope it to.
 *
 * @remarks
 * **`p12` = numeric rendering audit.** Price-scale values render at a
 * precision derived from the snapshot close (sub-dollar assets keep four
 * significant digits, KRX renders whole won) instead of a fixed two decimals
 * that zeroed SHIBUSD's bars; KRX symbols get Korean-listing framing instead of
 * "U.S. equity"; volatility and BandWidth render as percentages and Force Index
 * as a grouped integer; pivots come from the prior session on intraday charts;
 * round-number steps scale outside $1–$1,000; and the structural risk:reward
 * skips levels inside half the mean bar range. Bytes change for every request.
 *
 * @remarks
 * **`p13` = placeholder bars dropped.** `fetchBarsWithIndicators` now removes
 * bars whose OHLC is not a usable price (Yahoo KRX placeholder rows such as
 * `O:0 H:0 L:0 C:285000 V:0`, which printed `Current vs Low: Infinity%`). Bytes
 * change only for symbols whose history carried such rows, but analyses cached
 * from them are wrong, and the constant has no per-symbol axis.
 *
 * The same bump also covers the follow-up audit shipped with it: MACD, ATR,
 * squeeze momentum and Elder-Ray render at a difference precision (three
 * significant digits of ATR) instead of the price precision; crypto prices keep
 * five significant digits; at-price reference levels are tagged and kept
 * outside the per-side cap; the risk:reward block says "not measurable" instead
 * of vanishing; round-number
 * steps follow one continuous 2% rule with plain-decimal labels; pivots group
 * intraday bars by the listing's session date; listing framing and precision
 * follow the supplied currency rather than the symbol suffix; and NaN volumes
 * and ratios render `N/A`.
 *
 * @remarks
 * **`p14` = precomputed prompt data (spec 2026-09-18 §2.2/§2.3).** A new
 * `## Indicator State (computed)` section renders right after `## Indicator
 * Values` — every above/below, cross and zone comparison (MA/EMA distance,
 * MACD vs signal/zero, DMI/ADX regime, Stochastic zone, Ichimoku cloud
 * position, Bollinger position, Supertrend/PSAR distance, ATR % of price)
 * precomputed instead of left to the model. `analysisGuidelines` gained a
 * matching "do not re-derive" rule. Separately, `riskReward` no longer asks
 * the model for a ratio/percentage — `postProcessAnalysisWithReconcile` now
 * prepends a deterministic risk:reward line (`buildBullishRiskRewardText`) to
 * `actionRecommendation.riskReward` on every path, not only the reconciled
 * one, and the Contingent Plan Mandate / Step 3 prose rules were reworded to
 * match. Bytes change for every request. Each `## Market Reference` horizon
 * that produced a Fibonacci projection also gains a `Fib anchor: swing low
 * X → swing high Y (up leg)` (or down-leg) line, so the fibonacci skill's
 * "cite the swing you're anchored on" instruction has something to cite.
 *
 * @remarks
 * **`p15`** — precomputed prompt data, wave 2 (spec 2026-09-18 §A1–A5). A new
 * `## Chart Pattern Candidates (computed)` section renders the pre-screener's
 * hits with deterministic measured-move geometry (key points, breakout
 * level, height, measured/conservative targets, invalidation level, status);
 * `## Market Reference` pivots gain Fibonacci/Woodie/DeMark rows and an
 * `Fib ABC anchor`/extension block when an ABC leg exists; `## Indicator
 * State` gains a MACD-cycle stage line, `Bollinger %B`, and a volume-vs-
 * 20-bar-average line; the SMC section gains `(±x.xx% / y.y ATR from price)`
 * on every listed level, plus `[nearest above]`/`[nearest below]` tags on
 * the single closest unmitigated order block and FVG on each side.
 * `patternSummaries[].geometry` is a new schema field (the model reads it
 * from the candidates section or the chart itself; the app computes the
 * targets from it — see `ai-levels.ts`). The Chart Pattern Candidates intro
 * now states explicitly that the pre-screener's hits are hints, not a cap —
 * the model may report any other clearly-visible pattern, listed or not
 * (`patternSummaries Writing Rules` dropped its "do not include any patterns
 * not listed" line for the same reason); `analysisGuidelines` gained a
 * matching "skills are guidance, not a boundary" rule. Bytes change for
 * every request.
 *
 * @remarks
 * Same round, response-shaping only (spec §B6) — not a prompt-byte change,
 * but bundled here since it touches the same post-processing path `p14`
 * introduced: `buildBullishRiskRewardText`'s stop-loss percent (`slLabel`)
 * now goes through `formatNullableNumber` instead of a raw `toFixed`, so a
 * stop only fractionally below entry no longer prepends the deterministic
 * `reconciledLevels.riskReward` line with `-0.0%`.
 *
 * @remarks
 * **`p16`** — confluence authority withdrawn, washout reading added (spec
 * 2026-09-25-pullback-washout-design.md). `## Deterministic Metrics` no longer
 * tells the model to treat a met daily confluence rule as "strong evidence":
 * every `Reliability:` line now says the tally is descriptive and has no
 * measured forward edge (re-measured 2000–2026: daily entry-rule days trailed
 * the baseline in all five periods). On `1Day` charts a new
 * `### Short-Term Washout (rule engine, 1Day bars)` block renders
 * `evaluatePullback` — close vs MA200, Williams %R(14), RSI(2), the MA5 exit
 * reference, the reading and its measured base rate. `entryRecommendation`
 * rules follow: "enter" accepts a washout-in-uptrend reading in place of the
 * old "bullish confluence from 2+ categories", and a bearish tally alone is no
 * longer a reason for "avoid". `### Confluence Assessment` gains two lines
 * (tally is descriptive; state a washout reading next to it). Bytes change for
 * every request.
 *
 * **`p17`** — washout entry verdict decided by the rule engine (spec
 * 2026-09-26-washout-entry-verdict-design.md). `entryRecommendation` was never
 * "enter" in production (0 of 6,070 technical analyses, p9–p16): the model read
 * a washout's normal companions as missing confirmation. A washout-in-uptrend
 * block now prints `Entry verdict (rule engine): enter — washout path`; Step 1
 * puts that path first, says it needs no confirmation and that the confluence
 * entry/exit rules are neither prerequisite nor veto; the sub-1.0 risk:reward
 * "prefer wait" rule is scoped to charts outside the washout path. The
 * near-washout and below-MA200 base-rate sentences are softened to match the
 * re-measurement. Bytes change on every 1Day request.
 *
 * **`p18`** — the washout verdict stands down on a news-driven drop (same spec,
 * §8). When an earnings, guidance or regulatory event (impact high/medium,
 * not bullish) landed within the last 3 sessions, the block prints
 * `Entry verdict (rule engine): none — …` instead of `enter`, and Step 1 tells
 * the model to judge that chart itself without citing the base rate. The
 * `enter` verdict told the model not to re-judge, so ungated it forced "enter"
 * onto exactly the drops the measurement does not cover (3 of 23 A/B enters
 * were earnings-window drops). `formatDeterministicMetricsSection` now receives
 * the prompt's `marketEvents`. Step 1 gains one line, so every 1Day request's
 * bytes change.
 *
 * **`p19`** — detector catalogue widened (spec
 * 2026-09-28-pattern-signal-expansion-design.md): six multi-candle labels
 * (above/below the stomach, rising/falling three methods, bullish/bearish
 * three-line strike), five chart-pattern candidates (rounding top, high tight
 * flag, ascending/descending channel, broadening formation — near-parallel
 * pairs that used to read as wedges now read as channels) can now appear in
 * the prompt's candle-pattern lines and `## Chart Pattern Candidates
 * (computed)`, and four signals (52-week high/low, gap up/down) now feed skill
 * gating (not the confluence tally), so cached analyses built on the old
 * catalogue are stale.
 * **`p20`** — chart overlay candidate ids (spec 2026-09-28-chart-overlays).
 * `## Chart Pattern Candidates (computed)` gains a `Candidate id:` line per
 * geometry-bearing candidate, and a new `## Chart Overlay Candidates
 * (computed)` section lists trendline/divergence/fibonacci/elliott
 * candidates by id. `patternSummaries[].candidateId`,
 * `strategyResults[].candidateIds`, and `trendlineIds` replace the old
 * `patternLines` skeleton and the free-form `trendlines` array — the model
 * now selects logic-drawn overlays by id instead of authoring coordinates.
 * `runAnalysis` joins the referenced ids against the offered candidates
 * (`resolveChartOverlays`) after the model call. Bytes change on every
 * request.
 * **`p21`** — computed facts the model used to derive and got wrong
 * (2026-10-02 real-LLM A/B, 60 runs per side): `## Indicator State` gains
 * `MA spreads`, `EMA stack`, `MA cycle (MA5/MA20/MA60)`, `RSI zone` and
 * `Gap (last bar vs previous bar)` lines and a `mixed` MA stack now prints its
 * order; Long-term Context prints dated period extremes and distances instead
 * of ratios; Fib anchor lines end with the retracement depth; pattern
 * candidates gain a `Spacing (bars)` line; candle-pattern lines carry the bar
 * date; the Indicator State guidelines are rewritten and a Consistency Across
 * Fields block is added. Bytes change on every request.
 * **`p22`** — technical-analysis prompt layout only (no wording change): the
 * fixed Analysis Intent + Analysis Guidelines blocks move from the head of the
 * user prompt to the head of `stable` (system message, ahead of the
 * `always_on` skill digests) so the cross-symbol common prefix covers them for
 * provider automatic prefix caching. Bytes change on every request.
 *
 * @internal
 */
export const PROMPT_TEMPLATE_VERSION = 'p22' as const;

/**
 * @internal Redis key for the technical-analysis **peek pointer** — the latest
 * generation for a symbol/timeframe/model/tier, written next to the exact key
 * on every fresh generation (same TTL) and read by {@link peekAnalysisCache}.
 *
 * The exact key folds inputs a read-only caller cannot reconstruct without the
 * writer's DB reads — the prior-analysis (`:hist=`) and market-event (`:evt=`)
 * fingerprints — so peeking it essentially always missed (measured on
 * production 2026-09-29: every popular symbol's SSR seed was the fallback).
 * The pointer drops those and the skill fingerprint, keeping only what a
 * reader knows. Same design as {@link buildOverallPeekCacheKey}.
 *
 * Format: `analysis:peek:<SYM>:<TF>:<model>:<promptVersion>:<tier>[:reason=on][:pos=…][:lang=…]`.
 */
export function buildAnalysisPeekCacheKey(
    symbol: string,
    timeframe: Timeframe,
    modelId: string,
    tier: string,
    reasoning?: boolean,
    positionBucket?: PositionBucket,
    locale?: AnalysisLocale
): string {
    return `analysis:peek:${symbol}:${timeframe}:${modelId}:${PROMPT_TEMPLATE_VERSION}:${tier}${reasoningKeySuffix(reasoning)}${positionKeySuffix(positionBucket)}${localeKeySuffix(locale)}`;
}

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
 * @param historyFingerprint - Prior-analysis-context fingerprint, from
 *   `narrowPriorAnalysesForCacheKey`'s `fingerprint` return value. The
 *   NEW LAST segment, appended AFTER the locale suffix. `undefined` — the
 *   caller has no `priorAnalyses`, or nothing survived the two-stage
 *   narrowing (see that function's doc) — produces no suffix at all, so this
 *   is the exact key every existing caller (and every caller that never
 *   adopts the prior-analysis-context feature) reads/writes today.
 * @param eventsFingerprint - Market-events fingerprint, from
 *   `narrowMarketEventsForCacheKey`'s `fingerprint` return value. Appended
 *   AFTER the history suffix, making it the new last segment. `undefined` —
 *   the caller has no `marketEvents`, or none of them carried `high`/`medium`
 *   impact — produces no suffix at all, so a symbol with no market-moving news
 *   reads/writes the exact key it did before this feature existed.
 * @returns The cache key.
 *
 * @example
 * ```ts
 * const key = buildAnalysisCacheKey('AAPL', '1Day', 'gemini-3.6-flash');
 * // → 'analysis:AAPL:1Day:gemini-3.6-flash:p1'
 * const keyed = buildAnalysisCacheKey('AAPL', '1Day', 'gemini-3.6-flash', 'a1b2');
 * // → 'analysis:AAPL:1Day:gemini-3.6-flash:p1:a1b2'
 * const reasoned = buildAnalysisCacheKey('AAPL', '1Day', 'gemini-3.6-flash', 'a1b2', true);
 * // → 'analysis:AAPL:1Day:gemini-3.6-flash:p1:a1b2:reason=on'
 * const bucketed = buildAnalysisCacheKey('AAPL', '1Day', 'gemini-3.6-flash', 'a1b2', true, 'profit');
 * // → 'analysis:AAPL:1Day:gemini-3.6-flash:p1:a1b2:reason=on:pos=profit'
 * const historied = buildAnalysisCacheKey('AAPL', '1Day', 'gemini-3.6-flash', 'a1b2', true, 'profit', undefined, 'c3d4');
 * // → 'analysis:AAPL:1Day:gemini-3.6-flash:p1:a1b2:reason=on:pos=profit:hist=c3d4'
 * ```
 */
export function buildAnalysisCacheKey(
    symbol: string,
    timeframe: Timeframe,
    modelId = DEFAULT_ANALYSIS_MODEL_ID,
    skillFingerprint?: string,
    reasoning?: boolean,
    positionBucket?: PositionBucket,
    locale?: AnalysisLocale,
    historyFingerprint?: string,
    eventsFingerprint?: string
): string {
    const base = `analysis:${symbol}:${timeframe}:${modelId}:${PROMPT_TEMPLATE_VERSION}`;
    const withFingerprint =
        skillFingerprint !== undefined ? `${base}:${skillFingerprint}` : base;
    return `${withFingerprint}${reasoningKeySuffix(reasoning)}${positionKeySuffix(positionBucket)}${localeKeySuffix(locale)}${historyKeySuffix(historyFingerprint)}${eventsKeySuffix(eventsFingerprint)}`;
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
 * @remarks
 * **`p2` = guarded numbers.** Index/sector changes render through a signed-percent
 * helper (a missing change printed `NaN%`) and the volatility level is rounded to
 * cents in both places the model is told to copy it verbatim.
 *
 * **`p3`** — precomputed prompt data (spec 2026-09-18 §2.9). Sector rows are
 * sorted by change descending and prefixed with rank, and the prompt gains
 * `Breadth: N up / N down / N flat`, `Best − worst sector spread: x.xxpp`,
 * and `Index average change: ±x.xx%` lines, plus a rule that leading/lagging
 * sectors must come from the top/bottom of the ranked list. Bytes change for
 * every request.
 *
 * @remarks
 * **`p4`** — precomputed prompt data, wave 2 (spec 2026-09-18 §B2).
 * `Index average change` now excludes the volatility-index (`symbol ===
 * 'VIX'`) row — the VIX's own daily swing is several times an equity
 * index's, so folding it in reported a number that tracked VIX noise more
 * than the market. Bytes change whenever `indices` includes a VIX row.
 *
 * @internal
 */
export const MARKET_BRIEFING_PROMPT_TEMPLATE_VERSION = 'p4' as const;

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
 * Prompt-template version for the macro (economy) briefing cache key.
 *
 * Same reason {@link MARKET_BRIEFING_PROMPT_TEMPLATE_VERSION} exists: without
 * this axis a change to `buildMacroBriefingPrompt`'s output takes up to a full
 * TTL (1h) to take effect, because a cache HIT inside the same `dateHour`
 * bucket returns a response the old prompt produced.
 *
 * Bump whenever `buildMacroBriefingPrompt`'s output changes in a way that would
 * make a previously cached briefing wrong or stale.
 *
 * @remarks
 * **`p1` = axis introduced with guarded figures.** Indicator values and
 * calendar estimates render through `formatPlainNumber` (a non-finite value
 * printed the literal `NaN`; binary float noise such as `0.30000000000000004`
 * reached the model).
 *
 * @remarks
 * **`p2` = 15-significant-digit precision.** `formatPlainNumber` now keeps 15
 * significant digits instead of 10 — the 10-digit rule cut real digits off
 * large published figures (`29723864123.45` rendered `29723864120`).
 *
 * **`p3`** — precomputed prompt data (spec 2026-09-18 §2.10). Indicator rows
 * gain a `(Δ ±x.xx)` delta next to the previous value, and calendar rows gain
 * an `(in N days)` suffix. Bytes change for every request.
 *
 * @remarks
 * **`p4`** — precomputed prompt data, wave 2 (spec 2026-09-18 §B3). A
 * rate-type indicator (`unit === '%'`) now renders its delta as `±x.xxpp`
 * with no `%` term; a level-type indicator (no `%` unit) renders `±delta[,
 * ±x.xx%]` — the percent term only when `previous > 0` (null rule §0) — and
 * an integer-valued series (e.g. payroll counts) formats its delta with
 * thousands separators and no forced decimals (`-10,000`, not `-10000.00`).
 * The calendar `(in N days)` suffix now reads `(today, in Nh)` / `(in Nh)`
 * for an event inside the next 24 hours, and parses FMP's naive `YYYY-MM-DD
 * HH:mm:ss` timestamp as UTC instead of the runtime's local zone. Bytes
 * change for every request.
 *
 * @internal
 */
export const MACRO_BRIEFING_PROMPT_TEMPLATE_VERSION = 'p4' as const;

/**
 * @internal Build the Redis key for a cached macro (economy) briefing.
 *
 * Format: `briefing:macro:<dateHour>:<model>:<inputHash>:<promptVersion>`. Same bucketing
 * contract as {@link buildBriefingCacheKey} (date+hour share, model scopes,
 * input hash folds in the indicator/calendar snapshot) but a distinct `macro:`
 * namespace so market and economy briefings never collide.
 */
export function buildMacroBriefingCacheKey(
    dateHour: string,
    model: string,
    inputHash: string
): string {
    return `briefing:macro:${dateHour}:${model}:${inputHash}:${MACRO_BRIEFING_PROMPT_TEMPLATE_VERSION}`;
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
 * @remarks
 * **`p4` = guarded figures.** `actual` / `estimate` / `previous` render through
 * `formatPlainNumber`: a non-finite value used to print the literal `NaN`, and
 * binary float noise (`0.30000000000000004`) reached the model. Clean figures
 * render byte-identically; the bump keeps entries generated from corrupt inputs
 * from being served for the rest of their 1-day TTL.
 *
 * @remarks
 * **`p5` = 15-significant-digit precision.** `formatPlainNumber` now keeps 15
 * significant digits instead of 10 — the 10-digit rule cut real digits off
 * large published figures (`29723864123.45` rendered `29723864120`).
 *
 * **`p6`** — precomputed prompt data (spec 2026-09-18 §2.11). `## Event
 * Details` gains `Actual vs Estimate: ±x.xx (above/below/in line)` and
 * `Actual vs Previous: ±x.xx (higher/lower/unchanged)` lines, and the "Key
 * signal" sentence points at them instead of asking the model to compare the
 * figures itself. Bytes change for every request.
 *
 * @remarks
 * **`p7`** — precomputed prompt data, wave 2 (spec 2026-09-18 §B7). When
 * `unit === '%'`, the Actual-vs-Estimate/Previous deltas now render as
 * `±x.xxpp` (a delta of two percentages is a percentage-point figure, not a
 * percent) instead of `±x.xx %`. `Actual`/`Estimate`/`Previous` themselves
 * attach a `%` unit with no leading space (`0.20%`, not `0.20 %`); every
 * other unit keeps the space (`150 K`). Bytes change for every `%`-unit
 * request; unchanged for every other unit.
 *
 * @internal
 */
export const ECONOMIC_EVENT_PROMPT_TEMPLATE_VERSION = 'p7' as const;

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
 * Prompt-template version for the fundamental-analysis cache keys.
 *
 * **Why this exists as its own constant.** Until now the fundamental key
 * embedded {@link PROMPT_TEMPLATE_VERSION}, the *technical* axis's constant,
 * so every technical-prompt bump cold-started the entire fundamental cache
 * fleet (TTL {@link FUNDAMENTAL_CACHE_TTL_SECONDS} = 1 day, and each miss
 * fans out to ~13 parallel upstream calls) for a change that altered zero
 * fundamental prompt bytes. Every other analysis type — financials, congress,
 * news, briefing, economic-event, indicator-translation — already carries an
 * independent version; fundamental was the last one still coupled.
 *
 * Splitting it is only free at a moment when the fundamental cache is being
 * invalidated anyway. The p8→p9 technical bump shipping alongside this change
 * is exactly that moment: the one-time cold start happens either way, and
 * afterwards fundamental stops paying for technical's prompt iterations.
 *
 * `f1` starts the independent series. Bump it whenever the fundamental system
 * or user prompt template changes in a way that makes cached results stale.
 *
 * @remarks
 * **`f2` = currency-aware amounts.** Market caps, cash flow, and revenue
 * estimates render scaled with their listing currency (a KRX cap arrived in
 * won and printed as ~`1600000B USD`; a sub-$500M cap printed as `0B`), a
 * missing cap renders `N/A`, percent metrics never print `N/A%`, the debt
 * ratio carries its `%`, and a missing Piotroski score is `N/A` instead of
 * `N/A/9`.
 *
 * **`f3` = two currencies.** Statement and per-share figures (EPS, operating
 * cash flow, analyst estimates) are labelled with the filer's reporting
 * currency, or left unlabelled when the provider does not report it — an ADR
 * files in its home currency, and TSM's TWD figures printed as `USD`. Market
 * cap and price targets keep the listing currency, which is now supplied by
 * the caller instead of inferred from the symbol. Amounts that round up to the
 * next scale render there (`1.0B`, not `1000.0M`).
 *
 * **`f4`** — precomputed prompt data (spec 2026-09-18 §2.6). A new
 * `## Derived Metrics (computed)` section renders target upside vs current
 * price, price-target trend (1M vs 1Y avg), peer P/E and P/S medians with
 * premium/discount, analyst buy share, EPS estimate vs TTM, and days to next
 * earnings — all previously left for the model to work out. Bytes change for
 * every request.
 *
 * @remarks
 * **`f5`** — precomputed prompt data, wave 2 (spec 2026-09-18 §B4). The
 * computed `## Derived Metrics (computed)` line is relabelled `Price Target
 * Momentum` — it collided with the raw `## Forward / Analyst Outlook`
 * section's own `Price Target Trend` line (the priceTargetSummary readout),
 * two different numbers under one identical label. Bytes change for every
 * request.
 *
 * Same bump, spec §B6: `formatPeerMetric` (`## Comparable Peers` PER/PSR)
 * now delegates to `formatNullableNumber` instead of a raw `toFixed`, so a
 * loss-making peer's negative P/E no longer renders `-0.0` when it rounds
 * to exactly zero.
 *
 * @internal
 */
export const FUNDAMENTAL_PROMPT_TEMPLATE_VERSION = 'f5' as const;

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
    const base = `${CACHE_KEY_SCHEMA_VERSION}:analysis:fundamental:${symbol}:${modelId}:${FUNDAMENTAL_PROMPT_TEMPLATE_VERSION}`;
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
 * @remarks
 * **`p6` = currency-aware amounts.** Statement amounts render as T/B/M with
 * the listing currency (KRX statements are in won, previously printed as bare
 * `B`), and non-finite margins/growth render `N/A` instead of `NaN%`.
 *
 * **`p7` = reporting currency.** Statement amounts carry each row's reporting
 * currency and stay unlabelled when it is unknown, instead of the listing
 * currency inferred from the symbol (an ADR's TWD statements printed as
 * `USD`). Amounts that round up to the next scale render there.
 *
 * **`p8`** — precomputed prompt data (spec 2026-09-18 §2.7). Income Statement
 * and Cash Flow gain a `Margin Trend (latest vs prior same-period row)` line
 * (gross/operating/net/FCF change in `pp`), and Balance Sheet gains a
 * `Liabilities / Equity` line for the latest row. Bytes change for every
 * request that has at least one statement row.
 *
 * @internal
 */
export const FINANCIALS_PROMPT_TEMPLATE_VERSION = 'p8' as const;

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
 * buildFinancialsCacheKey('AAPL', 'gemini-3.6-flash', 'annual');
 * // → 'v1:analysis:financials:AAPL:annual:gemini-3.6-flash:p1'
 * buildFinancialsCacheKey('AAPL', 'gemini-3.6-flash', 'quarter', 'sk1');
 * // → 'v1:analysis:financials:AAPL:quarter:gemini-3.6-flash:p1:sk1'
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
 * buildCongressTrendCacheKey('AAPL', 'gemini-3.6-flash');
 * // → 'v1:analysis:congress:AAPL:gemini-3.6-flash:p1'
 * buildCongressTrendCacheKey('AAPL', 'gemini-3.6-flash', 'sk1');
 * // → 'v1:analysis:congress:AAPL:gemini-3.6-flash:p1:sk1'
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
 * @remarks
 * **`p5` = listing framing + currency.** KRX symbols are framed as Korean
 * listings instead of "a publicly traded U.S. equity", and earnings-calendar
 * revenue estimates carry their currency.
 *
 * **`p6` = supplied currency.** The Korean-listing framing and the calendar
 * currency follow the caller-supplied listing currency instead of the symbol
 * suffix, and amounts that round up to the next scale render there.
 *
 * **`p7`** — precomputed prompt data (spec 2026-09-18 §2.8). Both builders
 * gain a `Sentiment tally: N bullish / N bearish / N neutral (high impact: …)`
 * header, each item's `Published:` line gains an `(Nh ago | Nd ago)` suffix,
 * and news-analysis calendar rows gain `(in N days | N days ago)`. Bytes
 * change for every request.
 *
 * **`p8`** — reader-facing `currentDriverKo`. The schema field description no
 * longer says the driver is based on "provided" news (models copied that into
 * the published copy); the source boundary moved into Rules, which also gain a
 * rule against referring to the input itself. The no-articles rule stops
 * telling the model to say no articles "were provided". Bytes change for every
 * request of both builders.
 *
 * @internal
 */
export const NEWS_PROMPT_TEMPLATE_VERSION = 'p8' as const;

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
 * buildMarketNewsDigestCacheKey('crypto', 'deepseek-v4.1-flash', 'abc123');
 * // → 'v1:analysis:market-news:crypto:deepseek-v4.1-flash:p2:abc123'
 * buildMarketNewsDigestCacheKey('crypto', 'deepseek-v4.1-flash', 'abc123', true);
 * // → 'v1:analysis:market-news:crypto:deepseek-v4.1-flash:p2:abc123:reason=on'
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
 * buildNewsCacheKey('AAPL', 'gemini-3.1-pro-preview', 'h2');
 * // → 'v1:analysis:news:AAPL:gemini-3.1-pro-preview:p2:h2'
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
 * Prompt-template version for the overall (3-axis) analysis cache keys.
 *
 * Parallel to {@link FUNDAMENTAL_PROMPT_TEMPLATE_VERSION} /
 * {@link FINANCIALS_PROMPT_TEMPLATE_VERSION} but scoped to the overall
 * analysis type, so a change to `buildOverallAnalysisPrompt`'s rendered output
 * can be invalidated independently of the other analysis types.
 *
 * Bump this string whenever `buildOverallAnalysisPrompt`'s output changes in a
 * way that would make previously cached results stale.
 *
 * @remarks
 * **`p1` introduces this axis**, together with the numeric-rendering audit
 * that changed `buildOverallAnalysisPrompt`'s rendered bytes: KRX symbols get
 * Korean-listing framing instead of "U.S. equity", and level prices render at
 * a magnitude-aware precision instead of a fixed two decimals. The key
 * previously carried no template-version segment, so pre-change entries
 * (1-day TTL) kept being served after the prompt changed; `p1` gives this
 * builder the same invalidation lever its siblings already have.
 *
 * **`p2` = one precision per list.** Technical levels and targets render at
 * the precision the finest of them needs instead of each at its own magnitude
 * (a list near $1 mixed `0.9950` with `1.01`); framing and precision follow
 * the supplied listing currency instead of the symbol suffix. It also clears
 * entries built from Fear & Greed and prior-analysis bars fetched before
 * placeholder bars were dropped — those inputs are not folded into this key's
 * `inputHash`.
 *
 * **`p3`** — precomputed prompt data (spec 2026-09-18 §2.5): `formatTechnical`
 * gains a `- Snapshot Price: X` line (when `bars` was supplied) and every
 * support/resistance/target row gains a `(±x.xx% from snapshot)` suffix, so
 * the model no longer has to guess distance from a price it was never given.
 * Bytes change only when the caller supplies `bars`; the constant has no
 * per-request axis to scope the bump to, so it is fleet-wide anyway.
 *
 * **`p4`** — optional news axis (2026-09-21). `buildOverallAnalysisPrompt`'s
 * `news` parameter accepts `null` (no items in the analysis window), and three
 * pieces of template text changed with it — **the first two render on every
 * request**, which is what forces the bump:
 *
 * 1. The Rules line `- technicalBulletsKo, newsBulletsKo: provide 2–4 bullets
 *    each.` split into a plain `technicalBulletsKo` line plus a conditional
 *    `newsBulletsKo` line ("leave the array empty when the news axis indicates
 *    no coverage was available"). Without that split the tail of the prompt
 *    orders 2–4 news bullets right after the Axis-3 body says there is no
 *    coverage — the model invents them.
 * 2. `formatAxisScore`'s abstention rule names the absent news axis alongside
 *    crypto fundamentals, so the example no longer reads as crypto-scoped.
 * 3. The crypto `assetContext` no longer tells the model to synthesize from a
 *    news axis that may itself be empty. **Conditional** — crypto only, and
 *    only when `news === null`.
 *
 * Items 1 and 2 sit in the unconditional `dynamic` string, so **every** overall
 * prompt changes — not just the no-news path. That alone forces the bump. The
 * Axis-3 section itself is byte-identical for a symbol that has news, which is
 * why the first draft of this change claimed an exemption; that claim was wrong,
 * and rendering the prompt on both revisions and diffing it is what caught it.
 * A section-scoped byte test cannot back a whole-prompt claim — `overallPrompt.test.ts`
 * now pins the full prompt for the default equity path and for crypto + no-news.
 *
 * @internal
 */
export const OVERALL_PROMPT_TEMPLATE_VERSION = 'p4' as const;

/**
 * Build the Redis key for a cached overall (3-axis) analysis result.
 *
 * Format: `analysis:overall:<symbol>:<timeframe>:<modelId>:<promptVersion>:<inputHash>`.
 * The `timeframe` distinguishes analyses run with different chart contexts;
 * the {@link OVERALL_PROMPT_TEMPLATE_VERSION} segment invalidates the cache
 * when the overall prompt template changes.
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
    return `${CACHE_KEY_SCHEMA_VERSION}:analysis:overall:${symbol}:${timeframe}:${modelId}:${OVERALL_PROMPT_TEMPLATE_VERSION}:${inputHash}${reasoningKeySuffix(reasoning)}${localeKeySuffix(locale)}`;
}

/**
 * @internal Multiplier applied to the *averaged* calendar span of the
 * prior-analysis window before the closure allowance is added.
 *
 * Bars are not evenly spaced in calendar time, so an average understates any
 * window that happens to straddle a weekend. This absorbs the ordinary
 * two-day gap; {@link MAX_MARKET_CLOSURE_DAYS} covers the long ones.
 */
const HISTORY_WEEKEND_SAFETY_FACTOR = 1.5;

/**
 * @internal Flat calendar-day allowance for the longest stretch the U.S.
 * equity market stays shut — a holiday adjoining a weekend (e.g. Friday close
 * to Tuesday open is ~4 days; 5 leaves margin for a Thursday-holiday week).
 *
 * On short timeframes this term dominates: 21 five-minute bars span barely
 * any calendar time, so without it the query window closes long before the
 * prior trading session's analyses.
 */
const MAX_MARKET_CLOSURE_DAYS = 5;

/**
 * Sizes the consumer's own "recent analyses" query for
 * `SubmitAnalysisOptions.priorAnalyses`.
 *
 * The consumer's database knows nothing about bars, so this is a **coarse
 * pre-filter only** — deliberately generous. Core re-cuts precisely afterwards
 * in two stages: `narrowPriorAnalysesForCacheKey` drops entries inside
 * the current cache window, then `selectPriorAnalyses` applies the real
 * bar-anchored window. Over-fetching here costs one wider `WHERE` clause;
 * under-fetching silently disables the feature, because core can only narrow
 * what it was handed.
 *
 * **Why `sinceMs` is derived from calendar days per bar, not from a cache
 * TTL.** The window this feature actually cares about is
 * {@link PRIOR_ANALYSIS_WINDOW_BARS} **bars**, and bars are not
 * evenly spaced in wall-clock time — they skip nights, weekends, and
 * holidays. Sizing the query from `ANALYSIS_CACHE_TTL` (one bar of *clock*
 * time per bar) reintroduces exactly the defect the bar-counted window exists
 * to avoid: on `'5Min'` it yields a 1.75-hour cutoff, so the prior session's
 * closing analysis — roughly 17.5 hours old at the next open — is excluded by
 * the consumer's SQL and never reaches `selectPriorAnalyses` at all. The
 * feature would then appear to work while silently rendering nothing for the
 * first hours of every session.
 *
 * `TIMEFRAME_LOOKBACK_DAYS` over `TIMEFRAME_BARS_LIMIT` gives
 * calendar days per bar — but that ratio is an **average**, and the gap that
 * matters here is the **worst case**. Averaged over a year, a 5-minute bar is
 * ~3.5 calendar minutes apart; across a Friday close to a Monday open it is
 * 65.5 hours, and across a holiday Monday, 89.5 hours. Sizing from the average
 * alone gives `'5Min'` a 17.5-hour window, which clears one overnight gap and
 * then fails every single Monday — the same silent failure this whole
 * derivation exists to prevent, merely relocated from "the first hours of each
 * session" to "all day, every Monday and after every market holiday".
 *
 * So the averaged span is widened by {@link HISTORY_WEEKEND_SAFETY_FACTOR} and
 * then offset by {@link MAX_MARKET_CLOSURE_DAYS}, a flat allowance for the
 * longest stretch the market is shut. The offset is what actually carries the
 * short timeframes: 21 five-minute bars span almost no calendar time, so their
 * window is essentially "the last long weekend plus change".
 *
 * Erring long is the correct bias here and costs almost nothing — this is a
 * coarse pre-filter and core re-cuts precisely afterwards, so over-fetching
 * widens one `WHERE` clause while under-fetching disables the feature with no
 * error anywhere.
 *
 * **No `tab` parameter.** An earlier revision took one, on the theory that the
 * overall axis needed a different window because its cache TTL is a fixed day.
 * That was wrong: the TTL governs the *recency exclusion*, which core applies
 * itself in stage 1, not how far back the consumer must look. Both axes need
 * the same 21 bars of history, so both get the same query. The consumer still
 * filters its own rows by tab — this helper only sizes the range.
 *
 * One consequence worth knowing: on the overall axis, stage 1 excludes
 * everything newer than a day, so on short timeframes (`'5Min'`, where 21 bars
 * span less than a day) the two bounds do not overlap and the prior-analysis
 * section is legitimately always empty. That degrades to today's behaviour
 * rather than misbehaving.
 *
 * **The query must also exclude the current cache bucket
 * (`generatedBeforeMs`).** Stage 1 drops every row newer than the window from
 * the key, but the consumer's `ORDER BY generated_at DESC LIMIT limit` runs
 * first. Once in-window rows fill the limit, each fresh generation pushes the
 * oldest out-of-window row out of the result set, the survivor set changes,
 * and the `:hist=` fingerprint changes — so the very next request misses and
 * generates again, forever. Measured on production (PLTR 1Day, 2026-09-29):
 * every generation after the 21 slots filled produced a new fingerprint.
 * Excluding the bucket in SQL (`generated_at < generatedBeforeMs`) makes the
 * result set depend only on rows older than the bucket start, which new
 * generations cannot displace. The boundary is the same anchored bucket start
 * stage 1 uses ({@link priorAnalysisWindowStartMs}), so SQL and key agree.
 *
 * @param timeframe - Bar resolution the consumer will query history for.
 * @param axis - Which cache consumes the history. The technical key's window
 *   is {@link ANALYSIS_CACHE_TTL}`[timeframe]`; the overall key's is
 *   {@link OVERALL_CACHE_TTL_SECONDS} (a fixed day) — pass the axis whose
 *   `narrowPriorAnalysesForCacheKey` window the rows will feed.
 * @param now - Reference time; defaults to the current time.
 * @returns `limit` — the maximum rows worth fetching — `sinceMs`, how far
 *   back in milliseconds the `WHERE` clause should reach from now, and
 *   `generatedBeforeMs`, the epoch-ms upper bound (exclusive) for
 *   `generated_at`.
 */
export function analysisHistoryQuery(
    timeframe: Timeframe,
    axis: AnalysisHistoryAxis = 'technical',
    now: Date = new Date()
): AnalysisHistoryQuery {
    const limit = PRIOR_ANALYSIS_WINDOW_BARS;
    const calendarDaysPerBar =
        TIMEFRAME_LOOKBACK_DAYS[timeframe] / TIMEFRAME_BARS_LIMIT[timeframe];
    const days =
        calendarDaysPerBar * limit * HISTORY_WEEKEND_SAFETY_FACTOR +
        MAX_MARKET_CLOSURE_DAYS;
    const windowSeconds =
        axis === 'overall'
            ? OVERALL_CACHE_TTL_SECONDS
            : ANALYSIS_CACHE_TTL[timeframe];
    return {
        limit,
        sinceMs: Math.ceil(days * MS_PER_DAY),
        generatedBeforeMs: priorAnalysisWindowStartMs(windowSeconds, now),
    };
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
 * Format: `{version}:analysis:overall:peek:<symbol>:<timeframe>:<modelId>:<promptVersion>`.
 *
 * Unlike {@link buildOverallCacheKey}, this key omits the input hash so it can
 * be reconstructed from `(symbol, timeframe, modelId)` alone — without
 * resolving the four dependency axes (which is the only way to derive the
 * input hash, and which would entail cache reads / potential generation). The
 * {@link OVERALL_PROMPT_TEMPLATE_VERSION} segment is still required here even
 * though this is an overwrite-latest pointer: without it, a prompt-template
 * change would leave this pointer serving the stale overall result until
 * something else overwrites it.
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
    return `${CACHE_KEY_SCHEMA_VERSION}:analysis:overall:peek:${symbol}:${timeframe}:${modelId}:${OVERALL_PROMPT_TEMPLATE_VERSION}${reasoningKeySuffix(reasoning)}${localeKeySuffix(locale)}`;
}

/**
 * Prompt-template version for the options analysis cache keys.
 *
 * Parallel to {@link FUNDAMENTAL_PROMPT_TEMPLATE_VERSION} /
 * {@link FINANCIALS_PROMPT_TEMPLATE_VERSION} but scoped to the options
 * analysis type, so a change to `buildOptionsAnalysisPrompt`'s rendered output
 * can be invalidated independently of the other analysis types.
 *
 * Bump this string whenever `buildOptionsAnalysisPrompt`'s output changes in a
 * way that would make previously cached results stale.
 *
 * @remarks
 * **`p1` introduces this axis**, together with the numeric-rendering audit
 * that changed `buildOptionsAnalysisPrompt`'s rendered bytes: the current
 * price renders with cents instead of a whole number, and the metric JSON
 * values render at 4-decimal precision. The key previously carried no
 * template-version segment, so pre-change entries (1-day TTL) kept being
 * served after the prompt changed; `p1` gives this builder the same
 * invalidation lever its siblings already have.
 *
 * **`p2`** — precomputed prompt data (spec 2026-09-18 §2.4):
 * `summarizeChainForLlm` gained `daysToExpiration`, `maxPainDistancePct`,
 * `impliedMoveRange`, per-strike `distancePct`/`side`, and per-quote
 * `callSpreadPct`/`putSpreadPct`, and the Interpretation Guide gained one
 * line per field — the rendered Key Metrics JSON and guide text both
 * changed, so pre-`p2` cache entries would serve stale metrics.
 *
 * @remarks
 * **`p3`** — precomputed prompt data, wave 2 (spec 2026-09-18 §B5).
 * `summarizeChainForLlm`'s `distancePct` / `maxPainDistancePct` /
 * `callSpreadPct` / `putSpreadPct` now round to exactly 2 decimal places at
 * the source (previously unrounded floating-point ratios) — the rendered
 * Key Metrics JSON changes for every request.
 *
 * @internal
 */
export const OPTIONS_PROMPT_TEMPLATE_VERSION = 'p3' as const;

/**
 * @internal Build the Redis key for a cached options analysis result.
 *
 * Format: `{version}:analysis:options:<symbol>:<expirationDate>:<modelId>:<promptVersion>:<snapshotInputHash>`.
 *
 * The schema-version prefix ({@link CACHE_KEY_SCHEMA_VERSION}) ensures future
 * shape changes invalidate the cache automatically, matching the sibling
 * analysis cache-key builders above; the {@link OPTIONS_PROMPT_TEMPLATE_VERSION}
 * segment invalidates the cache when the options prompt template changes.
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
    return `${CACHE_KEY_SCHEMA_VERSION}:analysis:options:${symbol}:${expirationDate}:${modelId}:${OPTIONS_PROMPT_TEMPLATE_VERSION}:${snapshotInputHash}${reasoningKeySuffix(reasoning)}${localeKeySuffix(locale)}`;
}
