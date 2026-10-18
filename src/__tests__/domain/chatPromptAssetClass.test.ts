import { describe, it, expect } from 'vitest';
import { buildChatPrompt } from '@/domain/chat/buildChatPrompt';
import { buildNewsAnalysisPrompt as buildNewsAnalysisPromptRaw } from '@/domain/analysis/newsPrompt';
import { buildOverallAnalysisPrompt as buildOverallAnalysisPromptRaw } from '@/domain/analysis/overallPrompt';
import type {
    AnalysisResponse,
    CurrentAnalysisContext,
    FundamentalAnalysisResponse,
    NewsAnalysisResponse,
} from '@/domain/types';

// Both builders now return `{ stable, dynamic }` (spec §3.4 assembly split);
// this file's call sites predate the split and assert against the single
// legacy combined string (`stable + '\n\n' + dynamic`, exactly the string
// dispatch still sends as the `prompt` fallback field).
const buildNewsAnalysisPrompt = (
    ...args: Parameters<typeof buildNewsAnalysisPromptRaw>
): string => {
    const { stable, dynamic } = buildNewsAnalysisPromptRaw(...args);
    return `${stable}\n\n${dynamic}`;
};
const buildOverallAnalysisPrompt = (
    ...args: Parameters<typeof buildOverallAnalysisPromptRaw>
): string => {
    const { stable, dynamic } = buildOverallAnalysisPromptRaw(...args);
    return `${stable}\n\n${dynamic}`;
};

// ─── Shared fixtures ────────────────────────────────────────────────────────

const analysis: AnalysisResponse = {
    summary: 'Test summary.',
    trend: 'bullish',
    riskLevel: 'medium',
    indicatorResults: [],
    keyLevels: { support: [], resistance: [] },
    priceTargets: {
        bullish: { targets: [], condition: '' },
        bearish: { targets: [], condition: '' },
    },
    patternSummaries: [],
    strategyResults: [],
    candlePatterns: [],
    trendlines: [],
};

const mockFundamental: FundamentalAnalysisResponse = {
    overallConclusionKo: '펀더멘털 테스트.',
    categoryAssessments: [],
    riskFactorsKo: [],
    overallSentiment: 'neutral',
};

const mockNews: NewsAnalysisResponse = {
    currentDriverKo: '뉴스 테스트.',
    keyEventsKo: [],
    upcomingEventsKo: [],
    overallSentiment: 'neutral',
};

// ─── buildChatPrompt — assetClass framing ───────────────────────────────────

