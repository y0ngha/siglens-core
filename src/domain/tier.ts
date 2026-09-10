import type {
    ModelAccess,
    Tier,
    TierConfig,
    TierInfoDepth,
    TierLimitedFeature,
    ModelId,
    TierModel,
    Timeframe,
} from '@/domain/types';
import { TIMEFRAMES } from '@/domain/constants/market';

/** All supported subscription tiers, ordered free -> member -> pro. */
const TIER_VALUES = [
    'free',
    'member',
    'pro',
] as const satisfies readonly Tier[];
const TIER_VALUE_STRINGS: readonly string[] = TIER_VALUES;

const FREE_TIMEFRAMES: readonly Timeframe[] = ['1Day'];
const MEMBER_TIMEFRAMES: readonly Timeframe[] = [...TIMEFRAMES];
const PRO_TIMEFRAMES: readonly Timeframe[] = [...TIMEFRAMES];
const FREE_INFO_DEPTH: readonly TierInfoDepth[] = [
    'direction',
    'summary',
    // Free sees the detection output of the skills its analysis already ran
    // with. Skill sampling caps free to <=3 skills per prompt-injection group
    // (see createSkillSamplingPlan), so this exposes only that limited set; the
    // signup nudge invites members to unlock the full skill catalogue.
    'skill_detection',
];
const PRO_INFO_DEPTH: readonly TierInfoDepth[] = [
    ...FREE_INFO_DEPTH,
    'partial_detail',
    'full_detail',
    'entry',
    'stoploss',
    'target',
    'confidence',
];
const MEMBER_INFO_DEPTH: readonly TierInfoDepth[] = [...PRO_INFO_DEPTH];
// 아래 세 목록은 **서로소**다. 누적(`[...FREE_MODELS, ...]`) 방식이 아니므로
// 한 모델은 정확히 한 목록에만 존재하며, `getModelAccess`가 단일 값을 돌려줄 수
// 있다. 등급별 **허용 목록**(누적)이 필요한 `TIER_CONFIG.models`는 이 셋에서
// 파생한다.
//
// 배치 기준은 출력 단가다. Free ≤ $5 < Member ≤ $12 < Byok ≥ $20으로 구간이
// 겹치지 않는다. provider 내부 순위가 아니라 절대 단가로 자르는 이유는, provider마다
// 가격 스케일이 달라 상대 순위로 나누면 싼 모델이 상위 등급에 올라가는 역전이
// 생기기 때문이다.

/** 서버 키로 대납하며 비회원도 호출할 수 있는 모델. */
const FREE_MODELS: readonly TierModel[] = [
    'gpt-5.6-luna',
    'gemini-3.5-flash-lite',
    'deepseek-v4.1-flash',
    'gemini-3.6-flash',
    'claude-haiku-4-5',
];

/**
 * 서버 키로 대납하되 로그인을 요구하는 모델. BYOK 키는 필요 없다.
 *
 * ⚠️ 일일 분석 한도(`TIER_CONFIG.limits.analysisPerDay`)가 `Infinity`이므로
 * 이 목록의 모델은 회원당 무제한으로 대납된다. 목록을 넓힐 때는 한도 도입 여부를
 * 함께 검토할 것.
 */
const MEMBER_MODELS: readonly TierModel[] = [
    'gemini-3.7-flash',
    'gemini-3.8-flash',
    'deepseek-v4.1-pro',
    'claude-sonnet-5',
    'gpt-5.6-terra',
    'gemini-3.1-pro-preview',
];

/**
 * 사용자 BYOK 키로만 호출되는 모델 (`requiresByokKey` → siglens
 * `resolveTierAndByok`).
 *
 * pro 티어는 이 목록도 서버 키로 대납한다 — 즉 Byok 목록은 "pro 라이선스가
 * 열리면 pro에게 제공될 모델"과 같은 집합이다. pro 라이선스를 운영하지 않는
 * 현재는 BYOK 키가 유일한 경로다.
 */
const BYOK_MODELS: readonly TierModel[] = [
    'gpt-5.6-sol',
    'claude-opus-4-8',
    'claude-opus-5',
    'claude-fable-5-1',
    'gpt-6-astra',
];

/** 등급별 누적 허용 목록 — 상위 등급은 하위 등급 모델을 모두 포함한다. */
const MEMBER_ALLOWED_MODELS: readonly TierModel[] = [
    ...FREE_MODELS,
    ...MEMBER_MODELS,
];
const PRO_ALLOWED_MODELS: readonly TierModel[] = [
    ...MEMBER_ALLOWED_MODELS,
    ...BYOK_MODELS,
];

/** Default tier assigned to unauthenticated or newly-created users. */
export const DEFAULT_TIER: Tier = 'free';

