import {
    FTD_SPIKE_MIN_MULTIPLE,
    INVESTOR_FLOWS_AXES,
    KR_WINDOW_DAYS,
    PROMPT_MAX_NAME_CHARS,
    PROMPT_MAX_SQUEEZE_COMPONENTS,
    SHORT_INTEREST_TREND_POINTS,
} from '@/domain/investorFlows/constants';
import {
    DEFAULT_ANALYSIS_LOCALE,
    type AnalysisLocale,
} from '@/domain/analysis/outputLocale';
import { MS_PER_DAY } from '@/domain/constants/time';
import { formatDay, parseDay } from '@/domain/investorFlows/scoreHelpers';
import type {
    InvestorFlowsAxisBase,
    InvestorFlowsAxisId,
    InvestorFlowsEvidence,
    InvestorFlowsFreshness,
    InvestorFlowsLabel,
    InvestorFlowsMarket,
    InvestorFlowsScorecard,
    InvestorFlowsSignal,
    InvestorFlowsSignalDirection,
    InvestorFlowsSignalId,
    InvestorFlowsSignalStrength,
    InvestorFlowsWindow,
    LargeHolderMetrics,
    SqueezeRiskComponentId,
    SqueezeRiskLevel,
    SqueezeRiskScore,
} from '@/domain/investorFlows/types';

/**
 * Display names the scorecard renders instead of its identifiers. The A/B
 * copied `label=neutral` and `axes used: insider, short, dilution` straight into
 * Korean text ("종합 라벨 neutral", "사용 축: insider, short, dilution"), so the
 * prompt gives the words to write: Korean ones for Korean output, plain English
 * otherwise. Axis ids still appear once per heading, because the response
 * schema keys interpretations by them. Prompt wording.
 */
export interface ScorecardWords {
    readonly axis: Readonly<Record<InvestorFlowsAxisId, string>>;
    readonly label: Readonly<Record<InvestorFlowsLabel, string>>;
    readonly direction: Readonly<Record<InvestorFlowsSignalDirection, string>>;
    readonly strength: Readonly<Record<InvestorFlowsSignalStrength, string>>;
    readonly squeezeLevel: Readonly<Record<SqueezeRiskLevel, string>>;
    /** One schedule's positions and filings, in the form the answer should copy. */
    readonly positionsAndFilings: (
        schedule: '13D' | '13G',
        events: number,
        filings: number
    ) => string;
}

const EN_WORDS: ScorecardWords = {
    axis: {
        institutional: 'institutions',
        insider: 'insiders',
        largeHolders: '5% holders',
        short: 'short selling',
        dilution: 'dilution',
    },
    label: {
        strong_bullish: 'strongly bullish',
        bullish: 'bullish',
        neutral: 'neutral',
        bearish: 'bearish',
        strong_bearish: 'strongly bearish',
        insufficient: 'insufficient data',
    },
    direction: { bullish: 'bullish', bearish: 'bearish', neutral: 'neutral' },
    strength: { weak: 'weak', moderate: 'moderate', strong: 'strong' },
    squeezeLevel: {
        low: 'low',
        elevated: 'elevated',
        high: 'high',
        extreme: 'extreme',
    },
    positionsAndFilings: (schedule, events, filings) =>
        `${schedule}: ${groupDigits(events)} ${events === 1 ? 'position' : 'positions'} · ${groupDigits(filings)} ${filings === 1 ? 'filing' : 'filings'}`,
};

const KO_WORDS: ScorecardWords = {
    axis: {
        institutional: '기관',
        insider: '내부자',
        largeHolders: '5% 이상 대량보유자',
        short: '공매도',
        dilution: '증자·희석',
    },
    label: {
        strong_bullish: '강한 강세',
        bullish: '강세',
        neutral: '중립',
        bearish: '약세',
        strong_bearish: '강한 약세',
        insufficient: '데이터 부족',
    },
    direction: { bullish: '강세', bearish: '약세', neutral: '중립(참고)' },
    strength: { weak: '약함', moderate: '보통', strong: '강함' },
    squeezeLevel: {
        low: '낮음',
        elevated: '다소 높음',
        high: '높음',
        extreme: '매우 높음',
    },
    positionsAndFilings: (schedule, events, filings) =>
        `${schedule} 포지션 ${groupDigits(events)}건 · 신고 ${groupDigits(filings)}회`,
};

/** Display names for an output locale: Korean for `ko`, plain English otherwise. */
export function scorecardWords(locale: AnalysisLocale): ScorecardWords {
    return locale === 'ko' ? KO_WORDS : EN_WORDS;
}

/**
 * A number with standard thousands commas in its integer part (`861060` →
 * `861,060`, `1234567.5` → `1,234,567.5`); decimals and numbers under 1,000
 * are unchanged. The A/B copied bare integers ("861060 USD", "42673721") into
 * prose; grouped digits are what the reader expects, and the copy rule keeps
 * the model from regrouping them. Written by hand, not with `toLocaleString`:
 * ICU data differs between runtimes, and a prompt must be byte-stable.
 */
export function groupDigits(value: number): string {
    const text = String(value);
    if (!Number.isFinite(value) || text.includes('e')) return text;
    const [whole, fraction] = text.split('.');
    const sign = whole.startsWith('-') ? '-' : '';
    const digits = sign === '' ? whole : whole.slice(1);
    if (digits.length < 4) return text;
    const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return `${sign}${grouped}${fraction === undefined ? '' : `.${fraction}`}`;
}

/** Source line per axis (US listings), after the axis name in its heading; names the source and its lag so the model reads the number in context. */
export const INVESTOR_FLOWS_AXIS_HEADINGS: Readonly<
    Record<InvestorFlowsAxisId, string>
> = {
    institutional:
        'SEC 13F holdings, quarterly, filed up to ~45 days after quarter end (13F option positions are underlying notional, mostly hedges)',
    insider:
        'SEC Form 4 transactions (filed ~2 business days after the trade) and Form 144 notices of proposed sales',
    largeHolders:
        'SEC Schedule 13D (activist intent) and 13G (passive) filings by 5%+ owners',
    short: 'FINRA short interest (twice a month) and off-exchange short volume (daily); SEC fails to deliver (published ~2 weeks late) and Reg SHO threshold lists',
    dilution:
        'SEC registration and offering filings (S-1/F-1, S-3/F-3 shelves, 424B prospectus supplements, Form D) over the last 180 days',
};

