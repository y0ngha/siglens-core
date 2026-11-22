/**
 * 배열 최솟값·최댓값을 한 번 훑어 구한다.
 *
 * `Math.min(...arr)`·`Math.max(...arr)`는 배열을 인자로 펼쳐 넘기므로 약 10만 개를 넘으면
 * 호출 스택을 넘겨 RangeError로 멈춘다(eslint `no-restricted-syntax`가 금지한다). 의미는
 * 펼침 호출과 같다 — 빈 배열은 `minOf`가 `Infinity`, `maxOf`가 `-Infinity`를 돌려주고
 * (`Math.min()`·`Math.max()`와 동일), `NaN`이 섞이면 `NaN`이 전파된다.
 */

/** @internal Smallest value in one pass; `Infinity` for an empty list. */
export const minOf = (values: readonly number[]): number =>
    values.reduce((acc, v) => Math.min(acc, v), Number.POSITIVE_INFINITY);

/** @internal Largest value in one pass; `-Infinity` for an empty list. */
export const maxOf = (values: readonly number[]): number =>
    values.reduce((acc, v) => Math.max(acc, v), Number.NEGATIVE_INFINITY);
