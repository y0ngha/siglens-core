# Fix Log

## [Issue #2 | chore/2/초기-개발-환경-설정 | 2026-04-24]
- Violation: release-it config used `${version}` (JS template literal) instead of `{{version}}` (Handlebars) for commitMessage, tagName, tagAnnotation
- Rule: release-it interpolation uses `{{version}}` syntax — `${version}` is passed as a literal string and breaks tag push trigger matching
- Context: .release-it.json initially written with ES template literal style; corrected to Handlebars style across all three fields

- Violation: npm publish used instead of yarn npm publish in GitHub Actions workflow
- Rule: CLAUDE.md — yarn must be used for all package operations; npm is prohibited
- Context: publish.yml initially used `npm publish` and NODE_AUTH_TOKEN; corrected to `yarn npm publish` with YARN_NPM_AUTH_TOKEN and added npmScopes config to .yarnrc.yml for yarn 4 registry routing

## [Issue #1 | feat/1/서버-코드-분리-핵심-로직-npm-패키지 | 2026-04-24]
- Violation: `.sort()` used instead of `.toSorted()` in `selectLastCandlePatternEntries`
- Rule: MISTAKES.md Coding Paradigm #10 — `.sort()` mutates the original array; `.toSorted()` must be used
- Context: `candle-detection.ts` line 210 sorted the result array in-place before returning; fixed to `.toSorted()`

## [PR #23 | feat/1/서버-코드-분리-핵심-로직-npm-패키지 | 2026-04-25]
- Violation: `SingleCandlePatternEntry`, `MultiCandlePatternEntry`, `CandlePatternEntry` types defined in `candle-detection.ts` instead of `domain/types.ts`
- Rule: MISTAKES.md Architecture #1 — all shared domain types must be centralized in `domain/types.ts`
- Context: three types were defined in the implementation file; moved to `domain/types.ts` and updated all import sites

- Violation: `CrossDirection` type defined in `confirmed.ts` instead of `domain/types.ts` and not re-exported from `src/index.ts`
- Rule: MISTAKES.md Architecture #1 — shared domain types in implementation files; and consumer-facing types must be exported from `src/index.ts`
- Context: `CrossDirection` used as parameter type for public API functions `findCross`/`findThresholdCross`; moved to `domain/types.ts` and added to `src/index.ts` exports

- Violation: `.slice()` inside `.map()` causing O(n × period) complexity in `calculateMA`
- Rule: CONVENTIONS.md sliding window rule — use `for` loop exception when `.slice()` inside `.map()` is O(n²)
- Context: `ma.ts` recomputed window sum for each bar; replaced with O(n) sliding window `for` loop using incremental `windowSum += closes[i] - closes[i - period]`

- Violation: `reduce + new Map([...acc, ...])` O(n²) in `detectCandlePatternEntries`
- Rule: CONVENTIONS.md `reduce + spread` O(n²) rule — use local mutation exception for Maps
- Context: `multiEntryMap` in `candle-detection.ts` spread entire Map on every iteration; replaced with `for` loop + `multiEntryMap.set()`

- Violation: `reduce + [...acc, item]` O(n²) in `detectCandlePatternEntries`
- Rule: CONVENTIONS.md `reduce + spread` O(n²) rule — use `flatMap` instead
- Context: `singleEntries` in `candle-detection.ts` spread entire array on every iteration; replaced with `flatMap`
