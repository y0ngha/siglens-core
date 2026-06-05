// All AI-facing prompt strings must be in English — Korean reduces analysis quality.

import {
    ATR_DEFAULT_PERIOD,
    CCI_DEFAULT_PERIOD,
    CMF_DEFAULT_PERIOD,
    CRSI_OVERBOUGHT,
    CRSI_OVERSOLD,
    DONCHIAN_DEFAULT_PERIOD,
    EMA_DEFAULT_PERIODS,
    EMA_SUPPORT_RESISTANCE_LONG_INDEX,
    EMA_SUPPORT_RESISTANCE_SHORT_INDEX,
    FORCE_INDEX_ZERO,
    HIGH_CONFIDENCE_WEIGHT,
    HURST_RANDOM_WALK,
    ICHIMOKU_BASE_PERIOD,
    ICHIMOKU_CONVERSION_PERIOD,
    ICHIMOKU_SPAN_B_PERIOD,
    KELTNER_ATR_PERIOD,
    KELTNER_EMA_PERIOD,
    KELTNER_MULTIPLIER,
    MA_DEFAULT_PERIODS,
    MACDV_OVERBOUGHT,
    MACDV_OVERSOLD,
    MFI_DEFAULT_PERIOD,
    PCTB_OVERBOUGHT,
    PCTB_OVERSOLD,
    RSI_DEFAULT_PERIOD,
    SMC_SWING_PERIOD,
    SQUEEZE_MOMENTUM_BB_LENGTH,
    SQUEEZE_MOMENTUM_KC_LENGTH,
    SQUEEZE_MOMENTUM_KC_MULT,
    STOCH_RSI_D_PERIOD,
    STOCH_RSI_K_PERIOD,
    STOCH_RSI_RSI_PERIOD,
    STOCH_RSI_STOCH_PERIOD,
    STOCHASTIC_D_PERIOD,
    STOCHASTIC_K_PERIOD,
    STOCHASTIC_SMOOTHING,
    SUPERTREND_ATR_PERIOD,
    SUPERTREND_MULTIPLIER,
    VR_RANDOM_WALK,
    WILLIAMS_R_DEFAULT_PERIOD,
} from '@/domain/indicators/constants';
import { MS_PER_SECOND } from '@/domain/constants/time';
import { detectCandlePattern } from '@/domain/analysis/candle';
import { getCandlePatternLabel } from '@/domain/analysis/candle-labels';
import {
    getMultiPatternTrend,
    getSinglePatternTrend,
} from '@/domain/analysis/candle-trend';
import {
    detectCandlePatternEntries,
    getDetectionBars,
    selectLastCandlePatternEntries,
} from '@/domain/analysis/candle-detection';
import { selectSkills } from '@/domain/analysis/selectSkills';
import { detectSignals } from '@/domain/signals';
import type {
    CandlePatternEntry,
    AnalysisResponse,
    Bar,
    FearGreedSnapshot,
    HorizonKey,
    HorizonReference,
    ImpulseColor,
    IndicatorResult,
    MarketReference,
    PromptConfig,
    ReferenceLevel,
    Skill,
    SkillSelectionContext,
    SkillType,
    SMCEqualLevel,
    SMCResult,
    SMCZone,
    SqueezeMomentumResult,
    Timeframe,
    Trend,
} from '@/domain/types';
import { computeMarketReference } from '@/domain/analysis/marketReference';
import { lastOf } from '@/domain/analysis/analysisUtils';
import { formatFearGreedSection } from '@/domain/analysis/fearGreedSection';
import { formatNullableNumber } from '@/domain/analysis/promptFormat';

type SkillGroupKey = SkillType | 'regular';

const INDICATOR_DECIMAL_PLACES = 2;
const DATETIME_DISPLAY_LENGTH = 16;
const PERCENTAGE_FACTOR = 100;

// MACD-V "momentum lifecycle" inner band: research §1 places the weak/strong
// transition at ±50, which is the ±150 OB/OS bound divided by 3. Deriving it
// from the shared MACDV_OVERBOUGHT keeps the two bands in lockstep if retuned.
/** @internal Divisor from the ±150 MACD-V OB/OS bound to the ±50 transition band. */
const MACDV_ZONE_INNER_DIVISOR = 3;

/**
 * @internal Per-timeframe prompt configuration (trend sample counts, decimal places 등).
 * 테스트가 동일 값을 참조할 수 있도록 export (MISTAKES.md Tests #4/#13).
 */
export const PROMPT_CONFIG_BY_TIMEFRAME: Record<Timeframe, PromptConfig> = {
    '5Min': {
        trendSampleCount: 12,
        recentBarsCount: 48,
        squeezeZeroCrossLookback: 24,
    },
    '15Min': {
        trendSampleCount: 10,
        recentBarsCount: 40,
        squeezeZeroCrossLookback: 18,
    },
    '30Min': {
        trendSampleCount: 9,
        recentBarsCount: 36,
        squeezeZeroCrossLookback: 14,
    },
    '1Hour': {
        trendSampleCount: 8,
        recentBarsCount: 32,
        squeezeZeroCrossLookback: 12,
    },
    '4Hour': {
        trendSampleCount: 7,
        recentBarsCount: 30,
        squeezeZeroCrossLookback: 10,
    },
    '1Day': {
        trendSampleCount: 7,
        recentBarsCount: 30,
        squeezeZeroCrossLookback: 10,
    },
};

// detectTrend 의 상대 임계값 비율 (윈도 내 최대 절대값의 몇 % 를 'flat' 으로 간주할지).
const INDICATOR_TREND_THRESHOLD_RATIO = 0.01;
// ratio × maxAbs가 0에 수렴할 때 잡음이 rising/falling으로 오분류되는 것을 방지.
const INDICATOR_TREND_MIN_THRESHOLD = 1e-8;

const SMC_MAX_ORDER_BLOCKS = 5;
const SMC_MAX_FAIR_VALUE_GAPS = 5;
const SMC_MAX_STRUCTURE_BREAKS = 3;
const SMC_MAX_EQUAL_LEVELS = 3;
const SMC_MAX_SWING_POINTS = 5;

const TIMEFRAME_LABEL: Record<Timeframe, string> = {
    '5Min': '5-Minute',
    '15Min': '15-Minute',
    '30Min': '30-Minute',
    '1Hour': '1-Hour',
    '4Hour': '4-Hour',
    '1Day': 'Daily',
};

const TIMEFRAME_CONTEXT: Record<Timeframe, string> = {
    '5Min': 'Short-term chart. Combine indicator signals with volume confirmation before acting.',
    '15Min': 'Intraday chart. Indicator signals have moderate reliability.',
    '30Min':
        'Intraday chart. Good for identifying intraday trends and momentum shifts. Signals carry more weight than 5/15-minute charts.',
    '1Hour':
        'Medium-term chart. Divergences and pattern completions carry meaningful weight.',
    '4Hour':
        'Swing trading chart. Signals are reliable for multi-day trends. Divergences and breakouts are actionable.',
    '1Day': 'Daily chart. Indicator signals have high reliability. Overbought/oversold, divergences, and pattern completions are significant.',
};

type IndicatorTrend = 'rising' | 'falling' | 'flat';

const detectTrend = (
    values: (number | null)[],
    sampleCount: number
): IndicatorTrend | null => {
    const nonNull = values
        .slice(-sampleCount)
        .filter((v): v is number => v !== null);
    if (nonNull.length < 2) return null;

    // 선형 회귀 slope 기반 — 극단치 whipsaw에 강하고 windowSpan은 fitted line 총 변화량.
    const n = nonNull.length;
    const xMean = (n - 1) / 2;
    const yMean = nonNull.reduce((sum, v) => sum + v, 0) / n;
    const numerator = nonNull.reduce(
        (sum, v, i) => sum + (i - xMean) * (v - yMean),
        0
    );
    const denominator = nonNull.reduce(
        (sum, _, i) => sum + (i - xMean) ** 2,
        0
    );
    if (denominator === 0) return 'flat';
    const windowSpan = (numerator / denominator) * (n - 1);

    // 지표 스케일 비례 임계값 — MACD/CCI/CMF 영점 교차 구간의 잡음 오분류 방지.
    const windowMaxAbs = nonNull.reduce(
        (max, v) => Math.max(max, Math.abs(v)),
        0
    );
    const threshold = Math.max(
        windowMaxAbs * INDICATOR_TREND_THRESHOLD_RATIO,
        INDICATOR_TREND_MIN_THRESHOLD
    );
    if (windowSpan > threshold) return 'rising';
    if (windowSpan < -threshold) return 'falling';
    return 'flat';
};

interface PromptCandlePatternEntry {
    barsAgo: number;
    patternType: CandlePatternEntry['patternType'];
    patternName: string;
    trend: Trend;
}

// Brevity alias used across the prompt-line templates below.
const fmt = (n: number | null): string => formatNullableNumber(n, 2);

const formatVolume = (n: number): string =>
    Math.round(n)
        .toString()
        .replace(/\B(?=(\d{3})+(?!\d))/g, ',');

const lastNonNull = (arr: (number | null)[]): number | null =>
    arr.findLast((v): v is number => v !== null) ?? null;

const formatMarketSection = (bars: Bar[]): string => {
    if (bars.length === 0) {
        return [
            '## Analysis Snapshot',
            '- Snapshot Price (price captured at analysis time; not a live quote): N/A',
            '- Price Change %: N/A',
            '- Volume: N/A',
        ].join('\n');
    }

    const last = bars[bars.length - 1];
    const prev = bars.length > 1 ? bars[bars.length - 2] : null;
    const changeRate =
        prev !== null
            ? `${(((last.close - prev.close) / prev.close) * 100).toFixed(INDICATOR_DECIMAL_PLACES)}%`
            : 'N/A';

    return [
        '## Analysis Snapshot',
        `- Snapshot Price (price captured at analysis time; not a live quote): ${fmt(last.close)}`,
        `- Price Change %: ${changeRate}`,
        `- Volume: ${formatVolume(last.volume)}`,
    ].join('\n');
};

const formatLongTermContext = (bars: Bar[]): string => {
    if (bars.length === 0) {
        return ['## Long-term Context', '- No data available'].join('\n');
    }

    const highs = bars.map(b => b.high);
    const lows = bars.map(b => b.low);
    const periodHigh = Math.max(...highs);
    const periodLow = Math.min(...lows);
    const firstClose = bars[0].close;
    const lastClose = bars[bars.length - 1].close;
    const periodReturn =
        firstClose > 0
            ? ((lastClose - firstClose) / firstClose) * PERCENTAGE_FACTOR
            : 0;

    return [
        `## Long-term Context (${bars.length} bars total)`,
        `- Period High: ${fmt(periodHigh)}`,
        `- Period Low: ${fmt(periodLow)}`,
        `- Price Range: ${fmt(periodHigh)} ~ ${fmt(periodLow)}`,
        `- Period Return: ${periodReturn.toFixed(INDICATOR_DECIMAL_PLACES)}%`,
        `- Current vs High: ${((lastClose / periodHigh) * PERCENTAGE_FACTOR).toFixed(INDICATOR_DECIMAL_PLACES)}%`,
        `- Current vs Low: ${((lastClose / periodLow) * PERCENTAGE_FACTOR).toFixed(INDICATOR_DECIMAL_PLACES)}%`,
    ].join('\n');
};