/** An axis scored for Korean listings (DART fills these slots). */
export type KrScoredAxisId = Extract<
    InvestorFlowsAxisId,
    'insider' | 'largeHolders'
>;

/** Axes scored for Korean listings, in canonical order. */
export const KR_SCORED_AXES: readonly KrScoredAxisId[] = [
    'insider',
    'largeHolders',
];

/** Prompt heading per Korean-scored axis. */
export const KR_INVESTOR_FLOWS_AXIS_HEADINGS: Readonly<
    Record<KrScoredAxisId, string>
> = {
    insider:
        'DART executive / major-shareholder ownership reports (임원·주요주주 소유상황보고; no trade cause is reported) and trading-plan reports (거래계획보고서)',
    largeHolders:
        'DART 5%+ major-holder reports (대량보유 상황보고; no holding purpose is reported)',
};

/** The line that replaces the US-only axes for a Korean listing. Prompt wording. */
export function krNotProvidedLine(
    locale: AnalysisLocale = DEFAULT_ANALYSIS_LOCALE
): string {
    const { axis } = scorecardWords(locale);
    return `- ${axis.institutional}, ${axis.short}, ${axis.dilution} — NOT PROVIDED for Korean listings: institutional / foreign net buying, short selling and offering filings are not in this dataset. Say they are not provided; never describe them as neutral or fill them in from general knowledge.`;
}

/**
 * The scorecard renders `name=value` pairs for the model to read; this keeps
 * those names out of the reader-facing text. Prompt wording.
 */
export const INVESTOR_FLOWS_PLAIN_TEXT_RULE =
    '- Never write identifiers from this prompt in the output text: no metric, evidence, signal, label or axis identifiers (camelCase such as shortInterestPctFloat or largeHolders, snake_case such as fails_to_deliver_elevated or price_change_20d, label values such as strong_bullish, neutral or insufficient, axis ids such as institutional, insider, short or dilution — where the output schema has an "axis" field, they appear only as its value) and no `name=value` forms. Write labels and axes with the display names the scorecard gives, and state each fact in plain words in the output language, with its number, its unit as rendered here (%, %p, days, shares, USD) and its date.';

/** {@link INVESTOR_FLOWS_PLAIN_TEXT_RULE} with Korean-listing examples: its US examples name short interest, which a Korean prompt says is not provided. */
export const INVESTOR_FLOWS_KR_PLAIN_TEXT_RULE =
    '- Never write identifiers from this prompt in the output text: no metric, evidence, signal, label or axis identifiers (camelCase such as ratioChangePct or largeHolders, snake_case such as kr_major_holder_increase or kr_insider_cluster, label values such as strong_bullish, neutral or insufficient, axis ids such as insider or largeHolders — where the output schema has an "axis" field, they appear only as its value) and no `name=value` forms. Write labels and axes with the display names the scorecard gives, and state each fact in plain words in the output language, with its number, its unit as rendered here (%, %p, days, shares, USD) and its date.';

/**
 * How the model states a scoring window: by quoting the rendered inclusive
 * start date, never by deriving a boundary of its own. Prompt wording.
 */
export const INVESTOR_FLOWS_WINDOW_RULE =
    '- Scoring windows: state a window by quoting its rendered start date as given ("on or after <date>"); that date is inside the window. Never derive a boundary of your own (no "before <date> is outside the window" with a date the data does not show).';

/**
 * Interpretation limits written from the A/B: the model added price-impact
 * predictions ("주가에 부담") and present-tense claims a dated snapshot cannot
 * show ("숏이 빠르게 청산되고 있다"). Prompt wording.
 *
 * @param scope - Where the limits apply (`the output`, or one section's fields
 * in a prompt that has other axes).
 * @param market - Picks the example: a Korean prompt has no short data.
 */
export function investorFlowsInterpretationRules(
    scope: string,
    market: InvestorFlowsMarket = 'us'
): string {
    // Korean listings have no short data: their example names a DART report.
    const example =
        market === 'kr'
            ? 'e.g. a 5%+ holder\'s ratio rose 1.2%p between two report receipt dates), not a present-tense process (e.g. "the holder is accumulating now")'
            : 'e.g. short interest fell 13.59% between two settlement dates), not a present-tense process (e.g. "shorts are covering fast")';
    return [
        `- In ${scope}, describe supply and positioning facts only: never predict the effect on the share price (no "weighs on the stock", "upward pressure", "주가에 부담", "상승 압력").`,
        `- In ${scope}, never claim what is happening now beyond what the dated data shows: state the change with its dates (${example}.`,
        INVESTOR_FLOWS_WINDOW_RULE,
        '- Quote counts and totals (notices, filers, transactions, values, shares) from the scorecard metrics and evidence; never count the listed source rows yourself — the lists are capped and can include rows outside the scoring window.',
    ].join('\n');
}

/** Korean FTD caveat: the whole caveat, both parts in one sentence. Prompt wording. */
const FTD_CAVEAT_KO_SENTENCE =
    '결제불이행은 결제 시점·청산·운영 지연 등 여러 원인으로 생기며 무차입(불법) 공매도의 증거가 아닙니다';

/** The FTD caveat rule, one sentence per locale (see {@link investorFlowsOutputRules}). */
function ftdCaveatRule(caveatTarget: string, locale: AnalysisLocale): string {
    const scope = `- Whenever the output mentions fails to deliver at all, ${caveatTarget} must also carry the fails-to-deliver caveat`;
    const once =
        'State this caveat at most once per output field; never repeat the same sentence. "Interpret separately from short interest" does not replace it.';
    return locale === 'ko'
        ? `${scope}, written as exactly this one Korean sentence: "${FTD_CAVEAT_KO_SENTENCE}". That sentence is the whole caveat: never add a second sentence that restates either part (the operational causes or the naked short selling point), in Korean or English. ${once}`
        : `${scope}: one sentence saying that fails have many operational causes (settlement timing, clearing and operational delays) and are not evidence of naked (illegal) short selling — say it in those words, and never add a second sentence restating either part. ${once}`;
}