/**
 * Central source of truth for tier limits and gated capabilities.
 *
 * `featureFlags` defaults, explained:
 * - `enableTierRestrictions: false`: the legacy, coarse-grained flag stays
 *   off because model gating and daily usage limits (see {@link isAllowed},
 *   {@link getAllowedModels}) are intentionally OFF for this launch; every
 *   tier can use every model with no usage cap.
 * - `enableTimeframeRestrictions: true` and `enableInfoDepthRestrictions: true`
 *   are ON by default because free-tier timeframe gating (1Day only) and
 *   info-depth gating (direction/summary only) ARE the product default for
 *   this feature; this is intended, not an accidental leftover.
 * - The granular flags are the source of truth for their respective checks;
 *   `enableTierRestrictions` is only consulted as the legacy fallback when a
 *   granular flag is `undefined` (see {@link resolveRestrictionFlag} and its
 *   use in `resolveAllowedTimeframes` / `resolveAllowedInfoDepths`).
 */
export const TIER_CONFIG = {
    limits: {
        analysisPerDay: { free: Infinity, member: Infinity, pro: Infinity },
        chatbotPerDay: { free: Infinity, member: Infinity, pro: Infinity },
    },
    timeframes: {
        free: FREE_TIMEFRAMES,
        member: MEMBER_TIMEFRAMES,
        pro: PRO_TIMEFRAMES,
    },
    infoDepth: {
        free: FREE_INFO_DEPTH,
        member: MEMBER_INFO_DEPTH,
        pro: PRO_INFO_DEPTH,
    },
    models: {
        free: FREE_MODELS,
        member: MEMBER_ALLOWED_MODELS,
        pro: PRO_ALLOWED_MODELS,
    },
    featureFlags: {
        enableTierRestrictions: false,
        enableTimeframeRestrictions: true,
        enableInfoDepthRestrictions: true,
    },
} as const satisfies TierConfig;

/**
 * @internal Resolve a granular restriction flag, falling back to the legacy
 * `enableTierRestrictions` flag when the granular flag is `undefined`.
 */
export function resolveRestrictionFlag(
    specific: boolean | undefined,
    legacy: boolean
): boolean {
    return specific ?? legacy;
}

function resolveAllowedTimeframes(
    tier: Tier,
    config: TierConfig
): readonly Timeframe[] {
    const { enableTierRestrictions, enableTimeframeRestrictions } =
        config.featureFlags;
    const isRestricted = resolveRestrictionFlag(
        enableTimeframeRestrictions,
        enableTierRestrictions
    );
    return isRestricted ? config.timeframes[tier] : TIMEFRAMES;
}

function resolveAllowedInfoDepths(
    tier: Tier,
    config: TierConfig
): readonly TierInfoDepth[] {
    const { enableInfoDepthRestrictions, enableTierRestrictions } =
        config.featureFlags;
    const isRestricted = resolveRestrictionFlag(
        enableInfoDepthRestrictions,
        enableTierRestrictions
    );
    return isRestricted ? config.infoDepth[tier] : PRO_INFO_DEPTH;
}

function resolveAllowedModels(
    tier: Tier,
    config: TierConfig
): readonly TierModel[] {
    return config.featureFlags.enableTierRestrictions
        ? config.models[tier]
        : PRO_ALLOWED_MODELS;
}

/**
 * Return whether a daily usage-limited feature is enabled for the tier.
 *
 * Always returns `true` when `config.featureFlags.enableTierRestrictions` is `false`.
 *
 * @param tier - The user's subscription tier.
 * @param feature - The daily-limited feature to check.
 * @param config - Tier configuration; defaults to {@link TIER_CONFIG}.
 * @returns `true` if the feature is permitted for the tier, `false` otherwise.
 * @example
 * ```typescript
 * isAllowed('member', 'analysisPerDay');
 * ```
 */
export function isAllowed(
    tier: Tier,
    feature: TierLimitedFeature,
    config: TierConfig = TIER_CONFIG
): boolean {
    return config.featureFlags.enableTierRestrictions
        ? config.limits[feature][tier] > 0
        : true;
}

/**
 * Return the configured daily limit for a tiered feature.
 *
 * @param tier - The user's subscription tier.
 * @param feature - The daily-limited feature to read the limit for.
 * @param config - Tier configuration; defaults to {@link TIER_CONFIG}.
 * @returns The configured daily limit; `Infinity` when uncapped.
 */
export function getTierLimit(
    tier: Tier,
    feature: TierLimitedFeature,
    config: TierConfig = TIER_CONFIG
): number {
    return config.limits[feature][tier];
}

