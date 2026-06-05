import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
    Bar,
    ForwardDirection,
    ImpulseColor,
    Timeframe,
} from '@/domain/types';
import {
    calculateBollingerDerived,
    calculateChandelierExit,
    calculateConnorsRsi,
    calculateElderImpulse,
    calculateElderRay,
    calculateForceIndex,
    calculateMacdV,
    CRSI_OVERBOUGHT,
    CRSI_OVERSOLD,
    ELDER_POWER_ZERO,
    FORCE_INDEX_ZERO,
    MACDV_OVERBOUGHT,
    MACDV_OVERSOLD,
    PCTB_OVERBOUGHT,
    PCTB_OVERSOLD,
} from '@/domain/indicators';
import {
    collectValidReturns,
    findFlipIndices,
    findThresholdCrossIndices,
    sampleStd,
    statsFromReturns,
} from '@/domain/validation';
import { fetchBarsCached } from './fetchData';

const TICKERS = [
    'AAPL',
    'AMZN',
    'AVGO',
    'GOOGL',
    'LLY',
    'META',
    'NVDA',
    'PLTR',
    'TSLA',
    'WMT',
] as const;
const TIMEFRAMES: Timeframe[] = ['1Day', '1Hour', '15Min'];
const HORIZONS: Record<Timeframe, number[]> = {
    '1Day': [5, 10, 20],
    '1Hour': [6, 12, 24],
    '15Min': [8, 16, 32],
    '5Min': [],
    '30Min': [],
    '4Hour': [],
};
// ~2 years of history: the slow pro-indicators (Connors RSI percent-rank,
// Bollinger, MACD-V) need a long warmup, so a wider window yields enough
// signals for a meaningful pooled forward-edge n.
const FROM = '2024-06-05';
const TO = '2026-06-04';
const PERCENT = 100;
// 250 comfortably covers every Phase 1 indicator's warmup at all timeframes
// (Connors RSI percent-rank window is the longest contributor).
const MIN_WARMUP_BARS = 250;
// One-sample t-stat guards (mirrors domain/validation/forwardEdge.ts).
const MIN_SAMPLES_FOR_TSTAT = 2; // need ≥2 points for an (n−1) sample std
const MIN_STD_FOR_TSTAT = 1e-10; // below this, treat the spread as zero-variance
// flag thresholds: a real edge needs positive mean excess, |t| ≥ 2, n ≥ 30.
const MIN_T_FOR_SIGNAL = 2;
const MIN_N_FOR_SIGNAL = 30;
const REPORTS_DIR = join(import.meta.dirname, 'reports');

interface DirectionalTriggers {
    bullish: number[];
    bearish: number[];
}

interface IndicatorSpec {
    name: string;
    triggers: (bars: Bar[]) => DirectionalTriggers;
}

/**
 * The 7 directional pro-indicators. Each maps a bar series to bullish (`'up'`)
 * and bearish (`'down'`) trigger index arrays. Elder-Ray / Chandelier /
 * Bollinger %B return per-bar result objects, so we transpose them into the
 * `(number|null)[]` / state series the trigger-scan helpers expect.
 */