describe('buildChatPrompt assetClass framing', () => {
    it('equity chat (default): contains U.S. equity wording and equity refusal example', () => {
        const payload = buildChatPrompt(
            'AAPL',
            'Apple',
            '1Day',
            analysis,
            [],
            'How is it?'
        );
        const text = payload.systemPrompt;
        expect(text).toContain('U.S. equity');
        // Equity-specific refusal example references "다른 종목"
        expect(text).toContain('다른 종목');
    });

    it('crypto chat (assetClass param): contains cryptocurrency wording and crypto refusal example', () => {
        const payload = buildChatPrompt(
            'BTCUSD',
            'Bitcoin',
            '1Day',
            analysis,
            [],
            'Is now a good entry?',
            undefined, // no currentAnalysisContext
            'crypto'
        );
        const text = payload.systemPrompt;
        // Must use crypto asset kind
        expect(text).toContain('cryptocurrency');
        // Must include crypto-specific refusal example
        expect(text).toContain('다른 코인');
        // Must NOT use equity framing
        expect(text).not.toMatch(/U\.S\. equity/i);
        // Must NOT use the equity-specific "다른 종목" wording
        expect(text).not.toContain('다른 종목');
    });

    it('R1: assetClass=crypto with NO currentAnalysisContext does NOT emit a "## Current analysis context" section', () => {
        // This is the core R1 regression guard: a framing-only flag must not
        // produce a duplicate context section.
        const payload = buildChatPrompt(
            'BTCUSD',
            'Bitcoin',
            '1Day',
            analysis,
            [],
            'Is now a good entry?',
            undefined, // explicitly no context
            'crypto'
        );
        expect(payload.systemPrompt).not.toContain(
            '## Current analysis context'
        );
        // But crypto framing is still applied
        expect(payload.systemPrompt).toContain('cryptocurrency');
    });

    it('R1: currentAnalysisContext IS emitted when explicitly provided alongside assetClass=crypto', () => {
        const context: CurrentAnalysisContext = {
            kind: 'news',
            payload: mockNews,
        };
        const payload = buildChatPrompt(
            'BTCUSD',
            'Bitcoin',
            '1Day',
            analysis,
            [],
            'What is the news sentiment?',
            context,
            'crypto'
        );
        // Context section must appear (caller explicitly provided it)
        expect(payload.systemPrompt).toContain('## Current analysis context');
        expect(payload.systemPrompt).toContain('Kind: news');
        // Crypto framing is also applied
        expect(payload.systemPrompt).toContain('cryptocurrency');
    });

    it('equity chat with currentAnalysisContext emits the context section', () => {
        const context: CurrentAnalysisContext = {
            kind: 'technical',
            payload: analysis,
        };
        const payload = buildChatPrompt(
            'AAPL',
            'Apple',
            '1Day',
            analysis,
            [],
            'How is it?',
            context
        );
        expect(payload.systemPrompt).toContain('## Current analysis context');
        expect(payload.systemPrompt).toContain('Kind: technical');
        expect(payload.systemPrompt).toContain('U.S. equity');
    });
});

// ─── buildNewsAnalysisPrompt — crypto drops earnings framing ────────────────

describe('buildNewsAnalysisPrompt assetClass framing', () => {
    it('equity (default): contains U.S. equity framing', () => {
        const prompt = buildNewsAnalysisPrompt(
            'AAPL',
            'Apple Inc.',
            [],
            [],
            [],
            'equity'
        );
        expect(prompt).toContain('publicly traded U.S. equity');
        expect(prompt).not.toContain('cryptocurrency');
    });

    it('crypto: drops earnings/analyst framing and includes crypto framing', () => {
        const prompt = buildNewsAnalysisPrompt(
            'BTCUSD',
            'Bitcoin',
            [],
            [],
            [],
            'crypto'
        );
        // Must use crypto context
        expect(prompt).toContain('cryptocurrency');
        expect(prompt).toContain('no earnings reports');
        // Must NOT include U.S. equity framing
        expect(prompt).not.toContain('publicly traded U.S. equity');
    });
});

// ─── buildOverallAnalysisPrompt — crypto opener (R2) ───────────────────────

