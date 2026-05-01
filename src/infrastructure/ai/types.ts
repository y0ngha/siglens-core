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

/** Gemini `contents` payload — accepts either a plain string or a turn array. */
export type GeminiContents = string | GeminiContent[];

/** Options accepted by the AI provider call (currently Gemini; shape is provider-neutral). */
export interface CallAiProviderOptions {
    /** Primary key tried first; pass `undefined` to skip the primary attempt and go straight to fallback. */
    primaryApiKey: string | undefined;
    /** Fallback key used when the primary attempt fails. */
    fallbackApiKey: string;
    /** Model identifier (e.g. `'gemini-2.5-flash'`, `'gpt-5.5'`, `'claude-opus-4-7'`). */
    model: string;
    /**
     * Prompt contents in Gemini format — string or role-tagged turn list.
     * Consumers providing a non-Gemini `callAiProvider` must convert this format internally.
     */
    contents: GeminiContents;
    /** Optional system instruction passed via `config.systemInstruction`. */
    systemInstruction?: string;
}

/**
 * @deprecated Use {@link CallAiProviderOptions} instead. Will be removed in the next major version.
 */
export type CallGeminiWithKeyFallbackOptions = CallAiProviderOptions;