/**
 * Output rules shared by the investor-flows prompt and the overall prompt's
 * investor-flows section, written from real-LLM A/B failures: an FTD peak
 * quoted with the latest file date, FTDs mentioned without the naked-shorting
 * caveat, scorecard identifiers (`shortInterestTrend=falling`,
 * `strong_bullish`) copied into prose, a 20-day price change quoted without
 * its percent sign, and an active ATM described like a shelf. Prompt wording.
 *
 * The FTD caveat is one sentence per locale. An English-worded requirement
 * plus a separate Korean sentence made Korean output carry both (the caveat
 * twice in one bullet, AAPL real-data run), so Korean output gets a single
 * Korean sentence that holds both parts and nothing else.
 *
 * @param caveatTarget - Where the FTD caveat must appear (the output fields of
 * the prompt using the rules).
 * @param locale - Output locale; picks the caveat's wording.
 */
export function investorFlowsOutputRules(
    caveatTarget: string,
    locale: AnalysisLocale
): string {
    return [
        '- Fails to deliver: quote an FTD quantity only with its own settlement date — the peak with the peak settlement date shown next to it, never with the latest fails-to-deliver file date.',
        ftdCaveatRule(caveatTarget, locale),
        `- Never call fails to deliver routine, normal or usual (일상적) when the baseline multiple (failsToDeliverMultiple) is ${FTD_SPIKE_MIN_MULTIPLE} or more, even when the peak is too small to raise a signal; say the peak is elevated against its usual (baseline) level but small relative to shares outstanding. When the multiple is n/a the baseline was too thin to compare against; make no baseline comparison and use no spike or surge wording (spike, surge, 급증, 급등) — describe only the level against shares outstanding.`,
        `- 13D/13G counts: events13d / events13g are positions — one per holder after a filer's amendments are netted and a joint filing's co-filers merged — and filings13d / filings13g are how many filings they made. Quote positions as the number of holders or positions and filings only as how often they filed, as the "positions vs filings" line renders them${locale === 'ko' ? ' (e.g. "13D 포지션 1건 · 신고 7회")' : ''}; never call the filing count positions or holders.`,
        '- An active at-the-market (ATM) program means the company may be selling new shares into the market right now, at market prices — say so. Do not describe the size or pace of ATM sales; the filings do not show it. A shelf or a full registration only creates the capacity to sell later and does not mean shares are being sold.',
        INVESTOR_FLOWS_PLAIN_TEXT_RULE,
    ].join('\n');
}

/**
 * Percent units that name their basis. A bare `shortInterestPctFloat=0.72%`
 * was written up as "시가총액 대비" — float and shares outstanding are share
 * counts, not market value, and the basis changes the number's meaning.
 */
const PCT_OF_FLOAT = '% of float shares';
/** See {@link PCT_OF_FLOAT}. */
const PCT_OF_OUTSTANDING = '% of shares outstanding';
/**
 * A 13D/13G percent of class. A bare `% of class` was copied into Korean
 * output ("9.4% of class"); the class is the shares outstanding of that
 * class, and the Korean terminology rule maps it to 발행주식의 X%.
 */
export const PCT_OF_CLASS = '% of shares outstanding (class)';

/**
 * Korean word for a material change, rendered only for Korean output in both
 * markets' prompts: the model wrote the literal 물질적 변동. Prompt wording.
 */
export const INVESTOR_FLOWS_KO_CHANGE_TERM_RULE =
    '- Korean terminology: write 유의미한 변동 for a material change (유의미한 변동 없음 for no material change); never write 물질적 변동.';

/**
 * Korean terms and number style for the investor-flows output, rendered only
 * for Korean output: the model otherwise coins literal translations (미결제,
 * 제안 매도, 선반등록, 자기 기준선), calls a percent of float "시가총액 대비",
 * leaves English words in Korean sentences, adds approximate restatements
 * next to exact figures ("37,838,986달러(약 3,210만 달러 상당 321,061주)") and
 * garbles digits when converting to 만/억 ("3,210,61주" for 321,061) — so
 * numbers are copied as rendered, never converted. Prompt wording.
 */
export const INVESTOR_FLOWS_KO_TERMINOLOGY_RULE = [
    '- Korean terminology: write 결제불이행(FTD) for fails to deliver, 매도 예정 신고(Form 144) for a Form 144 notice, 일괄신고(셸프 등록) for a shelf registration, Reg SHO 결제불이행 임계 종목 목록 for the Reg SHO threshold list, 숏스퀴즈 for a short squeeze, 시장가 상시 발행(ATM) for an at-the-market program, 유동주식 for float shares, 발행주식 for shares outstanding, 평소 수준(기준선) for a baseline and 발행 여력 for registration capacity. Never write 미결제, 실패결제, 제안 매도, 선반등록 or 자기 기준선, never write 압축 for a short squeeze, never call the threshold list 서킷브레이커 (that is Rule 201, a different rule), never call a percent of float or of shares outstanding 시가총액 대비, and leave no English word (baseline, capacity, float) in Korean sentences.',
    INVESTOR_FLOWS_KO_CHANGE_TERM_RULE,
    `- Korean terminology: write a figure in ${PCT_OF_CLASS} or in ${PCT_OF_OUTSTANDING} as 발행주식의 X% (e.g. "9.1${PCT_OF_CLASS}" → "발행주식의 9.1%"), a share count as N주 (e.g. "411,522 shares" → "411,522주"), a USD amount as N달러, a day count as N일 and a window start "on or after <date>" as "<date> 이후(당일 포함)"; never leave "of class", "of shares outstanding", "shares", "on or after" or any other English unit or phrase in a Korean sentence.`,
    '- Korean numbers: copy numbers digit-for-digit exactly as they appear in the data, with standard 3-digit comma grouping; do not convert share counts or dollar amounts into 만/억 forms and do not regroup digits. Never add an approximate restatement next to an exact figure, and keep share counts and dollar amounts in separate phrases (never "N달러 상당 M주").',
].join('\n');