describe('buildOverallAnalysisPrompt assetClass framing (R2)', () => {
    it('equity (default): role line says "senior equity analyst" and "four-axis data"', () => {
        const prompt = buildOverallAnalysisPrompt(
            'AAPL',
            'Apple Inc.',
            analysis,
            mockFundamental,
            mockNews,
            '1Day',
            undefined,
            null,
            false,
            null,
            'equity'
        );
        // The role/opener line must use the equity role. Post assembly-split
        // (spec §3.4), the stable Output Schema block now precedes the
        // dynamic role line in the combined prompt, so this locates the
        // opener line by content rather than assuming index 0 (the inverse
        // of the pre-split order — see promptStability.test.ts).
        const openerLine =
            prompt.split('\n').find(line => line.startsWith('You are a')) ?? '';
        expect(openerLine).toContain('senior equity analyst');
        expect(openerLine).toContain('four-axis data');
        expect(openerLine).not.toContain('senior markets analyst');
        expect(openerLine).not.toContain('available-axis');
    });

    it('crypto: role line uses neutral "senior markets analyst" and "available-axis data" — no equity-analyst or four-axis in the opener', () => {
        const prompt = buildOverallAnalysisPrompt(
            'BTCUSD',
            'Bitcoin',
            analysis,
            mockFundamental,
            mockNews,
            '1Day',
            undefined,
            null,
            false,
            null,
            'crypto'
        );
        const openerLine =
            prompt.split('\n').find(line => line.startsWith('You are a')) ?? '';
        expect(openerLine).toContain('senior markets analyst');
        expect(openerLine).toContain('available-axis data');
        expect(openerLine).not.toContain('senior equity analyst');
        expect(openerLine).not.toContain('four-axis data');
        // The crypto branch must be internally consistent: no "four-axis data"
        // wording anywhere (R2 round-2 fix — the Data Boundary line previously
        // hardcoded "four-axis data", contradicting the crypto opener).
        expect(prompt).not.toContain('four-axis data');
        expect(prompt).toContain('available-axis data as evidence');
    });

    it('equity Data Boundary keeps the "four-axis data as evidence" wording', () => {
        const prompt = buildOverallAnalysisPrompt(
            'AAPL',
            'Apple Inc.',
            analysis,
            mockFundamental,
            mockNews,
            '1Day',
            undefined,
            null,
            false,
            null,
            'equity'
        );
        expect(prompt).toContain('four-axis data as evidence');
        expect(prompt).not.toContain('available-axis data');
    });

    it('crypto: Axis 2 section contains the empty-array instruction for fundamentalBulletsKo', () => {
        const prompt = buildOverallAnalysisPrompt(
            'BTCUSD',
            'Bitcoin',
            analysis,
            mockFundamental,
            mockNews,
            '1Day',
            undefined,
            null,
            false,
            null,
            'crypto'
        );
        // Verify the exact text emitted by overallPrompt.ts for the crypto Axis 2 branch.
        expect(prompt).toContain('## Axis 2 — Fundamental Analysis');
        expect(prompt).toContain(
            'This asset is a cryptocurrency and is not subject to corporate fundamental analysis. Keep fundamentalBulletsKo as an empty array.'
        );
    });
});

// ─── KRX listing framing ────────────────────────────────────────────────────

describe('KRX listing framing (chat / news)', () => {
    it('chat frames a KRX symbol as a Korean listing and renders levels in whole won', () => {
        const payload = buildChatPrompt(
            '005930.KS',
            '삼성전자',
            '1Day',
            {
                ...analysis,
                keyLevels: {
                    support: [{ price: 264000, reason: '지지선' }],
                    resistance: [],
                },
            },
            [],
            '어때요?',
            undefined,
            'equity',
            'KRW'
        );
        expect(payload.systemPrompt).toContain(
            'Korean equity listed on the KRX'
        );
        expect(payload.systemPrompt).not.toContain('U.S. equity');
        expect(payload.systemPrompt).toContain('- Support: 264000 (지지선)');
    });

    it('news frames a KRW listing as Korean', () => {
        const prompt = buildNewsAnalysisPrompt(
            '005930.KS',
            '삼성전자',
            [],
            [],
            [],
            'equity',
            undefined,
            'KRW'
        );
        expect(prompt).toContain('Korean equity listed on the KRX');
        expect(prompt).not.toContain('U.S. equity');
    });

    it('does not infer the listing from the symbol suffix', () => {
        // The currency is supplied by the consumer's market profile, never derived.
        const chat = buildChatPrompt(
            '005930.KS',
            '삼성전자',
            '1Day',
            analysis,
            [],
            '어때요?'
        );
        expect(chat.systemPrompt).toContain('U.S. equity');
        expect(
            buildNewsAnalysisPrompt(
                '005930.KS',
                '삼성전자',
                [],
                [],
                [],
                'equity'
            )
        ).toContain('publicly traded U.S. equity');
    });
});

