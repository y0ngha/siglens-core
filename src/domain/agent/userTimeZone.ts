import type { AgentLocale } from '@/domain/agent/promptShared';

/** Zone used when the consumer sends none (or an invalid one): the reader's usual market clock. */
const DEFAULT_TIME_ZONE: Record<AgentLocale, string> = {
    ko: 'Asia/Seoul',
    en: 'America/New_York',
    ja: 'Asia/Tokyo',
    zh: 'Asia/Shanghai',
};

/**
 * Labels readers recognise where `Intl` only offers `GMT+9`. Everything else
 * uses the `en-US` short name when it is a real abbreviation (EDT, PDT, BST)
 * and otherwise the generic name ("China Time").
 */
const KNOWN_LABELS: Readonly<Record<string, string>> = {
    'Asia/Seoul': 'KST',
    'Asia/Tokyo': 'JST',
};

/** An ISO-8601 instant with an explicit zone (`Z` or `±HH:MM`) — what tool results carry. */
const ISO_INSTANT_RE =
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;

function isValidTimeZone(timeZone: string): boolean {
    try {
        new Intl.DateTimeFormat('en-US', { timeZone });
        return true;
    } catch {
        return false;
    }
}

/**
 * @internal The IANA zone the agent writes times in: the browser's zone when it is a
 * valid IANA name, else a per-locale default.
 *
 * @param raw - Untrusted zone string from the consumer (e.g. a request header).
 * @param locale - The answer locale, for the fallback.
 * @returns A zone `Intl` accepts.
 */
export function resolveAgentTimeZone(
    raw: string | undefined,
    locale: AgentLocale
): string {
    const candidate = raw?.trim();
    return candidate && candidate.length <= 64 && isValidTimeZone(candidate)
        ? candidate
        : DEFAULT_TIME_ZONE[locale];
}

function timeZoneLabel(date: Date, timeZone: string): string {
    const known = KNOWN_LABELS[timeZone];
    if (known) return known;
    const name = (style: 'short' | 'shortGeneric'): string =>
        new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: style })
            .formatToParts(date)
            .find(p => p.type === 'timeZoneName')?.value ?? '';
    const short = name('short');
    return /^[A-Z]{2,5}$/.test(short) ? short : name('shortGeneric');
}

/**
 * @internal `YYYY-MM-DD HH:MM <label>` in `timeZone` — the form the model is told to
 * copy verbatim, so no answer ever shows UTC or a raw ISO string.
 *
 * @param date - The instant to format.
 * @param timeZone - A zone from {@link resolveAgentTimeZone}.
 * @returns The localized, labelled timestamp.
 */
export function formatAgentTimestamp(date: Date, timeZone: string): string {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
    }).formatToParts(date);
    const get = (type: Intl.DateTimeFormatPartTypes): string =>
        parts.find(p => p.type === type)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')} ${timeZoneLabel(date, timeZone)}`;
}

/**
 * @internal Deep copy of a tool result with every ISO-8601 instant string replaced by
 * {@link formatAgentTimestamp}. The model used to convert UTC itself from
 * offsets in the prompt and still leaked "21:42 UTC" into answers; doing the
 * conversion here makes the right time the only one it can see.
 *
 * Only full instants with an explicit zone are touched — bare dates and
 * zone-less bar times are left alone rather than guessed at.
 *
 * @param value - A JSON-shaped tool result.
 * @param timeZone - A zone from {@link resolveAgentTimeZone}.
 * @returns The same shape with instants localized.
 */
export function localizeTimestamps(value: unknown, timeZone: string): unknown {
    return localize(value, timeZone, new WeakSet());
}

/**
 * A cyclic result is returned untouched at the repeat so serialization still
 * reports it as `unserializable_result` instead of this walk overflowing.
 */
function localize(
    value: unknown,
    timeZone: string,
    seen: WeakSet<object>
): unknown {
    if (typeof value === 'string') {
        if (!ISO_INSTANT_RE.test(value)) return value;
        const date = new Date(value);
        return Number.isNaN(date.getTime())
            ? value
            : formatAgentTimestamp(date, timeZone);
    }
    if (value === null || typeof value !== 'object') return value;
    if (seen.has(value)) return value;
    seen.add(value);
    if (Array.isArray(value))
        return value.map(item => localize(item, timeZone, seen));
    return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
            key,
            localize(item, timeZone, seen),
        ])
    );
}