/** Strip line breaks and clip a filing-supplied name so it cannot inject prompt structure. */
export function sanitizePromptText(text: string, maxChars: number): string {
    const flat = text.replace(/\s+/g, ' ').trim();
    return flat.length > maxChars ? `${flat.slice(0, maxChars)}…` : flat;
}

/**
 * A z-score rendered in words. A bare `z=1.26` was copied into the output
 * verbatim; once the unit says what the number is, there is no `z=` form left
 * to copy (see {@link PROMPT_KEY_NAMES}).
 */
const Z_SCORE_UNIT = ' standard deviations from its trailing-baseline mean';

/**
 * Unit suffix of each squeeze input as rendered (see `SQUEEZE_COMPONENTS`).
 * A bare `price_change_20d=23.06` was quoted by the model as "20일 가격 변동
 * 23.06" — the number without its unit reads as a price.
 */
const SQUEEZE_COMPONENT_UNITS: Readonly<
    Record<SqueezeRiskComponentId, string>
> = {
    short_interest_pct_float: PCT_OF_FLOAT,
    days_to_cover: ' days',
    short_interest_trend: '%',
    off_exchange_short_ratio_z: Z_SCORE_UNIT,
    fails_to_deliver_pct: PCT_OF_OUTSTANDING,
    threshold_list_days: ' days',
    price_change_20d: '%',
    volume_ratio: 'x',
};

function isSqueezeComponentId(key: string): key is SqueezeRiskComponentId {
    return Object.hasOwn(SQUEEZE_COMPONENT_UNITS, key);
}

/**
 * Unit suffix of a metric or evidence figure, read from its key: squeeze
 * inputs by id, z-scores (`z`, `…Z`) in standard deviations, `…ratioChangePct`
 * in percentage points, percent-of-float / -outstanding / -prior-holdings keys
 * with their basis, any other `pct` key in percent. Keys without a known
 * unit render bare.
 */
export function unitOfFigure(key: string): string {
    if (isSqueezeComponentId(key)) return SQUEEZE_COMPONENT_UNITS[key];
    if (key === 'z' || /Z$/.test(key)) return Z_SCORE_UNIT;
    if (/ratioChangePct$/i.test(key)) return '%p';
    if (/pctFloat$/i.test(key)) return PCT_OF_FLOAT;
    if (/(pctOfSharesOutstanding|pctOutstanding)$/i.test(key)) {
        return PCT_OF_OUTSTANDING;
    }
    if (/pctOfPriorHoldings$/i.test(key)) return '% of prior holdings';
    if (/percentOfClass$/i.test(key)) return PCT_OF_CLASS;
    if (/pct/i.test(key)) return '%';
    return '';
}

/** Keys renamed for the prompt, where the bare key is a form the model copies (`z=1.26`). */
const PROMPT_KEY_NAMES: Readonly<Record<string, string>> = {
    z: 'shortVolumeRatioDeviation',
    shortVolumeRatioZ: 'shortVolumeRatioDeviation',
};

/** `key=value` with the value's unit; `n/a` for a missing or non-finite figure (never `NaN`). */
function formatFigure(key: string, value: number | null): string {
    const name = PROMPT_KEY_NAMES[key] ?? key;
    return `${name}=${value === null || !Number.isFinite(value) ? 'n/a' : `${groupDigits(value)}${unitOfFigure(key)}`}`;
}

function formatEvidence(evidence: InvestorFlowsEvidence): string {
    return Object.entries(evidence)
        .map(([key, value]) => formatFigure(key, value))
        .join(', ');
}

/** What a signal's `subject` is, when the bare value would be ambiguous (a date is not a party). */
const SUBJECT_LABELS: Partial<Record<InvestorFlowsSignalId, string>> = {
    fails_to_deliver_elevated: 'peak settlement date ',
    insider_proposed_sale_cluster: 'cluster span ',
    kr_insider_cluster: 'cluster span ',
    kr_insider_routine_mass_filing: 'filing span ',
    short_interest_trend: 'settlements ',
    institutional_holder_count_change: 'quarter ending ',
    institutional_net_share_change: 'quarter ending ',
};

/** Text after a subject, when the subject alone does not name both endpoints. */
const SUBJECT_SUFFIXES: Partial<Record<InvestorFlowsSignalId, string>> = {
    kr_insider_routine_mass_filing:
        '; many reporters filed together with a median change too small to count, not a coordinated move and adds no points',
    institutional_holder_count_change: ' vs the quarter before',
    institutional_net_share_change: ' vs the quarter before',
};

/**
 * What a neutral note means, after its evidence. The "no material change"
 * notes sit on an axis scored neutral 0 from real reports; without the note
 * the model read the bare neutral as missing data ("데이터 부족").
 */
const SIGNAL_NOTES: Partial<Record<InvestorFlowsSignalId, string>> = {
    large_holder_ratio_diluted:
        ' — shares held did not change; the percent fell because the company has more shares outstanding, not because the holder sold: not a reduction',
    kr_major_holder_no_material_change:
        " — reports were filed in the window, but no reporter's net holding ratio changed by 1%p or more or crossed 5%: no material change, a measured neutral reading, not missing data",
    kr_insider_no_material_change:
        ' — reports were filed in the window, but their net change and any cluster are too small to count: no material change, a measured neutral reading, not missing data',
};

type MetricRecord = Readonly<Record<string, unknown>>;

function dateOf(metrics: MetricRecord, key: string): string | null {
    const value = metrics[key];
    return typeof value === 'string' ? value : null;
}

/**
 * Endpoints rendered next to each change metric, from the metric's own date
 * fields (consumed here, not listed again). "The code computes, the model
 * copies": a change printed without its endpoints was attributed to the wrong
 * prior settlement in the A/B.
 */
const CHANGE_ENDPOINTS: Readonly<
    Record<string, (metrics: MetricRecord) => string | null>
