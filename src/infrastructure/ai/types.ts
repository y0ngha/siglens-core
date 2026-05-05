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
    /** User-owned BYOK key. Pass `undefined` to use the server key exclusively. */
    userApiKey: string | undefined;
    /** Server-owned key used when no `userApiKey` is present, or for pro-tier requests. */
    serverApiKey: string;
    /** Model identifier (e.g. `'gemini-2.5-flash'`, `'gpt-5.5'`, `'claude-opus-4-7'`). */
    model: string;
    /** Prompt contents — plain string or role-tagged turn list. */
    contents: AiContents;
    /** Optional system instruction passed via `config.systemInstruction`. */
    systemInstruction?: string;
}
