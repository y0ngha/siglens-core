import { roundToKrxTick, type KrxTickTable } from '@/domain/analysis/krxTick';
import { formatPrice } from '@/domain/analysis/promptFormat';
import type { CurrencyCode } from '@/domain/types';

/** Unit words a price figure may carry, in the four output locales. */
const UNIT = String.raw`(?:원|ウォン|달러|ドル|円|美元|韩元|韓元|元|dollars?|won|KRW|USD)`;

/**
 * Not a price: a figure followed by an ATR multiple, a ratio (`2x`, `2×`, `2배`) or a percent.
 * A small round stop (1, 2) would otherwise rewrite "1 ATR" or "2배".
 */
const NOT_PRICE_AFTER = String.raw`\s?(?:ATR|x|×|배|%|％)`;

/** The figure itself: digits with or without thousands commas and an optional decimal part. */
const FIGURE = String.raw`(?<![\d.,A-Za-z])(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?(?![\d]|[.,]\d|${NOT_PRICE_AFTER})`;

/**
 * A price figure in model prose and the unit word right after it. A leading `$` stays outside
 * the match and is kept. The look-arounds keep the figure whole: no digit, separator or Latin
 * letter before it (`S3`, `MA200`), no digit or separator-digit after it, and no multiplier or
 * percent after it ({@link NOT_PRICE_AFTER}).
 */
const PRICE_FIGURE = new RegExp(String.raw`${FIGURE}(\s?${UNIT})?`, 'gu');

/** A parenthesised text right after a figure, ASCII or full-width, one line, no nesting. */
const TRAILING_LABEL = /^(\s?)(\([^()（）\n]{0,60}\)|（[^()（）\n]{0,60}）)/u;

/**
 * A token right before `(` whose parentheses hold the figure: `MA20(`, `S1（`, `손절선=MA20(`.
 * The lead class is the separators a model puts before a level name.
 */
