import {
    KST_OFFSET_HOURS,
    MINUTES_PER_DAY,
    MS_PER_DAY,
    MS_PER_HOUR,
    MS_PER_SECOND,
    SECONDS_PER_MINUTE,
} from '@/domain/constants/time';

const MARKDOWN_CODE_BLOCK_PATTERN = /```(?:json)?\s*\n?([\s\S]*?)\n?```/;

export function parseNumberOrDefault(
    raw: string | undefined,
    defaultValue: number
): number {
    if (raw == null || raw === '') return defaultValue;
    const parsed = Number.parseFloat(raw);
    return Number.isFinite(parsed) ? parsed : defaultValue;
}

export function stripMarkdownCodeBlock(text: string): string {
    const match = MARKDOWN_CODE_BLOCK_PATTERN.exec(text.trim());
    return match ? match[1].trim() : text.trim();
}

/**
 * Parse an LLM response string as JSON with markdown-fence stripping.
 *
 * Pure-domain helper — no salvage. Consumers needing tolerance for
 * truncated / unquoted-key / trailing-comma payloads should use the
 * infrastructure-layer `extractJsonWithRepair` wrapper.
 *
 * @param text   - Raw response from the LLM.
 * @param source - Caller label for the error message (e.g. `'koreanTranslator'`).
 */
export function parseJsonResponse(text: string, source: string): unknown {
    try {
        return JSON.parse(stripMarkdownCodeBlock(text));
    } catch (error) {
        throw new Error(`Failed to parse ${source} response as JSON`, {
            cause: error,
        });
    }
}

export function computeSecondsUntilCacheExpiry(
    now: Date,
    expiryHourKst: number
): number {
    const kstNow = new Date(now.getTime() + KST_OFFSET_HOURS * MS_PER_HOUR);

    // 오늘 KST expiryHourKst:00 설정 (kstNow는 UTC+9 오프셋이 더해진 가상 UTC 날짜)
    const kstExpiryToday = new Date(
        Date.UTC(
            kstNow.getUTCFullYear(),
            kstNow.getUTCMonth(),
            kstNow.getUTCDate(),
            expiryHourKst,
            0,
            0,
            0
        )
    );

    const rawDiffMs = kstExpiryToday.getTime() - kstNow.getTime();

    // 현재 시각이 KST expiryHourKst 이후이면 내일 기준으로 전환
    const diffMs = rawDiffMs <= 0 ? rawDiffMs + MS_PER_DAY : rawDiffMs;

    // 최소 1초를 보장하여 Redis EX 0 오류 방지
    return Math.max(1, Math.floor(diffMs / MS_PER_SECOND));
}

/** US 정규장 개장 시각 = 09:30 ET → 분 단위(570). */
const ET_REGULAR_OPEN_MINUTES = 9 * 60 + 30;
/** US 정규장 마감 시각 = 16:00 ET → 분 단위(960). */
const ET_REGULAR_CLOSE_MINUTES = 16 * 60;

const ET_SESSION_FORMATTER = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
});

const ET_WEEKDAY_INDEX: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
};

interface EtSessionParts {
    weekdayIndex: number; // 0=Sun … 6=Sat
    minutesOfDay: number; // 0..1439, ET wall-clock
}

function etSessionParts(now: Date): EtSessionParts {
    const parts = ET_SESSION_FORMATTER.formatToParts(now);
    const get = (t: string) => parts.find(p => p.type === t)?.value ?? '';
    const weekdayIndex = ET_WEEKDAY_INDEX[get('weekday')] ?? 0;
    const hour = Number.parseInt(get('hour'), 10);
    const minute = Number.parseInt(get('minute'), 10);
    return { weekdayIndex, minutesOfDay: hour * 60 + minute };
}

/** @internal DST 안전한 뉴욕 정규장(09:30–16:00 ET) 개장 여부를 반환한다. */
export function isEtRegularSessionOpen(now: Date): boolean {
    const { weekdayIndex, minutesOfDay } = etSessionParts(now);
    if (weekdayIndex === 0 || weekdayIndex === 6) return false;
    return (
        minutesOfDay >= ET_REGULAR_OPEN_MINUTES &&
        minutesOfDay < ET_REGULAR_CLOSE_MINUTES
    );
}

/** @internal 주어진 ET 요일 인덱스(0=일~6=토) 기준 다음 평일까지의 일수. 주말은 건너뛴다. */
function daysToNextWeekday(fromWeekdayIndex: number): number {
    let offset = 1;
    let wd = (fromWeekdayIndex + 1) % 7;
    while (wd === 0 || wd === 6) {
        offset += 1;
        wd = (wd + 1) % 7;
    }
    return offset;
}

/** @internal 다음 뉴욕 정규장 개장(09:30 ET)까지 남은 초를 반환한다. */
export function secondsUntilNextEtRegularOpen(now: Date): number {
    const { weekdayIndex, minutesOfDay } = etSessionParts(now);
    const isWeekday = weekdayIndex >= 1 && weekdayIndex <= 5;

    const dayOffset =
        isWeekday && minutesOfDay < ET_REGULAR_OPEN_MINUTES
            ? 0
            : daysToNextWeekday(weekdayIndex);

    const minutesUntilOpen =
        dayOffset * MINUTES_PER_DAY + ET_REGULAR_OPEN_MINUTES - minutesOfDay;
    return minutesUntilOpen * SECONDS_PER_MINUTE - now.getUTCSeconds();
}
