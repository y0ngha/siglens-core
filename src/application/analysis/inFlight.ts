const inFlight = new Map<string, Promise<unknown>>();

/**
 * 같은 키의 동시 호출을 하나의 진행 중 실행에 합류시킨다.
 *
 * 프로세스 로컬 Map이다. LLM 생성 경로는 이 함수를 직접 쓰지 않고
 * `dedupeGeneration`(`generationLock.ts`)을 거친다 — 그 안에서 이 합류 위에 Redis
 * `SET NX` 락을 얹어 인스턴스 간 중복 생성까지 막는다.
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
