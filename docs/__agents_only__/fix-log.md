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
- Violation: `.slice()` inside `.map()` causing O(n × period) complexity in `calculateMA`
- Rule: CONVENTIONS.md sliding window rule — use `for` loop exception when `.slice()` inside `.map()` is O(n²)
- Context: `ma.ts` recomputed window sum for each bar; replaced with O(n) sliding window `for` loop using incremental `windowSum += closes[i] - closes[i - period]`

## [PR #23 Round 2 | feat/1/서버-코드-분리-핵심-로직-npm-패키지 | 2026-04-25]
- Violation: `[...arr].reverse().find()` used instead of `findLast` in `lastNonNull` helper in `prompt.ts`
- Rule: Consistency with ES2023 APIs already used in the same PR — `candle-detection.ts` already uses `findLast`; `tsconfig.json` targets ES2023
- Context: `lastNonNull` helper copied an array and reversed it just to find the last non-null value; `findLast` avoids the O(n) array copy entirely

- Violation: Loop in `detectCandlePatternEntries` starts at `0` with `if (i < detectionStartIndex) continue;` instead of starting at `detectionStartIndex`
- Rule: MISTAKES.md Coding Paradigm #2 — avoid redundant computation; set loop start boundary correctly
- Context: `candle-detection.ts` loop over `extendedBars` guarded against the buffer region with an early `continue`; the loop start index should be `detectionStartIndex` directly
