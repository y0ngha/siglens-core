import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    KNOWN_BARS_FINGERPRINTS,
    barsFingerprintOf,
    tradesSha256,
    type PageDataRun,
} from '../../../../scripts/replay/backtestBenchmarks';
import {
    computeBenchmarks,
    type BenchmarkInput,
} from '../../../../scripts/replay/backtestBenchmarksCompute';
import type { Bar } from '@/domain/types';

/**
 * Reproduction gate (B1, TE-16), opt-in because it needs the stored run. It is env-gated and
 * skipped everywhere the two variables are unset, so CI does NOT execute it: run it by hand
 * after any change to the instrument or the run data.
 *
 *   BACKTEST_RUN_DIR=<siglens-backtest-data>/runs/2026-11-daily-ai \
 *   BACKTEST_PAGE_DATA=<siglens>/src/entities/backtest-case/data/data.json \
 *   yarn test src/__tests__/scripts/replay/backtestBenchmarksReal.test.ts
 *
 * Three oracles that do not share code with the instrument:
 * - the per-trade mean excess against the audit's `trades.cjs` formula (re-implemented below
 *   on date strings, not on the instrument's indices), within 0.005 pp, the only tolerance,
 *   which covers rounding of the audit's float sum. The instrument's registered length of a
 *   trade is its stored `holdingDays` (a 0-day trade has drift 0); `trades.cjs` uses
 *   `max(1, holdingDays)`, which differs on the 0-day trades, so the re-implementation applies
 *   the registered rule;
 * - the hold portfolio and the closed-trade portfolio against the run's own 4-evaluate
 *   `summary.json` (`benchmark.meanTickerBuyHoldPct`, `portfolio.returnPct`,
 *   `portfolio.maxDrawdownPct`, `portfolio.meanExposurePct`), exact at its two decimals;
 * - the closed-trade return against siglens `deriveBacktestStats` (re-implemented below: a
 *   daily union of exit dates, each exit compounding the stored `returnPct`), exact at two
 *   decimals.
 */
const RUN_DIR = process.env.BACKTEST_RUN_DIR;
const PAGE_DATA = process.env.BACKTEST_PAGE_DATA;
const enabled = [RUN_DIR, PAGE_DATA].every(v => v !== undefined && v !== '');

/** Counts of the 2026-11-daily-ai run the reproduction pins (the run id guards a different run). */
const RUN_2026_11 = {
    runId: '2026-11-daily-ai',
    bracket: {
        n: 641,
        agree: 586,
        disagreeWithReviews: 55,
        initialTarget: 338,
        storedTarget: 363,
    },
} as const;

const round2 = (v: number): number => Number(v.toFixed(2));
const once = <T>(make: () => T): (() => T) => {
    const cache: { value?: T } = {};
    return () => (cache.value ??= make());
};
const mean = (xs: readonly number[]): number =>
    xs.reduce((a, b) => a + b, 0) / xs.length;

