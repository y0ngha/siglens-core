import {
    FTD_SPIKE_MIN_MULTIPLE,
    INVESTOR_FLOWS_AXES,
    PROMPT_MAX_NAME_CHARS,
    PROMPT_MAX_SQUEEZE_COMPONENTS,
    SHORT_INTEREST_TREND_POINTS,
} from '@/domain/investorFlows/constants';
import {
    DEFAULT_ANALYSIS_LOCALE,
    type AnalysisLocale,
} from '@/domain/analysis/outputLocale';
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
        '- Quote counts and totals (notices, filers, transactions, values, shares) from the scorecard metrics and evidence; never count the listed source rows yourself — the lists are capped and can include rows outside the scoring window.',
    ].join('\n');
}

/**
 * Output rules shared by the investor-flows prompt and the overall prompt's
 * investor-flows section, written from real-LLM A/B failures: an FTD peak
 * quoted with the latest file date, FTDs mentioned without the naked-shorting
 * caveat, scorecard identifiers (`shortInterestTrend=falling`,
 * `strong_bullish`) copied into prose, a 20-day price change quoted without
 * its percent sign, and an active ATM described like a shelf. Prompt wording.
 *
 * @param caveatTarget - Where the FTD caveat must appear (the output fields of
 * the prompt using the rules).
 */
export function investorFlowsOutputRules(caveatTarget: string): string {
    return [
        '- Fails to deliver: quote an FTD quantity only with its own settlement date — the peak with the peak settlement date shown next to it, never with the latest fails-to-deliver file date.',
        `- Whenever the output mentions fails to deliver at all, ${caveatTarget} must also say that fails have many operational causes (settlement timing, clearing and operational delays) and are not evidence of naked (illegal) short selling — say it in those words; "interpret separately from short interest" does not replace it. In Korean output include the sentence "결제불이행은 무차입(불법) 공매도의 증거가 아닙니다". State this caveat at most once per output field; never repeat the same sentence.`,
        `- Never call fails to deliver routine, normal or usual (일상적) when the baseline multiple (failsToDeliverMultiple) is ${FTD_SPIKE_MIN_MULTIPLE} or more, even when the peak is too small to raise a signal; say the peak is elevated against its usual (baseline) level but small relative to shares outstanding. When the multiple is n/a the baseline was too thin to compare against; make no baseline comparison and use no spike or surge wording (spike, surge, 급증, 급등) — describe only the level against shares outstanding.`,
        '- An active at-the-market (ATM) program means the company may be selling new shares into the market right now, at market prices — say so. Do not describe the size or pace of ATM sales; the filings do not show it. A shelf or a full registration only creates the capacity to sell later and does not mean shares are being sold.',
        INVESTOR_FLOWS_PLAIN_TEXT_RULE,
    ].join('\n');
}

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
    '- Korean numbers: copy numbers digit-for-digit exactly as they appear in the data, with standard 3-digit comma grouping; do not convert share counts or dollar amounts into 만/억 forms and do not regroup digits. Never add an approximate restatement next to an exact figure, and keep share counts and dollar amounts in separate phrases (never "N달러 상당 M주").',
].join('\n');

/** Strip line breaks and clip a filing-supplied name so it cannot inject prompt structure. */
export function sanitizePromptText(text: string, maxChars: number): string {
    const flat = text.replace(/\s+/g, ' ').trim();
    return flat.length > maxChars ? `${flat.slice(0, maxChars)}…` : flat;
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
    if (/percentOfClass$/i.test(key)) return '% of class';
    if (/pct/i.test(key)) return '%';
    return '';
}

/** Keys renamed for the prompt, where the bare key is a form the model copies (`z=1.26`). */
const PROMPT_KEY_NAMES: Readonly<Record<string, string>> = {
    z: 'shortVolumeRatioDeviation',
    shortVolumeRatioZ: 'shortVolumeRatioDeviation',
};

/** `key=value` with the value's unit; `n/a` for a missing figure. */
function formatFigure(key: string, value: number | null): string {
    const name = PROMPT_KEY_NAMES[key] ?? key;
    return `${name}=${value === null ? 'n/a' : `${groupDigits(value)}${unitOfFigure(key)}`}`;
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
    short_interest_trend: 'settlements ',
    institutional_holder_count_change: 'quarter ending ',
    institutional_net_share_change: 'quarter ending ',
};

