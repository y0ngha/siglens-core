/**
 * ES2023 배열 메서드(`findLast`·`findLastIndex`)의 ES2022 대체.
 *
 * 브라우저 번들(`index.client.ts`)에 닿는 코드는 ES2023 메서드를 쓰지 않는다. 소비자(Next)는
 * 이 메서드들을 폴리필하지 않아서, Chrome 109(Windows 7/8.1에서 올릴 수 있는 마지막 버전)
 * 같은 브라우저에서 `toSorted is not a function`으로 앱 전체가 깨졌다 — 모듈 로드 시점에
 * 도는 `VALID_CHAT_MODELS = getAllowedModels('pro')`가 그 지점이었다.
 * `tsconfig.client.json`이 클라이언트 진입점을 ES2022 lib로 타입 검사해 재발을 막는다.
 *
 * `toSorted`·`toReversed`는 입력을 복사해 `.slice().sort()`·`.slice().reverse()`로 쓴다. 받는
 * 쪽이 방금 만든 배열(`map`·`filter`·`Array.from`·배열 리터럴의 결과)이면 복사 없이
 * `.sort()`·`.reverse()`로 쓴다 — 바깥에 보이지 않는 배열이라 불변성 규칙을 어기지 않는다.
 *
 * 지원 하한은 **ES2022 = Chrome 109**다(로그에서 실제 사용자가 확인된 가장 낮은 버전). lib
 * 검사는 "ES2023 메서드가 없다"만 보장한다 — ES2022 API(`Array.prototype.at` 등)는 그대로
 * 쓰므로 Chrome 92 미만(예: 로그의 Chrome 79 1건)은 지원하지 않는다.
 */

/** 뒤에서부터 `predicate`를 만족하는 첫 인덱스. 없으면 -1. */
export function findLastIndex<T>(
    arr: readonly T[],
    predicate: (value: T, index: number) => boolean
): number {
    for (let i = arr.length - 1; i >= 0; i -= 1) {
        if (predicate(arr[i], i)) return i;
    }
    return -1;
}

/** 뒤에서부터 `predicate`를 만족하는 첫 값. 없으면 `undefined`. */
export function findLast<T, S extends T>(
    arr: readonly T[],
    predicate: (value: T, index: number) => value is S
): S | undefined;
export function findLast<T>(
    arr: readonly T[],
    predicate: (value: T, index: number) => boolean
): T | undefined;
export function findLast<T>(
    arr: readonly T[],
    predicate: (value: T, index: number) => boolean
): T | undefined {
    const index = findLastIndex(arr, predicate);
    return index === -1 ? undefined : arr[index];
}