> = {
    shortInterestChangePct: m => {
        const from = dateOf(m, 'shortInterestChangeFromDate');
        const to = dateOf(m, 'shortInterestChangeToDate');
        return from === null || to === null
            ? null
            : `${from} → ${to}, over ${SHORT_INTEREST_TREND_POINTS} settlements`;
    },
    shortInterestLatestChangePct: m => {
        const from = dateOf(m, 'shortInterestLatestChangeFromDate');
        const to = dateOf(m, 'shortInterestLatestChangeToDate');
        return from === null || to === null
            ? null
            : `${from} → ${to}, latest settlement vs the one before`;
    },
    holderCountChangePct: m => {
        const period = dateOf(m, 'scoredPeriod');
        return period === null
            ? null
            : `quarter ending ${period} vs the quarter before`;
    },
    netShareChangePct: m => {
        const period = dateOf(m, 'scoredPeriod');
        return period === null
            ? null
            : `quarter ending ${period} vs the quarter before`;
    },
};

/** Date fields rendered only as endpoints of their change metric. */
const ENDPOINT_ONLY_KEYS: ReadonlySet<string> = new Set([
    'shortInterestChangeFromDate',
    'shortInterestChangeToDate',
    'shortInterestLatestChangeFromDate',
    'shortInterestLatestChangeToDate',
]);

/** US 13D/13G signals, whose evidence renders as dated positions (see {@link formatLargeHolderEvidence}). */
const LARGE_HOLDER_POSITION_SIGNALS: ReadonlySet<InvestorFlowsSignalId> =
    new Set<InvestorFlowsSignalId>([
        'activist_13d_new',
        'activist_13d_increase',
        'activist_13d_reduction',
        'activist_13d_exit',
        'passive_13g_new',
        'passive_13g_increase',
        'passive_13g_reduction',
        'passive_13g_exit',
        'large_holder_amendment',
        'large_holder_ratio_diluted',
    ]);

/** Filing date of a figure `daysAgo` days before the reference day; days ago when the day is unknown. */
function filedOn(daysAgo: number | null, asOfDay: number | null): string {
    if (daysAgo === null) return 'date n/a';
    return asOfDay === null
        ? `${groupDigits(daysAgo)} days before the as-of date`
        : formatDay(asOfDay - daysAgo * MS_PER_DAY);
}

/** One filing's position: `9.1% of shares outstanding (class), 46,227,436 shares`. */
function positionText(
    evidence: InvestorFlowsEvidence,
    percentKey: string,
    sharesKey: string
): string {
    const percent = evidence[percentKey] ?? null;
    const shares = evidence[sharesKey] ?? null;
    const percentText =
        percent === null
            ? 'percent n/a'
            : `${groupDigits(percent)}${unitOfFigure(percentKey)}`;
    const sharesText =
        shares === null ? 'shares n/a' : `${groupDigits(shares)} shares`;
    return `${percentText}, ${sharesText}`;
}

/**
 * A 13D/13G event as dated positions. The A/B rendered the pre-window
 * baseline as `prevPercentOfClass=9.3%` beside an increase, and the model
 * read it as the filing just before the latest ("직전 신고 대비 9.3%에서
 * 9.1%로 낮아진") — the filing listed just before the latest was 8.9%. Each
 * figure now says which filing it is, with that filing's date, and that the
 * direction is measured from the pre-window baseline. The first filing in the
 * window is omitted when it is the latest (one filing in the window).
 */
function formatLargeHolderEvidence(
    evidence: InvestorFlowsEvidence,
    asOfDay: number | null
): string {
    const filings = evidence.filings ?? null;
    const latest = `latest filing ${filedOn(evidence.daysAgo ?? null, asOfDay)}: ${positionText(evidence, 'percentOfClass', 'shares')}`;
    const windowStart =
        filings === 1
            ? []
            : [
                  `first filing in the window ${filedOn(evidence.windowStartDaysAgo ?? null, asOfDay)}: ${positionText(evidence, 'windowStartPercentOfClass', 'windowStartShares')}`,
              ];
    const preWindowDaysAgo = evidence.preWindowDaysAgo ?? null;
    const baseline =
        preWindowDaysAgo === null
            ? 'last filing before the window: none'
            : `last filing before the window ${filedOn(preWindowDaysAgo, asOfDay)}: ${positionText(evidence, 'preWindowPercentOfClass', 'preWindowShares')} — the direction compares the latest filing with this one, not with the filing just before the latest`;
    const count =
        filings === null
            ? []
            : [
                  `${groupDigits(filings)} ${filings === 1 ? 'filing' : 'filings'} in the window`,
              ];
    return [latest, ...windowStart, baseline, ...count].join('; ');
}

function formatSignal(
    signal: InvestorFlowsSignal,
    words: ScorecardWords,
    asOfDay: number | null
): string {
    const evidence = LARGE_HOLDER_POSITION_SIGNALS.has(signal.id)
        ? formatLargeHolderEvidence(signal.evidence, asOfDay)
        : formatEvidence(signal.evidence);
    const subject =
        signal.subject === undefined
            ? ''
            : ` [${SUBJECT_LABELS[signal.id] ?? ''}${sanitizePromptText(signal.subject, PROMPT_MAX_NAME_CHARS)}${SUBJECT_SUFFIXES[signal.id] ?? ''}]`;
    return `  - ${signal.id}${subject}: ${words.direction[signal.direction]}, ${words.strength[signal.strength]} (${evidence})${SIGNAL_NOTES[signal.id] ?? ''}`;
}

/**
 * Notes after specific metric values whose bare reading misleads: a `0` FTD peak
 * is "no fails reported", not a measured peak, and a `mixed` trend is not a
 * trend at all.
 */
const VALUE_NOTES: Readonly<Record<string, string>> = {
    'failsToDeliverPeakQty=0': ' (no fails reported in the recent window)',
    'shortInterestTrend=mixed':
        ' (the settlements reversed direction; not a trend)',
};

function formatMetrics(metrics: object | null): string {
    if (metrics === null) return '';
    const record: MetricRecord = { ...metrics };
    const parts = Object.entries(record).flatMap(([key, value]) => {
        if (ENDPOINT_ONLY_KEYS.has(key)) return [];
        if (value === null) return [`${key}=n/a`];
        if (typeof value === 'object') return [];
        if (typeof value !== 'number') {
            return [
                `${key}=${String(value)}${VALUE_NOTES[`${key}=${String(value)}`] ?? ''}`,
            ];
        }
        const endpoints = CHANGE_ENDPOINTS[key]?.(record) ?? null;
        return [
            `${formatFigure(key, value)}${endpoints === null ? '' : ` (${endpoints})`}${VALUE_NOTES[`${key}=${value}`] ?? ''}`,
        ];
    });
    return parts.length === 0 ? '' : `\n  metrics: ${parts.join(', ')}`;
}

