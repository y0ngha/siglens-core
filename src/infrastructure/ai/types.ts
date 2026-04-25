export interface GeminiPart {
    text: string;
}

export interface GeminiContent {
    role: string;
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
