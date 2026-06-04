import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Bar, Timeframe } from '@/domain/types';
import { calculateMA } from '@/domain/indicators';
import { computeForwardEdge, findCrossIndices } from '@/domain/validation';
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
const FROM = '2025-05-01';
const TO = '2026-06-04';
const GC_FAST = 50;
const GC_SLOW = 200;
const PERCENT = 100;
const REPORTS_DIR = join(import.meta.dirname, 'reports');

interface EdgeRow {
    ticker: string;
    tf: Timeframe;
    horizon: number;
    triggers: number;
    excessHit: number;
    excessRet: number;
    tStat: number;
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
        console.warn(`  [skip] ${ticker} ${tf}: ${String(err)}`); // D6
        return null;
    }
}

function formatRow(r: EdgeRow): string {
    return `| ${r.ticker} | ${r.tf} | ${r.horizon} | ${r.triggers} | ${(r.excessHit * PERCENT).toFixed(1)}% | ${(r.excessRet * PERCENT).toFixed(2)}% | ${r.tStat.toFixed(2)} |`;
}

async function run(): Promise<void> {
    const refresh = process.argv.includes('--refresh');
    const rows: EdgeRow[] = [];

    // Sequential by design: FMP throttles aggressive concurrent fetching and
    // fmpGetWithRetry waits 60s on a 429, so parallelizing would amplify
    // rate-limiting. Each (ticker, tf) is fetched one at a time.
    for (const ticker of TICKERS) {
        for (const tf of TIMEFRAMES) {
            const bars = await tryFetchBars(ticker, tf, refresh);
            if (bars === null) continue;
            if (bars.length < GC_SLOW + Math.max(...HORIZONS[tf], 1)) {
                console.warn(
                    `  [skip] ${ticker} ${tf}: insufficient bars (${bars.length})`
                );
                continue;
            }
            const closes = bars.map(b => b.close);
            const fast = calculateMA(bars, GC_FAST);
            const slow = calculateMA(bars, GC_SLOW);
            const triggers = findCrossIndices(fast, slow, 'up');

            const tfRows = HORIZONS[tf].map((horizon): EdgeRow => {
                const edge = computeForwardEdge(
                    closes,
                    triggers,
                    horizon,
                    'up'
                );
                return {
                    ticker,
                    tf,
                    horizon,
                    triggers: edge.triggerCount,
                    excessHit: edge.excessHitRate,
                    excessRet: edge.excessMeanReturn,
                    tStat: edge.tStat,
                };
            });
            rows.push(...tfRows);
        }
    }

    mkdirSync(REPORTS_DIR, { recursive: true });
    const header =
        '| ticker | tf | h | triggers | excessHit | excessRet | tStat |';
    const sep = '|---|---|---|---|---|---|---|';
    const body = rows.map(formatRow).join('\n');
    const md = `# Golden Cross (50/200) self-test\n\n${header}\n${sep}\n${body}\n`;
    writeFileSync(join(REPORTS_DIR, 'golden-cross-selftest.md'), md, 'utf-8');
    console.log(
        `\n[done] ${rows.length} rows → reports/golden-cross-selftest.md`
    );
}

void run();