const formatBarRow = (bar: Bar): string => {
    const datetime = new Date(bar.time * MS_PER_SECOND)
        .toISOString()
        .replace('T', ' ')
        .slice(0, DATETIME_DISPLAY_LENGTH);
    const pattern = detectCandlePattern(bar);
    return `[ts:${bar.time}] ${datetime} | O:${fmt(bar.open)} H:${fmt(bar.high)} L:${fmt(bar.low)} C:${fmt(bar.close)} V:${formatVolume(bar.volume)} [${getCandlePatternLabel(pattern)}]`;
};

const buildCandlePatternEntries = (
    bars: Bar[],
    entries: CandlePatternEntry[]
): PromptCandlePatternEntry[] => {
    const detectionBars = getDetectionBars(bars);
    const totalBars = detectionBars.length;
    const lastEntries = selectLastCandlePatternEntries(entries);

    return lastEntries
        .map((entry: CandlePatternEntry) => ({
            barsAgo: totalBars - 1 - entry.barIndex,
            patternType: entry.patternType,
            patternName:
                entry.patternType === 'multi'
                    ? entry.multiPattern
                    : entry.singlePattern,
            trend:
                entry.patternType === 'single'
                    ? getSinglePatternTrend(entry.singlePattern)
                    : getMultiPatternTrend(entry.multiPattern),
        }))
        .toSorted(
            (a: PromptCandlePatternEntry, b: PromptCandlePatternEntry) =>
                b.barsAgo - a.barsAgo
        );
};

const formatPatternEntry = (entry: PromptCandlePatternEntry): string =>
    `- [${entry.barsAgo} bars ago] ${entry.patternType === 'single' ? 'Single candle pattern' : 'Multi-candle pattern'}: ${entry.patternName} [trend: ${entry.trend}]`;

const formatRecentBarsSection = (
    bars: Bar[],
    recentBarsCount: number,
    candleEntries: CandlePatternEntry[]
): string => {
    const recentBars = bars.slice(-recentBarsCount);

    if (recentBars.length === 0) {
        return ['## Recent Bar Data', '- No data available'].join('\n');
    }

    const patternEntries = buildCandlePatternEntries(bars, candleEntries);

    return [
        `## Recent Bar Data (Last ${recentBars.length} bars)`,
        'Format: Date/Time(UTC) | O:Open H:High L:Low C:Close V:Volume [CandlePattern]',
        ...recentBars.map(formatBarRow),
        ...(patternEntries.length > 0
            ? [
                  `## Detected Candle Patterns (Short-term Trend Signal)`,
                  'These patterns represent the most recent candle formation and should be interpreted as short-term trend signals.',
                  ...patternEntries.map(formatPatternEntry),
              ]
            : []),
    ].join('\n');
};

const formatBuySellVolumeSection = (
    indicators: IndicatorResult,
    recentBarsCount: number
): string => {
    const recentBuySell = indicators.buySellVolume.slice(-recentBarsCount);

    if (recentBuySell.length === 0) {
        return ['## Volume Analysis', '- No data available'].join('\n');
    }

    const { totalBuy, totalSell } = recentBuySell.reduce(
        (acc, v) => ({
            totalBuy: acc.totalBuy + v.buyVolume,
            totalSell: acc.totalSell + v.sellVolume,
        }),
        { totalBuy: 0, totalSell: 0 }
    );
    const totalVolume = totalBuy + totalSell;
    const buyRatio =
        totalVolume > 0 ? (totalBuy / totalVolume) * PERCENTAGE_FACTOR : 0;
    const sellRatio =
        totalVolume > 0 ? (totalSell / totalVolume) * PERCENTAGE_FACTOR : 0;

    const last = lastOf(recentBuySell)!;
    const lastTotal = last.buyVolume + last.sellVolume;
    const lastBuyRatio =
        lastTotal > 0 ? (last.buyVolume / lastTotal) * PERCENTAGE_FACTOR : 0;

    return [
        '## Volume Analysis (Buy/Sell)',
        `- Current bar: Buy ${formatVolume(last.buyVolume)} / Sell ${formatVolume(last.sellVolume)} (Buy ratio: ${lastBuyRatio.toFixed(INDICATOR_DECIMAL_PLACES)}%)`,
        `- Last ${recentBuySell.length}-bar cumulative: Buy ${formatVolume(totalBuy)} (${buyRatio.toFixed(INDICATOR_DECIMAL_PLACES)}%) / Sell ${formatVolume(totalSell)} (${sellRatio.toFixed(INDICATOR_DECIMAL_PLACES)}%)`,
    ].join('\n');
};

const trendLabel = (trend: IndicatorTrend | null): string =>
    trend === null ? '' : ` [${trend}]`;

const sqzStateLabel = (r: SqueezeMomentumResult): string => {
    if (r.sqzOn) return 'squeeze ON';
    if (r.sqzOff) return 'squeeze OFF';
    return 'no squeeze';
};

const sqzDirectionLabel = (r: SqueezeMomentumResult): string => {
    if (r.increasing === null) return '';
    return r.increasing ? ' [rising]' : ' [falling]';
};

const countSqueezeDuration = (data: SqueezeMomentumResult[]): number => {
    let count = 0;
    let i = data.length - 1;
    while (i >= 0 && data[i].sqzOn === true) {
        count++;
        i--;
    }
    return count;
};

interface ZeroCross {
    direction: 'bullish_cross' | 'bearish_cross';
    barsAgo: number;
}

const detectZeroCross = (
    data: SqueezeMomentumResult[],
    lookback: number
): ZeroCross | null => {
    const len = data.length;
    const start = Math.max(0, len - lookback);
    for (let i = len - 1; i > start; i--) {
        const curr = data[i].momentum;
        const prev = data[i - 1].momentum;
        if (curr === null || prev === null) continue;
        if (prev <= 0 && curr > 0)
            return { direction: 'bullish_cross', barsAgo: len - 1 - i };
        if (prev >= 0 && curr < 0)
            return { direction: 'bearish_cross', barsAgo: len - 1 - i };
    }
    return null;
};

const formatSqueezeMomentumLine = (
    indicators: IndicatorResult,
    config: PromptConfig
): string => {
    const data = indicators.squeezeMomentum;
    const last = lastOf(data);
    if (!last || last.momentum === null) {
        return `- Squeeze Momentum(BB:${SQUEEZE_MOMENTUM_BB_LENGTH},KC:${SQUEEZE_MOMENTUM_KC_LENGTH},mult:${SQUEEZE_MOMENTUM_KC_MULT}): N/A`;
    }

    const momentumTrend = detectTrend(
        data.map(d => d.momentum),
        config.trendSampleCount
    );
    const duration = countSqueezeDuration(data);
    const durationStr = duration > 0 ? ` / duration: ${duration} bars` : '';
    const cross = detectZeroCross(data, config.squeezeZeroCrossLookback);
    const crossStr =
        cross !== null
            ? ` / ${cross.direction === 'bullish_cross' ? 'bullish' : 'bearish'} zero-cross (${cross.barsAgo} bars ago)`
            : '';

    return `- Squeeze Momentum(BB:${SQUEEZE_MOMENTUM_BB_LENGTH},KC:${SQUEEZE_MOMENTUM_KC_LENGTH},mult:${SQUEEZE_MOMENTUM_KC_MULT}): momentum ${fmt(last.momentum)}${sqzDirectionLabel(last)}${trendLabel(momentumTrend)} / ${sqzStateLabel(last)}${durationStr}${crossStr}`;
};

const barsAgoCount = (index: number, totalBars: number): number =>
    totalBars - 1 - index;

const barsAgo = (index: number, totalBars: number): string =>
    `(${barsAgoCount(index, totalBars)} bars ago)`;

// Equal Highs/Lows differ only by label + liquidity-kind text; share one formatter.
const formatLiquidityLine = (
    label: string,
    liquidityKind: string,
    eq: SMCEqualLevel,
    totalBars: number
): string =>
    `- ${label} at ${fmt(eq.price)} (${liquidityKind}) (${barsAgoCount(eq.secondIndex, totalBars)} bars ago, span ${eq.secondIndex - eq.firstIndex} bars)`;

// When adding a new field to SMCResult, update this check accordingly.
const isSMCEmpty = (smc: SMCResult): boolean =>
    smc.swingHighs.length === 0 &&
    smc.swingLows.length === 0 &&
    smc.structureBreaks.length === 0 &&
    smc.orderBlocks.length === 0 &&
    smc.fairValueGaps.length === 0 &&
    smc.equalHighs.length === 0 &&
    smc.equalLows.length === 0 &&
    smc.premiumZone === null &&
    smc.discountZone === null &&
    smc.equilibriumZone === null;

const formatZoneLine = (zone: SMCZone | null, label: string): string | null =>
    zone !== null ? `- ${label}: ${fmt(zone.low)} ~ ${fmt(zone.high)}` : null;

// Priority: premium > discount > equilibrium (most actionable first).
// Note: premium/discount checks use only one bound (>= low / <= high) intentionally.
// In SMC theory, price above the premium zone is still "premium territory" (overextended),
// and price below the discount zone is still "discount territory". The zone marks a threshold,
// not a boundary — price beyond the far edge remains classified in that territory.
const classifyPriceZone = (
    price: number,
    premium: SMCZone | null,
    discount: SMCZone | null,
    equilibrium: SMCZone | null
): string => {
    if (premium !== null && price >= premium.low) return 'premium';
    if (discount !== null && price <= discount.high) return 'discount';
    if (
        equilibrium !== null &&
        price >= equilibrium.low &&
        price <= equilibrium.high
    )
        return 'equilibrium';
    return 'neutral';
};

