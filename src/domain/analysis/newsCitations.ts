import type { AnalysisLocale } from './outputLocale';
import type { CurrencyCode, NewsAnalysisResponse } from '@/domain/types';

/**
 * Article-number markers in news-analysis output.
 *
 * The news prompt numbers its articles `[1]…[N]` and asks the model to end
 * each key-event bullet with the number of the article it rests on, as
 * `[#3]`. The model never writes the date or the outlet itself: copying a
 * timestamp is exactly where it slips (wrong day, UTC vs. local date, a
 * date from the article body instead of the publish date). Code swaps the
 * marker for the article's real publish date and source, so every rendered
 * citation is the stored article's own metadata.
 *
 * Resolution needs the article list in the exact order the prompt numbered
 * it, so it runs inside the generation call (`runNewsAnalysis`): the
 * in-flight and cross-instance joiners of one cache key receive the winner's
 * already-resolved output instead of mapping its numbers onto their own
 * (possibly differently ordered) list.
 */

/** The fields of a prompt article a citation needs. */
export interface CitableArticle {
    readonly source: string;
    readonly publishedAt: string;
}

/** Which bullet list a citation is rendered into. */
export type CitationKind = 'event' | 'upcoming';

/** Options for {@link resolveCitationMarkers}. */
export interface CitationContext {
    /** Articles in the exact order the prompt numbered them (`[1]` = index 0). */
    readonly articles: readonly CitableArticle[];
    readonly locale: AnalysisLocale;
    /** Picks the calendar the publish date is read in: KRW → Seoul, otherwise New York. */
    readonly currency: CurrencyCode;
}

/**
 * The marker the prompt asks for. The prompt rules are built from this
 * function, so the requested syntax and {@link MARKER_GROUP} cannot drift
 * apart (`newsCitations.test.ts` resolves its output).
 */
export function citationMarker(n: number | 'N'): string {
    return `[#${n}]`;
}

/**
 * A marker group plus the whitespace before it. Accepts what the model
 * actually writes besides the requested `[#3]`: several numbers in one
 * bracket (`[#2, #5]`, `[#2,5]`), a range (`[#3-5]`, `[#3–#5]`), and
 * full-width brackets in ja/zh output (`［#3］`, `【#3】`), and a short label
 * the model sometimes puts before a `#` (`[페이퍼 #21]`, `[기사#3]`,
 * `[기사 #1, 기사 #2]`, seen in production 2026-11-08), plus padding or
 * quotes around any member (`[ #5 ]`, `["#6"]`, `["#5", "#6"]`, 2026-11-12).
 *
 * The label ({@link MARKER_LABEL}) is letters, spaces and hyphens only, up to
 * 20 characters. No digits: the cited number is read with
 * {@link MARKER_NUMBER}, so a digit in the label would be cited instead of the
 * article number. No punctuation, so `[No. #1]` stays text. A letters-only
 * bracket ending in `#number` (`[Top #1]`) is read as a marker on purpose:
 * in a news bullet that shape is far more often a leaked marker than prose,
 * and a leaked marker is what a reader must never see.
 */
const MARKER_LABEL = String.raw`(?:\p{L}[\p{L} \-]{0,19})?`;
/** Spaces or quote marks the model puts just inside a marker's brackets. */
const MARKER_PAD = String.raw`[\s"'“”‘’]*`;
const MARKER_GROUP = new RegExp(
    String.raw`\s*[[［【]${MARKER_PAD}${MARKER_LABEL}#\d+${MARKER_PAD}(?:\s*[,，、\-–~]\s*${MARKER_PAD}${MARKER_LABEL}#?\d+${MARKER_PAD})*[\]］】]`,
    'gu'
);

/**
 * A copy of the article list's own `[3]` numbering at the very end of a
 * bullet (before optional end punctuation). Without `#` a bracketed number
 * is only treated as a marker in that position, so a bracketed number
 * inside the sentence stays text.
 */
const TRAILING_BARE_MARKER = /\s*[[［【]\d+[\]］】](?=[.。!?！？]?$)/;

const MARKER_NUMBER = /\d+/g;

/** Final periods that belong to an abbreviation, not to the sentence. */
const ABBREVIATION_END = /\b(?:Inc|Corp|Co|Ltd|Jr|Sr|St|U\.S)\.$/;

const EN_MONTHS = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
] as const;

function timeZoneFor(currency: CurrencyCode): MarketTimeZone {
    return currency === 'KRW' ? 'Asia/Seoul' : 'America/New_York';
}

/**
 * The two market calendars a publish date is read in. Built once: a
 * formatter is costly to construct and holds no per-call state, so sharing
 * it cannot change any output.
 */
const MONTH_DAY_FORMATTERS = {
    'Asia/Seoul': monthDayFormat('Asia/Seoul'),
    'America/New_York': monthDayFormat('America/New_York'),
} as const;

type MarketTimeZone = keyof typeof MONTH_DAY_FORMATTERS;

function monthDayFormat(timeZone: string): Intl.DateTimeFormat {
    return new Intl.DateTimeFormat('en-US', {
        timeZone,
        month: 'numeric',
        day: 'numeric',
    });
}

/**
 * Month and day of `iso` in `timeZone`, or `null` when unparseable.
 *
 * Only numeric parts are read from `Intl` — the words around them are
 * rendered here, so a runtime whose ICU data words a localized date
 * differently cannot change the output.
 */