describe('buildOverallAnalysisPrompt listing framing and level precision', () => {
    it('frames a KRX symbol as a Korean listing and renders its levels in whole won', () => {
        const prompt = buildOverallAnalysisPrompt(
            '005930.KS',
            '삼성전자',
            {
                ...analysis,
                keyLevels: {
                    support: [{ price: 264000, reason: '지지선' }],
                    resistance: [],
                },
            },
            mockFundamental,
            mockNews,
            '1Day',
            undefined,
            null,
            false,
            null,
            'equity',
            undefined,
            undefined,
            undefined,
            'KRW'
        );
        expect(prompt).toContain('Korean equity listed on the KRX');
        expect(prompt).not.toContain('publicly traded U.S. equity');
        expect(prompt).toContain('- Key Support Levels: 264000 (지지선)');
    });

    it('keeps significant digits on a sub-dollar level instead of rounding to 0.08', () => {
        const prompt = buildOverallAnalysisPrompt(
            'DOGEUSD',
            'Dogecoin',
            {
                ...analysis,
                keyLevels: {
                    support: [{ price: 0.0826, reason: 'swing low' }],
                    resistance: [],
                },
            },
            null,
            mockNews,
            '1Hour',
            undefined,
            null,
            false,
            null,
            'crypto'
        );
        // Crypto keeps five significant digits.
        expect(prompt).toContain('- Key Support Levels: 0.082600 (swing low)');
    });

    it('renders every level at the precision the finest one needs', () => {
        // Per-level precision printed `0.9950` next to `1.01` in one list.
        const prompt = buildOverallAnalysisPrompt(
            'XYZ',
            'XYZ Corp',
            {
                ...analysis,
                keyLevels: {
                    support: [{ price: 0.995, reason: 'swing low' }],
                    resistance: [{ price: 1.01, reason: 'swing high' }],
                },
            },
            mockFundamental,
            mockNews,
            '1Day'
        );
        expect(prompt).toContain('- Key Support Levels: 0.9950 (swing low)');
        expect(prompt).toContain(
            '- Key Resistance Levels: 1.0100 (swing high)'
        );
    });
});

describe('legacy overloads never infer the listing from the symbol', () => {
    // The pre-assetClass overloads cannot carry a currency. Core does not derive one
    // from the `.KS` suffix (see `CurrencyCode`), so they frame every symbol as the
    // USD default; callers that need Korean framing use the overloads that take it.
    it('chat 6-argument overload frames a KRX symbol with the USD default', () => {
        const payload = buildChatPrompt(
            '005930.KS',
            '1Day',
            analysis,
            [],
            '어때요?'
        );
        expect(payload.systemPrompt).toContain('U.S. equity');
        expect(payload.systemPrompt).not.toContain('Korean equity');
    });

    it('news 4-argument overload frames a KRX symbol with the USD default', () => {
        // The local wrapper's Parameters<> only sees the last overload, so call the raw builder.
        const { stable, dynamic } = buildNewsAnalysisPromptRaw(
            '005930.KS',
            [],
            [],
            []
        );
        const prompt = `${stable}\n\n${dynamic}`;
        expect(prompt).toContain('publicly traded U.S. equity');
        expect(prompt).not.toContain('Korean equity');
    });
});

describe('KRX tick table (chat)', () => {
    const build = (krxTick?: 'share' | 'etp') =>
        buildChatPrompt(
            '069500.KS',
            'KODEX 200',
            '1Day',
            {
                ...analysis,
                keyLevels: {
                    support: [{ price: 40_123, reason: '지지선' }],
                    resistance: [],
                },
            },
            [],
            '어때요?',
            undefined,
            'equity',
            'KRW',
            krxTick
        );

    it('quotes levels on the 5-won ETP grid when asked', () => {
        expect(build('etp').systemPrompt).toContain(
            '- Support: 40125 (지지선)'
        );
    });

    it('keeps the 50-won share grid by default', () => {
        expect(build().systemPrompt).toContain('- Support: 40100 (지지선)');
    });
});