const formatSMCSection = (indicators: IndicatorResult, bars: Bar[]): string => {
    const smc = indicators.smc;

    if (isSMCEmpty(smc)) {
        return [
            '## Smart Money Concepts (SMC)',
            '- Insufficient data for SMC analysis',
        ].join('\n');
    }

    const totalBars = bars.length;
    const currentPrice = totalBars > 0 ? bars[totalBars - 1].close : null;

    // 1. Market Structure (BOS / CHoCH)
    const recentBreaks = smc.structureBreaks.slice(-SMC_MAX_STRUCTURE_BREAKS);
    const structureSection =
        recentBreaks.length > 0
            ? [
                  '### Market Structure',
                  ...recentBreaks.map(
                      b =>
                          `- [${b.breakType.toUpperCase()}] ${b.type} at ${fmt(b.price)} ${barsAgo(b.index, totalBars)}`
                  ),
              ]
            : [];

    // 2. Active Order Blocks (unmitigated only)
    const activeOBs = smc.orderBlocks
        .filter(ob => !ob.isMitigated)
        .slice(-SMC_MAX_ORDER_BLOCKS);
    const orderBlockSection = [
        '### Order Blocks',
        ...(activeOBs.length > 0
            ? activeOBs.map(
                  ob =>
                      `- ${ob.type} OB: ${fmt(ob.low)} ~ ${fmt(ob.high)} ${barsAgo(ob.startIndex, totalBars)}`
              )
            : ['- No active order blocks']),
    ];

    // 3. Active Fair Value Gaps (unmitigated only)
    const activeFVGs = smc.fairValueGaps
        .filter(fvg => !fvg.isMitigated)
        .slice(-SMC_MAX_FAIR_VALUE_GAPS);
    const fvgSection = [
        '### Fair Value Gaps',
        ...(activeFVGs.length > 0
            ? activeFVGs.map(
                  fvg =>
                      `- ${fvg.type} FVG: ${fmt(fvg.low)} ~ ${fmt(fvg.high)} ${barsAgo(fvg.index, totalBars)}`
              )
            : ['- No active fair value gaps']),
    ];

    // 4. Equal Highs / Equal Lows (Liquidity Pools)
    const eqHighs = smc.equalHighs.slice(-SMC_MAX_EQUAL_LEVELS);
    const eqLows = smc.equalLows.slice(-SMC_MAX_EQUAL_LEVELS);
    const liquiditySection =
        eqHighs.length > 0 || eqLows.length > 0
            ? [
                  '### Liquidity Pools',
                  ...eqHighs.map(eq =>
                      formatLiquidityLine(
                          'Equal Highs',
                          'sell-side liquidity',
                          eq,
                          totalBars
                      )
                  ),
                  ...eqLows.map(eq =>
                      formatLiquidityLine(
                          'Equal Lows',
                          'buy-side liquidity',
                          eq,
                          totalBars
                      )
                  ),
              ]
            : [];

    // 5. Premium / Discount / Equilibrium Zones
    const premiumLine = formatZoneLine(smc.premiumZone, 'Premium Zone');
    const equilibriumLine = formatZoneLine(
        smc.equilibriumZone,
        'Equilibrium Zone'
    );
    const discountLine = formatZoneLine(smc.discountZone, 'Discount Zone');
    const zoneLines = [premiumLine, equilibriumLine, discountLine].filter(
        (l): l is string => l !== null
    );
    const currentPriceLine =
        currentPrice !== null
            ? [
                  `- Snapshot Price (${fmt(currentPrice)}) is in ${classifyPriceZone(currentPrice, smc.premiumZone, smc.discountZone, smc.equilibriumZone)} zone`,
              ]
            : [];
    const marketZonesSection =
        zoneLines.length > 0
            ? ['### Market Zones', ...zoneLines, ...currentPriceLine]
            : [];

    // 6. Recent Swing Points
    const recentSwingHighs = smc.swingHighs.slice(-SMC_MAX_SWING_POINTS);
    const recentSwingLows = smc.swingLows.slice(-SMC_MAX_SWING_POINTS);
    const swingSection =
        recentSwingHighs.length > 0 || recentSwingLows.length > 0
            ? [
                  `### Swing Points (period: ${SMC_SWING_PERIOD})`,
                  ...recentSwingHighs.map(
                      s =>
                          `- Swing High: ${fmt(s.price)} ${barsAgo(s.index, totalBars)}`
                  ),
                  ...recentSwingLows.map(
                      s =>
                          `- Swing Low: ${fmt(s.price)} ${barsAgo(s.index, totalBars)}`
                  ),
              ]
            : [];

    return [
        '## Smart Money Concepts (SMC)',
        ...structureSection,
        ...orderBlockSection,
        ...fvgSection,
        ...liquiditySection,
        ...marketZonesSection,
        ...swingSection,
    ].join('\n');
};

// ── SMC handling ─────────────────────────────────────────────────────────────
// The full SMC skill guide (~13KB of ICT prose with placeholder example prices)
// is a prime fabrication source for floor models — they copy the example levels
// as if real. It is NEVER injected. The deterministic computed SMC section
// (formatSMCSection) stays as the data anchor; a compressed concept note is
// added only when a structure break is recent enough to be actionable.

/**
 * @internal Recency window (in bars) within which a BOS/CHoCH justifies the SMC
 * note. Exported only so the boundary test reads this exact value.
 */
export const SMC_STRUCTURE_BREAK_RECENCY_BARS = 10;

/**
 * @internal
 * One-line notice marking that the full SMC guide was deliberately withheld and
 * pointing the model at the computed SMC data section as the only valid source.
 */
export const SMC_GUIDE_BLOCKED_NOTICE =
    'SMC note: the full Smart Money Concepts guide is intentionally omitted; use ONLY the levels in the computed ## Smart Money Concepts (SMC) section below — do not infer or invent SMC levels from memory.';

/**
 * @internal
 * Anti-fabrication guardrail propagated to every level-citing section
 * (Fibonacci / support-resistance / pivot). Floor models otherwise invent or
 * recopy plausible-looking price levels; this line forbids it explicitly.
 */
export const ANTI_FABRICATION_GUARDRAIL =
    'Anti-fabrication: cite ONLY price levels that appear verbatim in the data above (computed references, SMC section, bar data). Never invent, round, or recall a level from outside this prompt; if a level is not present, say so rather than fabricating one.';

/**
 * Identifies the SMC full-guide skill (replaced by a compressed concept note),
 * regardless of its gating tier.
 *
 * Prefers the explicit `smcFullGuide` frontmatter flag (`smc_full_guide: true`)
 * so the routing survives a display-name rename. Falls back to name matching for
 * skills authored before the flag existed; the SMC guide should set
 * `smc_full_guide: true` so the stable flag path is taken.
 */
const isSmcGuideSkill = (skill: Skill): boolean => {
    if (skill.smcFullGuide === true) return true;
    const name = skill.name.toLowerCase();
    return name.includes('smart money') || name === 'smc';
};

/**
 * Latest structure break's distance in bars, or null when there is none.
 * Uses the maximum index (most recent break) against the bar count.
 */
const latestStructureBreakBarsAgo = (
    smc: SMCResult,
    totalBars: number
): number | null => {
    if (smc.structureBreaks.length === 0 || totalBars === 0) return null;
    const latestIndex = smc.structureBreaks.reduce(
        (max, b) => Math.max(max, b.index),
        smc.structureBreaks[0].index
    );
    const barsAgo = totalBars - 1 - latestIndex;
    // Defensive: an out-of-range index (e.g. a break index >= totalBars) would
    // yield a negative "bars ago"; treat that as no usable recency signal.
    if (barsAgo < 0) return null;
    return barsAgo;
};

/**
 * Compressed ~5-line SMC concept note, emitted only when the latest BOS/CHoCH
 * occurred within {@link SMC_STRUCTURE_BREAK_RECENCY_BARS} bars. Returns null
 * otherwise (no recent structural shift → no note, to avoid distraction).
 */
const formatSmcConceptNote = (
    indicators: IndicatorResult,
    bars: Bar[]
): string | null => {
    const barsAgo = latestStructureBreakBarsAgo(indicators.smc, bars.length);
    if (barsAgo === null || barsAgo > SMC_STRUCTURE_BREAK_RECENCY_BARS) {
        return null;
    }
    return [
        '## Smart Money Concepts — Concept Note',
        SMC_GUIDE_BLOCKED_NOTICE,
        `- A market-structure break (BOS/CHoCH) printed ${barsAgo} bar(s) ago — structure may be shifting.`,
        '- BOS (break of structure) = trend continuation; CHoCH (change of character) = potential reversal.',
        '- Read the computed SMC levels above as zones to react to, not as guarantees.',
    ].join('\n');
};

const MARKET_REFERENCE_HEADER =
    '## Market Reference (deterministic · advisory)';

const MARKET_REFERENCE_FRAMING =
    'The values below are a deterministic computation of reference levels and structure that market participants commonly watch. They are NOT validated forward predictors — backtesting shows precise level/trend prediction is near-random. Use them as context to weigh alongside detected patterns, skills, and your own reasoning; never treat them as guarantees. You may identify additional or better support/resistance from patterns, SMC, and volume that these references do not cover.';

const EFFICIENCY_DECIMAL_PLACES = 2;

const formatReferenceLevelLine = (level: ReferenceLevel): string =>
    `- ${fmt(level.price)} (${level.label}; ${Math.abs(level.distancePercent).toFixed(INDICATOR_DECIMAL_PLACES)}% away)`;

const HORIZON_LABEL: Record<HorizonKey, string> = {
    short: 'Short-term',
    medium: 'Medium-term',
    long: 'Long-term',
};

// Approximate calendar span each horizon's bar window covers, by timeframe, so
// the model calibrates its vocabulary: "long-term" on a daily chart spans
// quarters, while "long-term" on a 5-minute chart spans only a few sessions.
// Derived from the horizon bar counts (HORIZON_WINDOWS_BY_TIMEFRAME) at ~390
// trading minutes per session.
const HORIZON_SPAN_BY_TIMEFRAME: Record<
    Timeframe,
    Record<HorizonKey, string>
> = {
    '5Min': {
        short: '~2 trading hours',
        medium: '~1 trading day',
        long: '~2-3 trading days',
    },
    '15Min': {
        short: '~1 trading day',
        medium: '~3 trading days',
        long: '~1-2 weeks',
    },
    '30Min': { short: '~2 trading days', medium: '~1 week', long: '~3 weeks' },
    '1Hour': { short: '~4 trading days', medium: '~2 weeks', long: '~6 weeks' },
    '4Hour': { short: '~2-3 weeks', medium: '~2 months', long: '~5 months' },
    '1Day': { short: '~1 month', medium: '~1 quarter', long: '~9-12 months' },
};