/**
 * Return the timeframes available to a tier.
 *
 * Always returns every known timeframe when
 * `config.featureFlags.enableTimeframeRestrictions` is `false`.
 *
 * @param tier - The user's subscription tier.
 * @param config - Tier configuration; defaults to {@link TIER_CONFIG}.
 * @returns A new array of allowed timeframes for the active restriction mode.
 * @example
 * ```typescript
 * const allowedTimeframes = getAllowedTimeframes('free');
 * ```
 */
export function getAllowedTimeframes(
    tier: Tier,
    config: TierConfig = TIER_CONFIG
): Timeframe[] {
    return [...resolveAllowedTimeframes(tier, config)];
}

/**
 * Return the AI models currently available to a tier.
 *
 * When tier restrictions are disabled, returns every configured model across
 * all tiers so launch-time callers can render the complete model picker.
 *
 * @param tier - The user's subscription tier.
 * @param config - Tier configuration; defaults to {@link TIER_CONFIG}.
 * @returns A new array containing the model ids available to the tier.
 * @example
 * ```typescript
 * getAllowedModels('free');
 * // => every configured model when tier restrictions are disabled
 *
 * getAllowedModels('member', restrictedConfig);
 * // => models configured for the member tier when restrictions are enabled
 * ```
 * @see isModelAllowed
 */
export function getAllowedModels(
    tier: Tier,
    config: TierConfig = TIER_CONFIG
): ModelId[] {
    return config.featureFlags.enableTierRestrictions
        ? [...config.models[tier]].toSorted()
        : Array.from(new Set(Object.values(config.models).flat())).toSorted();
}

/**
 * Return whether a timeframe is available to the tier.
 *
 * Always returns `true` when
 * `config.featureFlags.enableTimeframeRestrictions` is `false`.
 *
 * @param tier - The user's subscription tier.
 * @param timeframe - The timeframe to check.
 * @param config - Tier configuration; defaults to {@link TIER_CONFIG}.
 * @returns `true` if the timeframe is permitted for the tier, `false` otherwise.
 */
export function isTimeframeAllowed(
    tier: Tier,
    timeframe: Timeframe,
    config: TierConfig = TIER_CONFIG
): boolean {
    return resolveAllowedTimeframes(tier, config).includes(timeframe);
}

/**
 * Return whether an AI detail fragment is available to the tier.
 *
 * Always returns `true` when
 * `config.featureFlags.enableInfoDepthRestrictions` is `false`.
 *
 * @param tier - The user's subscription tier.
 * @param infoDepth - The detail fragment to check.
 * @param config - Tier configuration; defaults to {@link TIER_CONFIG}.
 * @returns `true` if the detail fragment is permitted for the tier, `false` otherwise.
 */
export function isInfoDepthAllowed(
    tier: Tier,
    infoDepth: TierInfoDepth,
    config: TierConfig = TIER_CONFIG
): boolean {
    return resolveAllowedInfoDepths(tier, config).includes(infoDepth);
}

/**
 * Return whether an AI model is available to the tier.
 *
 * Always returns `true` when `config.featureFlags.enableTierRestrictions` is `false`.
 *
 * @param tier - The user's subscription tier.
 * @param model - The AI model identifier to check.
 * @param config - Tier configuration; defaults to {@link TIER_CONFIG}.
 * @returns `true` if the model is permitted for the tier, `false` otherwise.
 */
export function isModelAllowed(
    tier: Tier,
    model: TierModel,
    config: TierConfig = TIER_CONFIG
): boolean {
    return resolveAllowedModels(tier, config).includes(model);
}

/**
 * Runtime guard for tier values loaded from external systems.
 *
 * @param value - Arbitrary string value to validate.
 * @returns `true` if `value` is a known {@link Tier}, narrowing the type.
 */
export function isTier(value: string): value is Tier {
    return TIER_VALUE_STRINGS.includes(value);
}

/**
 * Classify a model by how it is paid for and who may reach it.
 *
 * This is the single access axis. It replaces the previous binary
 * free/premium split, which could not express "member pays nothing but must
 * be logged in".
 *
 * | 결과 | 접근 | 비용 |
 * |---|---|---|
 * | `'free'` | 비회원 포함 누구나 | 서버 키 |
 * | `'member'` | 로그인 필요 | 서버 키 |
 * | `'byok'` | 로그인 + 해당 provider 키 (pro면 키 면제) | 사용자 키 |
 *
 * Derived from `config.models`, whose three lists are cumulative — a member
 * may use every free model, and pro every member model. The exclusive class
 * is therefore the *narrowest* list containing the model.
 *
 * Like {@link isModelAllowed}'s counterpart classifiers, this intentionally
 * **ignores** `config.featureFlags.enableTierRestrictions`: it describes the
 * model's intrinsic class, not an access decision, so it must answer the same
 * way regardless of restriction mode.
 *
 * @param model - The AI model identifier to classify.
 * @param config - Tier configuration; defaults to {@link TIER_CONFIG}.
 * @returns The model's access class.
 * @throws {Error} When `model` appears in none of the three lists — a model
 *   that exists in `MODEL_SPECS` but was never placed in `domain/tier.ts`.
 *   The compiler cannot catch that omission, so it is surfaced loudly here
 *   rather than silently defaulting to the most permissive class.
 */