const PREFIX_TOKEN =
    /(^|[\s*:~\-—,·=/(（：、，])([^\s()（）·=/,:~*：、，]{1,20})([(（])\s?(\$?)$/u;

const CLOSING_PAREN = /^\s?[)）]/u;

/**
 * The level names whose parentheses may hold the stop (`MA20(28,000원)`): only these are
 * dropped with the figure, because they name the old level. Kept explicit and small; any other
 * token (`아래(`, `기준(`, `below(`) is a word of the sentence and stays, and only the figure in
 * its parentheses changes.
 */
const LEVEL_TOKEN =
    /^(?:(?:MA|EMA|SMA|WMA|VWAP|AVWAP|POC|VAH|VAL|BB|PP)\d*|[SRP]\d+|피봇\S*|피보나치\S*|Fib\S*|전저점|전고점|직전저점|직전고점|스윙저점|스윙고점|저점|고점|ピボット\S*|前回安値|安値|高値|前低|前高|低点|高点)$/iu;

/**
 * A trailing label that names a level (`(라운드)`, `(피봇 S1)`, `(VAH)`) or is a stale signed
 * distance (`(-3.3%)`): false for the new price, so it is dropped.
 */
const LEVEL_LABEL =
    /피봇|피보나치|Fib|pivot|\b(?:MA|EMA|SMA|WMA|VWAP|AVWAP|POC|VAH|VAL|BB|PP)\d*\b|\b[SR]\d\b|볼린저|Bollinger|켈트너|Keltner|슈퍼트렌드|Supertrend|돈치안|Donchian|라운드|round|원형|숫자|이평|이동평균|평균선|일선|주선|저점|고점|swing|스윙|support|확장|되돌림|retracement|extension|ピボット|フィボ|ラウンド|安値|高値|サポート|枢轴|斐波|整数|关口|支撑|低点|高点/iu;

const SIGNED_DISTANCE = /^[(（]\s*[+\-−]?\d+(?:\.\d+)?\s?%\s*[)）]$/u;

/** A qualifier on how the stop is read (`(종가 기준)`, `(on a daily close basis)`): kept. */
const QUALIFIER = /종가|마감|close|basis|closing|終値|收盘|收盤/iu;

/**
 * Whether a label names a level. `기준` ("basis", also "anchored on" in `(스윙 저점 기준 AVWAP)`)
 * and the bare `지지` ("support") are not level names by themselves, so `(지지 기준)` stays while
 * `(스윙 저점 기준 AVWAP)` is dropped.
 */
const namesLevel = (label: string): boolean =>
    LEVEL_LABEL.test(label.replace(/기준|지지/gu, ''));

const NAMES_THE_STOP = /손절|stop|loss|損切|止损|止損/iu;

const isLevelToken = (token: string): boolean =>
    LEVEL_TOKEN.test(token) && !NAMES_THE_STOP.test(token);

const isDroppableLabel = (label: string): boolean =>
    !QUALIFIER.test(label) &&
    (SIGNED_DISTANCE.test(label) || namesLevel(label));

/**
 * Between two stop candidates: "A 또는 B", "A or B", or a stop band "A~B" / "A-B". Not `/`
 * (`R/R 14.50/14.23`).
 */
const ALTERNATIVE = String.raw`(?:\s*(?:또는|혹은|または|或)\s*|\s+or\s+|\s*[~\-–〜]\s*)`;

/**
 * A figure joined to another by a range dash, and the rest of that range. The edges of an
 * entry zone are left alone even when one equals the stop: the A/B showed a model reusing its
 * stop as the top of an alternative entry zone (`51.96~51.69달러 구간 진입 시`), and rewriting it
 * moved the zone. The role keyword (a stop word or an entry word) nearest to the range in its
 * clause decides, on either side, the one before it winning a tie: an entry word makes it an
 * entry zone (`진입 27,000~28,000원`, `buy 14.50-15.00`, `손절 28,000원, 진입 28,000~29,000원`,
 * `… 구간 진입 시`, `… 분할 매수`), a stop word a stop band (`손절 28,000~27,400원 진입 시 무효`,
 * `止损 28,000~27,400韩元 买入`, `5.13~5.15 진입 시에도 5.06~5.04가 손절 기준`), and a range with
 * neither is a stop band too. A stop band is rewritten like any figure. A clause runs between
 * `.`, `!`, `?`, `。`, `;`, `；` and line breaks.
 */
const RANGE_BEFORE = new RegExp(
    String.raw`\d[\d,]*(?:\.\d+)?(?:\s?${UNIT})?\s*[~\-–〜]\s*\$?$`,
    'u'
);
const RANGE_REST = new RegExp(
    String.raw`^\s*[~\-–〜]\s*\$?\d[\d,]*(?:\.\d+)?(?:\s?${UNIT})?`,
    'u'
);
const ENTRY_WORD = String.raw`(?:진입|매수|분할\s*매수|entry|enter|buy|エントリー|買い|买入|进场|入场|進場)`;
/** Every stop word or entry word, to find the role keyword nearest before a range. */
const ROLE_WORD = new RegExp(
    String.raw`(손절|stop|loss|損切|止损|止損)|${ENTRY_WORD}`,
    'giu'
);
const CLAUSE_START = /[\s\S]*[.!?。;；\n]/u;
const CLAUSE_END = /[.!?。;；\n]/u;

const isEntryZoneEdge = (textBefore: string, after: string): boolean => {
    const rest = RANGE_REST.exec(after);
    const before = RANGE_BEFORE.exec(textBefore);
    if (rest === null && before === null) return false;
    // The text before the range's first figure, from the start of its clause.
    const rangeStart =
        before === null ? textBefore : textBefore.slice(0, before.index);
    const lead = rangeStart.slice(
        CLAUSE_START.exec(rangeStart)?.[0].length ?? 0
    );
    // The rest of the clause after the range.
    const tail = rest === null ? after : after.slice(rest[0].length);
    const trail = tail.slice(0, CLAUSE_END.exec(tail)?.index ?? tail.length);
    // The role keyword nearest to the range on either side decides (before wins a tie).
    const lastBefore = [...lead.matchAll(ROLE_WORD)].at(-1);
    const firstAfter = [...trail.matchAll(ROLE_WORD)].at(0);
    const beforeDistance =
        lastBefore === undefined
            ? Infinity
            : lead.length - (lastBefore.index + lastBefore[0].length);
    const afterDistance =
        firstAfter === undefined ? Infinity : firstAfter.index;
    const nearest = beforeDistance <= afterDistance ? lastBefore : firstAfter;
    return nearest !== undefined && nearest[1] === undefined;
};

const groupThousands = (digits: string): string => {
    const [int, frac] = digits.split('.');
    const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return frac === undefined ? grouped : `${grouped}.${frac}`;
};

const escapeRegExp = (text: string): string =>
    text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * @internal
 * The stop figure in a prose field, moved to the stop core put in its place.
 *
 * Core floors the stop one ATR below the zone low after the model has written its prose
 * (`reconcileBullishActionRecommendation`), and the model cannot measure that distance itself:
 * in the real-LLM A/B its stops sat a median 0.84 ATR below the zone, code moved the stop in
 * 468 of 598 plans, and the exit text still named the pre-floor stop in 467 of them. A prompt
 * that already stated the floor did not change that, so the figure is replaced here instead,
 * which makes the prose and `reconciledLevels.stopLoss` agree by construction.
 *
 * When unsure it changes only the figure and leaves the words alone; it never deletes a word
 * that is not a level name.
 *
 * - Every figure equal to `from` (for a KRW listing, also one that rounds to it at the KRX tick,
 *   because the model's stop was tick-rounded before reconciliation) becomes `to`, at the
 *   listing's precision, with thousands commas when the original had them; its unit word stays.
 * - A parenthesised label right after the figure (ASCII or full-width) is dropped only when it
 *   names a level (`28,000원(라운드)`, `(피봇 S1)`) or is a signed distance (`(-3.3%)`), and it
 *   holds no qualifier on how the stop is read (`(종가 기준)`, `(on a daily close basis)` stay).
 * - A level-name token whose parentheses hold the figure (`MA20(28,000원)`, `S1（…）`, from the
 *   small list in {@link LEVEL_TOKEN}) is replaced by the figure. Any other token (`아래(`,
 *   `기준(`, `below(`) stays with its parentheses, and only the figure changes.
 * - A label separated from the figure by a space (`피봇 S1 40.63달러`) cannot be told apart
 *   from the sentence and stays.
 * - A figure followed by an ATR multiple, a ratio or a percent (`1 ATR`, `2배`, `14.5 %`) is
 *   never rewritten.
 * - An edge of an entry zone is never rewritten. The stop or entry word nearest to the range
 *   in its clause decides, the one before it winning a tie (`손절 28,000원, 진입 28,000~29,000원`
 *   and `51.96~51.69달러 구간 진입 시` are entry zones; `손절 28,000~27,400원 진입 시 무효` and
 *   `진입 시에도 5.06~5.04가 손절 기준` are stop bands). A range with neither is a stop band
 *   (`5.06~5.04 지지 이탈`). A stop band is rewritten.
 * - Two alternatives or a band that the rewrite made equal (`27,400원 또는 27,400원(피봇 S3)`,
 *   `27,400~27,400원`) collapse to one, keeping a member's label; a pair the rewrite did not
 *   produce is never touched.
 * - Korean numeral forms (`8만3천1백원`) are not matched. Running it again with the same `from`
 *   and `to` changes nothing.
 *
 * Callers pass only fields whose subject is the stop (`exit`, `riskReward`): in summary or
 * positionAnalysis the same figure usually names the support level itself, which did not move.
 *
 * @param text - The prose field.
 * @param from - The model's raw stop. For KRW a figure matches when it equals `from` or
 *   both round to the same KRX tick, so a prose figure written at the tick still matches.
 * @param to - The stop core replaced it with.
 */
export function rewriteStopInProse(
    text: string,
    from: number,
    to: number,
    currency: CurrencyCode,
    krxTick: KrxTickTable
): string {
    if (from === to || !Number.isFinite(from) || !Number.isFinite(to)) {
        return text;
    }
    const tolerance = 1e-9 * Math.max(1, Math.abs(from));
    const isStop = (value: number): boolean =>
        Math.abs(value - from) <= tolerance ||
        (currency === 'KRW' &&
            Math.abs(
                roundToKrxTick(value, krxTick) - roundToKrxTick(from, krxTick)
            ) <= tolerance);
    const plain = formatPrice(to, currency, krxTick);

    const parts: string[] = [];
    // Output offsets where a rewritten figure starts (after any `$`).
    const produced = new Set<number>();
    let length = 0;
    let cursor = 0;
    const emit = (piece: string): void => {
        parts.push(piece);
        length += piece.length;
    };

    for (const match of text.matchAll(PRICE_FIGURE)) {
        const [whole, int, frac] = match;
        const start = match.index;
        if (start < cursor) continue;
        const value = Number(`${int.replace(/,/g, '')}${frac ?? ''}`);
        if (!isStop(value)) continue;
        const unit = match[3] ?? '';
        const figure = int.includes(',') ? groupThousands(plain) : plain;
        const end = start + whole.length;
        const before = text.slice(cursor, start);
        const after = text.slice(end);
        if (isEntryZoneEdge(text.slice(0, start), after)) continue;

        const prefix = PREFIX_TOKEN.exec(before);
        const closing = CLOSING_PAREN.exec(after);
        if (prefix !== null && closing !== null && isLevelToken(prefix[2])) {
            // `MA20(28,000원)` → `27,400원`: the level name and its parentheses go.
            const tokenStart = prefix.index + prefix[1].length;
            emit(before.slice(0, tokenStart));
            emit(prefix[4]);
            produced.add(length);
            emit(`${figure}${unit}`);
            cursor = end + closing[0].length;
            continue;
        }

        emit(before);
        produced.add(length);
        emit(figure);
        const label = TRAILING_LABEL.exec(after);
        if (label !== null && isDroppableLabel(label[2])) {
            // A space the match took only to reach the dropped label is not kept either.
            emit(unit.trimEnd());
            cursor = end + label[0].length;
        } else {
            emit(unit);
            cursor = end;
        }
    }
    if (produced.size === 0) return text;
    emit(text.slice(cursor));
    return collapseRepeatedStop(parts.join(''), plain, produced);
}

/**
 * "27,400원 또는 27,400원(피봇 S3)": the model offered its stop and the level code moved it to
 * as alternatives (or as a band), and the rewrite made them one price. A pair collapses only when
 * one of its members is a figure the rewrite produced (`produced`, output offsets) and the
 * other is the same price; it keeps the member that carries a label (the second when both
 * do). Every other pair, such as two equal targets, is left alone.
 */
function collapseRepeatedStop(
    text: string,
    plain: string,
    produced: ReadonlySet<number>
): string {
    const forms = [...new Set([plain, groupThousands(plain)])]
        .map(escapeRegExp)
        .join('|');
    const label = String.raw`(?:\s?(?:\([^()（）\n]{0,60}\)|（[^()（）\n]{0,60}）))`;
    const one = String.raw`(\$?)(?:${forms})(?![\d]|[.,]\d)(?:\s?${UNIT})?(${label})?`;
    const pair = new RegExp(
        String.raw`(?<![\d.,A-Za-z$])(${one})(${ALTERNATIVE})(${one})`,
        'gu'
    );
    return text.replace(
        pair,
        (
            whole: string,
            first: string,
            firstDollar: string,
            firstLabel: string | undefined,
            connective: string,
            second: string,
            _secondDollar: string,
            secondLabel: string | undefined,
            offset: number
        ) => {
            const firstAt = offset + firstDollar.length;
            const secondAt =
                offset +
                first.length +
                connective.length +
                (second.startsWith('$') ? 1 : 0);
            if (!produced.has(firstAt) && !produced.has(secondAt)) {
                return whole;
            }
            return secondLabel === undefined && firstLabel !== undefined
                ? first
                : second;
        }
    );
}