const formatHorizonBlock = (
    key: HorizonKey,
    horizon: HorizonReference,
    timeframe: Timeframe
): string => {
    const s = horizon.structure;
    const structureLine =
        `Structure: price ${s.priceVsMA60} MA60 / ${s.priceVsMA200} MA200; EMA ${s.emaStack}; swings ${s.swingStructure}; ` +
        `ADX ${s.adx != null ? s.adx.toFixed(INDICATOR_DECIMAL_PLACES) : 'n/a'}; efficiency ${s.efficiencyRatio != null ? s.efficiencyRatio.toFixed(EFFICIENCY_DECIMAL_PLACES) : 'n/a'}; regime ${s.regime}.`;
    const resistance =
        horizon.levels.resistance.length > 0
            ? [
                  'Resistance (above):',
                  ...horizon.levels.resistance.map(formatReferenceLevelLine),
              ]
            : [];
    const support =
        horizon.levels.support.length > 0
            ? [
                  'Support (below):',
                  ...horizon.levels.support.map(formatReferenceLevelLine),
              ]
            : [];
    return [
        `### ${HORIZON_LABEL[key]} — ${HORIZON_SPAN_BY_TIMEFRAME[timeframe][key]} (${horizon.window.bars} bars)`,
        structureLine,
        ...resistance,
        ...support,
    ].join('\n');
};

const formatMarketReferenceSection = (
    reference: MarketReference,
    timeframe: Timeframe
): string =>
    [
        MARKET_REFERENCE_HEADER,
        MARKET_REFERENCE_FRAMING,
        ANTI_FABRICATION_GUARDRAIL,
        formatHorizonBlock('short', reference.short, timeframe),
        formatHorizonBlock('medium', reference.medium, timeframe),
        formatHorizonBlock('long', reference.long, timeframe),
    ].join('\n');

// ── Pro-indicator measured-reliability annotations ─────────────────────────
// Inline "신뢰도 가중치": each pro-indicator line carries one of these notes so the
// model weights the read by our Phase 2 forward-edge study, NOT textbook
// enthusiasm. The study (2y, look-ahead-safe, 10 large-caps pooled) found
// standalone directional edges ≈ 0 for the advisory layer; Bollinger %B (daily,
// short, with confirmation) is the single modest measured edge; the regime trio
// conditions the directional reads; the volatility pair is risk/measurement.
/**
 * @internal Measured-reliability annotation strings appended to each
 * pro-indicator / regime / volatility line. Exported so tests assert the exact
 * substring rendered (MISTAKES.md Tests #4/#13).
 */
export const PRO_RELIABILITY_NOTE = {
    bollingerPctB:
        '{signal: daily short mean-reversion — modest measured edge; require confirmation}',
    advisory:
        '{advisory: no standalone forward-edge measured — use as confluence/context only}',
    impulse:
        '{permission gate: green = longs only, red = shorts only, blue = both allowed}',
    chandelier: '{risk context: trailing stop / trend regime — not an entry}',
    regime: '{regime lens: weight directional reads by this — trend-follow if trending, fade if mean-reverting}',
    volatility:
        '{risk context: position sizing / stop distance / breakout follow-through}',
} as const;

// Regime classification cut-points. Hurst and Variance Ratio pivot on their
// random-walk centres (HURST_RANDOM_WALK / VR_RANDOM_WALK, shared with the
// gating layer); a symmetric "decisive margin" keeps a read near the centre
// labelled inconclusive instead of forcing a trend/revert call.
/** @internal |H − centre| below this → too close to random to classify. */
const HURST_REGIME_VERDICT_MARGIN = 0.05;
/** @internal |VR − 1| below this → too close to random to classify. */
const VR_REGIME_VERDICT_MARGIN = 0.1;
// Direction-blind R²: high → clean trend. A fixed cut-point is a deliberate
// simplification of the window-scaled critical-R² table (research §10); for the
// default REGRESSION_PERIOD (20) the 95% critical R² ≈ 0.20, so this is a
// conservative "visibly trending" floor, not a significance test.
/** @internal Regression R² above which the fit is treated as a clean trend. */
const REGRESSION_R2_TREND = 0.3;

type RegimeVerdict = 'trending' | 'mean-reverting' | 'random';

const VERDICT_LABEL: Record<RegimeVerdict, string> = {
    trending: 'trending (favour trend-following; do not fade)',
    'mean-reverting':
        'mean-reverting (favour fade/reversion; be wary of breakouts)',
    random: 'near-random (low directional conviction; demand stronger confluence)',
};

// Classify each regime tool into a vote, then combine: any decisive disagreement
// or all-inconclusive → random; otherwise the agreed side. Direction-blind R²
// does not vote on a side — high R² only reinforces an existing trend vote.
const hurstVote = (h: number | null): RegimeVerdict | null => {
    if (h === null) return null;
    if (h - HURST_RANDOM_WALK >= HURST_REGIME_VERDICT_MARGIN) return 'trending';
    if (HURST_RANDOM_WALK - h >= HURST_REGIME_VERDICT_MARGIN)
        return 'mean-reverting';
    return 'random';
};

const varianceRatioVote = (vr: number | null): RegimeVerdict | null => {
    if (vr === null) return null;
    if (vr - VR_RANDOM_WALK >= VR_REGIME_VERDICT_MARGIN) return 'trending';
    if (VR_RANDOM_WALK - vr >= VR_REGIME_VERDICT_MARGIN)
        return 'mean-reverting';
    return 'random';
};

const combineRegimeVerdict = (
    votes: (RegimeVerdict | null)[]
): RegimeVerdict => {
    const decided = votes.filter(
        (v): v is RegimeVerdict => v !== null && v !== 'random'
    );
    if (decided.length === 0) return 'random';
    const allTrending = decided.every(v => v === 'trending');
    const allReverting = decided.every(v => v === 'mean-reverting');
    if (allTrending) return 'trending';
    if (allReverting) return 'mean-reverting';
    // Decisive votes disagree → no coherent regime.
    return 'random';
};

const REGIME_INSUFFICIENT_DATA_LINE =
    '- Regime: insufficient data (regime indicators still in warm-up)';

/**
 * @internal Build the `- Regime: …` line from the latest regime reads. Pulled
 * out of {@link formatRegimeContextSection} (was an inline IIFE) so the
 * trend/mean-revert classification + R² narrative live in one named place.
 * Called only when at least one of Hurst / VR / slope is non-null.
 */
const computeRegimeLine = (
    lastHurst: number | null,
    lastVR: number | null,
    lastSlope: number | null,
    lastR2: number | null
): string => {
    const verdict = combineRegimeVerdict([
        hurstVote(lastHurst),
        varianceRatioVote(lastVR),
    ]);
    const cleanTrend = lastR2 !== null && lastR2 >= REGRESSION_R2_TREND;
    const slopeDir =
        lastSlope === null
            ? ''
            : lastSlope > 0
              ? ', slope up'
              : lastSlope < 0
                ? ', slope down'
                : ', slope flat';
    const r2Note =
        lastR2 === null
            ? ''
            : cleanTrend
              ? ` — R² ${fmt(lastR2)} high (clean directional fit${slopeDir}; significance scales with window)`
              : ` — R² ${fmt(lastR2)} low (choppy / weak linear fit${slopeDir}; significance scales with window)`;
    return `- Regime: Hurst ${fmt(lastHurst)} / Variance Ratio ${fmt(lastVR)}${r2Note} → ${VERDICT_LABEL[verdict]} ${PRO_RELIABILITY_NOTE.regime}`;
};

const formatRegimeContextSection = (
    indicators: IndicatorResult,
    config: PromptConfig
): string => {
    const lastHurst = lastNonNull(indicators.hurst);
    const lastVR = lastNonNull(indicators.varianceRatio);
    const lastRegression = indicators.regression.findLast(
        r => r.slope !== null
    );
    const lastSlope = lastRegression?.slope ?? null;
    const lastR2 = lastRegression?.r2 ?? null;
    const lastYangZhang = lastNonNull(indicators.yangZhang);
    const lastEwma = lastNonNull(indicators.ewmaVolatility);

    const header = '## Market Regime & Risk Context';

    const regimeAllNull =
        lastHurst === null && lastVR === null && lastSlope === null;

    const regimeLine = regimeAllNull
        ? REGIME_INSUFFICIENT_DATA_LINE
        : computeRegimeLine(lastHurst, lastVR, lastSlope, lastR2);

    const volAllNull = lastYangZhang === null && lastEwma === null;
    const yzTrend = detectTrend(indicators.yangZhang, config.trendSampleCount);
    const ewmaTrend = detectTrend(
        indicators.ewmaVolatility,
        config.trendSampleCount
    );
    const volLine = volAllNull
        ? '- Volatility: N/A (volatility estimators still in warm-up)'
        : `- Volatility: Yang-Zhang ${fmt(lastYangZhang)}${trendLabel(yzTrend)} / EWMA ${fmt(lastEwma)}${trendLabel(ewmaTrend)} ${PRO_RELIABILITY_NOTE.volatility}`;

    return [header, regimeLine, volLine].join('\n');
};

// ── Pro-indicator confluence panel ─────────────────────────────────────────
const pctBLabel = (pctB: number | null): string => {
    if (pctB === null) return '';
    if (pctB <= PCTB_OVERSOLD) return ' [oversold — lower-band tag]';
    if (pctB >= PCTB_OVERBOUGHT) return ' [overbought — upper-band tag]';
    return '';
};

const macdVZoneLabel = (value: number | null): string => {
    if (value === null) return '';
    if (value <= MACDV_OVERSOLD) return ' [oversold reset zone]';
    if (value >= MACDV_OVERBOUGHT) return ' [overbought rollover zone]';
    if (value < MACDV_OVERSOLD / MACDV_ZONE_INNER_DIVISOR)
        return ' [strong negative momentum]';
    if (value > MACDV_OVERBOUGHT / MACDV_ZONE_INNER_DIVISOR)
        return ' [strong positive momentum]';
    return value >= 0 ? ' [positive regime]' : ' [negative regime]';
};

const crsiLabel = (value: number | null): string => {
    if (value === null) return '';
    if (value <= CRSI_OVERSOLD) return ' [oversold]';
    if (value >= CRSI_OVERBOUGHT) return ' [overbought]';
    return '';
};

const forceIndexSignLabel = (value: number | null): string => {
    if (value === null) return '';
    if (value > FORCE_INDEX_ZERO) return ' [buying pressure]';
    if (value < FORCE_INDEX_ZERO) return ' [selling pressure]';
    return ' [neutral]';
};

// "Just flipped" = latest color differs from the immediately prior non-null
// color, i.e. a permission change printed on the last bar.
const impulseFlipNote = (colors: (ImpulseColor | null)[]): string => {
    const i = colors.length - 1;
    if (i < 1) return '';
    const cur = colors[i];
    const prev = colors[i - 1];
    if (cur === null || prev === null) return '';
    return cur !== prev ? ` (flipped from ${prev})` : ' (no flip)';
};

const formatBollingerPercentBLine = (indicators: IndicatorResult): string => {
    const last = lastOf(indicators.bollingerDerived);
    if (!last || last.pctB === null) {
        return `- Bollinger %B: N/A ${PRO_RELIABILITY_NOTE.bollingerPctB}`;
    }
    const bandwidthStr =
        last.bandwidth !== null ? ` / BandWidth ${fmt(last.bandwidth)}` : '';
    return `- Bollinger %B: ${fmt(last.pctB)}${bandwidthStr}${pctBLabel(last.pctB)} ${PRO_RELIABILITY_NOTE.bollingerPctB}`;
};