/**
 * Every marker an axis heading line uses to say the axis is not scored. The
 * rules reference this list ({@link notScoredAxisPhrase}) so a new marker
 * cannot drift out of them.
 */
export const NOT_SCORED_MARKERS = {
    noData: 'NO DATA',
    finraUnavailable: 'FINRA DATA UNAVAILABLE',
    finraTooThin: 'FINRA SHORT DATA TOO THIN TO SCORE',
    finraStale: 'FINRA SHORT DATA STALE',
    finraMissingOrThin: 'FINRA SHORT DATA MISSING OR TOO THIN TO SCORE',
    noReportsInWindow: 'NO REPORTS IN WINDOW',
} as const;

/** Markers a US scorecard can render: every marker except the DART-only one. */
const US_NOT_SCORED_MARKERS: readonly string[] = [
    NOT_SCORED_MARKERS.noData,
    NOT_SCORED_MARKERS.finraUnavailable,
    NOT_SCORED_MARKERS.finraTooThin,
    NOT_SCORED_MARKERS.finraStale,
    NOT_SCORED_MARKERS.finraMissingOrThin,
];

/** Markers a Korean scorecard can render: its axes are DART-only, so no FINRA or filing marker. */
const KR_NOT_SCORED_MARKERS: readonly string[] = [
    NOT_SCORED_MARKERS.noData,
    NOT_SCORED_MARKERS.noReportsInWindow,
];

/**
 * Rule wording for an axis whose heading carries one of the markers the
 * market's scorecard can render. Prompt wording.
 */
export function notScoredAxisPhrase(
    market: InvestorFlowsMarket = 'us'
): string {
    const markers =
        market === 'kr' ? KR_NOT_SCORED_MARKERS : US_NOT_SCORED_MARKERS;
    return `an axis whose heading line says it is not scored (${markers.join(', ')})`;
}

/** {@link notScoredAxisPhrase} for US listings. */
export const NOT_SCORED_AXIS_PHRASE = notScoredAxisPhrase('us');

const NO_DATA_TEXT = `${NOT_SCORED_MARKERS.noData} — the inputs for this axis are missing or too thin to score. This is not a neutral reading.`;

/** Short axis without FINRA but with SEC / exchange context: not "no data". */
const FINRA_UNAVAILABLE_TEXT = `${NOT_SCORED_MARKERS.finraUnavailable} — FINRA short interest and short volume are not included, so this axis is not scored and has no direction. The fails-to-deliver and Reg SHO facts are still valid context; do not report them as missing.`;

/** Short axis whose FINRA rows exist but cannot be scored (e.g. one settlement, no float, no volume baseline). */
const FINRA_TOO_THIN_TEXT = `${NOT_SCORED_MARKERS.finraTooThin} — FINRA short-interest or short-volume rows exist but are too few to compute a level, trend or baseline, so this axis is not scored and has no direction. Quote the listed rows with their dates; do not call them missing.`;

/** Short axis whose FINRA rows exist but are all older than the freshness gate. */
const FINRA_STALE_TEXT = `${NOT_SCORED_MARKERS.finraStale} — the FINRA rows are older than the freshness limit, so this axis is not scored; the stale signal below carries their date.`;

/** {@link FINRA_UNAVAILABLE_TEXT} when the caller cannot tell excluded from thin (no snapshot). */
const FINRA_MISSING_OR_THIN_TEXT = `${NOT_SCORED_MARKERS.finraMissingOrThin} — this axis is not scored and has no direction. The fails-to-deliver and Reg SHO facts are still valid context; do not report them as missing.`;

/**
 * Note on a dilution axis scored neutral because its provided filing list was
 * empty: a measured "nothing filed", not missing data.
 */
const NO_FILINGS_ON_RECORD_NOTE =
    ' (no offering or registration filings on record over the whole lookback: a measured neutral reading, not missing data — say no filings were found)';

/**
 * A Korean axis whose usable reports all fall outside the window. Distinct from
 * NO DATA: the reports exist, there were just none recently.
 */
function noReportsInWindowText(latestReceiptDate: string): string {
    return `${NOT_SCORED_MARKERS.noReportsInWindow} — no usable report from this source was filed in the last ${KR_WINDOW_DAYS} days (latest receipt date: ${latestReceiptDate}), so the axis is not scored. Say there were no reports in the last ${KR_WINDOW_DAYS} days with that date; do not call the data missing, and never call the axis neutral or quiet.`;
}

/**
 * Rule for a Korean axis scored neutral from real reports (see
 * {@link SIGNAL_NOTES}), shared by the investor-flows prompt and the overall
 * prompt's Korean guidance. Prompt wording; no leading bullet.
 */
export const KR_NO_MATERIAL_CHANGE_RULE =
    'An axis scored neutral (score 0) with a no-material-change note is a measured reading: reports were filed in the window and their figures are known, but nothing moved enough to count. It is not missing data and not an unscored axis.';

/** Text of an insufficient Korean axis: NO REPORTS IN WINDOW when older usable reports exist, else NO DATA. */
function krInsufficientTextOf(
    scorecard: InvestorFlowsScorecard,
    id: KrScoredAxisId
): string {
    const latest = scorecard[id].krMetrics?.latestReceiptDate ?? null;
    const inWindow = scorecard[id].krMetrics?.reports ?? 0;
    return latest !== null && inWindow === 0
        ? noReportsInWindowText(latest)
        : NO_DATA_TEXT;
}

type FormattableAxis = InvestorFlowsAxisBase & {
    metrics: object | null;
    krMetrics?: object;
    noFilingsOnRecord?: boolean;
};

