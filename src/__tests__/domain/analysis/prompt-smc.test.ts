import { describe, it, expect } from 'vitest';
import {
    ANTI_FABRICATION_GUARDRAIL,
    buildAnalysisPrompt,
    SMC_GUIDE_BLOCKED_NOTICE,
} from '@/domain/analysis/prompt';
import { EMPTY_SMC_RESULT } from '@/domain/indicators/constants';
import type {
    Bar,
    IndicatorResult,
    Skill,
    SMCResult,
    SMCStructureBreak,
} from '@/domain/types';

const TEST_SYMBOL = 'AAPL';
const TEST_COMPANY = 'Apple Inc.';

const makeBar = (i: number): Bar => ({
    time: 1_700_000_000 + i * 86_400,
    open: 100 + i,
    high: 101 + i,
    low: 99 + i,
    close: 100 + i,
    volume: 1_000_000,
});

const bars: Bar[] = Array.from({ length: 100 }, (_, i) => makeBar(i));

const makeIndicators = (smc: SMCResult): IndicatorResult => ({
    rsi: [],
    cci: [],
    vwap: [],
    macd: [],
    bollinger: [],
    dmi: [],
    stochastic: [],
    stochRsi: [],
    ma: {},
    ema: {},
    volumeProfile: null,
    ichimoku: [],
    atr: [],
    obv: [],
    parabolicSar: [],
    williamsR: [],
    supertrend: [],
    mfi: [],
    keltnerChannel: [],
    cmf: [],
    donchianChannel: [],
    buySellVolume: [],
    squeezeMomentum: [],
    smc,
});

const structureBreak = (
    index: number,
    breakType: SMCStructureBreak['breakType']
): SMCStructureBreak => ({
    index,
    price: 155,
    type: 'bullish',
    breakType,
});

const SMC_GUIDE_BODY =
    '## Full SMC Methodology\n- Order blocks form when...\n- Example level $183.00–$184.20';

const smcGuideSkill = (gatingTier: 'always_on' | 'gated'): Skill => ({
    name: 'Smart Money Concepts',
    description: 'Full SMC ICT methodology guide',
    type: 'strategy',
    indicators: [],
    confidenceWeight: 0.9,
    content: SMC_GUIDE_BODY,
    gating:
        gatingTier === 'always_on'
            ? { tier: 'always_on' }
            : {
                  tier: 'gated',
                  signalKind: 'event',
                  triggers: ['rsi_oversold'],
              },
});

describe('SMC full-guide blocking', () => {
    it('never injects the SMC skill full guide, even when always_on', () => {
        const out = buildAnalysisPrompt(
            TEST_SYMBOL,
            TEST_COMPANY,
            bars,
            makeIndicators(EMPTY_SMC_RESULT),
            [smcGuideSkill('always_on')],
            '1Day'
        );
        expect(out).not.toContain('Full SMC Methodology');
        expect(out).not.toContain('$183.00–$184.20');
    });

    it('blocks the SMC guide body content but not the computed SMC data section', () => {
        const smc: SMCResult = {
            ...EMPTY_SMC_RESULT,
            structureBreaks: [structureBreak(95, 'bos')],
        };
        const out = buildAnalysisPrompt(
            TEST_SYMBOL,
            TEST_COMPANY,
            bars,
            makeIndicators(smc),
            [smcGuideSkill('always_on')],
            '1Day'
        );
        // Computed data section (the anchor) still renders.
        expect(out).toContain('## Smart Money Concepts (SMC)');
        // The skill's prose body never appears.
        expect(out).not.toContain('Full SMC Methodology');
        // A blocking notice documents the deliberate omission.
        expect(out).toContain(SMC_GUIDE_BLOCKED_NOTICE);
    });
});

describe('SMC compressed concept note (BOS/CHoCH recency gate)', () => {
    it('emits the compressed note when BOS/CHoCH is within 10 bars', () => {
        const smc: SMCResult = {
            ...EMPTY_SMC_RESULT,
            // 100 bars total → index 95 is 4 bars ago (within 10).
            structureBreaks: [structureBreak(95, 'choch')],
        };
        const out = buildAnalysisPrompt(
            TEST_SYMBOL,
            TEST_COMPANY,
            bars,
            makeIndicators(smc),
            [],
            '1Day'
        );
        expect(out).toContain(SMC_GUIDE_BLOCKED_NOTICE);
        const noteLines = out
            .split('\n\n')
            .find(s => s.includes(SMC_GUIDE_BLOCKED_NOTICE));
        expect(noteLines).toBeDefined();
        // ~5-line concept note: keep it compact.
        expect((noteLines as string).split('\n').length).toBeLessThanOrEqual(7);
    });

    it('omits the compressed note when the latest BOS/CHoCH is older than 10 bars', () => {
        const smc: SMCResult = {
            ...EMPTY_SMC_RESULT,
            // index 80 in a 100-bar series → 19 bars ago.
            structureBreaks: [structureBreak(80, 'bos')],
        };
        const out = buildAnalysisPrompt(
            TEST_SYMBOL,
            TEST_COMPANY,
            bars,
            makeIndicators(smc),
            [],
            '1Day'
        );
        expect(out).not.toContain(SMC_GUIDE_BLOCKED_NOTICE);
    });

    it('omits the compressed note when there is no structure break', () => {
        const out = buildAnalysisPrompt(
            TEST_SYMBOL,
            TEST_COMPANY,
            bars,
            makeIndicators(EMPTY_SMC_RESULT),
            [],
            '1Day'
        );
        expect(out).not.toContain(SMC_GUIDE_BLOCKED_NOTICE);
    });
});

describe('anti-fabrication guardrail on level-citing sections', () => {
    it('exposes the guardrail constant', () => {
        expect(ANTI_FABRICATION_GUARDRAIL.length).toBeGreaterThan(0);
    });

    it('includes the guardrail in the chart prompt (level sections)', () => {
        const out = buildAnalysisPrompt(
            TEST_SYMBOL,
            TEST_COMPANY,
            bars,
            makeIndicators(EMPTY_SMC_RESULT),
            [],
            '1Day'
        );
        expect(out).toContain(ANTI_FABRICATION_GUARDRAIL);
    });
});