const formatMacdVLine = (
    indicators: IndicatorResult,
    config: PromptConfig
): string => {
    const value = lastNonNull(indicators.macdV);
    if (value === null) {
        return `- MACD-V: N/A ${PRO_RELIABILITY_NOTE.advisory}`;
    }
    const trend = detectTrend(indicators.macdV, config.trendSampleCount);
    return `- MACD-V: ${fmt(value)}${macdVZoneLabel(value)}${trendLabel(trend)} ${PRO_RELIABILITY_NOTE.advisory}`;
};

const formatConnorsRsiLine = (indicators: IndicatorResult): string => {
    const value = lastNonNull(indicators.connorsRsi);
    if (value === null) {
        return `- Connors RSI: N/A ${PRO_RELIABILITY_NOTE.advisory}`;
    }
    return `- Connors RSI: ${fmt(value)}${crsiLabel(value)} ${PRO_RELIABILITY_NOTE.advisory}`;
};

const formatForceIndexLine = (
    indicators: IndicatorResult,
    config: PromptConfig
): string => {
    const value = lastNonNull(indicators.forceIndex);
    if (value === null) {
        return `- Force Index: N/A ${PRO_RELIABILITY_NOTE.advisory}`;
    }
    const trend = detectTrend(indicators.forceIndex, config.trendSampleCount);
    return `- Force Index: ${fmt(value)}${forceIndexSignLabel(value)}${trendLabel(trend)} ${PRO_RELIABILITY_NOTE.advisory}`;
};

const formatElderRayLine = (indicators: IndicatorResult): string => {
    const last = lastOf(indicators.elderRay);
    if (!last || (last.bullPower === null && last.bearPower === null)) {
        return `- Elder-Ray: N/A ${PRO_RELIABILITY_NOTE.advisory}`;
    }
    return `- Elder-Ray: Bull Power ${fmt(last.bullPower)} / Bear Power ${fmt(last.bearPower)} ${PRO_RELIABILITY_NOTE.advisory}`;
};

const formatElderImpulseLine = (indicators: IndicatorResult): string => {
    const colors = indicators.elderImpulse;
    const last = lastOf(colors);
    if (!last) {
        return `- Elder Impulse: N/A ${PRO_RELIABILITY_NOTE.impulse}`;
    }
    return `- Elder Impulse: ${last}${impulseFlipNote(colors)} ${PRO_RELIABILITY_NOTE.impulse}`;
};

const formatChandelierLine = (indicators: IndicatorResult): string => {
    const last = lastOf(indicators.chandelierExit);
    if (!last || last.trend === null) {
        return `- Chandelier Exit: N/A ${PRO_RELIABILITY_NOTE.chandelier}`;
    }
    const activeStop =
        last.trend === 'long'
            ? `long stop ${fmt(last.longStop)}`
            : `short stop ${fmt(last.shortStop)}`;
    return `- Chandelier Exit: ${activeStop} (trend: ${last.trend}) ${PRO_RELIABILITY_NOTE.chandelier}`;
};

const formatProIndicatorSection = (
    indicators: IndicatorResult,
    config: PromptConfig
): string =>
    [
        '## Pro-Indicator Confluence',
        formatBollingerPercentBLine(indicators),
        formatMacdVLine(indicators, config),
        formatConnorsRsiLine(indicators),
        formatForceIndexLine(indicators, config),
        formatElderRayLine(indicators),
        formatElderImpulseLine(indicators),
        formatChandelierLine(indicators),
    ].join('\n');

const formatIndicatorSection = (
    indicators: IndicatorResult,
    config: PromptConfig
): string => {
    const lastRSI = lastNonNull(indicators.rsi);
    const lastMACD = lastOf(indicators.macd);
    const lastBollinger = lastOf(indicators.bollinger);
    const lastDMI = lastOf(indicators.dmi);
    const lastStochastic = lastOf(indicators.stochastic);
    const lastStochRSI = lastOf(indicators.stochRsi);
    const lastCCI = lastNonNull(indicators.cci);
    const lastVWAP = lastNonNull(indicators.vwap);
    const vp = indicators.volumeProfile;
    const lastIchimoku = lastOf(indicators.ichimoku);
    const lastATR = lastNonNull(indicators.atr);
    const lastOBV = lastNonNull(indicators.obv);
    const lastPSAR = lastOf(indicators.parabolicSar);
    const lastWilliamsR = lastNonNull(indicators.williamsR);
    const lastSupertrend = lastOf(indicators.supertrend);
    const lastMFI = lastNonNull(indicators.mfi);
    const lastKeltner = lastOf(indicators.keltnerChannel);
    const lastCMF = lastNonNull(indicators.cmf);
    const lastDonchian = lastOf(indicators.donchianChannel);

    const sampleCount = config.trendSampleCount;
    const rsiTrend = detectTrend(indicators.rsi, sampleCount);
    const cciTrend = detectTrend(indicators.cci, sampleCount);
    const macdTrend = detectTrend(
        indicators.macd.map(m => m.histogram ?? null),
        sampleCount
    );
    const atrTrend = detectTrend(indicators.atr, sampleCount);
    const obvTrend = detectTrend(indicators.obv, sampleCount);
    const mfiTrend = detectTrend(indicators.mfi, sampleCount);
    const cmfTrend = detectTrend(indicators.cmf, sampleCount);

    return [
        '## Indicator Values',
        `- RSI(${RSI_DEFAULT_PERIOD}): ${fmt(lastRSI)}${trendLabel(rsiTrend)}`,
        `- MACD: ${fmt(lastMACD?.macd ?? null)} / Signal ${fmt(lastMACD?.signal ?? null)} / Histogram ${fmt(lastMACD?.histogram ?? null)}${trendLabel(macdTrend)}`,
        `- Bollinger Bands: Upper ${fmt(lastBollinger?.upper ?? null)} / Middle ${fmt(lastBollinger?.middle ?? null)} / Lower ${fmt(lastBollinger?.lower ?? null)}`,
        `- DMI: +DI ${fmt(lastDMI?.diPlus ?? null)} / -DI ${fmt(lastDMI?.diMinus ?? null)} / ADX ${fmt(lastDMI?.adx ?? null)}`,
        `- Stochastic(${STOCHASTIC_K_PERIOD},${STOCHASTIC_D_PERIOD},${STOCHASTIC_SMOOTHING}): %K ${fmt(lastStochastic?.percentK ?? null)} / %D ${fmt(lastStochastic?.percentD ?? null)}`,
        `- StochRSI(${STOCH_RSI_RSI_PERIOD},${STOCH_RSI_STOCH_PERIOD},${STOCH_RSI_K_PERIOD},${STOCH_RSI_D_PERIOD}): K ${fmt(lastStochRSI?.k ?? null)} / D ${fmt(lastStochRSI?.d ?? null)}`,
        `- CCI(${CCI_DEFAULT_PERIOD}): ${fmt(lastCCI)}${trendLabel(cciTrend)}`,
        `- VWAP: ${fmt(lastVWAP)}`,
        `- Volume Profile: POC ${fmt(vp?.poc ?? null)} / VAH ${fmt(vp?.vah ?? null)} / VAL ${fmt(vp?.val ?? null)}`,
        `- MA: ${MA_DEFAULT_PERIODS.map(p => `MA(${p}): ${fmt(lastNonNull(indicators.ma[p] ?? []))}`).join(' / ')}`,
        `- EMA: ${EMA_DEFAULT_PERIODS.map(p => `EMA(${p}): ${fmt(lastNonNull(indicators.ema[p] ?? []))}`).join(' / ')}`,
        `- Ichimoku(${ICHIMOKU_CONVERSION_PERIOD},${ICHIMOKU_BASE_PERIOD},${ICHIMOKU_SPAN_B_PERIOD}): Tenkan ${fmt(lastIchimoku?.tenkan ?? null)} / Kijun ${fmt(lastIchimoku?.kijun ?? null)} / SpanA ${fmt(lastIchimoku?.senkouA ?? null)} / SpanB ${fmt(lastIchimoku?.senkouB ?? null)} / Chikou ${fmt(lastIchimoku?.chikou ?? null)}`,
        `- ATR(${ATR_DEFAULT_PERIOD}): ${fmt(lastATR)}${trendLabel(atrTrend)}`,
        `- OBV: ${lastOBV !== null ? formatVolume(lastOBV) : 'N/A'}${trendLabel(obvTrend)}`,
        `- Parabolic SAR: ${fmt(lastPSAR?.sar ?? null)} (${lastPSAR?.trend ?? 'N/A'})`,
        `- Williams %R(${WILLIAMS_R_DEFAULT_PERIOD}): ${fmt(lastWilliamsR)}`,
        `- Supertrend(${SUPERTREND_ATR_PERIOD},${SUPERTREND_MULTIPLIER}): ${fmt(lastSupertrend?.supertrend ?? null)} (${lastSupertrend?.trend ?? 'N/A'})`,
        `- MFI(${MFI_DEFAULT_PERIOD}): ${fmt(lastMFI)}${trendLabel(mfiTrend)}`,
        `- Keltner Channel(${KELTNER_EMA_PERIOD},${KELTNER_ATR_PERIOD},${KELTNER_MULTIPLIER}): Upper ${fmt(lastKeltner?.upper ?? null)} / Middle ${fmt(lastKeltner?.middle ?? null)} / Lower ${fmt(lastKeltner?.lower ?? null)}`,
        `- CMF(${CMF_DEFAULT_PERIOD}): ${fmt(lastCMF)}${trendLabel(cmfTrend)}`,
        `- Donchian Channel(${DONCHIAN_DEFAULT_PERIOD}): Upper ${fmt(lastDonchian?.upper ?? null)} / Middle ${fmt(lastDonchian?.middle ?? null)} / Lower ${fmt(lastDonchian?.lower ?? null)}`,
        formatSqueezeMomentumLine(indicators, config),
    ].join('\n');
};

const confidenceLabel = (weight: number): string =>
    weight >= HIGH_CONFIDENCE_WEIGHT
        ? '[High Confidence]'
        : '[Medium Confidence]';

const buildSkillBlock = (skill: Skill): string =>
    `### ${skill.name} ${confidenceLabel(skill.confidenceWeight)}\n${skill.content}`;

/**
 * Per-field content guidance for the few AnalysisResponse fields whose unique
 * semantic instruction lives ONLY here. The response schema enforces the
 * structure of every field (names, types, enums, nesting), so a JSON skeleton
 * for the remaining fields is redundant; each of those fields instead has a
 * dedicated `### ... Writing Rules` section (or is pure structure the schema
 * already enforces).
 *
 * The Pick type keeps these entries compile-time synchronized with
 * AnalysisResponse — renaming one of these fields produces a compile error here.
 */
