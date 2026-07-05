import { describe, it, expect } from 'vitest';
import { buildNewsAnalysisPrompt as buildNewsAnalysisPromptRaw } from '@/domain/analysis/newsPrompt';
import type {
    EarningsCalendarItem,
    EnrichedNewsItem,
    Skill,
} from '@/domain/types';

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
            'Do not claim that news caused an actual price move'
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
