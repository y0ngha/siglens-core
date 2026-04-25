export type GeminiRole = 'user' | 'model';

export interface GeminiPart {
    text: string;
}

export interface GeminiContent {
    role: GeminiRole;
    parts: GeminiPart[];
}

export type GeminiContents = string | GeminiContent[];

export interface CallGeminiWithKeyFallbackOptions {
    freeApiKey: string | undefined;
    paidApiKey: string;
    model: string;
    contents: GeminiContents;
    systemInstruction?: string;
}