const ANALYSIS_FIELD_GUIDANCE: Record<
    keyof Pick<
        AnalysisResponse,
        'summary' | 'strategyResults' | 'actionRecommendation'
    >,
    string
> = {
    summary:
        'A comprehensive, accessible Korean markdown summary that synthesizes ALL findings (indicators, patterns, volume profile, skills, strategies) into plain language a non-technical user can understand. Instead of stating raw indicator values, explain their practical meaning (e.g., instead of RSI is overbought at 75, say the stock has risen quickly and may be due for a pause). Answer: What is happening with this stock and what does it mean for the investor? Use \\n\\n between paragraphs, and use short bullet lists only when they improve readability.',
    strategyResults:
        "Each entry's summary is Korean markdown text with each **label**: value on its own line, grouped into readable paragraphs using \\n\\n where context changes.",
    actionRecommendation:
        'positionAnalysis: Korean markdown prose explaining current price position vs support/resistance from a long-position perspective, separated into readable paragraphs with \\n\\n. entry: Korean markdown long (buy) entry strategy with specific price ranges, separated into readable paragraphs with \\n\\n. exit: Korean markdown long position exit strategy: take-profit targets and stop-loss price ranges, separated into readable paragraphs with \\n\\n. riskReward: Korean markdown risk-reward ratio for the long position (e.g., stop-loss 3% vs target 9% → risk:reward = 1:3), separated into readable paragraphs with \\n\\n when explanation is more than one sentence.',
};

const ANALYSIS_INTENT_BLOCK = [
    '## Analysis Intent',
    '- Analyze the symbol below using ONLY the provided data. Do not fabricate prices, indicators, or patterns.',
    '- Respond with a single JSON object. Its structure (field names, types, enums, nesting) is enforced by the response schema, so you do not need to restate it. For the fields listed under ## Field Content Guidance, follow the guidance there.',
].join('\n');

const FIELD_GUIDANCE_PREFACE =
    'Use the exact numbers provided above rather than recomputing arithmetic, but treat the Market Reference as advisory context — not a mandate. Follow the content guidance below for the fields that need it:';

const buildFieldGuidanceBody = (): string =>
    [
        '## Field Content Guidance',
        ...Object.entries(ANALYSIS_FIELD_GUIDANCE).map(
            ([key, value]) => `- ${key}: ${value}`
        ),
    ].join('\n');

const ANALYSIS_GUIDELINES = [
    '## Analysis Guidelines',
    '',
    '### Name Field Matching',
    '- skillName, strategyName, and indicatorName MUST exactly match a skill name from Writing Rules below. Copy verbatim — never translate, abbreviate, or use empty strings. Omit the entry if no matching skill exists.',
    '',
    '### Regular Skills Usage',
    '- Skills shown in ## Active Skills are context-only regular skills without a dedicated structured output field.',
    '- Use them only to enrich the summary with additional interpretation or market context when they are relevant.',
    '- Do not create new top-level fields for regular skills, and do not force them into indicatorResults, patternSummaries, strategyResults, candlePatterns, or keyLevels unless another explicit rule already applies.',
    '',
    '### Candle Patterns vs Chart Patterns',
    '- candlePatterns: Only include candle patterns (single/multi candle) detected from bar data. Chart patterns defined in skills/*.md go in patternSummaries.',
    '- patternSummaries: Only include chart patterns defined in skills/*.md. Candle patterns go in candlePatterns.',
    '- For each detected candle pattern, the candlePatterns[].trend field MUST copy the value from the [trend: ...] label in ## Detected Candle Patterns verbatim. Do not re-judge the trend yourself.',
    '',
    '### keyPrices Rules',
    '- keyPrices must only contain actual price levels (numbers that represent a price, e.g. 150.00). Do NOT include bar indices, counts, or any non-price numeric values.',
    '- All label values in keyPrices must be written in Korean (e.g. "상단 추세선", "하단 추세선", "넥라인", "목표가", "손절선"). Never use English or snake_case identifiers.',
    '',
    '### Support/Resistance Assessment',
    '- For keyLevels, you may reuse exact prices from the ## Market Reference section (to avoid arithmetic error) OR derive your own from patterns, SMC, and volume — neither is mandatory. State a brief reason for each level. Do NOT treat reference levels as carrying more conviction merely because they were precomputed; weigh them like any other evidence.',
    `- Check convergence points of moving averages (MA ${MA_DEFAULT_PERIODS.join(',')}, EMA ${EMA_DEFAULT_PERIODS[EMA_SUPPORT_RESISTANCE_SHORT_INDEX]}/${EMA_DEFAULT_PERIODS[EMA_SUPPORT_RESISTANCE_LONG_INDEX]}) first`,
    '- Use Volume Profile levels: POC is the strongest support/resistance, VAH/VAL mark the boundaries of the value area',
    '- Price returning to POC indicates a high-probability reaction zone; breakouts above VAH or below VAL signal potential trend continuation',
    '- Treat high/low of high-volume bars as supply/demand zones',
    '- Reference prior swing highs/lows and Bollinger Band boundaries',
    '- Each level must include a reason',
    '',
    '### Price Target Calculation',
    '- Apply the measured move rule (project pattern height) for detected patterns',
    '- First target: nearest support/resistance; second target: based on pattern measurement',
    '- State the trigger condition (breakout/breakdown reference level) for each scenario',
    '- Strengthen target viability with supporting indicators (RSI extremes, Bollinger Band touch, MACD trend)',
    '- Sort targets by proximity to current price: bullish targets in ascending price order (closest first), bearish targets in descending price order (closest first). Never return targets in arbitrary order.',
    '- Every target MUST include a non-empty basis explaining the rationale (supporting indicator, pattern measurement, swing level, etc.). If a basis cannot be provided, exclude that target entirely instead of returning it with an empty basis.',
    '',
    '### Trendline Detection',
    '- Return 0 to 3 trendlines maximum',
    '- Derive trendlines from the swing points in ## Smart Money Concepts (SMC) and the bar data, reusing their exact time/price values verbatim. Use real swing points as endpoints rather than inventing levels.',
    '- ascending: connect higher lows (at least 2 clear swing low points)',
    '- descending: connect lower highs (at least 2 clear swing high points)',
    '- Use the Unix timestamp values from the provided bar data for the time field. Each bar row begins with [ts:<unix_timestamp>] — copy this exact integer value into the time field. Do not calculate or guess timestamps.',
    '- Only include a trendline when 2 or more clear swing points are identifiable',
    '- If no clear trendlines exist, return an empty array',
    '',
    '### trendlines vs patternLines',
    '- trendlines: Overall price trendlines visible on the full chart (ascending support / descending resistance). These are independent of any specific pattern.',
    '- patternLines (inside patternSummaries): Structural lines that define a specific pattern (e.g. wedge upper/lower boundaries, neckline). These belong to a particular pattern and are rendered as part of that pattern overlay.',
    '- Do not duplicate a trendline in patternLines or vice versa.',
    '',
    // NOTE: Individual indicator interpretation guidelines (ATR, OBV, Parabolic SAR, Supertrend,
    // MFI, Williams %R, Keltner, CMF, Donchian, SMC, Squeeze Momentum) are intentionally omitted here
    // because they are covered by the corresponding indicator_guide skills, which are now injected
    // dynamically via frontmatter gating (selectSkills). When a guide's gating does not fire for the
    // current chart state, its detailed interpretation is simply not in this prompt — that is the
    // intended behavior, not a regression.
    '',
    '### Confluence Assessment',
    '- Confluence = 2+ independent signals pointing the same direction at the same price zone.',
    '- Count confirming signals from different categories: (a) trend indicators, (b) momentum oscillators, (c) volume indicators, (d) pattern detection, (e) SMC/structure levels, (f) support/resistance tools.',
    '- Strong confluence: 3+ categories agree. Moderate: 2 categories. Weak: single indicator.',
    '- State the confluence count in keyLevels reasoning and in the summary.',
    '',
    '### Conflicting Signals',
    '- When indicators give conflicting signals (e.g. RSI overbought but MACD bullish cross), list each signal individually and then state which side has stronger confluence.',
    '- Weight signals by the number of confirming indicators and the strength of each signal.',
    '- Mention the conflict explicitly in the summary so the user understands the mixed picture.',
    '',
    '### Price Reference Naming',
    '- The "Snapshot Price" labels in ## Analysis Snapshot and ## Smart Money Concepts (SMC) represent the bar close at the moment this analysis was captured, not a live market quote.',
    '- In all Korean output fields (summary, actionRecommendation, strategyResults, etc.), refer to this value consistently as "분석 시점 가격" or "분석 당시 종가".',
    '- NEVER call it "현재 가격" or "실시간 가격" — those phrases imply a live market quote, which this analysis does not have.',
    '',
    '### Readable Text Formatting Rules',
    '- All long-form Korean prose fields must be easy to render in a UI without becoming one dense line.',
    '- Use markdown where it improves readability: **short labels**, bullet lists, and compact numbered steps are allowed.',
    '- Use \\n\\n to separate paragraphs when the context changes (trend overview, signal conflict, key levels, risk, conclusion).',
    '- Use single \\n only inside a compact list or between adjacent **label**: value lines.',
    '- Do not join multiple independent ideas with repeated periods in one line. Split them into separate paragraphs or list items.',
    '- Apply these rules to summary, strategyResults[].summary, candlePatterns[].summary, patternSummaries[].summary, and every actionRecommendation text field.',
    '',
    '### Summary Writing Checklist (follow every step)',
    '1. STATE the overall trend direction and strength in plain language.',
    '2. SUMMARIZE key indicator findings — explain practical meaning, not raw values (e.g., "주가가 빠르게 상승하여 단기 조정 가능성이 있습니다" not "RSI is 75").',
    '3. REPORT detected chart/candle patterns and what they typically predict.',
    '4. INCLUDE strategy conclusions — for each strategy in strategyResults, state its finding (e.g., MACD/MA cycle stage, divergence detection result, mean reversion signal, breakout setup, Fibonacci level, Elliott wave position). If a strategy contradicts the dominant trend, explicitly state the conflict.',
    '5. DESCRIBE key support/resistance levels and their significance.',
    '6. ASSESS risk — warning signs and what could go wrong.',
    '7. CONCLUDE: "What is happening with this stock and what does it mean for the investor?"',
    '- Use \\n\\n between topic paragraphs. Never write a single long paragraph.',
    '- Prefer 3 to 5 short paragraphs. Each paragraph should cover one context: trend, signals, levels, risk, investor takeaway.',
    '- If signals conflict, state the mixed picture and which side has stronger confluence.',
    '',
    '### Action Recommendation Decision Tree',
    '- LONG POSITION ONLY. Never generate short (sell) strategies, entry points, stop-loss, or take-profit for short positions.',
    '- actionRecommendation must be consistent with keyLevels and priceTargets. Use those values directly.',
    '- Step 1 — Determine entryRecommendation:',
    '  - "enter": price near support + bullish confluence from 2+ categories + risk level not high',
    '  - "wait": setup forming but not confirmed (approaching key level, awaiting breakout, mixed signals)',
    '  - "avoid": price extended from support, strong resistance overhead, risk high, or bearish confluence dominates',
    '- Step 2 — Compute prices:',
    '  - For "enter" and "wait": entryPrices, stopLoss, and takeProfitPrices are REQUIRED.',
    '  - For "avoid": entryPrices must be [], takeProfitPrices must be [], and stopLoss must be omitted. Do not use null, 0, or made-up placeholder prices.',
    '  - entryPrices: [low, high] range near support. Must match the entry text field exactly.',
    '  - stopLoss: single number below nearest support. Must match the exit text field exactly.',
    '  - takeProfitPrices: ascending order (lowest first). Must match the exit text field exactly.',
    '- Step 3 — Write text fields in plain Korean:',
    '  - positionAnalysis: current price position vs keyLevels (support, resistance, POC)',
    '  - entry: for "enter" and "wait", provide specific long buy price ranges with reasoning. For "avoid", state that no long entry range is valid under the current data and explain why.',
    '  - exit: for "enter" and "wait", provide take-profit targets (referencing priceTargets.bullish / resistance) + stop-loss (referencing support below entry). For "avoid", do not invent exit prices; state that exit planning is not applicable without a valid long entry.',
    '  - riskReward: for "enter" and "wait", provide a ratio calculation (e.g., "손절 3% vs 목표 9% → 위험:보상 = 1:3"). For "avoid", state that risk/reward cannot be calculated because there is no valid long setup.',
    '- Step 3 formatting: each actionRecommendation text field must be readable markdown Korean. Use \\n\\n between context paragraphs, and use bullet lists for multiple prices or conditions.',
    '- Consistency: entryPrices, stopLoss, takeProfitPrices must numerically match the text in entry/exit fields — they are the same prices in structured form for chart rendering.',
    '',
    '### Insufficient Data',
    '- If bar data is too short to reliably calculate an indicator or detect a pattern, state "데이터 부족" rather than guessing.',
    '- Do not fabricate support/resistance levels or patterns when the data does not clearly support them.',
].join('\n');

