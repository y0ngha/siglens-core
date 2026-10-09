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
