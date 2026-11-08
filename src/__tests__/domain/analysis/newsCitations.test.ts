import { describe, expect, it } from 'vitest';
import {
    applyNewsCitations,
    citationMarker,
    resolveCitationMarkers,
    stripCitationMarkers,
    type CitationContext,
} from '@/domain/analysis/newsCitations';

// 20:30 UTC: 뉴욕은 같은 날(16:30 EDT), 서울은 다음 날 05:30 — 시장 달력 선택을 가른다.
const ARTICLES = [
    { source: 'Reuters', publishedAt: '2026-10-15T20:30:00Z' },
    { source: 'GlobeNewswire', publishedAt: '2026-10-20T13:00:00Z' },
    { source: '', publishedAt: '2026-10-21T13:00:00Z' },
    { source: 'CNBC', publishedAt: 'not a date' },
];

const ctx = (over: Partial<CitationContext> = {}): CitationContext => ({
    articles: ARTICLES,
    locale: 'ko',
    currency: 'USD',
    ...over,
});

describe('resolveCitationMarkers', () => {
    it('표식을 기사 게시일·출처로 바꾸고 마침표 앞에 둔다', () => {
        expect(
            resolveCitationMarkers(
                '9개월 매출이 65% 늘었다 [#1].',
                'event',
                ctx()
            )
        ).toBe('9개월 매출이 65% 늘었다 (10월 15일 · Reuters).');
    });

    it('게시일은 시장 달력으로 읽는다: KRW 종목은 서울 날짜', () => {
        expect(
            resolveCitationMarkers(
                '실적 발표 [#1]',
                'event',
                ctx({ currency: 'KRW' })
            )
        ).toBe('실적 발표 (10월 16일 · Reuters)');
    });

    it.each([
        ['en', 'Revenue rose (Oct 15 · Reuters).'],
        ['ja', '売上が増えた（10月15日・Reuters）。'],
        ['zh', '营收增长（10月15日，Reuters）。'],
    ] as const)('%s 로케일 표기', (locale, expected) => {
        const text =
            locale === 'en'
                ? 'Revenue rose [#1].'
                : locale === 'ja'
                  ? '売上が増えた[#1]。'
                  : '营收增长[#1]。';
        expect(resolveCitationMarkers(text, 'event', ctx({ locale }))).toBe(
            expected
        );
    });

    it('예정 이벤트는 보도 형식으로 적어 이벤트 날짜로 읽히지 않게 한다', () => {
        expect(
            resolveCitationMarkers(
                '인수 본계약 전환, 날짜 미정 [#2]',
                'upcoming',
                ctx()
            )
        ).toBe('인수 본계약 전환, 날짜 미정 (GlobeNewswire 10월 20일 보도)');
        expect(
            resolveCitationMarkers(
                'Deal closing [#2]',
                'upcoming',
                ctx({ locale: 'en' })
            )
        ).toBe('Deal closing (reported by GlobeNewswire, Oct 20)');
    });

    it('표식이 여럿이면 첫 유효 기사 하나만 인용하고 나머지는 지운다', () => {
        expect(
            resolveCitationMarkers('A [#9] 그리고 B [#2, #1].', 'event', ctx())
        ).toBe('A 그리고 B (10월 20일 · GlobeNewswire).');
    });

    it('범위 밖·출처 없는 기사 번호는 인용 없이 지운다', () => {
        expect(resolveCitationMarkers('A [#9]', 'event', ctx())).toBe('A');
        expect(resolveCitationMarkers('A [#3]', 'event', ctx())).toBe('A');
    });

    it('게시일을 읽을 수 없으면 출처만 붙인다', () => {
        expect(resolveCitationMarkers('A [#4]', 'event', ctx())).toBe(
            'A (CNBC)'
        );
    });

    it('표식이 없으면 그대로 돌려준다(캐시된 결과에 다시 적용해도 무변화)', () => {
        const once = resolveCitationMarkers('A [#1].', 'event', ctx());
        expect(resolveCitationMarkers(once, 'event', ctx())).toBe(once);
        expect(resolveCitationMarkers('[1] 같은 대괄호', 'event', ctx())).toBe(
            '[1] 같은 대괄호'
        );
    });
});

