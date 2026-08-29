import { describe, expect, it } from 'vitest';
import {
    ANALYSIS_LOCALES,
    isValidAnalysisLocale,
    localeKeySuffixFor,
    DEFAULT_ANALYSIS_LOCALE,
    outputLanguageContract,
    outputLanguageName,
    outputLanguageReminder,
} from '@/domain/analysis/outputLocale';
import {
    aiSystemPrompt,
    AI_SYSTEM_PROMPT,
} from '@/domain/analysis/systemPrompt';

describe('출력 로케일', () => {
    it('기본값은 ko다 — 호출부가 생략하면 지금까지와 같은 한국어가 나온다', () => {
        expect(DEFAULT_ANALYSIS_LOCALE).toBe('ko');
    });

    /**
     * **이 테스트가 캐시를 지킨다.**
     *
     * 로케일이 붙기 전 시스템 프롬프트와 ko 산출물이 한 글자라도 달라지면,
     * 이미 쌓인 한국어 분석 캐시가 전부 낡은 프롬프트로 만든 것이 되고
     * `PROMPT_TEMPLATE_VERSION`을 올려 재생성해야 한다(비용). 기본 로케일은
     * **바이트가 같아야** 한다.
     */
    it('ko 시스템 프롬프트는 인자 없이 부른 것과 같다', () => {
        expect(aiSystemPrompt('ko')).toBe(aiSystemPrompt());
        expect(aiSystemPrompt('ko')).toBe(AI_SYSTEM_PROMPT);
    });

    it('ko 출력 계약은 존댓말 한 줄 그대로다 — 오버라이드 문구를 덧붙이지 않는다', () => {
        const ko = outputLanguageContract('ko');
        expect(ko.split('\n')).toHaveLength(1);
        expect(ko).toContain('존댓말');
    });

    it('ko 인라인 표기는 `Korean` 한 단어다', () => {
        // `Respond in ${name}.` 문장이 예전과 같아야 한다.
        expect(outputLanguageName('ko')).toBe('Korean');
    });

    it('ko 리마인더는 빈 문자열 — 유저 프롬프트도 바이트가 같다', () => {
        expect(outputLanguageReminder('ko')).toBe('');
    });

    it.each(ANALYSIS_LOCALES.filter(l => l !== 'ko'))(
        '%s: 시스템 계약이 다른 언어 힌트를 덮는다고 명시한다',
        locale => {
            const contract = outputLanguageContract(locale);
            expect(contract).toContain('overrides');
            expect(contract).toContain(outputLanguageName(locale));
        }
    );

    it.each(ANALYSIS_LOCALES.filter(l => l !== 'ko'))(
        '%s: 유저 프롬프트 리마인더가 필드 설명의 "Korean"을 무력화한다',
        locale => {
            const reminder = outputLanguageReminder(locale);
            expect(reminder).toContain('OVERRIDES EVERYTHING ABOVE');
            expect(reminder).toContain(outputLanguageName(locale));
            // 필드 설명이 `Korean`이라고 못 박아 둔 것을 이름으로 집어 무력화한다.
            expect(reminder).toContain('"Korean"');
        }
    );

    /** 언어마다 기본 문체가 달라 지정하지 않으면 호출마다 문체가 흔들린다. */
    it.each(ANALYSIS_LOCALES)('%s: 공손 층위를 지정한다', locale => {
        expect(outputLanguageContract(locale).length).toBeGreaterThan(40);
    });

    /**
     * 로케일은 URL 세그먼트를 타고 들어온다 — 이 유니언 밖의 값이 실제로
     * 도달할 수 있다(core가 아직 모르는 새 UI 로케일, 손으로 고친 주소).
     * 가드가 없으면 `OUTPUT_LANGUAGE[locale]` 구조분해에서 TypeError가 나
     * 분석 요청이 통째로 죽는다.
     */
    describe('isValidAnalysisLocale', () => {
        it.each(ANALYSIS_LOCALES)('%s는 통과한다', locale => {
            expect(isValidAnalysisLocale(locale)).toBe(true);
        });

        it.each(['kr', 'en-US', 'KO', '', 'zh-Hans'])('%j는 막는다', value => {
            expect(isValidAnalysisLocale(value)).toBe(false);
        });

        it('null·undefined도 막는다', () => {
            expect(isValidAnalysisLocale(null)).toBe(false);
            expect(isValidAnalysisLocale(undefined)).toBe(false);
        });

        /** 막기만 하면 안 된다 — 모르는 값이 와도 기본 로케일로 살아나야 한다. */
        it('알 수 없는 값은 기본 로케일로 떨어진다 — 던지지 않는다', () => {
            const bogus = 'kr' as unknown as (typeof ANALYSIS_LOCALES)[number];
            expect(() => outputLanguageName(bogus)).not.toThrow();
            expect(outputLanguageName(bogus)).toBe(outputLanguageName('ko'));
            expect(outputLanguageContract(bogus)).toBe(
                outputLanguageContract('ko')
            );
            expect(outputLanguageReminder(bogus)).toBe('');
            // 키도 같이 떨어져야 한다 — 산출물만 ko로 가고 키가 갈리면
            // 그 요청이 기존 한국어 캐시를 영영 못 맞힌다.
            expect(localeKeySuffixFor(bogus)).toBe('');
        });
    });
});