describe.skipIf(!enabled)(
    'the real run reproduces three independent implementations',
    () => {
        /** Loaded on first use: `describe.skipIf` still runs this body to collect the tests. */
        const loaded = once(() => {
            const runDir = RUN_DIR ?? '';
            const page = JSON.parse(
                readFileSync(PAGE_DATA ?? '', 'utf-8')
            ) as PageDataRun;
            const summary = JSON.parse(
                readFileSync(join(runDir, 'summary.json'), 'utf-8')
            ) as {
                portfolio: {
                    returnPct: number;
                    maxDrawdownPct: number;
                    meanExposurePct: number;
                };
                benchmark: { meanTickerBuyHoldPct: number };
            };
            const bars = Object.fromEntries(
                page.run.tickers.map(t => [
                    t,
                    (
                        JSON.parse(
                            readFileSync(
                                join(runDir, 'data', 'bars', `${t}.json`),
                                'utf-8'
                            )
                        ) as { bars: Bar[] }
                    ).bars,
                ])
            );
            const input: BenchmarkInput = {
                run: page.run,
                baselines: page.baselines,
                trades: page.trades,
                bars,
                identity: {
                    tradesSha256: tradesSha256(page.trades),
                    barsFingerprint: barsFingerprintOf(
                        runDir,
                        page.run.tickers
                    ),
                    coreSha: 'test',
                },
            };
            const result = computeBenchmarks(input);
            return { runDir, page, summary, bars, input, result };
        });

        it('reads the bars the definitions were written for', () => {
            const { input } = loaded();
            expect(KNOWN_BARS_FINGERPRINTS).toContain(
                input.identity.barsFingerprint
            );
        });

        it('per-trade mean equals the audit implementation within 0.005 pp', () => {
            const { page, bars, result } = loaded();
            // trades.cjs formula: same-ticker unconditional drift over bars dated inside the period, h = holdingDays (the registered 0-day rule).
            const dated = (t: string): { d: string; c: number }[] =>
                bars[t]
                    .map(b => ({
                        d: new Date(b.time * 1000).toISOString().slice(0, 10),
                        c: b.close,
                    }))
                    .filter(
                        x =>
                            x.d >= page.run.periodStart &&
                            x.d <= page.run.periodEnd
                    );
            const drift = (t: string, h: number): number => {
                const b = dated(t);
                return mean(
                    Array.from(
                        { length: b.length - h },
                        (_, i) => (b[i + h].c / b[i].c - 1) * 100
                    )
                );
            };
            const audit = mean(
                page.trades.map(
                    t => t.returnPct - drift(t.ticker, t.holdingDays)
                )
            );
            expect(
                Math.abs(result.benchmarks.perTradeExcess.meanPct - audit)
            ).toBeLessThanOrEqual(0.005);
            const baselineAudit = mean(
                page.trades.map(t => drift(t.ticker, t.holdingDays))
            );
            expect(
                Math.abs(
                    result.benchmarks.perTradeExcess.baselineMeanPct -
                        baselineAudit
                )
            ).toBeLessThanOrEqual(0.005);
            expect(result.benchmarks.perTradeExcess.n).toBe(page.trades.length);
        });

        it("hold portfolio equals 4-evaluate's mean ticker buy-and-hold exactly", () => {
            const { summary, result } = loaded();
            expect(round2(result.benchmarks.holdPortfolio.returnPct)).toBe(
                summary.benchmark.meanTickerBuyHoldPct
            );
        });

        it('closed-trade return and drawdown equal 4-evaluate and deriveBacktestStats exactly', () => {
            const { page, summary, result } = loaded();
            expect(round2(result.diagnostics.strategy.closedReturnPct)).toBe(
                summary.portfolio.returnPct
            );
            expect(
                round2(result.diagnostics.strategy.closedMaxDrawdownPct)
            ).toBe(summary.portfolio.maxDrawdownPct);
            // deriveBacktestStats: axis = union of exit dates, each ticker compounds at its exits, portfolio = mean.
            const axis = [
                ...new Set(page.trades.map(t => t.exitDate)),
            ].toSorted();
            const curves = page.run.tickers.map(ticker => {
                const own = page.trades.filter(t => t.ticker === ticker);
                return axis.reduce<number[]>((curve, date) => {
                    const factor = own
                        .filter(t => t.exitDate === date)
                        .reduce((f, t) => f * (1 + t.returnPct / 100), 1);
                    return [...curve, (curve.at(-1) ?? 1) * factor];
                }, []);
            });
            const app = (mean(curves.map(c => c[c.length - 1])) - 1) * 100;
            expect(round2(result.diagnostics.strategy.closedReturnPct)).toBe(
                round2(app)
            );
        });

        it('exposure matches 4-evaluate to its rounding', () => {
            const { summary, result } = loaded();
            expect(
                Math.abs(
                    result.benchmarks.exposureMatchedHold.exposurePct -
                        summary.portfolio.meanExposurePct
                )
            ).toBeLessThan(0.0051);
        });

        it('keeps the comparable bracket pair on fixed initial levels and the stored share apart', () => {
            const { page, result } = loaded();
            const { bracket } = result.benchmarks;
            // Derived from the trades: the subset and the stored share.
            const subset = page.trades.filter(t =>
                ['tp1', 'sl1'].includes(t.legs[0].reason)
            );
            const storedTarget = subset.filter(
                t => t.legs[0].reason === 'tp1'
            ).length;
            expect(bracket.n).toBe(subset.length);
            expect(bracket.storedTargetFirstShare).toBeCloseTo(
                storedTarget / subset.length,
                12
            );
            expect(bracket.initialPlan.resolvedRaces).toBeLessThanOrEqual(
                subset.length
            );
            expect(bracket.placebo.resolvedRaces).toBeLessThanOrEqual(
                3 * subset.length
            );
            const { agree, disagreeWithReviews } =
                result.diagnostics.bracket.reRace;
            expect(agree + disagreeWithReviews).toBe(subset.length);
            // Results of the 2026-11-daily-ai run (also in scripts/replay/README.md): these are
            // outputs of the instrument, pinned so a change to the race or the data shows up.
            expect(RUN_2026_11).toMatchObject({ runId: page.run.runId });
            expect({
                n: bracket.n,
                agree,
                disagreeWithReviews,
                initialTarget: Math.round(
                    bracket.initialPlan.targetFirstShare *
                        bracket.initialPlan.resolvedRaces
                ),
                storedTarget: storedTarget,
            }).toEqual(RUN_2026_11.bracket);
        });

        it('is deterministic on the real run', () => {
            const { input, result } = loaded();
            expect(JSON.stringify(computeBenchmarks(input))).toBe(
                JSON.stringify(result)
            );
        });
    }
);