describe('resolveCitationMarkers — 모델이 실제로 쓰는 변형', () => {
    it('문장 끝 표식(마지막 그룹)을 인용한다. 앞쪽 곁가지 표식은 지운다', () => {
        expect(
            resolveCitationMarkers(
                '앞선 보도 [#2]와 달리 가이던스를 올렸다 [#1].',
                'event',
                ctx()
            )
        ).toBe('앞선 보도와 달리 가이던스를 올렸다 (10월 15일 · Reuters).');
    });

    it.each([
        ['전각 대괄호', '売上が増えた［#1］。'],
        ['겹낫표 괄호', '売上が増えた【#1】。'],
        ['범위', '売上が増えた[#1-2]。'],
        ['물결 범위', '売上が増えた[#1–#2]。'],
    ])('%s', (_label, text) => {
        expect(
            resolveCitationMarkers(text, 'event', ctx({ locale: 'ja' }))
        ).toBe('売上が増えた（10月15日・Reuters）。');
    });

    // 2026-11-08 운영 PEPEUSD 스냅샷: 모델이 `#` 앞에 단어를 붙여 표식이 화면에 그대로 남았다.
    it.each([
        ['단어 + 공백', '매수세가 유입됐다 [페이퍼 #1].'],
        ['단어 붙여쓰기', '매수세가 유입됐다 [기사#1].'],
        [
            '영문 여러 단어(20자 이내)',
            '매수세가 유입됐다 [Reuters article #1].',
        ],
        ['번호마다 단어', '매수세가 유입됐다 [기사 #1, 기사 #2].'],
        ['글자+#번호 대괄호는 의도적으로 표식', '매수세가 유입됐다 [Top #1].'],
    ])('#앞에 단어가 붙은 표식(%s)도 인용한다', (_label, text) => {
        expect(resolveCitationMarkers(text, 'event', ctx())).toBe(
            '매수세가 유입됐다 (10월 15일 · Reuters).'
        );
    });

    it.each([
        ['전각 대괄호', '売上が増えた［記事 #1］。'],
        ['겹낫표 괄호', '売上が増えた【報道#1】。'],
    ])('ja: 단어가 붙은 %s 표식', (_label, text) => {
        expect(
            resolveCitationMarkers(text, 'event', ctx({ locale: 'ja' }))
        ).toBe('売上が増えた（10月15日・Reuters）。');
    });

    it('단어가 붙은 표식이 여럿이면 마지막 그룹을 인용한다', () => {
        expect(
            resolveCitationMarkers(
                '앞선 보도 [기사 #1]와 달리 가이던스를 올렸다 [기사 #2].',
                'event',
                ctx()
            )
        ).toBe(
            '앞선 보도와 달리 가이던스를 올렸다 (10월 20일 · GlobeNewswire).'
        );
    });

    it.each([
        ['단어에 숫자(번호 오인 방지)', '실적 [Q3 #1] 발표'],
        ['단어에 구두점', '순위 [No. #1] 유지'],
        ['단어가 20자 초과', '실적 [an unusually long label text #1] 발표'],
    ])('표식으로 보지 않는다: %s', (_label, text) => {
        expect(resolveCitationMarkers(text, 'event', ctx())).toBe(text);
    });

    it('stripCitationMarkers도 단어가 붙은 표식만 지우고 일반 대괄호는 둔다', () => {
        expect(
            stripCitationMarkers(
                '순위 [No. #1] 유지, 수급이 개선됐다 [페이퍼 #23].'
            )
        ).toBe('순위 [No. #1] 유지, 수급이 개선됐다.');
    });

    it('목록 번호를 그대로 베낀 끝자리 [3]도 표식으로 본다(문장 중간 [3]은 본문)', () => {
        expect(resolveCitationMarkers('실적 발표 [2].', 'event', ctx())).toBe(
            '실적 발표 (10월 20일 · GlobeNewswire).'
        );
        expect(resolveCitationMarkers('규정 [2]조 개정', 'event', ctx())).toBe(
            '규정 [2]조 개정'
        );
    });

    it('물음표·닫는 따옴표·약어 마침표 뒤에 붙인다', () => {
        expect(resolveCitationMarkers('반등할까? [#1]', 'event', ctx())).toBe(
            '반등할까? (10월 15일 · Reuters)'
        );
        expect(
            resolveCitationMarkers(
                'Shares of Apple Inc. [#1]',
                'event',
                ctx({ locale: 'en' })
            )
        ).toBe('Shares of Apple Inc. (Oct 15 · Reuters)');
    });

    it('프롬프트가 요구하는 표식 문법(citationMarker)을 그대로 해석한다', () => {
        expect(
            resolveCitationMarkers(`A ${citationMarker(2)}`, 'event', ctx())
        ).toBe('A (10월 20일 · GlobeNewswire)');
    });
});

describe('stripCitationMarkers', () => {
    it('인용 없이 표식만 지운다', () => {
        expect(stripCitationMarkers('흐름을 이끈다 [#1] 계속.')).toBe(
            '흐름을 이끈다 계속.'
        );
        expect(stripCitationMarkers('표식 없음')).toBe('표식 없음');
    });
});

describe('applyNewsCitations', () => {
    it('표식만 남은 불릿은 버리고 나머지 필드는 보존한다', () => {
        expect(
            applyNewsCitations(
                {
                    currentDriverKo: '동인 [#1]',
                    keyEventsKo: ['[#9]', '사건 [#1]'],
                    upcomingEventsKo: ['11월 20일 실적 발표'],
                    overallSentiment: 'neutral',
                },
                ctx()
            )
        ).toEqual({
            currentDriverKo: '동인',
            keyEventsKo: ['사건 (10월 15일 · Reuters)'],
            upcomingEventsKo: ['11월 20일 실적 발표'],
            overallSentiment: 'neutral',
        });
    });
});
