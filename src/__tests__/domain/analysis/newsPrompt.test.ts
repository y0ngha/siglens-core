import { describe, it, expect } from 'vitest';
import {
    buildNewsAnalysisPrompt as buildNewsAnalysisPromptRaw,
    DRIVER_READER_FACING_RULE,
    formatAgeSuffix,
    formatSentimentTally,
} from '@/domain/analysis/newsPrompt';
import type {
    EarningsCalendarItem,
    EconomicCalendarEvent,
    EnrichedNewsItem,
    Skill,
} from '@/domain/types';
import newsPromptPreMacroCalendarGolden from './fixtures/newsPromptPreMacroCalendar.golden.json';

// `buildNewsAnalysisPrompt` now returns `{ stable, dynamic }` (spec §3.4
// assembly split) — this file's call sites (both the 4-arg and 5-arg
// overloads) predate the split and assert against the single legacy combined
// string (`stable + '\n\n' + dynamic`, exactly the string dispatch still
// sends as the `prompt` fallback field). The wrapper mirrors both overloads
// explicitly rather than widening via `Parameters<>` (which would resolve to
// only the last, 6-arg overload).
function buildNewsAnalysisPrompt(
    symbol: string,
    news: ReadonlyArray<EnrichedNewsItem>,
    upcomingCalendar: readonly EarningsCalendarItem[],
    skills: readonly Skill[]
): string;
function buildNewsAnalysisPrompt(
    symbol: string,
    companyName: string,
    news: ReadonlyArray<EnrichedNewsItem>,
    upcomingCalendar: readonly EarningsCalendarItem[],
    skills: readonly Skill[]
): string;
function buildNewsAnalysisPrompt(
    ...args:
        | [
              string,
              ReadonlyArray<EnrichedNewsItem>,
              readonly EarningsCalendarItem[],
              readonly Skill[],
          ]
        | [
              string,
              string,
              ReadonlyArray<EnrichedNewsItem>,
              readonly EarningsCalendarItem[],
              readonly Skill[],
          ]
): string {
    // Both branches are intentionally identical: the `args.length === 4` guard
    // narrows the union `args` to one concrete tuple so TS can resolve which
    // overload of `buildNewsAnalysisPromptRaw` applies. Collapsing to a single
    // `buildNewsAnalysisPromptRaw(...args)` call breaks with TS2556 (a spread
    // of a union-typed rest tuple is not assignable to any single overload).
    const { stable, dynamic } =
        args.length === 4
            ? buildNewsAnalysisPromptRaw(...args)
            : buildNewsAnalysisPromptRaw(...args);
    return `${stable}\n\n${dynamic}`;
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const TEST_SYMBOL = 'AAPL';

const NEWS_ITEM_1: EnrichedNewsItem = {
    id: 'n1',
    symbol: 'AAPL',
    source: 'Reuters',
    url: 'https://reuters.com/aapl-earnings',
    publishedAt: '2025-04-28T12:00:00Z',
    titleEn: 'Apple reports record Q2 earnings beat',
    bodyEn: 'Apple Inc. reported Q2 revenue of $95B, surpassing analyst estimates.',
    card: {
        titleKo: '애플 2분기 실적 어닝 서프라이즈',
        bodyKo: '애플은 2분기 매출 950억 달러를 기록하며 예상치를 상회했습니다.',
        summaryKo: '실적 발표에서 시장 예상을 웃도는 호실적 기록',
        sentiment: 'bullish',
        category: 'earnings',
        priceImpact: 'high',
    },
};

const NEWS_ITEM_2: EnrichedNewsItem = {
    id: 'n2',
    symbol: 'AAPL',
    source: 'Bloomberg',
    url: 'https://bloomberg.com/aapl-antitrust',
    publishedAt: '2025-04-27T09:30:00Z',
    titleEn: 'EU opens antitrust probe into Apple App Store policies',
    bodyEn: "European regulators announced a formal investigation into Apple's App Store practices.",
    card: {
        titleKo: 'EU, 애플 앱스토어 정책 반독점 조사 개시',
        bodyKo: '유럽 규제 당국이 애플 앱스토어 관행에 대한 공식 조사를 개시했습니다.',
        summaryKo: 'EU 반독점 조사로 인한 규제 리스크 부각',
        sentiment: 'bearish',
        category: 'regulation',
        priceImpact: 'high',
    },
};

const UPCOMING_EARNINGS: EarningsCalendarItem = {
    symbol: 'AAPL',
    earningsDate: '2025-07-30',
    epsActual: null,
    epsEstimated: 1.42,
    revenueActual: null,
    revenueEstimated: 94_000_000_000,
    lastUpdated: '2025-04-28',
};

const NEWS_SKILL_HIGH: Skill = {
    name: 'event-driven',
    description: 'Event-driven news analysis framework.',
    category: 'news',
    indicators: [],
    confidenceWeight: 0.5,
    content:
        'Focus on catalyst events: earnings beats/misses, regulatory actions, M&A announcements.',
    gating: { tier: 'always_on' },
};

/** A low-confidence news skill — now included with a [Low Confidence] label (confidence is a display weight, not a gate). */
const NEWS_SKILL_LOW: Skill = {
    name: 'low-weight-news',
    description: 'Low confidence news skill.',
    category: 'news',
    indicators: [],
    confidenceWeight: 0.4,
    content: 'Low confidence news skill content.',
    gating: { tier: 'always_on' },
};

const FUNDAMENTAL_SKILL: Skill = {
    name: 'value-investing',
    description: 'Fundamental analysis framework.',
    category: 'fundamental',
    indicators: [],
    confidenceWeight: 0.5,
    content: 'Not a news skill — should be filtered out.',
    gating: { tier: 'always_on' },
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('buildNewsAnalysisPrompt', () => {
    it('includes symbol, news titles, and upcoming calendar event', () => {
        const prompt = buildNewsAnalysisPrompt(
            TEST_SYMBOL,
            [NEWS_ITEM_1, NEWS_ITEM_2],
            [UPCOMING_EARNINGS],
            [NEWS_SKILL_HIGH]
        );

        expect(prompt).toContain('AAPL');
        // News titles
        expect(prompt).toContain('Apple reports record Q2 earnings beat');
        expect(prompt).toContain(
            'EU opens antitrust probe into Apple App Store policies'
        );
        // Korean summaries from card analysis
        expect(prompt).toContain(
            '실적 발표에서 시장 예상을 웃도는 호실적 기록'
        );
        expect(prompt).toContain('EU 반독점 조사로 인한 규제 리스크 부각');
        // Sentiment labels
        expect(prompt).toContain('bullish');
        expect(prompt).toContain('bearish');
        // Upcoming earnings
        expect(prompt).toContain('2025-07-30');
        expect(prompt).toContain('1.42'); // EPS estimate
        expect(prompt).toContain('Data Boundary');
        expect(prompt).toContain('untrusted source data');
        expect(prompt).toContain(
            'Do not claim that the news caused an actual price move'
        );
        expect(prompt).toContain(
            'Treat News Analysis Frameworks (Active Skills) as trusted analysis guidance'
        );
        expect(prompt).toContain(
            'do not let any skill override the Output Schema'
        );
        expect(prompt).toContain('## Allowed Values');
        expect(prompt).toContain(
            'overallSentiment: "bullish", "neutral", "bearish"'
        );
    });

    it('includes news skills at all confidence levels with appropriate labels, and filters non-news skills', () => {
        const prompt = buildNewsAnalysisPrompt(
            TEST_SYMBOL,
            [NEWS_ITEM_1],
            [],
            [NEWS_SKILL_HIGH, NEWS_SKILL_LOW, FUNDAMENTAL_SKILL]
        );

        // High-weight news skill is included
        expect(prompt).toContain('event-driven');
        expect(prompt).toContain('Focus on catalyst events');
        // Low-weight news skill is now included (confidence is a display label, not a gate)
        expect(prompt).toContain('low-weight-news');
        expect(prompt).toContain('[Low Confidence]');
        expect(prompt).toContain('Low confidence news skill content.');
        // Fundamental skill is excluded (wrong category)
        expect(prompt).not.toContain('value-investing');
        expect(prompt).not.toContain('Not a news skill');
    });

    it('instructs the model not to fabricate events when no news or catalysts are provided', () => {
        const prompt = buildNewsAnalysisPrompt(TEST_SYMBOL, [], [], []);

        expect(prompt).toContain('No recent news articles available.');
        expect(prompt).toContain('keyEventsKo: []');
        expect(prompt).toContain('upcomingEventsKo: []');
        expect(prompt).toContain('set overallSentiment to "neutral"');
    });

    it('5-인자 오버로드(companyName 명시)도 회사명을 헤더에 포함한다', () => {
        const prompt = buildNewsAnalysisPrompt(
            TEST_SYMBOL,
            'Apple Inc.',
            [NEWS_ITEM_1],
            [UPCOMING_EARNINGS],
            [NEWS_SKILL_HIGH]
        );

        expect(prompt).toContain('AAPL');
        expect(prompt).toContain('Apple Inc.');
        expect(prompt).toContain('Apple reports record Q2 earnings beat');
    });

    it('companyName 오버로드에서 skills 인자가 누락되면 빈 스킬로 처리한다', () => {
        // 5-인자 시그니처에서 skills 를 undefined 로 넘기면 `maybeSkills ?? []`
        // fallback 경로를 탄다 (호출자 실수에 대한 방어).
        const prompt = buildNewsAnalysisPrompt(
            TEST_SYMBOL,
            'Apple Inc.',
            [NEWS_ITEM_1],
            [UPCOMING_EARNINGS],
            undefined as unknown as Skill[]
        );

        expect(prompt).toContain('No additional news skills loaded.');
    });

    it('실적 actual EPS가 있고 매출 추정치가 없으면 Actual EPS와 Rev est. N/A를 렌더한다', () => {
        // epsActual != null → "Actual EPS:" 분기 + actEps truthy 분기,
        // revenueEstimated == null → "Rev est. N/A" 분기를 동시에 커버한다.
        const item: EarningsCalendarItem = {
            ...UPCOMING_EARNINGS,
            epsActual: 1.55,
            revenueEstimated: null,
        };
        const prompt = buildNewsAnalysisPrompt(
            TEST_SYMBOL,
            [NEWS_ITEM_1],
            [item],
            []
        );

        expect(prompt).toContain('Actual EPS:');
        expect(prompt).toContain('1.55');
        expect(prompt).toContain('Rev est. N/A');
    });

    it('includes a low-confidence news skill with a [Low Confidence] label', () => {
        const skills: Skill[] = [
            {
                name: 'Catalyst Lens',
                description: '',
                type: 'pattern' as const,
                category: 'news' as const,
                indicators: [],
                confidenceWeight: 0.3,
                content: 'news body',
                gating: { tier: 'always_on' as const },
            },
        ];
        const prompt = buildNewsAnalysisPrompt(
            'AAPL',
            'Apple Inc.',
            [],
            [],
            skills
        );
        expect(prompt).toContain('### Catalyst Lens [Low Confidence]');
        expect(prompt).toContain('news body');
    });
});

describe('bodyTruncated propagation', () => {
    const TRUNCATED_ITEM: EnrichedNewsItem = {
        ...NEWS_ITEM_1,
        bodyTruncated: true,
    };

    it('marks the excerpt inline next to the body it qualifies', () => {
        // 항목이 20개까지 늘어나므로 별도 범례 줄로 두면 모델이 놓치기 쉽다.
        const prompt = buildNewsAnalysisPrompt(
            TEST_SYMBOL,
            [TRUNCATED_ITEM],
            [UPCOMING_EARNINGS],
            [NEWS_SKILL_HIGH]
        );

        expect(prompt).toContain('Body (KO) [EXCERPT — cut off]:');
    });

    it('tells the model to weigh an excerpt as weaker evidence', () => {
        // 1단계에서 잘린 본문이 카드 요약을 거쳐 2단계로 그대로 전파된다.
        // 2단계는 원문이 아니라 1단계의 해석을 받으므로 스스로 검증할 수 없다.
        const prompt = buildNewsAnalysisPrompt(
            TEST_SYMBOL,
            [TRUNCATED_ITEM],
            [UPCOMING_EARNINGS],
            [NEWS_SKILL_HIGH]
        );

        expect(prompt).toContain(
            'Treat it as weaker evidence than a complete body'
        );
        expect(prompt).toContain(
            "do not treat the fragment's opening framing as the article's conclusion"
        );
    });

    it('does not mark items whose body is complete', () => {
        const prompt = buildNewsAnalysisPrompt(
            TEST_SYMBOL,
            [NEWS_ITEM_1],
            [UPCOMING_EARNINGS],
            [NEWS_SKILL_HIGH]
        );

        expect(prompt).toContain('Body (KO):');
        expect(prompt).not.toContain('[EXCERPT — cut off]');
    });

    it('marks only the truncated item when a batch is mixed', () => {
        const prompt = buildNewsAnalysisPrompt(
            TEST_SYMBOL,
            [TRUNCATED_ITEM, NEWS_ITEM_2],
            [UPCOMING_EARNINGS],
            [NEWS_SKILL_HIGH]
        );

        expect(prompt.match(/\[EXCERPT — cut off\]/g)).toHaveLength(1);
    });
});

describe('buildNewsAnalysisPrompt — 출력 로케일', () => {
    /** 로컬 래퍼는 로케일을 받지 않으므로 원본을 직접 부른다. */
    const build = (locale?: 'ko' | 'en' | 'ja' | 'zh') =>
        buildNewsAnalysisPromptRaw(
            'AAPL',
            'Apple Inc.',
            [NEWS_ITEM_1],
            [],
            [],
            'equity',
            locale
        ).dynamic;

    /**
     * 이 축은 프롬프트 **본문**에 필드 언어 지시를 하드코딩하고 있었다 —
     * 말미 리마인더로는 뒤집힌다고 볼 수 없는 과업 규칙이다(리뷰 6라운드).
     */
    it('로케일을 생략하면 ko와 바이트가 같다', () => {
        expect(build()).toBe(build('ko'));
    });

    it.each(['en', 'ja', 'zh'] as const)(
        '%s: 한국어로 쓰라는 지시가 본문에 남지 않는다',
        locale => {
            expect(build(locale)).not.toContain('must be written in Korean');
            expect(build(locale)).not.toContain('in Korean (존댓말)');
            expect(build(locale)).not.toContain('한국어');
        }
    );

    it('ko: 예전 지시문이 그대로다', () => {
        expect(build('ko')).toContain('Korean (존댓말)');
    });
});

describe('buildNewsAnalysisPrompt — 독자용 문구 규칙', () => {
    const build = (locale?: 'ko' | 'en' | 'ja' | 'zh') =>
        buildNewsAnalysisPromptRaw(
            'AAPL',
            'Apple Inc.',
            [NEWS_ITEM_1],
            [],
            [],
            'equity',
            locale
        ).dynamic;

    const schemaBlock = (dynamic: string): string =>
        dynamic.slice(
            dynamic.indexOf('## Output Schema'),
            dynamic.indexOf('## Allowed Values')
        );

    it.each([undefined, 'en', 'ja', 'zh'] as const)(
        '%s: 스키마 블록에 "제공된" 같은 입력 지칭 표현이 없다',
        locale => {
            const schema = schemaBlock(build(locale));
            expect(schema).toContain('currentDriverKo');
            expect(schema).not.toContain('제공된');
        }
    );

    it('출처 제한 지시는 Rules 블록에 있다', () => {
        const dynamic = build();
        const rules = dynamic.slice(dynamic.indexOf('\nRules:'));
        expect(rules).toContain(
            'Base currentDriverKo only on the articles and calendar rows above'
        );
    });

    it('독자용 문구 규칙이 Rules 블록에 있다', () => {
        const dynamic = build();
        const rules = dynamic.slice(dynamic.indexOf('\nRules:'));
        expect(rules).toContain(DRIVER_READER_FACING_RULE);
        expect(rules).toContain('Never refer to the input itself');
    });

    it('입력 언급 금지가 주의·한계 문장까지 포함하고, 면책 문장을 요구하지 않는다', () => {
        expect(DRIVER_READER_FACING_RULE).toContain(
            'in any sentence including caveats and limitations'
        );
        expect(DRIVER_READER_FACING_RULE).toContain(
            'no sentences about what data was or was not included'
        );
        expect(DRIVER_READER_FACING_RULE).toContain(
            'no disclaimer sentence is needed'
        );
    });

    it('다른 규칙이 가격·거래량 데이터가 없다고 밝히도록 모델을 유도하지 않는다', () => {
        const dynamic = build();
        expect(dynamic).not.toMatch(
            /No current price, price change, or volume/
        );
        expect(dynamic).not.toMatch(/price[^.\n]* data is provided/i);
        expect(dynamic).toContain(
            'Do not claim that the news caused an actual price move.'
        );
    });

    it('규칙 문구에 예시 문장이나 한글이 인용되지 않는다', () => {
        expect(DRIVER_READER_FACING_RULE).not.toMatch(/[가-힣]/);
        expect(DRIVER_READER_FACING_RULE).not.toMatch(/["“'‘]/);
    });
});

describe('formatAgeSuffix (spec 2026-09-18 §2.8)', () => {
    const NOW = new Date('2025-04-28T12:00:00Z');

    it('renders "<N>h ago" under 24h', () => {
        expect(formatAgeSuffix('2025-04-28T09:00:00Z', NOW)).toBe(' (3h ago)');
    });

    it('renders "<N>d ago" at/over 24h', () => {
        expect(formatAgeSuffix('2025-04-26T12:00:00Z', NOW)).toBe(' (2d ago)');
    });

    it('clamps a future timestamp (clock skew) to "0h ago" instead of a negative age', () => {
        expect(formatAgeSuffix('2025-04-28T13:00:00Z', NOW)).toBe(' (0h ago)');
    });

    it('returns an empty string for an unparseable timestamp', () => {
        expect(formatAgeSuffix('not-a-date', NOW)).toBe('');
    });
});

describe('formatSentimentTally (spec 2026-09-18 §2.8)', () => {
    it('tallies bullish/bearish/neutral and high-impact bullish/bearish', () => {
        // NEWS_ITEM_1 bullish/high, NEWS_ITEM_2 bearish/high
        expect(formatSentimentTally([NEWS_ITEM_1, NEWS_ITEM_2])).toBe(
            'Sentiment tally: 1 bullish / 1 bearish / 0 neutral (high impact: 1 bullish / 1 bearish)'
        );
    });

    it('all zero for an empty list', () => {
        expect(formatSentimentTally([])).toBe(
            'Sentiment tally: 0 bullish / 0 bearish / 0 neutral (high impact: 0 bullish / 0 bearish)'
        );
    });

    it('does not count a medium/low-impact item toward the high-impact tally', () => {
        const mediumImpact: EnrichedNewsItem = {
            ...NEWS_ITEM_1,
            card: { ...NEWS_ITEM_1.card, priceImpact: 'medium' },
        };
        expect(formatSentimentTally([mediumImpact])).toBe(
            'Sentiment tally: 1 bullish / 0 bearish / 0 neutral (high impact: 0 bullish / 0 bearish)'
        );
    });
});

describe('buildNewsAnalysisPrompt — sentiment tally + age + calendar offsets (spec 2026-09-18 §2.8)', () => {
    const NOW = new Date('2025-04-28T12:00:00Z');

    it('renders the sentiment tally header inside ## Recent News Articles', () => {
        const { dynamic } = buildNewsAnalysisPromptRaw(
            TEST_SYMBOL,
            'Apple Inc.',
            [NEWS_ITEM_1, NEWS_ITEM_2],
            [],
            [],
            'equity',
            'ko',
            'USD',
            NOW
        );
        const articlesIdx = dynamic.indexOf('## Recent News Articles');
        const tallyIdx = dynamic.indexOf('Sentiment tally:');
        const item1Idx = dynamic.indexOf('[1]');
        expect(tallyIdx).toBeGreaterThan(articlesIdx);
        expect(item1Idx).toBeGreaterThan(tallyIdx);
        expect(dynamic).toContain(
            'Sentiment tally: 1 bullish / 1 bearish / 0 neutral (high impact: 1 bullish / 1 bearish)'
        );
    });

    it("appends an age suffix to each item's Published line", () => {
        const { dynamic } = buildNewsAnalysisPromptRaw(
            TEST_SYMBOL,
            'Apple Inc.',
            [NEWS_ITEM_1],
            [],
            [],
            'equity',
            'ko',
            'USD',
            NOW
        );
        // NEWS_ITEM_1 published 2025-04-28T12:00:00Z == NOW -> 0h ago
        expect(dynamic).toContain('Published: 2025-04-28T12:00:00Z (0h ago)');
    });

    it('appends "in N days" for a future earnings date', () => {
        const { dynamic } = buildNewsAnalysisPromptRaw(
            TEST_SYMBOL,
            'Apple Inc.',
            [],
            [UPCOMING_EARNINGS], // earningsDate 2025-07-30
            [],
            'equity',
            'ko',
            'USD',
            NOW
        );
        expect(dynamic).toContain('2025-07-30 (in 93 days):');
    });

    it('appends "N days ago" for a past earnings date', () => {
        const pastEarnings = {
            ...UPCOMING_EARNINGS,
            earningsDate: '2025-04-20',
        };
        const { dynamic } = buildNewsAnalysisPromptRaw(
            TEST_SYMBOL,
            'Apple Inc.',
            [],
            [pastEarnings],
            [],
            'equity',
            'ko',
            'USD',
            NOW
        );
        expect(dynamic).toContain('2025-04-20 (8 days ago):');
    });

    it('omits relative-time annotations when `now` is omitted — the domain never reads the wall clock', () => {
        const recent = {
            ...NEWS_ITEM_1,
            publishedAt: '2026-09-18T12:00:00.000Z',
        };
        const { dynamic } = buildNewsAnalysisPromptRaw(
            TEST_SYMBOL,
            'Apple Inc.',
            [recent],
            [],
            []
        );
        expect(dynamic).not.toMatch(/\(\d+[hd] ago\)/);
    });
});

// ─── Macro Calendar (spec 2026-09-28) ─────────────────────────────────────────

describe('buildNewsAnalysisPrompt — macro calendar (spec 2026-09-28)', () => {
    const MACRO_NOW = new Date('2025-04-28T12:00:00Z');

    const MACRO_EVENT_CPI: EconomicCalendarEvent = {
        date: '2025-07-30 12:00:00',
        event: 'CPI MoM',
        impact: 'High',
        actual: null,
        estimate: 0.3,
        previous: 0.2,
        unit: '%',
    };

    const MACRO_EVENT_FOMC: EconomicCalendarEvent = {
        date: '2025-05-05 12:00:00',
        event: 'Interest Rate Decision',
        impact: 'High',
        actual: 4.5,
        estimate: 4.5,
        previous: 4.75,
        unit: '%',
    };

    describe('backward compatibility — byte-identical to the pre-macro-calendar baseline', () => {
        // Captured by running the 9-arg overload BEFORE macroCalendar existed
        // (spec 2026-09-28 backward-compat requirement) — same fixtures as
        // the top-level describe block above.
        const GOLDEN = newsPromptPreMacroCalendarGolden;

        it('omitting macroCalendar produces byte-identical output to the captured baseline', () => {
            const result = buildNewsAnalysisPromptRaw(
                TEST_SYMBOL,
                'Apple Inc.',
                [NEWS_ITEM_1, NEWS_ITEM_2],
                [UPCOMING_EARNINGS],
                [NEWS_SKILL_HIGH],
                'equity',
                'ko',
                'USD',
                MACRO_NOW
            );
            expect(result).toEqual(GOLDEN);
        });

        it('passing an explicit empty macroCalendar produces byte-identical output', () => {
            const result = buildNewsAnalysisPromptRaw(
                TEST_SYMBOL,
                'Apple Inc.',
                [NEWS_ITEM_1, NEWS_ITEM_2],
                [UPCOMING_EARNINGS],
                [NEWS_SKILL_HIGH],
                'equity',
                'ko',
                'USD',
                MACRO_NOW,
                []
            );
            expect(result).toEqual(GOLDEN);
        });
    });

    it('renders the Macro Calendar section header when non-empty', () => {
        const { dynamic } = buildNewsAnalysisPromptRaw(
            TEST_SYMBOL,
            'Apple Inc.',
            [],
            [],
            [],
            'equity',
            'ko',
            'USD',
            MACRO_NOW,
            [MACRO_EVENT_CPI]
        );
        expect(dynamic).toContain(
            '## Macro Calendar (scheduled economic releases — source data)'
        );
    });

    it('sorts rows ascending by date regardless of input order', () => {
        const { dynamic } = buildNewsAnalysisPromptRaw(
            TEST_SYMBOL,
            'Apple Inc.',
            [],
            [],
            [],
            'equity',
            'ko',
            'USD',
            MACRO_NOW,
            [MACRO_EVENT_CPI, MACRO_EVENT_FOMC]
        );
        const idxFomc = dynamic.indexOf('Interest Rate Decision');
        const idxCpi = dynamic.indexOf('CPI MoM');
        expect(idxFomc).toBeGreaterThan(-1);
        expect(idxCpi).toBeGreaterThan(-1);
        expect(idxFomc).toBeLessThan(idxCpi);
    });

    it('renders both rows without crashing when two events share the same date (sort tie)', () => {
        const sameDate = '2025-06-01 08:30:00';
        const { dynamic } = buildNewsAnalysisPromptRaw(
            TEST_SYMBOL,
            'Apple Inc.',
            [],
            [],
            [],
            'equity',
            'ko',
            'USD',
            MACRO_NOW,
            [
                { ...MACRO_EVENT_CPI, date: sameDate },
                { ...MACRO_EVENT_FOMC, date: sameDate },
            ]
        );
        expect(dynamic).toContain('CPI MoM');
        expect(dynamic).toContain('Interest Rate Decision');
    });

    it('caps at 12 rows even when more are supplied, keeping the earliest (fed out of order so only sort-then-cap can pass)', () => {
        // Deliberately reversed + shuffled (not ascending) — review round 1
        // finding 3: an already-ascending fixture would still pass if the
        // sort step were silently dropped and only `.slice(0, 12)` ran on
        // the input order, since the earliest 12 happen to also be first.
        const ascending: EconomicCalendarEvent[] = Array.from(
            { length: 15 },
            (_, i) => ({
                date: `2025-08-${String(i + 1).padStart(2, '0')} 12:00:00`,
                event: `Event ${i + 1}`,
                impact: 'Medium' as const,
                actual: null,
                estimate: null,
                previous: null,
                unit: '',
            })
        );
        const shuffleOrder = [14, 2, 9, 0, 11, 5, 13, 1, 7, 3, 10, 4, 12, 6, 8];
        const events = shuffleOrder.map(i => ascending[i]!);
        const { dynamic } = buildNewsAnalysisPromptRaw(
            TEST_SYMBOL,
            'Apple Inc.',
            [],
            [],
            [],
            'equity',
            'ko',
            'USD',
            MACRO_NOW,
            events
        );
        expect(dynamic).toContain('Event 1 ');
        expect(dynamic).toContain('Event 12');
        expect(dynamic).not.toContain('Event 13');
        expect(dynamic).not.toContain('Event 14');
        expect(dynamic).not.toContain('Event 15');
    });

    it('renders null actual/estimate/previous as an em dash', () => {
        const { dynamic } = buildNewsAnalysisPromptRaw(
            TEST_SYMBOL,
            'Apple Inc.',
            [],
            [],
            [],
            'equity',
            'ko',
            'USD',
            MACRO_NOW,
            [MACRO_EVENT_CPI]
        );
        expect(dynamic).toContain('actual — / estimate 0.3 / previous 0.2 %');
    });

    it('renders non-null numeric fields without trailing-zero padding', () => {
        const { dynamic } = buildNewsAnalysisPromptRaw(
            TEST_SYMBOL,
            'Apple Inc.',
            [],
            [],
            [],
            'equity',
            'ko',
            'USD',
            MACRO_NOW,
            [MACRO_EVENT_FOMC]
        );
        expect(dynamic).toContain(
            'actual 4.5 / estimate 4.5 / previous 4.75 %'
        );
    });

    it('computes the relative-day offset from the UTC-normalized timestamp, exact at a day-boundary-crossing hour (review round 1 finding 1)', () => {
        // 00:30:00 is the boundary-crossing case: interpreted as *local* time
        // (the pre-fix bug) instead of UTC, a positive-offset zone (e.g.
        // KST, UTC+9) rolls this back onto the PREVIOUS UTC calendar day —
        // "in 6 days" instead of the correct "in 7 days" from MACRO_NOW
        // (2025-04-28T12:00:00Z). An exact string assertion (not a regex)
        // is required so this test actually fails on the old bug rather
        // than passing on either day count.
        const { dynamic } = buildNewsAnalysisPromptRaw(
            TEST_SYMBOL,
            'Apple Inc.',
            [],
            [],
            [],
            'equity',
            'ko',
            'USD',
            MACRO_NOW,
            [{ ...MACRO_EVENT_FOMC, date: '2025-05-05 00:30:00' }]
        );
        expect(dynamic).toContain(
            '- 2025-05-05 00:30:00 UTC (in 7 days) | Interest Rate Decision | impact High | actual 4.5 / estimate 4.5 / previous 4.75 %'
        );
    });

    it('labels a naive macro timestamp as UTC even without a relative-day offset', () => {
        const { dynamic } = buildNewsAnalysisPromptRaw(
            TEST_SYMBOL,
            'Apple Inc.',
            [],
            [],
            [],
            'equity',
            undefined,
            undefined,
            undefined,
            [MACRO_EVENT_FOMC]
        );
        expect(dynamic).toContain(
            '2025-05-05 12:00:00 UTC | Interest Rate Decision'
        );
        expect(dynamic).not.toMatch(/\(in \d+ days?\)/);
    });

    it('does not append a trailing unit suffix when unit is empty', () => {
        const { dynamic } = buildNewsAnalysisPromptRaw(
            TEST_SYMBOL,
            'Apple Inc.',
            [],
            [],
            [],
            'equity',
            'ko',
            'USD',
            MACRO_NOW,
            [{ ...MACRO_EVENT_CPI, unit: '' }]
        );
        expect(dynamic).toContain('previous 0.2\n');
        expect(dynamic).not.toContain('previous 0.2 \n');
    });

    it('mentions macro calendar in the intro sentence only when non-empty', () => {
        const withMacro = buildNewsAnalysisPromptRaw(
            TEST_SYMBOL,
            'Apple Inc.',
            [],
            [],
            [],
            'equity',
            'ko',
            'USD',
            MACRO_NOW,
            [MACRO_EVENT_CPI]
        ).dynamic;
        expect(withMacro).toContain(
            'card metadata, earnings calendar, and macro calendar.'
        );

        const withoutMacro = buildNewsAnalysisPromptRaw(
            TEST_SYMBOL,
            'Apple Inc.',
            [],
            [],
            [],
            'equity',
            'ko',
            'USD',
            MACRO_NOW
        ).dynamic;
        expect(withoutMacro).toContain('card metadata, and earnings calendar.');
        expect(withoutMacro).not.toContain('macro calendar');
    });

    it('adds the macro Data Boundary rule and "macro release dates" only when non-empty', () => {
        const withMacro = buildNewsAnalysisPromptRaw(
            TEST_SYMBOL,
            'Apple Inc.',
            [],
            [],
            [],
            'equity',
            'ko',
            'USD',
            MACRO_NOW,
            [MACRO_EVENT_CPI]
        ).dynamic;
        expect(withMacro).toContain(
            'Macro calendar rows are scheduled releases, not news.'
        );
        expect(withMacro).toContain(
            'regulatory events, macro release dates, prices, volume'
        );

        const withoutMacro = buildNewsAnalysisPromptRaw(
            TEST_SYMBOL,
            'Apple Inc.',
            [],
            [],
            [],
            'equity',
            'ko',
            'USD',
            MACRO_NOW
        ).dynamic;
        expect(withoutMacro).not.toContain(
            'Macro calendar rows are scheduled releases'
        );
        expect(withoutMacro).toContain('regulatory events, prices, volume');
    });

    it('renders the Macro Calendar section for crypto too', () => {
        const { dynamic } = buildNewsAnalysisPromptRaw(
            TEST_SYMBOL,
            'Apple Inc.',
            [],
            [],
            [],
            'crypto',
            'ko',
            'USD',
            MACRO_NOW,
            [MACRO_EVENT_CPI]
        );
        expect(dynamic).toContain(
            '## Macro Calendar (scheduled economic releases — source data)'
        );
    });
});