const INDICATORS: IndicatorSpec[] = [
    {
        name: 'MACD-V',
        triggers: bars => {
            const macdV = calculateMacdV(bars);
            return {
                bullish: findThresholdCrossIndices(macdV, MACDV_OVERSOLD, 'up'),
                bearish: findThresholdCrossIndices(
                    macdV,
                    MACDV_OVERBOUGHT,
                    'down'
                ),
            };
        },
    },
    {
        name: 'Connors RSI',
        triggers: bars => {
            const crsi = calculateConnorsRsi(bars.map(b => b.close));
            return {
                bullish: findThresholdCrossIndices(crsi, CRSI_OVERSOLD, 'up'),
                bearish: findThresholdCrossIndices(
                    crsi,
                    CRSI_OVERBOUGHT,
                    'down'
                ),
            };
        },
    },
    {
        name: 'Force Index',
        triggers: bars => {
            const fi = calculateForceIndex(bars);
            return {
                bullish: findThresholdCrossIndices(fi, FORCE_INDEX_ZERO, 'up'),
                bearish: findThresholdCrossIndices(
                    fi,
                    FORCE_INDEX_ZERO,
                    'down'
                ),
            };
        },
    },
    {
        name: 'Elder-Ray',
        triggers: bars => {
            const elder = calculateElderRay(bars);
            const bullPower = elder.map(e => e.bullPower);
            const bearPower = elder.map(e => e.bearPower);
            return {
                bullish: findThresholdCrossIndices(
                    bullPower,
                    ELDER_POWER_ZERO,
                    'up'
                ),
                bearish: findThresholdCrossIndices(
                    bearPower,
                    ELDER_POWER_ZERO,
                    'down'
                ),
            };
        },
    },
    {
        name: 'Elder Impulse',
        triggers: bars => {
            const colors: (ImpulseColor | null)[] = calculateElderImpulse(bars);
            return {
                bullish: findFlipIndices(colors, 'green'),
                bearish: findFlipIndices(colors, 'red'),
            };
        },
    },
    {
        name: 'Chandelier',
        triggers: bars => {
            const trend = calculateChandelierExit(bars).map(c => c.trend);
            return {
                bullish: findFlipIndices(trend, 'long'),
                bearish: findFlipIndices(trend, 'short'),
            };
        },
    },
    {
        name: 'Bollinger %B',
        triggers: bars => {
            const pctB = calculateBollingerDerived(bars).map(d => d.pctB);
            return {
                bullish: findThresholdCrossIndices(pctB, PCTB_OVERSOLD, 'up'),
                bearish: findThresholdCrossIndices(
                    pctB,
                    PCTB_OVERBOUGHT,
                    'down'
                ),
            };
        },
    },
];

interface EdgeRow {
    indicator: string;
    direction: ForwardDirection;
    tf: Timeframe;
    horizon: number;
    triggers: number;
    excessHit: number;
    excessRet: number;
    tStat: number;
    flag: 'signal' | 'advisory';
}

/**
 * Fetch bars for one symbol/timeframe; return null (logged) on failure so the
 * caller can skip without a `let` + try/catch reassignment.
 */
async function tryFetchBars(
    ticker: string,
    tf: Timeframe,
    refresh: boolean
): Promise<Bar[] | null> {
    try {
        return await fetchBarsCached(ticker, tf, FROM, TO, refresh);
    } catch (err) {
        console.warn(`  [skip] ${ticker} ${tf}: ${String(err)}`);
        return null;
    }
}

/**
 * Sequentially fetch every (ticker, tf) once, applying the bar-count guard, so
 * each indicator can be evaluated against the same cached bars without
 * re-fetching. FMP throttles concurrent fetching, so the loop is sequential.
 */
async function loadBarsByTimeframe(
    refresh: boolean
): Promise<Map<Timeframe, Bar[][]>> {
    const byTf = new Map<Timeframe, Bar[][]>(TIMEFRAMES.map(tf => [tf, []]));
    for (const ticker of TICKERS) {
        for (const tf of TIMEFRAMES) {
            const bars = await tryFetchBars(ticker, tf, refresh);
            if (bars === null) continue;
            const minBars = MIN_WARMUP_BARS + Math.max(...HORIZONS[tf], 1);
            if (bars.length < minBars) {
                console.warn(
                    `  [skip] ${ticker} ${tf}: insufficient bars (${bars.length} < ${minBars})`
                );
                continue;
            }
            byTf.get(tf)?.push(bars);
        }
    }
    return byTf;
}

/**
 * Pool signal + baseline forward returns ACROSS tickers at the returns level
 * (trigger indices are per-ticker, so closes cannot be concatenated), then
 * derive the excess stats and a one-sample t-stat of pooled signal returns vs
 * the pooled baseline mean.
 */
