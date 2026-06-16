import { hashAnalysisInput } from '@/infrastructure/hash/analysisInput';
import type { EconomySnapshot } from '@/domain/types';

/**
 * @internal 거시 브리핑 프롬프트를 결정하는 입력값의 짧은 결정적 해시.
 *
 * 프롬프트(`buildMacroBriefingPrompt`)에 들어가는 모든 가변 필드를 그대로 반영한다:
 * 지표 latest(name+value), treasury(2Y/10Y), 캘린더 이벤트(date+event+impact+
 * estimate+actual). 같은 dateHour 버킷 안에서 consensus estimate revision이나
 * impact 재분류가 일어나면 해시가 바뀌어 stale briefing이 살아남지 않는다.
 * name/date 기준 정렬로 배열 순서 무관 + submit write 키 == peek read 키 보장.
 *
 * @returns 16자 소문자 hex.
 */
export function hashMacroBriefingInput(snapshot: EconomySnapshot): string {
    const indicators = snapshot.indicators
        .map(i => ({ name: i.name, value: i.latest?.value ?? null }))
        .toSorted((a, b) => a.name.localeCompare(b.name, 'en'));
    const calendar = snapshot.calendar
        .map(e => ({
            date: e.date,
            event: e.event,
            impact: e.impact,
            estimate: e.estimate,
            actual: e.actual,
        }))
        .toSorted((a, b) => {
            const byDate = a.date.localeCompare(b.date, 'en');
            return byDate !== 0 ? byDate : a.event.localeCompare(b.event, 'en');
        });
    // treasury는 명시적 키 매핑으로 직렬화 — JSON.stringify는 객체 키 삽입 순서에
    // 의존하므로 wire 응답의 키 순서가 달라지면 같은 값이어도 해시가 달라진다
    // (read==write 어긋남). indicators/calendar와 같은 결정성 보장.
    const treasury =
        snapshot.treasury === null
            ? null
            : {
                  date: snapshot.treasury.date,
                  year2: snapshot.treasury.year2,
                  year10: snapshot.treasury.year10,
              };
    return hashAnalysisInput(
        JSON.stringify({ indicators, treasury, calendar })
    );
}
