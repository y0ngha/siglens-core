import {
    KST_OFFSET_HOURS,
    MS_PER_DAY,
    MS_PER_HOUR,
    MS_PER_SECOND,
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
    hour12: false,
});

const ET_WEEKDAY_INDEX: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

interface EtSessionParts {
    weekdayIndex: number; // 0=Sun … 6=Sat
    minutesOfDay: number; // 0..1439, ET wall-clock
}

function etSessionParts(now: Date): EtSessionParts {
    const parts = ET_SESSION_FORMATTER.formatToParts(now);
    const get = (t: string) => parts.find(p => p.type === t)?.value ?? '';
    const weekdayIndex = ET_WEEKDAY_INDEX[get('weekday')] ?? 0;
    // hour12:false는 자정에 '24'를 emit하는 ICU locale가 있어 24→0 정규화.
    const rawHour = Number.parseInt(get('hour'), 10);
    const hour = rawHour === 24 ? 0 : rawHour;
    const minute = Number.parseInt(get('minute'), 10);
    return { weekdayIndex, minutesOfDay: hour * 60 + minute };
}

/** `now`가 US 정규장(평일 09:30–16:00 ET) 중인지. DST-safe. */
export function isEtRegularSessionOpen(now: Date): boolean {
    const { weekdayIndex, minutesOfDay } = etSessionParts(now);
    if (weekdayIndex === 0 || weekdayIndex === 6) return false;
    return (
        minutesOfDay >= ET_REGULAR_OPEN_MINUTES &&
        minutesOfDay < ET_REGULAR_CLOSE_MINUTES
    );
}

/**
 * `now`로부터 다음 정규장 개장(평일 09:30 ET)까지 남은 초. DST-safe.
 *
 * ET wall-clock 분 단위로 계산하므로 분 미만 오차가 있고, DST 전환일(연 2회)에
 * 실제 경과시간과 최대 1h 차이가 날 수 있으나 캐시 TTL 용도라 무해하다.
 * 미 증시 휴장일은 캘린더가 없어 개장으로 간주한다(기존 캐시들과 동일).
 */
export function secondsUntilNextEtRegularOpen(now: Date): number {
    const { weekdayIndex, minutesOfDay } = etSessionParts(now);
    const isWeekday = weekdayIndex >= 1 && weekdayIndex <= 5;

    let dayOffset: number;
    if (isWeekday && minutesOfDay < ET_REGULAR_OPEN_MINUTES) {
        dayOffset = 0; // 오늘 개장이 아직 남음
    } else {
        dayOffset = 1;
        let wd = (weekdayIndex + 1) % 7;
        while (wd === 0 || wd === 6) {
            dayOffset += 1;
            wd = (wd + 1) % 7;
        }
    }

    const minutesUntilOpen =
        dayOffset * 24 * 60 + ET_REGULAR_OPEN_MINUTES - minutesOfDay;
    return minutesUntilOpen * 60;
}
