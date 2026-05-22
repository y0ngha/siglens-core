/**
 * @port
 * Provider-neutral AI chat-completion contract the domain depends on for
 * generating analysis text, briefings, and chat replies.
 *
 * Adapters live in consumer codebases (this library does not ship a concrete
 * AI SDK adapter — see `docs/ARCHITECTURE.md`). Implementations must route by
 * `options.model` to the appropriate upstream provider (Gemini, OpenAI,
 * Anthropic, …), translate the provider-neutral payload into the upstream
 * SDK's wire shape, and return the generated text. Upstream provider errors
 * should be surfaced to the caller — the application layer maps them to
 * typed error codes.
 */

/** Speaker role in a chat turn. `'assistant'` is the AI's reply. */
export type ConversationRole = 'user' | 'assistant';

/** A single role-tagged turn in a chat conversation. */
export interface ConversationTurn {
    role: ConversationRole;
    text: string;
}

/**
 * Provider-neutral prompt payload — either a single user prompt as a plain
 * string, or a role-tagged conversation history.
 */
export type AiContents = string | ConversationTurn[];

/** Options accepted by the AI provider call. Provider-neutral. */
export interface CallAiProviderOptions {
    /**
     * User-owned BYOK key.
     * Exactly one of `userApiKey` / `serverApiKey` is defined per call;
     * the application layer enforces this invariant.
     */
    userApiKey: string | undefined;
    /**
     * Server-owned key used for pro-tier requests and free-model calls.
     * Exactly one of `userApiKey` / `serverApiKey` is defined per call;
     * the application layer enforces this invariant.
     */
    serverApiKey: string | undefined;
    /** Model identifier (e.g. `'gemini-2.5-flash'`, `'gpt-5.5'`, `'claude-opus-4-7'`). */
    model: string;
    /** Prompt contents — plain string or role-tagged turn list. */
    contents: AiContents;
    /** Optional system-level instruction prepended before the conversation. */
    systemInstruction?: string;
}

/**
 * Callable port shape for the AI provider. Adapters implement this signature
 * directly (no class wrapper) and the application layer accepts the function
 * as a dependency.
 */
export type CallAiProvider = (
    options: CallAiProviderOptions
) => Promise<string>;