function poolEdge(
    barsList: Bar[][],
    spec: IndicatorSpec,
    tf: Timeframe,
    direction: ForwardDirection,
    horizon: number
): EdgeRow {
    const signalReturns: number[] = [];
    const baselineReturns: number[] = [];

    for (const bars of barsList) {
        const closes = bars.map(b => b.close);
        const { bullish, bearish } = spec.triggers(bars);
        const triggers = direction === 'up' ? bullish : bearish;
        signalReturns.push(
            ...collectValidReturns(closes, triggers, horizon, direction)
        );
        const eligible = Array.from(
            { length: Math.max(0, closes.length - horizon) },
            (_, i) => i
        );
        baselineReturns.push(
            ...collectValidReturns(closes, eligible, horizon, direction)
        );
    }

    const sig = statsFromReturns(signalReturns);
    const base = statsFromReturns(baselineReturns);
    const excessHitRate = sig.hitRate - base.hitRate;
    const excessMeanReturn = sig.meanReturn - base.meanReturn;

    // sig.count === signalReturns.length (statsFromReturns sets count = length),
    // so use the single source for both the t-stat guard and its denominator.
    const sd = sampleStd(signalReturns, sig.meanReturn);
    const tStat =
        sig.count >= MIN_SAMPLES_FOR_TSTAT && sd >= MIN_STD_FOR_TSTAT
            ? (sig.meanReturn - base.meanReturn) / (sd / Math.sqrt(sig.count))
            : 0;

    const flag =
        excessMeanReturn > 0 &&
        Math.abs(tStat) >= MIN_T_FOR_SIGNAL &&
        sig.count >= MIN_N_FOR_SIGNAL
            ? 'signal'
            : 'advisory';

    return {
        indicator: spec.name,
        direction,
        tf,
        horizon,
        triggers: sig.count,
        excessHit: excessHitRate,
        excessRet: excessMeanReturn,
        tStat,
        flag,
    };
}

function formatRow(r: EdgeRow): string {
    return `| ${r.indicator} | ${r.direction} | ${r.tf} | ${r.horizon} | ${r.triggers} | ${(r.excessHit * PERCENT).toFixed(1)}% | ${(r.excessRet * PERCENT).toFixed(2)}% | ${r.tStat.toFixed(2)} | ${r.flag} |`;
}

const NOTES = [
    '## Notes',
    '',
    'The 5 non-directional Phase 1 indicators are intentionally excluded from this directional edge test:',
    '',
    '- **Hurst, Variance Ratio, Regression R²** = regime filters (not directional signals; a follow-up can test whether a reference signal’s edge improves when gated by the regime).',
    '- **Yang-Zhang, EWMA volatility** = risk / measurement (no directional edge test).',
    '',
].join('\n');

function buildReport(rows: EdgeRow[]): string {
    const header =
        '| indicator | direction | tf | h | n (triggers) | excessHit | excessRet | tStat | flag |';
    const sep = '|---|---|---|---|---|---|---|---|---|';
    const body = rows.map(formatRow).join('\n');

    const perIndicator = INDICATORS.map(spec => {
        const flagged = rows.filter(
            r => r.indicator === spec.name && r.flag === 'signal'
        ).length;
        return `- **${spec.name}**: ${flagged} (tf,h,direction) cell(s) flagged \`signal\``;
    }).join('\n');
    const totalSignal = rows.filter(r => r.flag === 'signal').length;

    return [
        '# Pro-indicator forward-edge self-test (pooled across tickers)',
        '',
        `Window ${FROM} → ${TO}. Pooled across ${TICKERS.length} tickers at the returns level. ` +
            'A cell is flagged `signal` when excess mean return > 0, |tStat| ≥ 2, and n ≥ 30; otherwise `advisory`.',
        '',
        header,
        sep,
        body,
        '',
        '## Per-indicator summary',
        '',
        perIndicator,
        '',
        `Overall: ${totalSignal} of ${rows.length} cell(s) flagged \`signal\`.`,
        '',
        NOTES,
    ].join('\n');
}

async function run(): Promise<void> {
    const refresh = process.argv.includes('--refresh');
    const barsByTf = await loadBarsByTimeframe(refresh);

    const rows: EdgeRow[] = [];
    for (const spec of INDICATORS) {
        for (const tf of TIMEFRAMES) {
            const barsList = barsByTf.get(tf) ?? [];
            for (const horizon of HORIZONS[tf]) {
                for (const direction of ['up', 'down'] as const) {
                    rows.push(poolEdge(barsList, spec, tf, direction, horizon));
                }
            }
        }
    }

    mkdirSync(REPORTS_DIR, { recursive: true });
    writeFileSync(
        join(REPORTS_DIR, 'indicator-edge.md'),
        buildReport(rows),
        'utf-8'
    );
    console.log(`\n[done] ${rows.length} rows → reports/indicator-edge.md`);
}

void run();
