import { jsonrepair } from 'jsonrepair';

const JSON_CODE_FENCE_START = '```json';
const JSON_CODE_FENCE_END = '```';

export function normalizeJsonResponse(raw: string): string {
    const trimmed = raw.trim();
    const jsonText =
        trimmed.startsWith(JSON_CODE_FENCE_START) &&
        trimmed.endsWith(JSON_CODE_FENCE_END)
            ? trimmed
                  .slice(
                      JSON_CODE_FENCE_START.length,
                      trimmed.length - JSON_CODE_FENCE_END.length
                  )
                  .trim()
            : trimmed;

    try {
        return JSON.stringify(JSON.parse(jsonText));
    } catch (err) {
        try {
            return JSON.stringify(JSON.parse(jsonrepair(jsonText)));
        } catch {
            throw err; // rethrow the original SyntaxError for backward compatibility
        }
    }
}