/** Text after a subject, when the subject alone does not name both endpoints. */
const SUBJECT_SUFFIXES: Partial<Record<InvestorFlowsSignalId, string>> = {
    institutional_holder_count_change: ' vs the quarter before',
    institutional_net_share_change: ' vs the quarter before',
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

function formatSignal(
    signal: InvestorFlowsSignal,
    words: ScorecardWords
): string {
    const subject =
        signal.subject === undefined
            ? ''
            : ` [${SUBJECT_LABELS[signal.id] ?? ''}${sanitizePromptText(signal.subject, PROMPT_MAX_NAME_CHARS)}${SUBJECT_SUFFIXES[signal.id] ?? ''}]`;
    return `  - ${signal.id}${subject}: ${words.direction[signal.direction]}, ${words.strength[signal.strength]} (${formatEvidence(signal.evidence)})`;
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
    noFilings: 'NO FILINGS',
} as const;

/** Markers a Korean scorecard can render: its axes are DART-only, so no FINRA or filing marker. */
const KR_NOT_SCORED_MARKERS: readonly string[] = [NOT_SCORED_MARKERS.noData];

/**
 * Rule wording for an axis whose heading carries one of the markers the
 * market's scorecard can render. Prompt wording.
 */
export function notScoredAxisPhrase(
    market: InvestorFlowsMarket = 'us'
): string {
    const markers =
        market === 'kr'
            ? KR_NOT_SCORED_MARKERS
            : Object.values(NOT_SCORED_MARKERS);
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

/** Dilution axis whose filing list was provided but empty. */
const NO_FILINGS_TEXT = `${NOT_SCORED_MARKERS.noFilings} (no offering or registration filings on record) — the axis is not scored. Say no filings were found; do not call dilution neutral or quiet.`;

type FormattableAxis = InvestorFlowsAxisBase & {
    metrics: object | null;
    krMetrics?: object;
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
    if (id === 'dilution' && scorecard.dilution.noFilingsOnRecord) {
        return NO_FILINGS_TEXT;
    }
    return NO_DATA_TEXT;
}

function formatAxis(
    axis: FormattableAxis,
    source: string,
    words: ScorecardWords,
    axisIds: boolean,
    insufficientText: string = NO_DATA_TEXT
): string {
    const id = axisIds ? ` (axis "${axis.id}")` : '';
    const heading = `- ${words.axis[axis.id]}${id} — ${source}`;
    const signalLine = (signal: InvestorFlowsSignal): string =>
        formatSignal(signal, words);
    if (axis.sufficiency === 'insufficient') {
        const signals = axis.signals.map(signalLine).join('\n');
        return `${heading}\n  ${insufficientText}${signals === '' ? '' : `\n${signals}`}`;
    }
    const quietDilution =
        axis.id === 'dilution' &&
        axis.metrics !== null &&
        'filingsInWindow' in axis.metrics &&
        axis.metrics.filingsInWindow === 0;
    const signals =
        axis.signals.length === 0
            ? `\n  signals: none${quietDilution ? ' (no filings in the window; older filings exist)' : ''}`
            : `\n  signals:\n${axis.signals.map(signalLine).join('\n')}`;
    return `${heading}\n  label: ${words.label[axis.label]}, score: ${axis.score}${formatMetrics(axis.krMetrics ?? axis.metrics)}${signals}`;
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
        `- Insider window: ${freshness.insiderWindow.from ?? 'n/a'} to ${freshness.insiderWindow.to ?? 'n/a'} (${groupDigits(freshness.insiderTransactionsInWindow)} Form 4 transactions)`,
        `- 13D/13G window: ${freshness.largeHolderWindow.from ?? 'n/a'} to ${freshness.largeHolderWindow.to ?? 'n/a'}`,
        `- SEC fails-to-deliver latest settlement date: ${ftdLatest}`,
        `- Reg SHO threshold list as-of: ${thresholdAsOf}`,
        `- Offering filings window: ${freshness.dilutionWindow.from ?? 'n/a'} to ${freshness.dilutionWindow.to ?? 'n/a'}`,
    ].join('\n');
}

/** Dates of the Korean (DART) sources. */
export function formatKrInvestorFlowsFreshness(
    freshness: InvestorFlowsFreshness
): string {
    return [
        `- Snapshot as-of: ${freshness.asOf ?? 'unknown'}`,
        `- Latest DART receipt date: ${freshness.krDisclosureLatestDate ?? 'n/a'}`,
        `- DART window: ${freshness.insiderWindow.from ?? 'n/a'} to ${freshness.insiderWindow.to ?? 'n/a'} (${groupDigits(freshness.insiderTransactionsInWindow)} executive / major-shareholder and trading-plan reports)`,
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
            axisIds
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
    const axes = INVESTOR_FLOWS_AXES.map(id =>
        formatAxis(
            scorecard[id],
            INVESTOR_FLOWS_AXIS_HEADINGS[id],
            words,
            axisIds,
            insufficientTextOf(scorecard, id, options)
        )
    ).join('\n');
    const squeeze =
        scorecard.squeezeRisk === null
            ? ''
            : `\n${formatSqueezeRisk(scorecard.squeezeRisk, locale)}`;
    return `${compositeLineOf(scorecard, words)}\n${axes}${squeeze}\n\nData freshness:\n${formatInvestorFlowsFreshness(scorecard.freshness, scorecard.short.metrics.failsToDeliverPeakQty)}`;
}
