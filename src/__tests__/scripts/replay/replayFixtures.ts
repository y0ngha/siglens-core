/**
 * Synthetic inputs for the replay tooling tests: bars, stored-bars files, a set built by
 * the real `writeSet`, and label rows with a complete default label. Nothing here is
 * market data; prices come from a closed-form wave so every run reproduces them.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isUsTradingDay } from '@/domain/marketCalendar';
import { OUTCOME_HORIZON_BARS } from '@/domain/outcomes/constants';
import type { AnalysisOutcomeLabels, Bar } from '@/domain/types';
import { marketOfSymbol } from '../../../../scripts/replay/markets';
import type { LabelRow, StoredBars } from '../../../../scripts/replay/types';

const MS_PER_DAY = 86_400_000;

/** A directory under the OS temp dir (outside the repository), and a function that removes it. */
export function makeTempDir(prefix = 'replay-test-'): {
    dir: string;
    remove: () => void;
} {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    return { dir, remove: () => rmSync(dir, { recursive: true, force: true }) };
}

/** Default wave: slow drift plus a 30-bar oscillation, always positive. */
export const wave = (i: number): number =>
    100 + i * 0.05 + 12 * Math.sin(i / 5);

/**
 * `count` daily bars from `startIso` on trading days only (weekdays for a Korean symbol,
 * NYSE days otherwise), stamped at UTC midnight. `open` is the previous close.
 */
export function tradingBars(options: {
    symbol: string;
    startIso: string;
    count: number;
    close?: (i: number) => number;
}): Bar[] {
    const { symbol, startIso, count, close = wave } = options;
    const kr = marketOfSymbol(symbol) === 'kr';
    const start = Date.parse(`${startIso}T00:00:00Z`);
    const isTradingDay = (ms: number): boolean => {
        const weekday = new Date(ms).getUTCDay();
        return kr
            ? weekday !== 0 && weekday !== 6
            : isUsTradingDay(new Date(ms + MS_PER_DAY / 2));
    };
    const days = Array.from(
        { length: count * 2 },
        (_, k) => start + k * MS_PER_DAY
    )
        .filter(isTradingDay)
        .slice(0, count);
    return days.map((ms, i) => {
        const closeAt = close(i);
        const open = i === 0 ? closeAt : close(i - 1);
        return {
            time: ms / 1000,
            open,
            high: Math.max(open, closeAt) * 1.01,
            low: Math.min(open, closeAt) * 0.99,
            close: closeAt,
            volume: 1_000,
        };
    });
}

export function storedBars(symbol: string, bars: Bar[]): StoredBars {
    return {
        ticker: symbol,
        companyName: `${symbol} Inc`,
        fetchedAt: '2026-11-20T00:00:00.000Z',
        from: new Date(bars[0].time * 1000).toISOString().slice(0, 10),
        to: new Date(bars[bars.length - 1].time * 1000)
            .toISOString()
            .slice(0, 10),
        bars,
    };
}

/** Writes `<dir>/<SYMBOL>.json` for each entry, the layout `buildSet` reads. */
export function writeBarsDir(
    dir: string,
    entries: readonly { symbol: string; bars: Bar[] }[]
): void {
    mkdirSync(dir, { recursive: true });
    entries.forEach(({ symbol, bars }) =>
        writeFileSync(
            join(dir, `${symbol}.json`),
            JSON.stringify(storedBars(symbol, bars))
        )
    );
}

/** A complete label with every field at a neutral value; override what a test is about. */
export function makeLabels(
    overrides: {
        plan?: Partial<AnalysisOutcomeLabels['plan']>;
        levels?: AnalysisOutcomeLabels['levels'];
        patterns?: AnalysisOutcomeLabels['patterns'];
        forward?: AnalysisOutcomeLabels['forward'];
        anchorSource?: AnalysisOutcomeLabels['anchorSource'];
        atr?: number | null;
    } = {}
): AnalysisOutcomeLabels {
    return {
        v: 1,
        windowBars: 20,
        referencePrice: 100,
        adjFactor: 1,
        anchorForming: false,
        anchorSource: overrides.anchorSource ?? 'prompt_bar',
        atr: overrides.atr === undefined ? 2 : overrides.atr,
        forward:
            overrides.forward ??
            OUTCOME_HORIZON_BARS.map(h => ({
                h,
                returnPct: 1,
                baselinePct: 0.5,
                baselineN: 40,
            })),
        plan: {
            recommendation: 'enter',
            outcome: 'not_triggered',
            reason: null,
            approach: 'inside',
            entryOffset: null,
            exitOffset: null,
            fill: null,
            target: null,
            anchorBarUnobserved: false,
            exit: null,
            gap: null,
            returnPct: null,
            holdBars: null,
            rwNullTargetFirst: null,
            baselineSameLengthPct: null,
            baselineN: null,
            sameWindowHoldPct: null,
            ...overrides.plan,
        },
        levels: overrides.levels ?? [],
        scenarioTargets: [],
        patterns: overrides.patterns ?? [],
    };
}

/** A labelled, headline row; override any field. */
export function makeRow(overrides: Partial<LabelRow> = {}): LabelRow {
    return {
        caseId: 'NVDA|2024-03-01',
        symbol: 'NVDA',
        market: 'us',
        regime: 'range',
        asOf: '2024-03-01',
        repeat: 1,
        variance: false,
        status: 'labelled',
        error: null,
        dataAsOfMatches: true,
        subject: {
            v: 1,
            anchor: { barTime: 1, close: 100 },
            trend: 'bullish',
            riskLevel: 'medium',
            plan: {
                recommendation: 'enter',
                position: 'in_zone',
                entryLow: 98,
                entryHigh: 100,
                stop: 95,
                targets: [104, 108],
                reconciled: false,
            },
            levels: [],
            scenarioTargets: [],
            patterns: [],
        },
        labels: makeLabels(),
        periodBaselinePct: { '1': 0.1, '5': 0.4, '10': 0.8, '20': 1.6 },
        provenance: null,
        provenanceControl: null,
        invariants: [],
        ...overrides,
    };
}

export interface Deferred<T> {
    promise: Promise<T>;
    resolve: (value: T) => void;
}

/** A promise settled from outside (`Promise.withResolvers` is not in the compile target's lib). */
export function deferred<T>(): Deferred<T> {
    const holder: { resolve: (value: T) => void } = {
        resolve: () => undefined,
    };
    const promise = new Promise<T>(done => {
        holder.resolve = done;
    });
    return { promise, resolve: value => holder.resolve(value) };
}
