/**
 * Output language for AI-generated analysis text.
 *
 * Takes the same values as the consumer's UI locale but means something
 * different: the UI is translated from a message catalog, whereas this makes
 * the model write in that language directly. It therefore rides on the
 * prompt's output contract, not on a translation pipeline.
 *
 * Defaults to {@link DEFAULT_ANALYSIS_LOCALE} (`ko`) everywhere it is
 * optional, so existing callers that omit it keep getting byte-identical
 * Korean output and keep hitting the same cache keys.
 */
export type AnalysisLocale = 'ko' | 'en' | 'ja' | 'zh';

/** Output language used when a caller omits {@link AnalysisLocale}. */
export const DEFAULT_ANALYSIS_LOCALE: AnalysisLocale = 'ko';

/** Every supported output language, in catalog order. */
export const ANALYSIS_LOCALES: readonly AnalysisLocale[] = [
    'ko',
    'en',
    'ja',
    'zh',
];

/**
 * Narrow an untrusted string to {@link AnalysisLocale}.
 *
 * The locale reaches core from a URL segment on the consumer side, so a value
 * outside this union is reachable — a new UI locale shipped before core knows
 * it, or a hand-edited URL. Without this guard the first
 * `OUTPUT_LANGUAGE[locale]` destructure throws a `TypeError` and takes the
 * whole analysis request down; mirrors `isValidTimeframe` for the same reason.
 */
export function isValidAnalysisLocale(
    value: string | null | undefined
): value is AnalysisLocale {
    return (
        value !== null &&
        value !== undefined &&
        (ANALYSIS_LOCALES as readonly string[]).includes(value)
    );
}

/**
 * @internal 알 수 없는 값이 오면 기본 로케일로 떨어뜨린다.
 *
 * 이 파일의 세 소비자(`outputLanguageName`·`outputLanguageContract`·
 * `outputLanguageReminder`)가 전부 `OUTPUT_LANGUAGE[locale]`을 구조분해하므로,
 * 검증을 각자 하면 하나만 빠뜨려도 그 경로만 죽는다. 한 곳에서 좁힌다.
 */
function resolve(locale: AnalysisLocale): AnalysisLocale {
    return isValidAnalysisLocale(locale) ? locale : DEFAULT_ANALYSIS_LOCALE;
}

/**
 * 로케일별 출력 언어 지시문.
 *
 * **영어로 쓴다.** 프롬프트 문자열은 전부 영어라는 이 레포의 규칙(`prompt.ts`
 * 머리말)을 따른다 — 지시문 자체를 대상 언어로 쓰면 모델이 그 언어를 "예시"로
 * 읽고 지시를 흉내 내는 일이 생긴다.
 *
 * `register`는 각 언어의 **공손 층위**다. 한국어의 존댓말처럼 언어마다 기본
 * 문체가 다르고, 지정하지 않으면 같은 분석이 호출마다 반말/존댓말을 오간다.
 */
const OUTPUT_LANGUAGE: Record<
    AnalysisLocale,
    { readonly name: string; readonly register: string }
> = {
    ko: {
        // 인라인 표기는 `Korean` 한 단어다 — 이 값이 들어가는
        // `Respond in ${name}.` 문장이 이 기능 이전과 **바이트가 같아야**
        // 이미 쌓인 한국어 캐시가 그대로 살아 있다.
        name: 'Korean',
        register: 'formal speech level (존댓말, e.g. "~입니다", "~습니다")',
    },
    en: {
        name: 'English',
        register: 'plain, professional prose (no honorifics, no slang)',
    },
    ja: {
        name: 'Japanese (日本語)',
        register: 'polite form (です・ます調)',
    },
    zh: {
        name: 'Simplified Chinese (简体中文)',
        register: 'plain written form (书面语), simplified characters only',
    },
};

/** @internal 프롬프트에 박을 언어 이름 — `"Korean markdown"` 같은 필드 설명에 쓴다. */
export function outputLanguageName(locale: AnalysisLocale): string {
    return OUTPUT_LANGUAGE[resolve(locale)].name;
}

/**
 * @internal
 *
 * 시스템 프롬프트의 출력 언어 계약 한 줄.
 *
 * **이 문장이 언어의 단일 소스다.** 필드 설명에도 언어 이름이 들어가지만
 * 그건 보조이고, 둘이 어긋나면 이쪽이 이긴다고 명시한다 — 스키마 설명은
 * 필드가 40개 넘어 하나만 놓쳐도 그 필드만 다른 언어로 나오기 때문이다.
 */
