import type { ChatbotLimitError } from '@/application/usage/types';
import type { CallAiProvider } from '@/domain/ports/aiProvider';
import type {
    AnalysisResponse,
    AssetClass,
    ChatMessage,
    CurrencyCode,
    CurrentAnalysisContext,
    ModelId,
    TierConfig,
    Timeframe,
    UserTierContext,
} from '@/domain/types';
import type { ChatTokenStore } from '@/domain/ports/chatTokenStore';
import type { UsageLogRepository } from '@/domain/ports/usageLogRepository';
import type { UsageRepository } from '@/domain/ports/usageRepository';

/** Error code produced by chat infrastructure or application policy. */
export type ChatErrorCode =
    | 'token_exhausted'
    | 'model_not_allowed'
    | 'rate_limited'
    | 'server_error'
    | 'server_busy'
    | 'user_api_key_required';

/** Input params for `requestChatCompletion`. */
export interface RequestChatCompletionParams {
    symbol: string;
    /** Full company name forwarded to the chat prompt. Defaults to `symbol` when omitted. */
    companyName?: string;
    timeframe: Timeframe;
    analysis: AnalysisResponse;
    history: ChatMessage[];
    userMessage: string;
    clientIp: string;
    model?: ModelId;
    /**
     * Server-owned API key for AI provider calls.
     *
     * Must be provided when:
     * - `tierContext.tier === 'pro'` (any model) — `server_error` if absent.
     * - Non-pro tier + free model — `server_error` if absent.
     *
     * Not required (and not used) when:
     * - Non-pro tier + premium model + `userApiKey` present (BYOK path).
     */
    serverApiKey?: string;
    /**
     * User-registered BYOK API key.
     *
     * Must be provided when:
     * - Non-`'pro'`-tier user requests a premium model and `serverApiKey` is
     *   absent — omitting it returns `user_api_key_required`.
     *
     * Ignored when:
     * - `tierContext.tier === 'pro'` — server covers all models via
     *   `serverApiKey`; this field is never forwarded.
     * - Non-pro tier + free model — server key is used; this field is ignored.
     */
    userApiKey?: string;
    occurredAt?: Date;
    tierContext?: UserTierContext;
    /**
     * Tagged union representing the analysis result currently displayed on the
     * user's page (technical / fundamental / news / overall / options /
     * financials). When provided, the chat system prompt receives an extra
     * `## Current analysis context` section so the assistant can reference
     * the live numbers without re-fetching data. Omit to keep the original
     * behavior.
     */
    currentAnalysisContext?: CurrentAnalysisContext;
    /**
     * Instrument asset class. Controls chat prompt framing: `'crypto'` drops
     * U.S. equity framing and "unrelated stock" refusal examples.
     * Defaults to `'equity'` for backward compatibility.
     */
    assetClass?: AssetClass;
    /**
     * Listing quote currency, supplied from the caller's market profile (core
     * never derives it from the symbol — see {@link CurrencyCode}). `KRW`
     * describes a Korean listing and renders levels in whole won. Defaults to
     * `'USD'`.
     */
    currency?: CurrencyCode;
}

/** Injectable dependencies for `requestChatCompletion`. */
export interface RequestChatCompletionDependencies {
    tokenStore?: ChatTokenStore;
    usageRepository?: UsageRepository;
    usageLogs?: UsageLogRepository;
    /**
     * AI provider implementation. Required.
     *
     * Implementations must route by `options.model` to the appropriate
     * upstream provider (Gemini, OpenAI, Anthropic, etc.) and return the
     * generated text. The core library no longer ships a default adapter —
     * callers wire up their own provider client and inject it here.
     */
    callAiProvider: CallAiProvider;
    tierConfig?: TierConfig;
}

/** Result returned by {@link requestChatCompletion}. */
export type ChatActionResult =
    | { ok: true; message: string; remainingTokens: number }
    | { ok: false; error: ChatErrorCode }
    | { ok: false; error: ChatbotLimitError };