export function getModelAccess(
    model: ModelId,
    config: TierConfig = TIER_CONFIG
): ModelAccess {
    // The lists are typed as `readonly TierModel[]` (string-literal unions).
    // Widening to `readonly string[]` lets `.includes(model: ModelId)` accept a
    // non-literal argument. Read-only views — never mutated through these bindings.
    if ((config.models.free as readonly string[]).includes(model)) {
        return 'free';
    }
    if ((config.models.member as readonly string[]).includes(model)) {
        return 'member';
    }
    if ((config.models.pro as readonly string[]).includes(model)) {
        return 'byok';
    }
    throw new Error(
        `getModelAccess: model "${model}" is not present in any tier model list. ` +
            'Add it to FREE_MODELS, MEMBER_MODELS, or BYOK_MODELS in domain/tier.ts.'
    );
}

/**
 * Return whether a model is considered premium (not in the free-tier list).
 *
 * Unlike {@link isModelAllowed}, this function intentionally **ignores**
 * `config.featureFlags.enableTierRestrictions`. It is a classifier of the
 * model's intrinsic class, not an access decision — so it must return the
 * same result regardless of restriction mode.
 *
 * ⚠️ "Premium" means "not free"; it covers **both** member and byok models and
 * therefore no longer implies a BYOK key is required. Use
 * {@link requiresByokKey} for that question, or {@link getModelAccess} when
 * you need the exact class.
 *
 * @param model - The AI model identifier to check.
 * @param config - Tier configuration; defaults to {@link TIER_CONFIG}.
 * @returns `true` if the model is NOT in `config.models.free`, `false` otherwise.
 */
export function isPremiumModel(
    model: ModelId,
    config: TierConfig = TIER_CONFIG
): boolean {
    return getModelAccess(model, config) !== 'free';
}

/**
 * Return whether a model is in the free-tier list.
 *
 * Inverse of {@link isPremiumModel}. Like that function, this is a classifier
 * of the model's intrinsic class — it intentionally **ignores**
 * `config.featureFlags.enableTierRestrictions`. Both functions are mutually
 * exclusive: every model is either free or premium.
 *
 * @param model - The AI model identifier to check.
 * @param config - Tier configuration; defaults to {@link TIER_CONFIG}.
 * @returns `true` if the model is in `config.models.free`, `false` otherwise.
 */
export function isFreeModel(
    model: ModelId,
    config: TierConfig = TIER_CONFIG
): boolean {
    return !isPremiumModel(model, config);
}

/**
 * Return whether a request requires a BYOK API key.
 *
 * BYOK is required only for `'byok'`-class models on a non-pro tier. Free and
 * member models are covered by the server key, and pro tier bypasses BYOK
 * entirely.
 *
 * ⚠️ This narrowed with the three-way access axis. It previously returned
 * `true` for every non-free model, which meant a member had to supply a key
 * for models the server now pays for.
 *
 * Like {@link getModelAccess}, this intentionally **ignores**
 * `config.featureFlags.enableTierRestrictions` — BYOK classification is
 * independent of whether tier restrictions are enabled.
 *
 * Pure function — no I/O, no side effects.
 *
 * @param tier - The user's subscription tier.
 * @param model - The AI model identifier.
 * @param config - Tier configuration; defaults to {@link TIER_CONFIG}.
 * @returns `true` if the user must provide their own BYOK key for this combo.
 */
export function requiresByokKey(
    tier: Tier,
    model: ModelId,
    config: TierConfig = TIER_CONFIG
): boolean {
    return tier !== 'pro' && getModelAccess(model, config) === 'byok';
}

/**
 * Return whether a model requires the caller to be signed in.
 *
 * True for both `'member'` and `'byok'` models — the difference between them
 * is who pays, not whether authentication is needed. Consumers use this to
 * decide between an auth gate and a BYOK gate.
 *
 * @param model - The AI model identifier.
 * @param config - Tier configuration; defaults to {@link TIER_CONFIG}.
 * @returns `true` when anonymous callers must be blocked.
 */
export function requiresAuth(
    model: ModelId,
    config: TierConfig = TIER_CONFIG
): boolean {
    return getModelAccess(model, config) !== 'free';
}
