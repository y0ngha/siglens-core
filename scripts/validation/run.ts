import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Bar, Timeframe } from '../../src/domain/types';
import { calculateMA } from '../../src/domain/indicators';
import {
    computeForwardEdge,
    findCrossIndices,
} from '../../src/domain/validation';
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

async function run(): Promise<void> {
    const refresh = process.argv.includes('--refresh');
    const rows: EdgeRow[] = [];

    for (const ticker of TICKERS) {
        for (const tf of TIMEFRAMES) {
            let bars: Bar[];
            try {
                bars = await fetchBarsCached(ticker, tf, FROM, TO, refresh);
            } catch (err) {
                console.warn(`  [skip] ${ticker} ${tf}: ${String(err)}`);
                continue; // D6: skip after retries exhausted
            }
            if (bars.length < GC_SLOW + Math.max(...HORIZONS[tf], 1)) {
                console.warn(
                    `  [skip] ${ticker} ${tf}: insufficient bars (${bars.length})`
                );
                continue;
            }
            const closes = bars.map((b: Bar) => b.close);
            const fast = calculateMA(bars, GC_FAST);
            const slow = calculateMA(bars, GC_SLOW);
            const triggers = findCrossIndices(fast, slow, 'up');

            for (const horizon of HORIZONS[tf]) {
                const edge = computeForwardEdge(
                    closes,
                    triggers,
                    horizon,
                    'up'
                );
                rows.push({
                    ticker,
                    tf,
                    horizon,
                    triggers: edge.triggerCount,
                    excessHit: edge.excessHitRate,
                    excessRet: edge.excessMeanReturn,
                    tStat: edge.tStat,
                });
            }
        }
    }

    mkdirSync(REPORTS_DIR, { recursive: true });
    const header =
        '| ticker | tf | h | triggers | excessHit | excessRet | tStat |';
    const sep = '|---|---|---|---|---|---|---|';
    const body = rows
        .map(
            (r: EdgeRow) =>
                `| ${r.ticker} | ${r.tf} | ${r.horizon} | ${r.triggers} | ${(r.excessHit * 100).toFixed(1)}% | ${(r.excessRet * 100).toFixed(2)}% | ${r.tStat.toFixed(2)} |`
        )
        .join('\n');
    const md = `# Golden Cross (50/200) self-test\n\n${header}\n${sep}\n${body}\n`;
    writeFileSync(join(REPORTS_DIR, 'golden-cross-selftest.md'), md, 'utf-8');
    console.log(
        `\n[done] ${rows.length} rows → reports/golden-cross-selftest.md`
    );
}

void run();
