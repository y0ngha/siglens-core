const inFlight = new Map<string, Promise<unknown>>();

/**
 * 같은 키의 동시 호출을 하나의 진행 중 실행에 합류시킨다.
 *
 * ponytail: 프로세스 로컬 Map. ASG desired=1이라 실질 위험이 낮고, 다중 인스턴스에서
 * 최악의 결과는 "LLM 1회 중복"이다. 중복이 실제로 관측되면 Redis 락으로 승격한다.
 */
export async function dedupeInFlight<T>(
    key: string,
    run: () => Promise<T>
): Promise<T> {
    const existing = inFlight.get(key);
    if (existing !== undefined) return existing as Promise<T>;

    const promise = run().finally(() => inFlight.delete(key));
    inFlight.set(key, promise);
    return promise as Promise<T>;
}