/** Options of {@link formatInvestorFlowsScorecard}. */
export interface FormatInvestorFlowsScorecardOptions {
    /**
     * Name each axis heading's id (`(axis "institutional")`). Default `true`:
     * the investor-flows response keys interpretations by it. A prompt whose
     * schema has no `axis` field passes `false`, so no id appears to be copied.
     */
    readonly axisIds?: boolean;
    /**
     * Whether the FINRA feeds are absent (excluded via `includeFinraData: false`
     * or null / empty in the snapshot). `true` → an insufficient short axis
     * says "FINRA data unavailable" (when SEC context exists); `false` → rows
     * exist, so it says "too thin to score". Omitted (no snapshot at hand): a
     * wording that claims neither. Only the caller holding the snapshot knows —
     * null metrics cannot tell an excluded feed from a thin one.
     */
    readonly finraUnavailable?: boolean;
}

/** Text of an insufficient axis: NO DATA, unless the scorecard shows why it is something narrower. */
function insufficientTextOf(
    scorecard: InvestorFlowsScorecard,
    id: InvestorFlowsAxisId,
    options: FormatInvestorFlowsScorecardOptions
): string {
    if (id === 'short') {
        const { metrics } = scorecard.short;
        const secContext =
            metrics.failsToDeliverPeakQty !== null ||
            metrics.thresholdListed !== null;
        if (options.finraUnavailable === false) {
            // Present rows dropped as stale carry their own `data_stale` signal.
            return scorecard.short.signals.some(s => s.id === 'data_stale')
                ? FINRA_STALE_TEXT
                : FINRA_TOO_THIN_TEXT;
        }
        if (secContext) {
            return options.finraUnavailable === true
                ? FINRA_UNAVAILABLE_TEXT
                : FINRA_MISSING_OR_THIN_TEXT;
        }
    }
    return NO_DATA_TEXT;
}

/**
 * Positions next to filings for the 13D/13G axis. The answer quoted seven
 * filings as if they were seven holders; one holder's seven amendments are
 * one position, so both counts are rendered in the words to copy.
 */
function positionsLine(
    metrics: LargeHolderMetrics | null,
    words: ScorecardWords
): string {
    if (metrics === null) return '';
    return `\n  positions vs filings: ${words.positionsAndFilings('13D', metrics.events13d, metrics.filings13d)}; ${words.positionsAndFilings('13G', metrics.events13g, metrics.filings13g)}`;
}

/** Why a sufficient axis has no signals, when "none" alone would mislead. */
function emptySignalsNote(axis: FormattableAxis): string {
    if (axis.noFilingsOnRecord === true) return NO_FILINGS_ON_RECORD_NOTE;
    const quietDilution =
        axis.id === 'dilution' &&
        axis.metrics !== null &&
        'filingsInWindow' in axis.metrics &&
        axis.metrics.filingsInWindow === 0;
    return quietDilution
        ? ' (no filings in the window; older filings exist)'
        : '';
}

function formatAxis(
    axis: FormattableAxis,
    source: string,
    words: ScorecardWords,
    axisIds: boolean,
    insufficientText: string = NO_DATA_TEXT,
    extraLine = '',
    asOfDay: number | null = null
): string {
    const id = axisIds ? ` (axis "${axis.id}")` : '';
    const heading = `- ${words.axis[axis.id]}${id} — ${source}`;
    const signalLine = (signal: InvestorFlowsSignal): string =>
        formatSignal(signal, words, asOfDay);
    if (axis.sufficiency === 'insufficient') {
        const signals = axis.signals.map(signalLine).join('\n');
        return `${heading}\n  ${insufficientText}${signals === '' ? '' : `\n${signals}`}`;
    }
    const signals =
        axis.signals.length === 0
            ? `\n  signals: none${emptySignalsNote(axis)}`
            : `\n  signals:\n${axis.signals.map(signalLine).join('\n')}`;
    return `${heading}\n  label: ${words.label[axis.label]}, score: ${axis.score}${formatMetrics(axis.krMetrics ?? axis.metrics)}${extraLine}${signals}`;
}

/** The computed squeeze score: level, coverage and its largest inputs. */
export function formatSqueezeRisk(
    squeeze: SqueezeRiskScore,
    locale: AnalysisLocale = DEFAULT_ANALYSIS_LOCALE
): string {
    const { squeezeLevel } = scorecardWords(locale);
    if (squeeze.score === null) {
        return 'Short squeeze risk (computed): NO DATA — no short-side input (FINRA, fails to deliver, threshold list) was available. This is not a low reading.';
    }
    const coverage =
        squeeze.sufficiency === 'full'
            ? 'all inputs present'
            : `partial — missing: ${squeeze.missing.join(', ')}`;
    const cap = squeeze.levelCapped
        ? `; level held at ${squeezeLevel.elevated} because no short-positioning input was available`
        : '';
    const top = squeeze.components
        .slice(0, PROMPT_MAX_SQUEEZE_COMPONENTS)
        .map(
            c =>
                `${formatFigure(c.id, c.value)}${c.id === 'fails_to_deliver_pct' && c.value === 0 ? ' (no fails reported)' : ''} (contribution ${c.contribution} points)`
        )
        .join(', ');
    const level = squeeze.level === null ? 'n/a' : squeezeLevel[squeeze.level];
    // Without short interest or short volume the score only reads price and
    // delivery stress; calling it a squeeze-risk level overstates it.
    const heading = squeeze.includesFinra
        ? `Short squeeze risk (computed): score ${squeeze.score}/100, level: ${level}`
        : `Price and delivery-stress score (computed; price, fails-to-deliver and threshold-list inputs only — no short-positioning input, so this is NOT a short-squeeze risk reading): score ${squeeze.score}/100, ${squeeze.levelCapped ? 'capped level' : 'level'}: ${level}`;
    return `${heading} (${coverage}${cap})\n  top inputs: ${top}\n  last completed daily bar used: ${squeeze.lastBarDate ?? 'none'}`;
}

/**
 * A scoring window as an inclusive start date: "receipts on or after
 * 2026-07-19 (90 days to 2026-10-17)". A bare `from to to` range was turned
 * into a wrong boundary ("2026-07-10 이전 접수분은 채점 창 밖" for a window
 * that also excluded 07-10), so the start is stated as the first included day
 * and the model quotes it (see {@link INVESTOR_FLOWS_WINDOW_RULE}).
 */