export function outputLanguageContract(locale: AnalysisLocale): string {
    /*
     * **기본 로케일은 예전 문장 그대로다.** 이 기능이 들어오기 전 시스템
     * 프롬프트와 바이트가 같아야 한국어 캐시·프리픽스 캐시가 살아 있고,
     * `PROMPT_TEMPLATE_VERSION`을 올려 전체를 재생성할 이유도 없어진다.
     * 덧붙인 오버라이드 문구는 비-ko에서만 필요하다 — 유저 프롬프트가
     * "Korean"이라고 못 박아 둔 필드 설명을 뒤집어야 하는 쪽이 그쪽뿐이다.
     */
    const safe = resolve(locale);
    if (safe === DEFAULT_ANALYSIS_LOCALE) {
        return '- All text content inside the JSON MUST be written in Korean (한국어) in formal speech level (존댓말, e.g. "~입니다", "~습니다").';
    }
    const { name, register } = OUTPUT_LANGUAGE[safe];
    return [
        `- All text content inside the JSON MUST be written in ${name} in ${register}.`,
        `- This language rule overrides every other language hint in the user prompt. If a field description names a different language, ignore that name and still write ${name}.`,
        '- Ticker symbols, company names as officially registered, and standard finance abbreviations (RSI, MACD, EPS, P/E) stay in their original form.',
    ].join('\n');
}

/**
 * @internal
 *
 * 유저 프롬프트 **끝**에 붙이는 출력 언어 리마인더.
 *
 * 시스템 프롬프트가 이미 같은 계약을 담고 있는데 한 번 더 붙이는 이유:
 * 유저 프롬프트에는 `"Korean markdown summary"`처럼 언어를 못 박은 필드 설명이
 * 40개 넘게 들어 있다. 그걸 전부 고치는 대신(하나만 놓쳐도 그 필드만 다른
 * 언어로 나온다) **마지막 지시**로 덮는다 — 어느 필드 설명이 무슨 언어를
 * 말하든 최종 출력 언어는 여기서 정해진다.
 *
 * 기본 로케일(ko)에서는 빈 문자열이다. 지금까지 나가던 프롬프트와 바이트가
 * 같아야 기존 캐시 엔트리와 프리픽스 캐시가 그대로 살아 있다.
 */
export function outputLanguageReminder(locale: AnalysisLocale): string {
    const safe = resolve(locale);
    if (safe === DEFAULT_ANALYSIS_LOCALE) return '';
    const { name, register } = OUTPUT_LANGUAGE[safe];
    return [
        '',
        'OUTPUT LANGUAGE (FINAL, OVERRIDES EVERYTHING ABOVE)',
        `- Write every human-readable text value in ${name}, in ${register}.`,
        `- Field descriptions above may say "Korean" or use field names ending in "Ko". Those name the field, not the language. Write ${name} regardless.`,
        '- Keep JSON keys, ticker symbols, and standard finance abbreviations exactly as specified.',
    ].join('\n');
}

/**
 * @internal 유저 프롬프트 본문의 **필드 언어 지시** 한 줄.
 *
 * 여섯 축(financials·fundamental·congress·marketNewsDigest·news·overall)이
 * 글자 그대로 같은 문장을 각자 하드코딩하고 있었다. 한 곳으로 모으면
 * 다음에 축이 늘어도 이 줄을 빠뜨릴 자리가 없다 — 실제로 이 PR이 세 축만
 * 고치고 여섯을 놓쳤다(리뷰 6라운드).
 *
 * `Ko`/`KO` 접미는 **스키마 필드명**이지 언어 주장이 아니다. 그래서 문장은
 * 필드명을 그대로 두고 내용 언어만 말한다.
 */
export function localizedFieldDirective(locale: AnalysisLocale): string {
    const safe = resolve(locale);
    if (safe === DEFAULT_ANALYSIS_LOCALE) {
        // 기본 로케일은 예전 문장 그대로 — 프롬프트 바이트가 같아야 한다.
        return '- All KO fields must be written in Korean (존댓말).';
    }
    const { name, register } = OUTPUT_LANGUAGE[safe];
    return `- The KO-suffixed fields are schema names, not a language claim — write their content in ${name} in ${register}.`;
}