function monthDayIn(
    iso: string,
    timeZone: MarketTimeZone
): { month: number; day: number } | null {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return null;
    const parts = MONTH_DAY_FORMATTERS[timeZone].formatToParts(date);
    const month = Number(parts.find(p => p.type === 'month')?.value);
    const day = Number(parts.find(p => p.type === 'day')?.value);
    if (!Number.isInteger(month) || !Number.isInteger(day)) return null;
    return { month, day };
}

function formatMonthDay(
    md: { month: number; day: number },
    locale: AnalysisLocale
): string {
    switch (locale) {
        case 'ko':
            return `${md.month}월 ${md.day}일`;
        case 'en':
            return `${EN_MONTHS[md.month - 1]} ${md.day}`;
        case 'ja':
        case 'zh':
            return `${md.month}月${md.day}日`;
    }
}

/**
 * The rendered citation for one article.
 *
 * - `event` (a past key event): the date the news broke and the outlet.
 * - `upcoming` (a milestone the article announced): phrased as a report so
 *   the date is not read as the milestone's own date.
 */
function formatCitation(
    date: string | null,
    source: string,
    kind: CitationKind,
    locale: AnalysisLocale
): string {
    if (date === null) {
        return locale === 'ja' || locale === 'zh'
            ? `（${source}）`
            : ` (${source})`;
    }
    if (kind === 'event') {
        switch (locale) {
            case 'ko':
            case 'en':
                return ` (${date} · ${source})`;
            case 'ja':
                return `（${date}・${source}）`;
            case 'zh':
                return `（${date}，${source}）`;
        }
    }
    switch (locale) {
        case 'ko':
            return ` (${source} ${date} 보도)`;
        case 'en':
            return ` (reported by ${source}, ${date})`;
        case 'ja':
            return `（${source} ${date}報道）`;
        case 'zh':
            return `（${source} ${date}报道）`;
    }
}

/** First number in `group` that names an article with a source. */
function articleOf(
    group: string,
    articles: readonly CitableArticle[]
): CitableArticle | null {
    return (
        (group.match(MARKER_NUMBER) ?? [])
            .map(n => articles[Number(n) - 1])
            .find(a => a !== undefined && a.source.trim() !== '') ?? null
    );
}

/** Place `citation` at the end of `body`, before a sentence-final period. */
function appendCitation(body: string, citation: string): string {
    const endsWithPeriod = /[.。]$/.test(body) && !ABBREVIATION_END.test(body);
    return endsWithPeriod
        ? `${body.slice(0, -1)}${citation}${body.slice(-1)}`
        : `${body}${citation}`;
}

/**
 * @internal
 * Replace article markers in one bullet.
 *
 * - The LAST marker group that names a valid article is cited — the prompt
 *   asks for the source marker at the end, so an earlier aside
 *   ("unlike the earlier report [#5]") does not win. Within that group the
 *   first valid number is cited: one outlet per bullet keeps it readable.
 * - The citation goes at the end of the bullet, before a sentence-final
 *   period (other end punctuation, closing quotes and abbreviation periods
 *   stay before it).
 * - Every other marker, and any marker whose number is out of range, is
 *   removed: an unresolvable `[#9]` must never reach a reader.
 * - Text without markers is returned unchanged.
 */
export function resolveCitationMarkers(
    text: string,
    kind: CitationKind,
    ctx: CitationContext
): string {
    const bare = text.match(TRAILING_BARE_MARKER);
    const groups = [
        ...[...text.matchAll(MARKER_GROUP)].map(m => ({
            at: m.index,
            group: m[0],
        })),
        ...(bare === null ? [] : [{ at: bare.index ?? 0, group: bare[0] }]),
    ];
    if (groups.length === 0) return text;
    let article: CitableArticle | null = null;
    for (const { group } of groups.toSorted((a, b) => b.at - a.at)) {
        article = articleOf(group, ctx.articles);
        if (article !== null) break;
    }
    const body = text
        .replace(MARKER_GROUP, '')
        .replace(TRAILING_BARE_MARKER, '')
        .trim();
    if (article === null) return body;
    const md = monthDayIn(article.publishedAt, timeZoneFor(ctx.currency));
    return appendCitation(
        body,
        formatCitation(
            md === null ? null : formatMonthDay(md, ctx.locale),
            article.source.trim(),
            kind,
            ctx.locale
        )
    );
}

/**
 * @internal
 * Remove every marker from prose that carries no citation (the driver
 * paragraph, published verbatim as page copy).
 */
export function stripCitationMarkers(text: string): string {
    const stripped = text
        .replace(MARKER_GROUP, '')
        .replace(TRAILING_BARE_MARKER, '');
    return stripped === text ? text : stripped.trim();
}

/**
 * @internal
 * Resolve the markers of a whole news-analysis result: key events and
 * upcoming events get citations, the driver paragraph only loses stray
 * markers, and a bullet left empty is dropped.
 */
export function applyNewsCitations(
    result: NewsAnalysisResponse,
    ctx: CitationContext
): NewsAnalysisResponse {
    return {
        ...result,
        currentDriverKo: stripCitationMarkers(result.currentDriverKo),
        keyEventsKo: result.keyEventsKo
            .map(e => resolveCitationMarkers(e, 'event', ctx))
            .filter(e => e.length > 0),
        upcomingEventsKo: result.upcomingEventsKo
            .map(e => resolveCitationMarkers(e, 'upcoming', ctx))
            .filter(e => e.length > 0),
    };
}
