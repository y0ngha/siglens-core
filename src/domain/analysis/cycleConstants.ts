/**
 * The numbers of the cycle strategy cards, in a module of their own so the browser entrypoint can
 * export them without reaching `indicatorState` (server-only ES2023 code, see CONVENTIONS.md).
 * Prompt text and renderers read these; nothing else spells `5/20/60` or `120`.
 */

/**
 * MA periods of the 이동평균선 대순환 (MA cycle) strategy: short, medium, long. Public (both
 * entrypoints) so a renderer names the lines from here instead of copied `5`/`20`/`60`.
 */
export const MA_CYCLE_PERIODS = { short: 5, medium: 20, long: 60 } as const;

/**
 * Bars a cycle card looks back over for its stage history (the current bar included): the history
 * and the line it explains are one rule. Public (both entrypoints) so a renderer states the window
 * from here instead of a copied `120`.
 */
export const CYCLE_LOOKBACK_BARS = 120;