const CRITICAL_RESPONSE_RULES = [
    '',
    '### Critical Response Rules',
    '- For optional object fields (poc in keyLevels, actionRecommendation), provide an object that follows the field rules or omit the field entirely. Never set the object itself to null.',
    '- Unix timestamp values must be copied verbatim from the [ts:<number>] markers in the bar data.',
].join('\n');

const buildAnalysisRequest = (
    patternSkills: Skill[],
    strategySkills: Skill[],
    indicatorGuideSkills: Skill[],
    candlestickSkills: Skill[],
    supportResistanceSkills: Skill[],
    regularSkills: Skill[]
): string => {
    const patternListInstruction =
        patternSkills.length > 0
            ? [
                  '',
                  '### patternSummaries Writing Rules',
                  '- patternSummaries must include detection results for **every** Skills pattern listed below.',
                  '- For each Skills pattern, assess whether it is detected in the current chart data and set the detected value accordingly.',
                  '- Patterns that are not detected must still be included with detected: false.',
                  '- **Do not include any patterns not listed below in patternSummaries.**',
                  '- **Do not include candle patterns (single/multi candle) in patternSummaries.** Candle patterns belong only in candlePatterns.',
                  '- skillName: follow the Name Field Matching rule in ## Analysis Guidelines. It MUST exactly match one of the pattern skill names from the list below.',
                  '- The trend field is REQUIRED for every patternSummaries entry, including entries where detected is false. For not-detected patterns, use the pattern\'s inherent directional bias (e.g., head-and-shoulders → bearish, inverse head-and-shoulders → bullish, ascending wedge → bearish, descending wedge → bullish, double top → bearish, double bottom → bullish). Use "neutral" only when the pattern has no inherent bias. NEVER omit the trend field.',
                  '',
                  '### patternLines Writing Rules',
                  '- patternLines is an optional field. Include it only when detected: true and the pattern has diagonal trendlines (e.g., wedge upper/lower trendlines, neckline).',
                  '- Each entry must have: label (Korean, e.g. "상단 추세선", "하단 추세선", "넥라인"), start { time, price }, end { time, price }.',
                  '- For time values: each bar row begins with [ts:<unix_timestamp>] — copy this exact integer value. Do not calculate or guess.',
                  '- For wedge patterns (ascending/descending): include upper trendline and lower trendline as two separate entries.',
                  '- For head-and-shoulders / double-top / double-bottom: include the neckline as one entry.',
                  '- start and end should span the full visible range of the pattern (from the first swing point to the most recent touch).',
                  '- If no clear trendlines can be identified, omit patternLines entirely.',
                  '',
                  'Skills pattern list to analyze:',
                  ...patternSkills.map(s => `- ${s.name}`),
              ].join('\n')
            : '';

    const strategyInstruction =
        strategySkills.length > 0
            ? [
                  '',
                  '### strategyResults Writing Rules for Strategy Skills',
                  '- For each strategy skill listed below, include exactly one entry in strategyResults.',
                  "- Follow the summary format specified in each strategy skill's ## AI Analysis Instructions section.",
                  '- The summary field must use the structured markdown format with **label**: value lines.',
                  '- Put each **label**: value item on its own line. When moving from status/inputs to interpretation/trading implication, insert \\n\\n.',
                  '- Never return strategyResults[].summary as one sentence containing many "**label**:" fragments separated only by periods.',
                  '- REQUIRED FIELDS (never omit any):',
                  '  1. strategyName: follow the Name Field Matching rule in ## Analysis Guidelines. It MUST exactly match one strategy skill name from the list below.',
                  '  2. trend: one of "bullish", "bearish", "neutral". Set based on the skill\'s own analysis instructions. NEVER omit this field — if the analysis is inconclusive, use "neutral".',
                  "  3. summary: non-empty Korean markdown text following the skill's format.",
                  '',
                  'Strategy skill list to analyze:',
                  ...strategySkills.map(s => `- ${s.name}`),
              ].join('\n')
            : '';

    const indicatorGuideInstruction =
        indicatorGuideSkills.length > 0
            ? [
                  '',
                  '### indicatorResults Writing Rules for Indicator Guides',
                  '- Use the Indicator Signal Guides above to interpret the current indicator values in ## Indicator Values.',
                  '- For each indicator guide, evaluate whether the current values meet any signal condition described in its Signal Interpretation section.',
                  '- For every detected signal, add one entry to the indicatorResults array in the following exact format:',
                  '    { "indicatorName": "<exact skill name from the list below>", "signals": [{ "type": "skill", "description": "<Korean explanation>", "strength": "moderate", "trend": "neutral" }] }',
                  '- CRITICAL RULES (never violate):',
                  '  1. indicatorName: follow the Name Field Matching rule in ## Analysis Guidelines. It MUST be a non-empty string — never use an empty string, a translated name, or a generic label.',
                  '  2. Each indicatorResults entry corresponds to EXACTLY ONE indicator guide. Never combine multiple indicators (e.g., "MACD and Bollinger") into one entry. Create separate entries for separate indicators.',
                  '  3. The type field of each signal entry MUST be "skill". Never use any other value.',
                  '  4. The description field MUST be written in Korean and MUST include the indicator name and specific numeric condition (e.g., "RSI 72.5 — 과매수 임계선에 근접, 단기 조정 가능").',
                  '- Signal strength calibration:',
                  '  - strong: value is in an extreme zone (e.g., RSI > 80 or < 20, Stochastic > 90 or < 10, CCI > +200 or < -200) OR multiple indicators confirm the same direction with high confluence',
                  '  - moderate: value is in a standard overbought/oversold zone (e.g., RSI 70–80, Stochastic 80–90, CCI ±100–200) with single-indicator confirmation',
                  '  - weak: value is approaching a threshold but has not yet crossed, or the signal conflicts with the prevailing trend',
                  '- Signal trend assignment:',
                  '  - bullish: the indicator signal suggests upward price movement (e.g., RSI recovering from oversold, MACD golden cross, price above key moving average)',
                  '  - bearish: the indicator signal suggests downward price movement (e.g., RSI entering overbought, MACD death cross, price below key moving average)',
                  '  - neutral: the indicator is in a range-bound or indeterminate state with no clear directional bias',
                  '- When the Key Combinations section of a guide identifies a multi-indicator confluence that is currently active, increase the strength by one level AND note the confluence in the description field.',
                  "- Respect each guide's Caveats section: do not generate a signal if the caveats indicate it would be unreliable in the current market context (e.g., Stochastic overbought in a strong uptrend with ADX > 25 should not automatically produce a bearish signal).",
                  '- If no signal conditions are met for a given indicator guide, simply omit that guide from indicatorResults. Do not create placeholder or empty entries.',
                  '',
                  'Indicator guide list (use these exact names for indicatorName):',
                  ...indicatorGuideSkills.map(s => `- ${s.name}`),
              ].join('\n')
            : '';

    const candlestickInstruction =
        candlestickSkills.length > 0
            ? [
                  '',
                  '### candlePatterns Writing Rules for Candlestick Skills',
                  '- Use the Candlestick Pattern Guides above to interpret the candle patterns detected in ## Detected Candle Patterns.',
                  '- For each detected candle pattern, evaluate the trend context, confirmation signals, and statistical reliability as described in the matching guide.',
                  '- When a pattern matches a guide, enrich the candlePatterns entry with the guide insights: trend context validity, volume confirmation, and recommended indicator cross-checks.',
                  '- The summary field of each candlePatterns entry must include the guide-informed interpretation, not just pattern name repetition.',
                  '- The trend field MUST use the value provided in the [trend: ...] label of ## Detected Candle Patterns. Do not re-judge or override it.',
                  '- If a detected pattern appears in a sideways/range-bound market context and the guide warns about reduced reliability, note this explicitly in the summary.',
                  '',
                  'Candlestick pattern guide list to apply:',
                  ...candlestickSkills.map(s => `- ${s.name}`),
              ].join('\n')
            : '';

    const supportResistanceInstruction =
        supportResistanceSkills.length > 0
            ? [
                  '',
                  '### keyLevels Writing Rules for Support/Resistance Tools',
                  '- Use the Support/Resistance Tool Guides above to INTERPRET the levels in the ## Market Reference section — use the exact provided numbers; do not recompute the pivot/Fibonacci arithmetic yourself.',
                  '- The reference pivot and Fibonacci levels are advisory context, not a mandate. When relevant, assess which levels the current price is nearest to and which are acting as support or resistance.',
                  '- For Fibonacci Extension levels, consider them for take-profit assessment when they fit your read of the chart.',
                  '- You may add reference pivot/Fibonacci levels to the keyLevels field as support/resistance entries with their basis (e.g. "Standard pivot R1", "Fib 61.8% retracement") as the reason — or derive your own from patterns, SMC, and volume.',
                  '- When a Fibonacci level or pivot point converges with an existing indicator-based support/resistance level, note the confluence in the reason field as one piece of supporting evidence.',
                  '- Include relevant support/resistance tool findings in the summary field, explaining their practical meaning for the investor.',
                  '',
                  'Support/Resistance tool list to apply:',
                  ...supportResistanceSkills.map(s => `- ${s.name}`),
              ].join('\n')
            : '';

    const regularSkillInstruction =
        regularSkills.length > 0
            ? [
                  '',
                  '### Active Skills Writing Rules',
                  '- The skills listed below are regular context skills.',
                  '- Reflect relevant insights from these skills in the summary only.',
                  '- Do not create separate structured entries or new fields for them.',
                  '',
                  'Active skill list to consider for summary enrichment:',
                  ...regularSkills.map(s => `- ${s.name}`),
              ].join('\n')
            : '';

    return [
        '## Analysis Request',
        CRITICAL_RESPONSE_RULES,
        'Based on the data above, perform technical analysis and respond with a single JSON object. The response structure is enforced by the schema; follow the field content guidance below for the fields that need it. Respond in Korean.',
        FIELD_GUIDANCE_PREFACE,
        buildFieldGuidanceBody(),
        indicatorGuideInstruction,
        patternListInstruction,
        strategyInstruction,
        candlestickInstruction,
        supportResistanceInstruction,
        regularSkillInstruction,
    ]
        .filter(s => s !== '')
        .join('\n');
};

