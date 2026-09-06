// All AI-facing prompt strings must be in English — Korean reduces analysis quality.

import {
    DEFAULT_ANALYSIS_LOCALE,
    outputLanguageName,
    type AnalysisLocale,
} from './outputLocale';
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
    REGRESSION_R2_SIGNIFICANT,
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
import { confidenceLabel, roleLabel } from '@/domain/analysis/confidenceLevel';
import { detectSignals } from '@/domain/signals';
import { screenChartPatterns } from '@/domain/patterns';
import type {
    AnalysisResponse,
    AssembledPrompt,
    AssetClass,
    Bar,
    CandlePatternEntry,
    ChartPatternId,
    FearGreedSnapshot,
    HorizonKey,
    HorizonReference,
    ImpulseColor,
    IndicatorResult,
    MarketEvent,
    MarketReference,
    PositionBucket,
    PriorAnalysis,
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
import { formatDeterministicMetricsSection } from '@/domain/analysis/confluenceSection';
import { computeMarketReference } from '@/domain/analysis/marketReference';
import { lastOf } from '@/domain/analysis/analysisUtils';
import { formatFearGreedSection } from '@/domain/analysis/fearGreedSection';
import { formatPositionHintSection } from '@/domain/analysis/positionHintSection';
import { selectPriorAnalyses } from '@/domain/analysis/priorAnalysis';
import { formatMarketEventsSection } from '@/domain/analysis/marketEventsSection';
import { formatPriorAnalysisSection } from '@/domain/analysis/priorAnalysisSection';
import {
    formatBarDateTime,
    formatNullableNumber,
    TIMEFRAME_LABEL,
} from '@/domain/analysis/promptFormat';

type SkillGroupKey = SkillType | 'regular';

const INDICATOR_DECIMAL_PLACES = 2;
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
    const datetime = formatBarDateTime(bar.time * MS_PER_SECOND);
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

// Design C (skills-to-system split): only the always_on skill digests move to
// the byte-stable prefix. ANTI_FABRICATION_GUARDRAIL carries no symbol/skill
// content and would be cacheable in isolation, but restoring it to its
// original production position (inline, once, right after the framing
// sentence) keeps `dynamic` a faithful reproduction of the v0.31 section
// order rather than introducing a new standalone stable line.
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
/**
 * @internal |H − centre| below this → too close to random to classify.
 * Intentionally looser than `skillGatingPredicates.ts`'s `HURST_DECISIVE_MARGIN`
 * (0.1): prompt classification labels are more permissive than the skill-gating
 * threshold.
 */
const HURST_REGIME_VERDICT_MARGIN = 0.05;
/**
 * @internal |VR − 1| below this → too close to random to classify.
 * Intentionally looser than `skillGatingPredicates.ts`'s `VR_DECISIVE_MARGIN`
 * (0.2): prompt classification labels are more permissive than the skill-gating
 * threshold.
 */
const VR_REGIME_VERDICT_MARGIN = 0.1;
// Direction-blind R²: high → clean trend. The "visibly trending" floor uses the
// shared REGRESSION_R2_SIGNIFICANT (domain/indicators/constants.ts) so the prompt
// narrative and the skill gate never drift apart; see its JSDoc for the
// window-scaled critical-R² rationale (research §10).

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

/** @internal Section header — exported so tests reference the exact string (MISTAKES.md Tests #4). */
export const REGIME_CONTEXT_SECTION_HEADER = '## Market Regime & Risk Context';
/** @internal Section header — exported so tests reference the exact string. */
export const INDICATOR_VALUES_SECTION_HEADER = '## Indicator Values';
/** @internal Section header — exported so tests reference the exact string. */
export const PRO_INDICATOR_SECTION_HEADER = '## Pro-Indicator Confluence';

const REGIME_INSUFFICIENT_DATA_LINE =
    '- Regime: insufficient data (regime indicators still in warm-up)';

/**
 * @internal Build the `- Regime: …` line from the latest regime reads. Pulled
 * out of {@link formatRegimeContextSection} (was an inline IIFE) so the
 * trend/mean-revert classification + R² narrative live in one named place.
 * Called only when at least one of Hurst / VR (the verdict voters) is non-null.
 */
/** @internal Directional suffix for the R² narrative from a regression slope. */
const slopeDirLabel = (slope: number | null): string => {
    if (slope === null) return '';
    if (slope > 0) return ', slope up';
    if (slope < 0) return ', slope down';
    return ', slope flat';
};

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
    const cleanTrend = lastR2 !== null && lastR2 >= REGRESSION_R2_SIGNIFICANT;
    const slopeDir = slopeDirLabel(lastSlope);
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

    const header = REGIME_CONTEXT_SECTION_HEADER;

    // Only Hurst + VR vote on the verdict; slope/R² merely annotate it. So when
    // both voters are null, the verdict is undefined regardless of slope — render
    // "insufficient data" instead of a spurious near-random call from slope alone.
    const regimeAllNull = lastHurst === null && lastVR === null;

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

// "Just flipped" = latest color differs from the previous *coloured* bar (nulls
// skipped), i.e. a permission change printed on the last bar. Skipping nulls
// mirrors the gating layer's `elderImpulseLevelNotable`, so both layers compare
// against the same "previous coloured bar".
const impulseFlipNote = (colors: (ImpulseColor | null)[]): string => {
    const lastIdx = colors.length - 1;
    if (lastIdx < 1) return '';
    const cur = colors[lastIdx];
    if (cur === null) return '';
    const prev = colors.findLast((c, i) => c !== null && i < lastIdx) ?? null;
    if (prev === null) return '';
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
        PRO_INDICATOR_SECTION_HEADER,
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
        INDICATOR_VALUES_SECTION_HEADER,
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

const buildSkillBlock = (skill: Skill): string => {
    const roles =
        skill.type === 'indicator_guide' ? roleLabel(skill.usageRoles) : '';
    return `### ${skill.name} ${confidenceLabel(skill.confidenceWeight)}${roles}\n${skill.content}`;
};

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
    '- Respond with a single JSON object. The response schema defines its structure (field names, types, enums, nesting) — follow it. A few critical field and enum requirements are additionally restated explicitly below; those MUST be honored regardless. For the fields listed under ## Field Content Guidance, follow the guidance there.',
].join('\n');

// "provided above" — the Analysis Request preamble (this preface included)
// lives at the END of `dynamic` (spec §3.4 / instruction-sandwiching fix), a
// tail position after every per-call data section (indicators, SMC, Market
// Reference), so a spatial "above" is accurate again.
const FIELD_GUIDANCE_PREFACE =
    'Use the exact numbers provided above rather than recomputing arithmetic, but treat the Market Reference as advisory context — not a mandate. Follow the content guidance below for the fields that need it:';

const buildFieldGuidanceBody = (): string =>
    [
        '## Field Content Guidance',
        ...Object.entries(ANALYSIS_FIELD_GUIDANCE).map(
            ([key, value]) => `- ${key}: ${value}`
        ),
    ].join('\n');

/**
 * 분석 가이드라인. **세 줄이 출력 언어에 묶여 있다** — keyPrices 라벨 언어와
 * Step 3의 산문 언어 지시다. 프롬프트 말미 리마인더는 "필드 설명"을 덮으려고
 * 만든 것이라, 이렇게 과업 규칙으로 적힌 지시까지 뒤집는다고 볼 수 없다
 * (같은 이유로 `Respond in ...` 한 줄과 한자 규칙도 소스에서 직접 갈랐다).
 */
const analysisGuidelines = (locale: AnalysisLocale): string =>
    [
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
        locale === DEFAULT_ANALYSIS_LOCALE
            ? '- All label values in keyPrices must be written in Korean (e.g. "상단 추세선", "하단 추세선", "넥라인", "목표가", "손절선"). Never use English or snake_case identifiers.'
            : `- All label values in keyPrices must be written in ${outputLanguageName(locale)} (e.g. an upper trendline, a neckline, a target price, a stop-loss level). Never use snake_case identifiers.`,
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
        '- The indicator tally in ## Deterministic Metrics is computed by a rule engine, not by you. Do not recount it, restate it with a different number, or substitute your own category count.',
        '- Cite its signal list as the evidence in keyLevels reasoning and in the summary — name the signals, not just the score.',
        '- The engine covers indicator crosses and flips only. Pattern detection, SMC structure, and support/resistance are yours to judge. When they agree with the engine, say the confluence is corroborated beyond the indicators; when they disagree, treat it as a conflict and follow ### Conflicting Signals.',
        '- When ## Deterministic Metrics reports the tally as not measurable, judge the indicators yourself and say in the summary that the rule engine abstained.',
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
        '  - Before settling on "enter", check the structural risk:reward in ## Deterministic Metrics. A ratio below 1.0 means the nearest obstacle above is closer than the support below; prefer "wait" with a named pullback level over "enter", and say which number drove the choice. A met confluence entry rule does not override this — the two were measured to be inversely related.',
        '- Contingent Plan Mandate: even when entryRecommendation is "wait" or "avoid", ALWAYS derive a CONTINGENT plan from the nearest meaningful keyLevels — conditional entry zone(s), stop-loss reference, take-profit target(s), and a risk:reward estimate — clearly framed as conditional on the stated trigger (e.g. "if price reclaims X with volume"). Never leave entryPrices, stopLoss, or takeProfitPrices empty when keyLevels exist; an "avoid" verdict changes the framing, not the obligation to map levels into a plan. Ground every number: use ONLY price levels that already appear in keyLevels or the provided market data — never invent or extrapolate a level to satisfy this mandate. If a component genuinely has no supporting level (e.g. no meaningful resistance above), state explicitly which component lacks data instead of fabricating one; an honest gap beats an invented number.',
        '- Step 2 — Compute prices:',
        '  - entryPrices, stopLoss, and takeProfitPrices are REQUIRED for "enter", "wait", and "avoid" alike, whenever a supporting keyLevels/priceTargets value exists. Do not use null, 0, or made-up placeholder prices — every price must trace back to a stated keyLevels/priceTargets value. If no such value exists for a component, do not fabricate one — state the gap explicitly in the matching text field instead (see Contingent Plan Mandate).',
        '  - entryPrices: [low, high] range near support — the actionable zone for "enter"/"wait", or the contingent trigger zone for "avoid". Must match the entry text field exactly.',
        '  - stopLoss: single number below nearest support (real or contingent). Must match the exit text field exactly.',
        '  - takeProfitPrices: ascending order (lowest first). Must match the exit text field exactly.',
        `- Step 3 — Write text fields in plain ${outputLanguageName(locale)}:`,
        '  - positionAnalysis: current price position vs keyLevels (support, resistance, POC)',
        '  - entry: for "enter" and "wait", provide specific long buy price ranges with reasoning. For "avoid", state the conditional trigger explicitly (e.g. "OO 저항선을 거래량 동반 돌파 시") and give the contingent entry range tied to that trigger, using only a trigger level that is actually present in keyLevels — if none exists, say so instead of inventing one.',
        '  - exit: for all three, provide take-profit targets (referencing priceTargets.bullish / resistance) + stop-loss (referencing support below entry); for "avoid" frame these as applying once the contingent entry triggers. If a required reference level is missing from keyLevels/priceTargets, state that gap rather than guessing a number.',
        '  - riskReward: for all three, provide a ratio calculation (e.g., "손절 3% vs 목표 9% → 위험:보상 = 1:3") based on the (contingent) entry/exit prices for "avoid"; skip the ratio and note the missing input if entry/exit prices could not be grounded.',
        `- Step 3 formatting: each actionRecommendation text field must be readable markdown in ${outputLanguageName(locale)}. Use \\n\\n between context paragraphs, and use bullet lists for multiple prices or conditions.`,
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

/**
 * Full "## Analysis Request" section — the request header, the
 * critical-response rules, the generic ask sentence, the (fully static,
 * catalog-only) field content guidance, AND the per-type writing-rule
 * instructions (patternSummaries / strategyResults / indicatorResults /
 * candlePatterns / keyLevels / regular-skill enrichment), each ending in an
 * enumeration of the exact active skill names for that type.
 *
 * This entire block lives at the END of `dynamic` (spec §3.4 / the
 * instruction-sandwiching fix — see the "Output-contract" comment above
 * {@link buildAnalysisPrompt}'s `dynamicSections` assembly): an A/B test found
 * that moving the static preamble into the byte-stable prefix (ahead of the
 * chart-data block) degraded actionability, because the Contingent Plan
 * Mandate and other output rules ended up many thousands of tokens behind the
 * model's response. None of the static preamble interpolates a symbol, skill
 * name, or other per-call value — it would be cacheable in isolation — but
 * rule recency matters more here than that caching win, so the whole section
 * stays one atomic unit at the tail rather than being split back into a
 * stable/dynamic pair. The per-type instructions were never cacheable to
 * begin with (`core ∪ selected` — `selected` is chart-state dependent), and
 * keeping each category's rule text immediately adjacent to its name list
 * preserves prompt locality/quality.
 *
 * @param patternSkills,strategySkills,... - `core ∪ selected` skills of each
 *   type (see {@link buildAnalysisPrompt}'s `combinedGroups`).
 */
const buildAnalysisRequest = (
    patternSkills: Skill[],
    strategySkills: Skill[],
    indicatorGuideSkills: Skill[],
    candlestickSkills: Skill[],
    supportResistanceSkills: Skill[],
    regularSkills: Skill[],
    locale: AnalysisLocale = DEFAULT_ANALYSIS_LOCALE
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
                  // Schema §3.5 dedup: the response schema's `required`
                  // list only API-enforces this for the forced-tool providers
                  // (Gemini/OpenAI/haiku). The thinking-Claude path (sonnet/opus,
                  // tool_choice: auto) is not schema-enforced and extractJsonWithRepair
                  // fixes JSON syntax only, not shape — so the compact guard below is
                  // retained as the natural-language backstop for that path.
                  '- Every entry MUST include `trend` (bullish/bearish/neutral), including detected:false entries.',
                  '- For not-detected patterns, set trend to the pattern\'s inherent directional bias (e.g., head-and-shoulders → bearish, inverse head-and-shoulders → bullish, ascending wedge → bearish, descending wedge → bullish, double top → bearish, double bottom → bullish); use "neutral" only when the pattern has no inherent bias.',
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
                  // Schema §3.5 dedup: the verbose "REQUIRED FIELDS
                  // (never omit any)" header is dropped as pure scaffolding, but the
                  // trend enum/never-omit clause is kept — TREND_SCHEMA's enum is only
                  // API-enforced for forced-tool providers, not the thinking-Claude
                  // (sonnet/opus, tool_choice: auto) path, which extractJsonWithRepair
                  // cannot shape-check either. This clause is that path's guard.
                  '- Field notes:',
                  '  1. strategyName: follow the Name Field Matching rule in ## Analysis Guidelines. It MUST exactly match one strategy skill name from the list below.',
                  '  2. trend: every entry MUST include `trend` as one of bullish/bearish/neutral. Set based on the skill\'s own analysis instructions; use "neutral" when the analysis is inconclusive.',
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
                  // Schema §3.5 dedup: the literal JSON entry skeleton
                  // stays dropped — it only restated field names/nesting/types that
                  // TECHNICAL_RESPONSE_SCHEMA already fully specifies. The `type` enum
                  // rule is restored below (compact form): `enum: ['skill']` is only
                  // API-enforced for forced-tool providers, not the thinking-Claude
                  // (sonnet/opus, tool_choice: auto) path — extractJsonWithRepair fixes
                  // JSON syntax only, not shape, so this is that path's guard.
                  '- For every detected signal, add one entry to the indicatorResults array.',
                  '- CRITICAL RULES (never violate):',
                  '  1. indicatorName: follow the Name Field Matching rule in ## Analysis Guidelines. It MUST be a non-empty string — never use an empty string, a translated name, or a generic label.',
                  '  2. Each indicatorResults entry corresponds to EXACTLY ONE indicator guide. Never combine multiple indicators (e.g., "MACD and Bollinger") into one entry. Create separate entries for separate indicators.',
                  '  3. Each signal\'s `type` MUST be exactly "skill".',
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
        `Based on the data above, perform technical analysis and respond with a single JSON object. The response structure is enforced by the schema; follow the field content guidance below for the fields that need it. Respond in ${outputLanguageName(locale)}.`,
        /*
         * 한자 혼용 금지는 **한국어에만** 적용된다. 중국어 출력에 이 규칙이
         * 남으면 "한글로만 쓰라"가 되어 산출물이 통째로 깨지고, 일본어에서는
         * 한자가 정상 표기라 오히려 틀린 글이 나온다.
         */
        ...(locale === 'ko'
            ? [
                  'Output language rule (STRICT): every Korean text field must be written in pure Hangul (한글) only — NEVER mix in 한자(漢字)/Chinese characters. Write every Sino-Korean word in Hangul (e.g. write "부근" not "附近", "매도" not "賣渡", "이익 실현" not "利益實現"). This applies to all prose fields (summary, keyLevels reasoning, actionRecommendation, strategyResults, candlePatterns, patternSummaries, etc.).',
              ]
            : []),
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

// Design C (skills-to-system split): FINAL_REMINDER is removed outright — it
// existed only to recap the output rules when an earlier design had moved
// them far ahead of the data (ahead of the chart-data block). Here, the full
// "## Analysis Request" block (built above) already sits at the true tail of
// `dynamic`, immediately before the model responds, exactly reproducing the
// v0.31 production ordering; nothing was moved away from that tail position,
// so no recap is needed.

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

/**
 * Chart-pattern IDs surfaced by the pre-screener for this chart, for the
 * `patternCandidates` selection-context field. Guards `atr` unavailable/
 * non-positive the same way {@link screenChartPatterns} itself does (`[]`),
 * and additionally wraps the call defensively: a screener/classifier bug must
 * degrade to "no candidates" rather than take down prompt building, mirroring
 * `observePatternCandidates` in `submitAnalysis.ts`. Unlike that
 * application-layer call, this domain function cannot `console.error` (domain
 * is zero-I/O per `domain/CLAUDE.md`) — the application-layer observe-only log
 * already surfaces screener failures, so no telemetry is duplicated here.
 */
const collectPatternCandidateIds = (
    bars: readonly Bar[],
    atr: number | null
): ChartPatternId[] => {
    if (atr === null || atr <= 0) return [];
    try {
        return screenChartPatterns(bars, atr).map(candidate => candidate.id);
    } catch {
        return [];
    }
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
        patternCandidates: collectPatternCandidateIds(bars, atr),
        price,
        atrPercent,
    };
};

const EMPTY_SKILL_GROUPS = (): Record<SkillGroupKey, Skill[]> => ({
    pattern: [],
    strategy: [],
    indicator_guide: [],
    candlestick: [],
    support_resistance: [],
    regular: [],
});

/** Bucket a flat skill list by `type` (untyped skills fall into `regular`). */
const bucketSkillsByType = (
    list: readonly Skill[]
): Record<SkillGroupKey, Skill[]> => {
    const groups = EMPTY_SKILL_GROUPS();
    for (const skill of list) {
        const key: SkillGroupKey = skill.type ?? 'regular';
        groups[key].push(skill);
    }
    return groups;
};

const SKILL_CONTENT_SECTION_HEADER: Record<SkillGroupKey, string> = {
    indicator_guide: '## Indicator Signal Guides',
    pattern: '## Pattern Analysis',
    candlestick: '## Candlestick Pattern Guides',
    support_resistance: '## Support/Resistance Tool Guides',
    strategy: '## Strategy Analysis',
    regular: '## Active Skills',
};

// Rendering order for the digest-content sections — unchanged from the
// pre-split single-block order (indicator guides, patterns, candlesticks,
// support/resistance, strategy, regular).
const SKILL_CONTENT_SECTION_ORDER: readonly SkillGroupKey[] = [
    'indicator_guide',
    'pattern',
    'candlestick',
    'support_resistance',
    'strategy',
    'regular',
];

/**
 * Render one `## <Section>\n<skill blocks>` entry per non-empty type bucket,
 * in {@link SKILL_CONTENT_SECTION_ORDER}. Shared by the stable pass (`core`
 * buckets) and the dynamic pass (`selected` buckets) — the same header text
 * can therefore appear once in each half when both a core and a gated skill
 * of the same type are active for a given call, which is expected (the
 * digest-content sections are unified into checklists over in
 * {@link buildAnalysisRequest}, not here).
 */
const buildSkillContentSections = (
    groups: Record<SkillGroupKey, Skill[]>
): string[] =>
    SKILL_CONTENT_SECTION_ORDER.flatMap(key => {
        const skills = groups[key];
        if (skills.length === 0) return [];
        return [
            `${SKILL_CONTENT_SECTION_HEADER[key]}\n${skills.map(buildSkillBlock).join('\n\n')}`,
        ];
    });

/**
 * @internal Design C (skills-to-system split) tail marker left in `dynamic`
 * at the exact position the combined (core ∪ selected) skill-content block
 * used to occupy in production order — right after the Market Reference
 * section, before the gated (`selected`) skill digests. Only rendered when
 * `core` actually moved digest content into `stable` (see
 * {@link buildAnalysisPrompt}); when the catalog has no `always_on` skills
 * for this call, `stable` is empty and there is nothing to point at.
 */
export const CORE_SKILL_REFERENCE_POINTER =
    'Core skill reference: provided in the system prompt.';

/**
 * @internal Builds the technical-analysis LLM prompt; used by submit use-cases.
 *
 * Build the AI analysis prompt for a single symbol from bars, indicators, and skills.
 *
 * Composes the prompt the worker LLM consumes to produce an
 * `AnalysisResponse`, split into a stable/dynamic pair (spec §3.4,
 * {@link AssembledPrompt}) — Design C ("skills-to-system split") rather than
 * the earlier stable-first designs:
 *
 * - `stable` — ONLY the `always_on` skill digests (`core`, name-sorted,
 *   grouped by type via {@link buildSkillContentSections}). Byte-identical
 *   across calls sharing the same `(analysisType, catalog)` — contains no
 *   symbol, timeframe data, or per-call value — so it can serve as a
 *   cacheable request prefix at the worker/provider layer (folded into the
 *   system message; see `scripts/ab-harness/buildPrompts.ts`'s
 *   `--fold-stable-into-system`). Empty when the catalog has no `always_on`
 *   skills for this prompt type.
 * - `dynamic` — the ENTIRE rest of the prompt, in the ORIGINAL PRODUCTION
 *   ORDER (v0.31, pre-split): symbol/company/asset-class framing, timeframe,
 *   the analysis-intent block, guidelines (incl. the contingent-plan
 *   mandate's textual description), all computed chart data (snapshot,
 *   long-term context, recent bars, regime/indicator/pro-indicator/SMC
 *   sections), the Market Reference section (with the anti-fabrication
 *   guardrail inline, its original position), a one-line pointer
 *   ({@link CORE_SKILL_REFERENCE_POINTER}) where the combined skill-content
 *   block used to sit — replacing only the `core` digests that moved to
 *   `stable` — the gated (`selected`) skill digests ordered by relevance,
 *   the tier/timeframe conditional notes (ATR-extreme sizing), the optional
 *   Fear & Greed section, and finally — at the true tail, exactly as in
 *   production — the FULL "## Analysis Request" section (static output
 *   rules + the per-type writing-rule/active-skill-name instructions, see
 *   {@link buildAnalysisRequest}). Two prior orderings (stable-first output
 *   rules, and a `FINAL_REMINDER` recap tail) both degraded actionability in
 *   A/B smoke tests; Design C avoids the regression entirely by keeping the
 *   user prompt's section order byte-for-byte identical to production and
 *   moving ONLY the skill digests elsewhere — no recap tail is needed
 *   because nothing was ever moved away from the tail.
 *
 * Skills are gated by {@link selectSkills} in the `'technical'` prompt
 * context: non-chart skills (category fundamental/news/congress) are
 * whitelisted out, `always_on` skills form the stable name-sorted `core`
 * block, and gated skills are injected into `selected` only when their
 * frontmatter `gating` fires for this chart's state (detected signals,
 * textbook indicator states, detected candles), ordered by relevance.
 * Untagged skills throw (fail-closed). Both buckets are grouped by `type`
 * (pattern, strategy, indicator_guide, candlestick, support_resistance,
 * regular) independently, so a type's content can land in `stable` (its
 * `core` members), `dynamic` (its `selected` members), both, or neither. The
 * per-type writing-rule instructions in `buildAnalysisRequest` still cover
 * `core ∪ selected` (`combinedGroups`) — the model must judge every active
 * skill regardless of which half of the prompt (or which provider message)
 * its digest physically landed in.
 *
 * @param symbol - U.S. equity ticker (e.g. `"AAPL"`).
 * @param companyName - Full English company name (e.g. `"Apple Inc."`).
 * @param bars - OHLCV bars sorted oldest-first.
 * @param indicators - Indicator suite produced by {@link calculateIndicators}.
 * @param skills - Skill definitions to inject (defaults to none).
 * @param timeframe - Bar resolution; controls trend window sizing. Defaults to `"1Day"`.
 * @param fearGreed - Optional Fear & Greed snapshot. When provided, a "Fear & Greed Index (Reference)" section is appended.
 * @param assetClass - Instrument asset class controlling prompt framing. `'crypto'` drops
 *   U.S. equity context (earnings, fundamentals, analyst ratings) and adds 24/7 market
 *   context. Defaults to `'equity'` for backward compatibility.
 * @param positionBucket - Member position-bucket hint
 *   (personalized-analysis-by-position-bucket spec, Subsystem C). When
 *   provided, a single neutral Korean reference line naming the member's
 *   coarse unrealized-P&L band is appended via
 *   {@link formatPositionHintSection} — into `dynamic` only, never `stable`,
 *   since a per-member value must not pollute the byte-cached stable
 *   system-prompt prefix shared across every caller. Omit for the base
 *   (no-bucket) analysis; see {@link buildAnalysisCacheKey}'s `positionBucket`
 *   param for the matching cache-key axis.
 * @param locale - Output language for the model-facing text. Defaults to
 *   {@link DEFAULT_ANALYSIS_LOCALE} (`ko`), which produces a byte-identical
 *   prompt to the one this builder emitted before the parameter existed —
 *   that byte identity is what keeps the existing Korean analysis cache valid.
 * @param priorAnalyses - Optional history of past analyses for this symbol +
 *   timeframe, supplied by the consumer (siglens / siglens-trader) from its
 *   own storage. When provided, narrowed via `selectPriorAnalyses` (bar
 *   anchor, per-bar dedup, newest-first, capped at
 *   `PRIOR_ANALYSIS_LIMIT`) and rendered via
 *   `formatPriorAnalysisSection` — into `dynamic` only, never `stable`,
 *   for the same reason as `positionBucket` above: a per-call value here
 *   would destroy the byte-cacheable stable prefix shared across every
 *   caller. It also never reaches skill selection — it is computed
 *   independently of {@link buildSkillSelectionContext} / {@link selectSkills}
 *   and cannot change which skills get injected into a prompt. Omitting it
 *   (or passing an empty array) produces a byte-identical prompt to the one
 *   this builder emitted before the parameter existed.
 * @returns `{ stable, dynamic }` — see {@link AssembledPrompt}.
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
    fearGreed?: FearGreedSnapshot,
    assetClass: AssetClass = 'equity',
    positionBucket?: PositionBucket,
    locale: AnalysisLocale = DEFAULT_ANALYSIS_LOCALE,
    priorAnalyses?: readonly PriorAnalysis[],
    marketEvents?: readonly MarketEvent[]
): AssembledPrompt {
    // Detect candle patterns once and thread the result to every consumer
    // (skill-selection gating + the recent-bars section) so the expensive
    // detection pass runs a single time per prompt build.
    const candleEntries = detectCandlePatternEntries(bars);

    // Dynamic gating (chart only): whitelist to chart skills, then split into
    // `core` (always_on, catalog-only — byte-stable across calls) and
    // `selected` (gated skills whose frontmatter fired for this chart's
    // state — chart-dependent). Untagged skills throw (fail-closed).
    const selectionContext = buildSkillSelectionContext(
        bars,
        indicators,
        timeframe,
        candleEntries
    );
    const { core, selected } = selectSkills(
        skills,
        selectionContext,
        'technical'
    );
    // The SMC full guide is never injected (fabrication source); it is replaced
    // by the deterministic SMC data section + a compressed concept note. Drop it
    // regardless of its gating tier or which bucket it landed in.
    const coreSkills = core.filter(skill => !isSmcGuideSkill(skill));
    const selectedSkills = selected.filter(skill => !isSmcGuideSkill(skill));

    // Bucketed independently (not merged first) so each type's `core`
    // members can be rendered into the stable digest-content sections while
    // its `selected` members render into the dynamic ones.
    const coreGroups = bucketSkillsByType(coreSkills);
    const selectedGroups = bucketSkillsByType(selectedSkills);
    // The per-type writing-rule instructions need one checklist covering
    // BOTH buckets (the AI must judge every active skill of a type,
    // regardless of which half of the prompt its digest landed in) — see
    // buildAnalysisRequest's doc comment for why this stays merged and
    // atomic in the dynamic block.
    const combinedGroups = bucketSkillsByType([
        ...coreSkills,
        ...selectedSkills,
    ]);

    const config = PROMPT_CONFIG_BY_TIMEFRAME[timeframe];

    const marketReference = computeMarketReference(bars, indicators, timeframe);
    const smcConceptNote = formatSmcConceptNote(indicators, bars);

    const assetContext =
        assetClass === 'crypto'
            ? `This is a cryptocurrency trading 24/7 with no market open/close. There are no earnings, fundamentals, or analyst ratings — focus purely on price action, technical structure, volatility, and macro/liquidity context.`
            : `This is a publicly traded U.S. equity.`;

    // Reunites the static output-rules preamble with the per-type
    // writing-rule instructions into one atomic block (see its own doc
    // comment) — this always renders the "## Analysis Request" header, so
    // unlike the pre-fix `requestDynamicPart` it is never the empty string.
    const analysisRequest = buildAnalysisRequest(
        combinedGroups.pattern,
        combinedGroups.strategy,
        combinedGroups.indicator_guide,
        combinedGroups.candlestick,
        combinedGroups.support_resistance,
        combinedGroups.regular,
        locale
    );

    // Design C: `stable` carries ONLY the always_on skill digests — nothing
    // else moves out of the production order below.
    const coreSkillSections = buildSkillContentSections(coreGroups);
    const stableSections = coreSkillSections;

    // `formatPositionHintSection` returns '' when `positionBucket` doesn't
    // resolve to a known label (defensive guard against a runtime value
    // outside the `PositionBucket` union) — computed once here so the
    // section array below can filter on the result directly instead of
    // building-then-filtering a throwaway array.
    const positionHint = positionBucket
        ? formatPositionHintSection(positionBucket)
        : '';

    // Computed once here, like `positionHint` above, so the section array
    // below can filter on the rendered result directly. `selectPriorAnalyses`
    // narrows `priorAnalyses` to what's worth rendering (bar anchor, dedup,
    // newest-first, capped); `formatPriorAnalysisSection` returns `''` when
    // there is nothing left to render (empty history, or a history that
    // doesn't anchor to any bar). Deliberately NOT threaded into
    // `selectionContext` / `selectSkills` above — history must never change
    // which skills get injected.
    const marketEventsSection = formatMarketEventsSection(
        marketEvents ?? [],
        bars,
        symbol,
        timeframe
    );
    const priorAnalysisSection = formatPriorAnalysisSection(
        selectPriorAnalyses(priorAnalyses ?? [], bars),
        bars,
        symbol,
        timeframe
    );

    // Faithful reproduction of the v0.31 production section order (see
    // `git show main:src/domain/analysis/prompt.ts`'s `sections` array),
    // minus the combined skill-content block (now split: `core` digests live
    // in `stable`, replaced here by a one-line pointer when non-empty;
    // `selected` digests stay in `dynamic` at the same position).
    const dynamicSections = [
        `Symbol: ${symbol}\nCompany: ${companyName}\n${assetContext}`,
        `Timeframe: ${TIMEFRAME_LABEL[timeframe]}\nTimeframe interpretation: ${TIMEFRAME_CONTEXT[timeframe]}`,
        ANALYSIS_INTENT_BLOCK,
        analysisGuidelines(locale),
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
        // Placed after the reference levels it quotes: the risk:reward half is arithmetic
        // over the levels rendered immediately above, and reading the inputs before the
        // conclusion is what lets the model check the conclusion instead of trusting it.
        formatDeterministicMetricsSection(bars, timeframe, marketReference),
        ...(coreSkillSections.length > 0 ? [CORE_SKILL_REFERENCE_POINTER] : []),
        ...buildSkillContentSections(selectedGroups),
        ...(selectionContext.atrPercent >= atrExtremeThreshold(timeframe)
            ? [ATR_EXTREME_SIZING_NOTE]
            : []),
        ...(fearGreed ? [formatFearGreedSection(fearGreed)] : []),
        // Only push a non-empty section so an empty/unmatched history
        // doesn't inject a stray blank entry that would double up the
        // `\n\n` separator on join below (same guard as `positionHint`).
        // 이벤트를 이력보다 앞에 둔다: 이벤트는 봉에 대한 사실이라 위쪽 봉
        // 데이터의 연장이고, 이력은 그 위에서 내린 과거 판단이라 한 겹 위다.
        ...(marketEventsSection !== '' ? [marketEventsSection] : []),
        ...(priorAnalysisSection !== '' ? [priorAnalysisSection] : []),
        // Only push a non-empty hint so an unrecognized bucket (empty
        // `positionHint`) doesn't inject a stray blank entry that would
        // double up the `\n\n` separator on join below.
        ...(positionHint !== '' ? [positionHint] : []),
        // The full output-rules block — the true tail, exactly as in
        // production (see buildAnalysisRequest's doc comment for why).
        analysisRequest,
    ];

    return {
        stable: stableSections.join('\n\n'),
        dynamic: dynamicSections.join('\n\n'),
    };
}
