export type AgentLocale = 'ko' | 'en' | 'ja' | 'zh';

/** @internal Display name per {@link AgentLocale}, for the "Answer in ${language}" instruction. */
export const LANGUAGE_NAME: Record<AgentLocale, string> = {
    ko: 'Korean',
    en: 'English',
    ja: 'Japanese',
    zh: 'Chinese',
};

/** `YYYY-MM-DD, HH:MM` in the given zone, independent of locale-pattern quirks across Intl implementations. */
function formatClock(now: Date, timeZone: string): string {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
    }).formatToParts(now);
    const get = (type: Intl.DateTimeFormatPartTypes): string =>
        parts.find(p => p.type === type)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')}, ${get('hour')}:${get('minute')}`;
}

/** @internal ET·KST on one line, same wording in every prompt that states the current time. */
export function formatNowLine(now: Date): string {
    return `ET: ${formatClock(now, 'America/New_York')} · KST: ${formatClock(now, 'Asia/Seoul')}`;
}
