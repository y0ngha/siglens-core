/**
 * @internal
 *
 * Shared skill-fixture helper for `infrastructure/skills` loader tests.
 * Centralizes the `PROMPT_DIGEST` fixture shape so `loader.test.ts`,
 * `loader-gating.test.ts`, and `fingerprintCrossPath.test.ts` don't each
 * hand-roll their own copy of the same markdown scaffolding.
 */

/**
 * Marker text usable in a fixture body so tests can assert `skill.content`
 * is the digest ONLY and does not leak the full pre-digest body text.
 */
export const ORIGINAL_BODY_SENTINEL = 'ORIGINAL_BODY_SENTINEL_NOT_IN_DIGEST';

/** Append a well-formed `PROMPT_DIGEST` section to a fixture body. */
export const withDigest = (body: string, digestText = 'Digest text.') =>
    `${body}\n<!-- PROMPT_DIGEST:START -->\n${digestText}\n<!-- PROMPT_DIGEST:END -->`;
