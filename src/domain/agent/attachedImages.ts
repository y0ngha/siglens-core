/**
 * Most images one user message may carry. Each image costs the model up to about a thousand input tokens, and a
 * screen of more than four captures is rarely one question — the consumer rejects more before the turn starts, and
 * `runAgentTurn` keeps only the first ones as a last guard.
 */
export const AGENT_IMAGES_PER_MESSAGE_MAX = 4;

/**
 * The line a consumer appends to an earlier user message that had images. Old images are never sent again (they would
 * re-bill every turn), so this marker is how the model knows the user showed something it can no longer see; the
 * system prompt tells it to rely on its earlier answer and ask for the image again when it must look.
 *
 * @param count - How many images that message carried (1 or more); the system prompt passes the placeholder `'N'`
 *   so its wording and the real marker cannot drift apart.
 * @returns The marker line, e.g. `[attached images: 2]`.
 */
export function formatAttachedImagesMarker(count: number | 'N'): string {
    return `[attached images: ${count}]`;
}
