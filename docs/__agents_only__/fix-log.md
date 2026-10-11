# Fix Log

## [2026-10-09] fix/client-bundle-es2022-safe round 1 (required)
- Violation: Convention change (ban toSorted/toReversed/findLast in browser-reachable code) not synchronized to the docs that state it (docs/CONVENTIONS.md immutability block, docs/PR_FIX_FLOW.md still recommended them).
- Rule: CONVENTIONS.md change-sync-convention-docs
- Fix: Documented the ES2022 browser-reachable rule in both docs.

## [2026-10-09] fix/client-bundle-es2022-safe round 1 (recommended)
- Violation: Support floor (ES2022 = Chrome 109) was not stated alongside the new syntax/API restriction.
- Rule: CONVENTIONS.md state-support-floor-with-restriction
- Fix: Stated the floor where the rule is documented.

## [2026-10-09] fix/client-bundle-es2022-safe round 1 (recommended)
- Violation: Redundant `.slice()` copies left on provably fresh arrays after mechanically rewriting toSorted/toReversed.
- Rule: CONVENTIONS.md no-redundant-copy-on-fresh-array
- Fix: Removed the redundant copies.

## [2026-10-09] fix/client-bundle-es2022-safe round 2 (recommended)
- Violation: Redundant `.slice()` before `.reverse()` on a fresh `clusterLevels` result.
- Rule: CONVENTIONS.md no-redundant-copy-on-fresh-array
- Fix: Dropped the copy. (aggregateOpenInterest/aggregateVolume keep `.slice()`: readonly return type requires it.)

## [2026-10-09] fix/client-bundle-es2022-safe round 2 (recommended)
- Violation: `for` loop in `findLastIndex` lacked a one-line rationale for the CP-5 exception.
- Rule: CONVENTIONS.md#CP-5
- Fix: Added a one-line rationale comment.

## [2026-10-11] fix/gemini-sampling-params round 1 (recommended)
- Violation: docs/PUBLIC_API.md registry header still said "16 models" and listed gemini-3.7-flash after the model was removed from code (count/list not synchronized).
- Rule: CONVENTIONS.md#DS-5
- Fix: Updated the count and list in PUBLIC_API.md.

## [2026-10-11] fix/gemini-sampling-params round 1 (recommended)
- Violation: Edited JSDoc line in modelSpecs.ts (and a comment in gemini.ts) left over-long and mentioning a retired model; not re-wrapped to neighbouring width.
- Rule: CONVENTIONS.md#JD-5
- Fix: Re-wrapped the lines and dropped the retired model name.