// ── ATR-extreme sizing note (Tier-0 conditional promotion) ──────────────────
// When realized volatility is extreme, position-sizing context must never be
// dropped — even if the gated sizing guide did not fire. The threshold is
// timeframe-aware: a 6% daily ATR is extreme, but intraday bars routinely show
// 2%+ ATR, so the intraday bar is lower.
/** @internal Exported only so the boundary test reads this exact threshold. */
export const ATR_EXTREME_PERCENT_DAILY = 6;
const ATR_EXTREME_PERCENT_INTRADAY = 2;
const DAILY_TIMEFRAME: Timeframe = '1Day';

const atrExtremeThreshold = (timeframe: Timeframe): number =>
    timeframe === DAILY_TIMEFRAME
        ? ATR_EXTREME_PERCENT_DAILY
        : ATR_EXTREME_PERCENT_INTRADAY;

const ATR_EXTREME_SIZING_NOTE = [
    '## Extreme Volatility — Position Sizing',
    '- Realized volatility (ATR) is extreme for this timeframe. Size positions conservatively: widen stops to the ATR range, reduce position size so a single ATR move stays within risk tolerance, and avoid market entries into the volatility spike.',
].join('\n');

/**
 * Pattern names of every candle formation detected in the recent window — the
 * candle equivalent of a signal event, used by {@link selectSkills} to gate
 * candle guides. Includes all detected entries (not just the last two shown in
 * the prompt) so a guide gates on its candle's presence anywhere in the window.
 */
const collectDetectedCandleNames = (
    entries: CandlePatternEntry[]
): string[] => {
    const names = entries
        .map(entry =>
            entry.patternType === 'multi'
                ? entry.multiPattern
                : entry.singlePattern
        )
        .filter((name): name is NonNullable<typeof name> => name !== null);
    return [...new Set<string>(names)];
};

/** Build the pure, read-only selection context from data already in scope. */
const buildSkillSelectionContext = (
    bars: Bar[],
    indicators: IndicatorResult,
    timeframe: Timeframe,
    candleEntries: CandlePatternEntry[]
): SkillSelectionContext => {
    const price = bars.length > 0 ? bars[bars.length - 1].close : 0;
    const atr = lastNonNull(indicators.atr);
    const atrPercent =
        price > 0 && atr !== null ? (atr / price) * PERCENTAGE_FACTOR : 0;
    return {
        indicators,
        signals: detectSignals(bars, indicators),
        timeframe,
        detectedCandles: collectDetectedCandleNames(candleEntries),
        price,
        atrPercent,
    };
};

/**
 * @internal Builds the technical-analysis LLM prompt; used by submit use-cases.
 *
 * Build the AI analysis prompt for a single symbol from bars, indicators, and skills.
 *
 * Composes a fully-rendered English prompt that the worker LLM consumes to
 * produce an `AnalysisResponse`. Sections include analysis snapshot,
 * long-term context, recent bars with detected candle patterns, buy / sell
 * volume split, every indicator value with timeframe-aware trend labels,
 * market reference (deterministic advisory levels and structure per horizon),
 * SMC structure, and per-skill writing rules.
 *
 * Skills are dynamically gated by {@link selectSkills}: only those whose
 * frontmatter `gating` fires for this chart's state (detected signals, textbook
 * indicator states, detected candles) are injected; untagged skills fail open
 * (always included). Selected skills are name-sorted and grouped by `type`
 * (pattern, strategy, indicator_guide, candlestick, support_resistance,
 * regular). When ATR% is extreme for the timeframe, an always-on position-sizing
 * note is appended. The number of trend samples and recent bars varies per
 * `timeframe` via `PROMPT_CONFIG_BY_TIMEFRAME`.
 *
 * @param symbol - U.S. equity ticker (e.g. `"AAPL"`).
 * @param companyName - Full English company name (e.g. `"Apple Inc."`).
 * @param bars - OHLCV bars sorted oldest-first.
 * @param indicators - Indicator suite produced by {@link calculateIndicators}.
 * @param skills - Skill definitions to inject (defaults to none).
 * @param timeframe - Bar resolution; controls trend window sizing. Defaults to `"1Day"`.
 * @param fearGreed - Optional Fear & Greed snapshot. When provided, a "Fear & Greed Index (Reference)" section is appended.
 * @returns The fully-rendered prompt string.
 *
 * @see calculateIndicators
 * @see enrichAnalysisWithConfidence
 */
export function buildAnalysisPrompt(
    symbol: string,
    companyName: string,
    bars: Bar[],
    indicators: IndicatorResult,
    skills: Skill[] = [],
    timeframe: Timeframe = '1Day',
    fearGreed?: FearGreedSnapshot
): string {
    // Detect candle patterns once and thread the result to every consumer
    // (skill-selection gating + the recent-bars section) so the expensive
    // detection pass runs a single time per prompt build.
    const candleEntries = detectCandlePatternEntries(bars);

    // Dynamic gating (chart only): inject only the skills whose frontmatter
    // gating fires for this chart's state. Untagged skills fail open (included).
    // selectSkills already returns a name-sorted copy, so the static byName
    // sort is no longer needed here.
    const selectionContext = buildSkillSelectionContext(
        bars,
        indicators,
        timeframe,
        candleEntries
    );
    // The SMC full guide is never injected (fabrication source); it is replaced
    // by the deterministic SMC data section + a compressed concept note. Drop it
    // regardless of its gating tier before bucketing.
    const activeSkills = selectSkills(skills, selectionContext).filter(
        skill => !isSmcGuideSkill(skill)
    );

    const skillGroups: Record<SkillGroupKey, Skill[]> = {
        pattern: [],
        strategy: [],
        indicator_guide: [],
        candlestick: [],
        support_resistance: [],
        regular: [],
    };
    for (const skill of activeSkills) {
        const key: SkillGroupKey = skill.type ?? 'regular';
        skillGroups[key].push(skill);
    }
    const patternSkills = skillGroups.pattern;
    const strategySkills = skillGroups.strategy;
    const indicatorGuideSkills = skillGroups.indicator_guide;
    const candlestickSkills = skillGroups.candlestick;
    const supportResistanceSkills = skillGroups.support_resistance;
    const regularSkills = skillGroups.regular;

    const config = PROMPT_CONFIG_BY_TIMEFRAME[timeframe];

    const marketReference = computeMarketReference(bars, indicators, timeframe);
    const smcConceptNote = formatSmcConceptNote(indicators, bars);

    const sections = [
        `Symbol: ${symbol}\nCompany: ${companyName}`,
        `Timeframe: ${TIMEFRAME_LABEL[timeframe]}\nTimeframe interpretation: ${TIMEFRAME_CONTEXT[timeframe]}`,
        ANALYSIS_INTENT_BLOCK,
        ANALYSIS_GUIDELINES,
        formatMarketSection(bars),
        formatLongTermContext(bars),
        formatRecentBarsSection(bars, config.recentBarsCount, candleEntries),
        formatBuySellVolumeSection(indicators, config.recentBarsCount),
        formatRegimeContextSection(indicators, config),
        formatIndicatorSection(indicators, config),
        formatProIndicatorSection(indicators, config),
        formatSMCSection(indicators, bars),
        ...(smcConceptNote !== null ? [smcConceptNote] : []),
        formatMarketReferenceSection(marketReference, timeframe),
        ...(indicatorGuideSkills.length > 0
            ? [
                  `## Indicator Signal Guides\n${indicatorGuideSkills.map(buildSkillBlock).join('\n\n')}`,
              ]
            : []),
        ...(patternSkills.length > 0
            ? [
                  `## Pattern Analysis\n${patternSkills.map(buildSkillBlock).join('\n\n')}`,
              ]
            : []),
        ...(candlestickSkills.length > 0
            ? [
                  `## Candlestick Pattern Guides\n${candlestickSkills.map(buildSkillBlock).join('\n\n')}`,
              ]
            : []),
        ...(supportResistanceSkills.length > 0
            ? [
                  `## Support/Resistance Tool Guides\n${supportResistanceSkills.map(buildSkillBlock).join('\n\n')}`,
              ]
            : []),
        ...(strategySkills.length > 0
            ? [
                  `## Strategy Analysis\n${strategySkills.map(buildSkillBlock).join('\n\n')}`,
              ]
            : []),
        ...(regularSkills.length > 0
            ? [
                  `## Active Skills\n${regularSkills.map(buildSkillBlock).join('\n\n')}`,
              ]
            : []),
        ...(selectionContext.atrPercent >= atrExtremeThreshold(timeframe)
            ? [ATR_EXTREME_SIZING_NOTE]
            : []),
        ...(fearGreed ? [formatFearGreedSection(fearGreed)] : []),
        buildAnalysisRequest(
            patternSkills,
            strategySkills,
            indicatorGuideSkills,
            candlestickSkills,
            supportResistanceSkills,
            regularSkills
        ),
    ];

    return sections.join('\n\n');
}
