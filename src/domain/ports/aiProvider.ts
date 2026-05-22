/**
 * @port
 * Provider-neutral AI chat-completion contract the domain depends on for
 * generating analysis text, briefings, and chat replies.
 *
 * Adapters live in consumer codebases (this library does not ship a concrete
 * AI SDK adapter — see `docs/ARCHITECTURE.md`). Implementations must route by
 * `options.model` to the appropriate upstream provider (Gemini, OpenAI,
 * Anthropic, …) and return the generated text. Upstream provider errors
 * should be surfaced to the caller — the application layer maps them to
 * typed error codes.
 */

/** Speaker role accepted by the Gemini contents schema. */
export type GeminiRole = 'user' | 'model';

/** Single text part inside a Gemini content turn. */
export interface GeminiPart {
    text: string;
}

/** A single role-tagged turn in the Gemini contents array. */
export interface GeminiContent {
    role: GeminiRole;
    parts: GeminiPart[];
}

/** Provider-neutral prompt payload — a plain string or a role-tagged turn list. */
export type AiContents = string | GeminiContent[];

/** Options accepted by the AI provider call (currently Gemini; shape is provider-neutral). */
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
    /** Optional system instruction passed via `config.systemInstruction`. */
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