function windowRange(window: InvestorFlowsWindow, rows: string): string {
    return window.from === null || window.to === null
        ? 'n/a'
        : `${rows} on or after ${window.from} (${window.days} days to ${window.to})`;
}

/** Dates of every underlying source, so an answer can say how old each number is. */
export function formatInvestorFlowsFreshness(
    freshness: InvestorFlowsFreshness,
    ftdPeakQty: number | null = null
): string {
    // A present feed with no fail day reads as "no fails reported", not n/a.
    const ftdLatest =
        freshness.failsToDeliverLatestDate ??
        (ftdPeakQty === 0 ? 'none (no fails reported)' : 'n/a');
    const thresholdAsOf =
        freshness.thresholdListStale === null
            ? 'n/a (not included)'
            : `${freshness.thresholdListAsOf ?? 'undated (taken as current)'}${freshness.thresholdListStale ? ' (stale, not scored)' : ''}`;
    const quarter =
        freshness.latestInstitutionalPeriod === null
            ? '13F quarters: none'
            : `13F: scored quarter ${freshness.institutionalPeriod ?? 'none (no complete quarter)'}; latest quarter present ${freshness.latestInstitutionalPeriod} is ${freshness.latestInstitutionalPeriodComplete ? 'complete' : 'IN PROGRESS (partial, not scored)'}`;
    return [
        `- Snapshot as-of: ${freshness.asOf ?? 'unknown'}`,
        `- ${quarter}`,
        `- FINRA short interest settlement date: ${freshness.shortInterestSettlementDate ?? 'n/a'}`,
        `- FINRA off-exchange short volume latest trade date: ${freshness.shortVolumeLatestDate ?? 'n/a'}`,
        `- Insider scoring window: ${windowRange(freshness.insiderWindow, 'transactions')} (${groupDigits(freshness.insiderTransactionsInWindow)} Form 4 transactions)`,
        `- 13D/13G scoring window: ${windowRange(freshness.largeHolderWindow, 'filings')}`,
        `- SEC fails-to-deliver latest settlement date: ${ftdLatest}`,
        `- Reg SHO threshold list as-of: ${thresholdAsOf}`,
        `- Offering filings scoring window: ${windowRange(freshness.dilutionWindow, 'filings')}`,
    ].join('\n');
}

/** Dates of the Korean (DART) sources. */
export function formatKrInvestorFlowsFreshness(
    freshness: InvestorFlowsFreshness
): string {
    return [
        `- Snapshot as-of: ${freshness.asOf ?? 'unknown'}`,
        `- Latest DART receipt date: ${freshness.krDisclosureLatestDate ?? 'n/a'}`,
        `- DART scoring window: ${windowRange(freshness.insiderWindow, 'receipts')} (${groupDigits(freshness.insiderTransactionsInWindow)} executive / major-shareholder and trading-plan reports)`,
    ].join('\n');
}

function compositeLineOf(
    scorecard: InvestorFlowsScorecard,
    words: ScorecardWords
): string {
    const { composite } = scorecard;
    const axes = composite.axesUsed.map(id => words.axis[id]).join(', ');
    return composite.score === null
        ? `Composite: NO DATA (fewer than two axes had data; axes with data: ${axes || 'none'})`
        : `Composite: label: ${words.label[composite.label]}, score: ${composite.score} (axes used: ${axes})`;
}

function formatKrScorecard(
    scorecard: InvestorFlowsScorecard,
    locale: AnalysisLocale,
    axisIds: boolean
): string {
    const words = scorecardWords(locale);
    const axes = KR_SCORED_AXES.map(id =>
        formatAxis(
            scorecard[id],
            KR_INVESTOR_FLOWS_AXIS_HEADINGS[id],
            words,
            axisIds,
            krInsufficientTextOf(scorecard, id)
        )
    ).join('\n');
    return `${compositeLineOf(scorecard, words)}\n${axes}\n${krNotProvidedLine(locale)}\n\nData freshness:\n${formatKrInvestorFlowsFreshness(scorecard.freshness)}`;
}

/**
 * Render the computed scorecard as prompt text: composite, the axes in
 * canonical order (an axis without data says so explicitly instead of reading
 * as neutral), the squeeze score when one was computed, then the freshness block.
 *
 * A Korean scorecard renders only the two DART-scored axes with DART headings,
 * one line saying the US-only sources are not provided (no 13F / FINRA / SEC
 * wording), and the DART freshness block.
 *
 * Labels, axes, signal directions/strengths and the squeeze level render as
 * display names for `locale` (see {@link ScorecardWords}); numbers render with
 * thousands commas (see {@link groupDigits}).
 */
export function formatInvestorFlowsScorecard(
    scorecard: InvestorFlowsScorecard,
    locale: AnalysisLocale = DEFAULT_ANALYSIS_LOCALE,
    options: FormatInvestorFlowsScorecardOptions = {}
): string {
    const axisIds = options.axisIds ?? true;
    if (scorecard.market === 'kr') {
        return formatKrScorecard(scorecard, locale, axisIds);
    }
    const words = scorecardWords(locale);
    const { asOf } = scorecard.freshness;
    const asOfDay = asOf === null ? null : parseDay(asOf);
    const axes = INVESTOR_FLOWS_AXES.map(id =>
        formatAxis(
            scorecard[id],
            INVESTOR_FLOWS_AXIS_HEADINGS[id],
            words,
            axisIds,
            insufficientTextOf(scorecard, id, options),
            id === 'largeHolders'
                ? positionsLine(scorecard.largeHolders.metrics, words)
                : '',
            asOfDay
        )
    ).join('\n');
    const squeeze =
        scorecard.squeezeRisk === null
            ? ''
            : `\n${formatSqueezeRisk(scorecard.squeezeRisk, locale)}`;
    return `${compositeLineOf(scorecard, words)}\n${axes}${squeeze}\n\nData freshness:\n${formatInvestorFlowsFreshness(scorecard.freshness, scorecard.short.metrics.failsToDeliverPeakQty)}`;
}
