/**
 * Marker that opens the agent's last line when it offers follow-up questions:
 * `[[followups]] A | B | C`. The system prompt asks for exactly this shape;
 * the consumer strips the line from the visible answer and renders the items
 * as tappable suggestions.
 */
export const AGENT_FOLLOW_UP_MARKER = '[[followups]]';

/** At most this many follow-ups are kept, whatever the model wrote. */
const MAX_FOLLOW_UPS = 3;

/** A follow-up longer than this is cut — a chip must stay a short, tappable line. */
const MAX_FOLLOW_UP_CHARS = 60;

const FOLLOW_UP_SEPARATOR = '|';

/** Marker characters that open any `[[...` line, including a half-streamed marker. */
const MARKER_OPENER = '[[';

const MARKER_FIRST_CHAR = '[';

export interface SplitAgentFollowUps {
    /** The answer without the follow-up line. Identical to the input when there is none. */
    body: string;
    /** Up to three short follow-up questions; empty when the line is absent or malformed. */
    followUps: string[];
}

function parseFollowUpItems(rest: string): string[] {
    return rest
        .split(FOLLOW_UP_SEPARATOR)
        .map(item => item.trim())
        .filter(item => item.length > 0)
        .slice(0, MAX_FOLLOW_UPS)
        .map(item => Array.from(item).slice(0, MAX_FOLLOW_UP_CHARS).join(''));
}

/**
 * A trailing line that cannot be a complete marker line yet: a lone `[` or a
 * prefix of the marker (`[[`, `[[foll`, `[[followups]`) or the marker with no
 * item after it. While the answer streams, the line is still being written, so
 * showing it would flash raw bracket text; once the stream ends it either
 * completes (and parses) or is genuinely malformed.
 */
function isIncompleteMarkerLine(line: string): boolean {
    // A lone `[` is the first character of the marker arriving.
    if (line === MARKER_FIRST_CHAR) return true;
    if (!line.startsWith(MARKER_OPENER)) return false;
    if (AGENT_FOLLOW_UP_MARKER.startsWith(line)) return true;
    return (
        line.startsWith(AGENT_FOLLOW_UP_MARKER) &&
        line.slice(AGENT_FOLLOW_UP_MARKER.length).trim() === ''
    );
}

/**
 * Split an assistant answer into its visible body and its follow-up
 * suggestions. Pure and total — never throws.
 *
 * Only the LAST non-empty line is considered. It must start with
 * {@link AGENT_FOLLOW_UP_MARKER}; the rest is split on `|`, trimmed, emptied
 * entries dropped, capped at 3 items of 60 characters. A marker that appears
 * anywhere else (mid-answer, mid-line) is ordinary text and the input is
 * returned unchanged with `followUps: []`. A trailing line that only starts to
 * look like the marker (streaming) is removed from the body with
 * `followUps: []` so it never shows as raw text.
 *
 * **Streaming:** the body is safe to render on every chunk, but a complete
 * marker line may still be growing (`[[followups]] A | B` can become
 * `[[followups]] A | B | C`, and the last item may be cut mid-word). Render the
 * follow-up chips only after the stream has completed.
 */
export function splitAgentFollowUps(text: string): SplitAgentFollowUps {
    const lines = text.split('\n');
    const lastIndex = lines.findLastIndex(line => line.trim() !== '');
    if (lastIndex === -1) return { body: text, followUps: [] };

    const lastLine = lines[lastIndex].trim();
    const bodyWithout = (): string =>
        lines.slice(0, lastIndex).join('\n').trimEnd();

    if (isIncompleteMarkerLine(lastLine)) {
        return { body: bodyWithout(), followUps: [] };
    }
    if (!lastLine.startsWith(AGENT_FOLLOW_UP_MARKER)) {
        return { body: text, followUps: [] };
    }

    const followUps = parseFollowUpItems(
        lastLine.slice(AGENT_FOLLOW_UP_MARKER.length)
    );
    if (followUps.length === 0) return { body: text, followUps: [] };
    return { body: bodyWithout(), followUps };
}
