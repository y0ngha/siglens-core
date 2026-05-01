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
    /** Gemini model name (e.g. `'gemini-2.5-flash'`). */
    model: string;
    /** Prompt contents — string or role-tagged turn list. */
    contents: GeminiContents;
    /** Optional system instruction passed via `config.systemInstruction`. */
    systemInstruction?: string;
}
