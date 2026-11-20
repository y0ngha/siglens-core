import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
    CASES_PER_REGIME,
    MIN_GAP_BARS,
    MIN_LATER_BARS,
    MIN_PRIOR_BARS,
    VARIANCE_CASES_PER_REGIME,
    assertUsableBars,
    assignVarianceFlags,
    buildManifest,
    classifyRegime,
    dropNearIndices,
    missingSymbols,
    pickEvenly,
    selectCaseIndices,
    selectSymbolCases,
    writeSet,
    type BarsInput,
} from '../../../../scripts/replay/buildSet';
import { REPO_ROOT, sha256Hex } from '../../../../scripts/replay/fsUtil';
import {
    REPLAY_REGIMES,
    type ReplayCase,
    type ReplayRegime,
} from '../../../../scripts/replay/types';
import {
    makeTempDir,
    storedBars,
    tradingBars,
    writeBarsDir,
} from './replayFixtures';

const temps = new Set<() => void>();

describe('replay set builder', () => {
    afterEach(() => {
        [...temps].forEach(remove => remove());
        temps.clear();
    });
    function temp(): string {
        const { dir, remove } = makeTempDir();
        temps.add(remove);
        return dir;
    }

    const flat = (length: number, value = 100): number[] =>
        Array.from({ length }, () => value);
    const withValues = (
        base: readonly number[],
        at: Record<number, number>
    ): number[] => base.map((value, i) => at[i] ?? value);

    describe('classifyRegime', () => {
        const base = flat(300);

        it('is crash at exactly -20% over 20 bars and not just above it', () => {
            expect(classifyRegime(withValues(base, { 250: 80 }), 250)).toBe(
                'crash'
            );
            // -19.99% is no crash; the 60-bar drop below the SMA makes it a downtrend.
            expect(classifyRegime(withValues(base, { 250: 80.01 }), 250)).toBe(
                'downtrend'
            );
        });

        it('prefers crash over downtrend when both match', () => {
            expect(classifyRegime(withValues(base, { 250: 70 }), 250)).toBe(
                'crash'
            );
        });

        it('is downtrend at exactly -10% over 60 bars below the SMA, range just above it', () => {
            expect(classifyRegime(withValues(base, { 250: 90 }), 250)).toBe(
                'downtrend'
            );
            expect(classifyRegime(withValues(base, { 250: 90.01 }), 250)).toBe(
                'range'
            );
        });

        it('needs the close below the SMA200 for a downtrend', () => {
            const lowThenHigh = [...flat(100, 50), ...flat(200, 100)];
            // 60-bar change is -10%, but the close (90) is above the SMA200 (about 87.7).
            expect(
                classifyRegime(withValues(lowThenHigh, { 250: 90 }), 250)
            ).toBe('range');
        });

        it('is uptrend at exactly +10% over 60 bars above the SMA, range just below it', () => {
            expect(classifyRegime(withValues(base, { 250: 110 }), 250)).toBe(
                'uptrend'
            );
            expect(classifyRegime(withValues(base, { 250: 109.99 }), 250)).toBe(
                'range'
            );
        });

        it('needs the close above the SMA200 for an uptrend', () => {
            const highThenLow = [...flat(100, 200), ...flat(200, 100)];
            // 60-bar change is +10%, but the close (110) is below the SMA200 (about 124.6).
            expect(
                classifyRegime(withValues(highThenLow, { 250: 110 }), 250)
            ).toBe('range');
        });

        it('is range when nothing moved', () => {
            expect(classifyRegime(base, 250)).toBe('range');
        });
    });

    describe('pickEvenly', () => {
        it('takes the centre of each of `count` equal slices', () => {
            expect(pickEvenly([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 4)).toEqual([
                1, 3, 6, 8,
            ]);
        });

        it('returns every item when there are no more than `count`', () => {
            expect(pickEvenly([1, 2, 3, 4], 4)).toEqual([1, 2, 3, 4]);
            expect(pickEvenly([1, 2], 4)).toEqual([1, 2]);
            expect(pickEvenly([], 4)).toEqual([]);
        });

        it('never repeats an item', () => {
            const picked = pickEvenly(
                Array.from({ length: 5 }, (_, i) => i),
                4
            );
            expect(new Set(picked).size).toBe(picked.length);
        });
    });

    describe('dropNearIndices (the 20-bar gap rule)', () => {
        it('drops a pick 19 bars from a kept one and keeps one 20 bars away', () => {
            expect(
                dropNearIndices([100, 119, 120, 140], [], MIN_GAP_BARS)
            ).toEqual([100, 120, 140]);
        });

        it('applies the gap to indices chosen earlier as well', () => {
            expect(dropNearIndices([29, 30], [10], MIN_GAP_BARS)).toEqual([30]);
            expect(dropNearIndices([-9, -10], [10], MIN_GAP_BARS)).toEqual([
                -10,
            ]);
        });

        it('keeps everything when nothing is close', () => {
            expect(dropNearIndices([0, 50, 100], [], MIN_GAP_BARS)).toEqual([
                0, 50, 100,
            ]);
        });
    });

    describe('selectCaseIndices', () => {
        it('needs 260 bars before and 20 after: 280 bars give none, 281 give index 260', () => {
            expect(MIN_PRIOR_BARS).toBe(260);
            expect(MIN_LATER_BARS).toBe(20);
            expect(selectCaseIndices(flat(280))).toEqual([]);
            expect(selectCaseIndices(flat(281)).map(c => c.index)).toEqual([
                260,
            ]);
        });

        it('never picks a date too close to the end or the start', () => {
            const indices = selectCaseIndices(flat(400)).map(c => c.index);
            expect(indices.length).toBeGreaterThan(0);
            expect(Math.min(...indices)).toBeGreaterThanOrEqual(260);
            expect(Math.max(...indices)).toBeLessThanOrEqual(400 - 1 - 20);
        });

        it('keeps every chosen date at least 20 bars from every other', () => {
            const wave = Array.from(
                { length: 1500 },
                (_, i) => 100 + 30 * Math.sin(i / 40) + i * 0.02
            );
            const indices = selectCaseIndices(wave).map(c => c.index);
            expect(indices.length).toBeGreaterThan(4);
            const gaps = indices.slice(1).map((index, i) => index - indices[i]);
            expect(Math.min(...gaps)).toBeGreaterThanOrEqual(MIN_GAP_BARS);
        });

        it('returns dates in ascending order', () => {
            const wave = Array.from(
                { length: 1500 },
                (_, i) => 100 + 30 * Math.sin(i / 40)
            );
            const indices = selectCaseIndices(wave).map(c => c.index);
            expect(indices).toEqual(indices.toSorted((a, b) => a - b));
        });

        it('drops the second crash pick when it falls inside the 20-bar window of the first', () => {
            // Five consecutive crash candidates (300..304); the two evenly spaced picks are 2 bars apart.
            const closes = withValues(flat(400), {
                300: 79,
                301: 79,
                302: 79,
                303: 79,
                304: 79,
            });
            const chosen = selectCaseIndices(closes);
            const crashes = chosen.filter(c => c.regime === 'crash');
            expect(crashes.map(c => c.index)).toEqual([301]);
        });

        it('also keeps a later regime away from a date an earlier regime already took', () => {
            const closes = withValues(flat(400), {
                300: 79,
                301: 79,
                302: 79,
                303: 79,
                304: 79,
            });
            const indices = selectCaseIndices(closes).map(c => c.index);
            const nearCrash = indices.filter(
                index => index !== 301 && Math.abs(index - 301) < MIN_GAP_BARS
            );
            expect(indices).toContain(301);
            expect(nearCrash).toEqual([]);
        });

        it('takes at most the regime quota per regime', () => {
            const wave = Array.from(
                { length: 3000 },
                (_, i) => 100 + 40 * Math.sin(i / 25) + i * 0.01
            );
            const chosen = selectCaseIndices(wave);
            REPLAY_REGIMES.forEach(regime => {
                expect(
                    chosen.filter(c => c.regime === regime).length
                ).toBeLessThanOrEqual(CASES_PER_REGIME[regime]);
            });
            expect(chosen.length).toBeGreaterThan(CASES_PER_REGIME.crash);
        });
    });

    describe('selectSymbolCases', () => {
        it('names a case `${symbol}|${asOf}` with the bar date, timeframe 1Day and no variance flag', () => {
            const stored = storedBars(
                'NVDA',
                tradingBars({
                    symbol: 'NVDA',
                    startIso: '2020-01-02',
                    count: 400,
                })
            );
            const cases = selectSymbolCases('NVDA', stored);
            expect(cases.length).toBeGreaterThan(0);
            cases.forEach(c => {
                expect(c.caseId).toBe(`NVDA|${c.asOf}`);
                expect(c.timeframe).toBe('1Day');
                expect(c.variance).toBe(false);
                expect(
                    stored.bars.some((bar: { time: number }) =>
                        new Date(bar.time * 1000)
                            .toISOString()
                            .startsWith(c.asOf)
                    )
                ).toBe(true);
            });
        });
    });

    function caseOf(regime: ReplayRegime, n: number): ReplayCase {
        return {
            caseId: `SYM${n}|2024-01-01`,
            symbol: `SYM${n}`,
            timeframe: '1Day',
            asOf: '2024-01-01',
            regime,
            variance: false,
        };
    }

    describe('assignVarianceFlags', () => {
        const cases = REPLAY_REGIMES.flatMap((regime, r) =>
            Array.from({ length: 40 }, (_, n) => caseOf(regime, r * 100 + n))
        );

        it('flags exactly 25 cases per regime', () => {
            const flagged = assignVarianceFlags(cases).filter(c => c.variance);
            REPLAY_REGIMES.forEach(regime => {
                expect(flagged.filter(c => c.regime === regime)).toHaveLength(
                    VARIANCE_CASES_PER_REGIME
                );
            });
            expect(flagged).toHaveLength(100);
        });

        it('flags the 25 smallest sha256(caseId) of each regime', () => {
            const flagged = new Set(
                assignVarianceFlags(cases)
                    .filter(c => c.variance)
                    .map(c => c.caseId)
            );
            REPLAY_REGIMES.forEach(regime => {
                const expected = cases
                    .filter(c => c.regime === regime)
                    .map(c => ({ id: c.caseId, key: sha256Hex(c.caseId) }))
                    .toSorted((a, b) => (a.key < b.key ? -1 : 1))
                    .slice(0, 25)
                    .map(c => c.id);
                expect(expected).toHaveLength(25);
                expect(expected.every(id => flagged.has(id))).toBe(true);
            });
        });

        it('does not depend on the input order', () => {
            const forward = assignVarianceFlags(cases)
                .filter(c => c.variance)
                .map(c => c.caseId)
                .toSorted();
            const reversed = assignVarianceFlags(cases.toReversed())
                .filter(c => c.variance)
                .map(c => c.caseId)
                .toSorted();
            expect(reversed).toEqual(forward);
        });

        it('flags every case of a regime that has fewer than 25', () => {
            const few = [caseOf('crash', 1), caseOf('crash', 2)];
            expect(assignVarianceFlags(few)).toHaveLength(2);
            expect(assignVarianceFlags(few).every(c => c.variance)).toBe(true);
        });
    });

    function barsInput(symbol: string, count = 420): BarsInput {
        const stored = storedBars(
            symbol,
            tradingBars({ symbol, startIso: '2020-01-02', count })
        );
        return { symbol, raw: JSON.stringify(stored), stored };
    }

    describe('buildManifest', () => {
        const createdAt = '2026-11-20T00:00:00.000Z';

        it('is deterministic: the same inputs give the same manifest, whatever the input order', () => {
            const inputs = [
                barsInput('NVDA'),
                barsInput('005930.KS'),
                barsInput('AAPL'),
            ];
            const first = buildManifest(inputs, createdAt);
            const second = buildManifest(inputs.toReversed(), createdAt);
            expect(JSON.stringify(second)).toBe(JSON.stringify(first));
        });

        it('records the set id, frozen flag and the creation time it was given', () => {
            const manifest = buildManifest([barsInput('NVDA')], createdAt);
            expect(manifest).toMatchObject({
                setId: 'replay-v1',
                frozen: true,
                createdAt,
            });
        });

        it('describes each bars file by hash, range, count, market and currency', () => {
            const nvda = barsInput('NVDA');
            const kr = barsInput('005930.KS');
            const manifest = buildManifest([nvda, kr], createdAt);
            expect(manifest.bars.NVDA).toEqual({
                file: 'bars/NVDA.json',
                sha256: sha256Hex(nvda.raw),
                from: nvda.stored.from,
                to: nvda.stored.to,
                count: nvda.stored.bars.length,
                market: 'us',
                currency: 'USD',
            });
            expect(manifest.bars['005930.KS']).toMatchObject({
                market: 'kr',
                currency: 'KRW',
            });
        });

        it('lists cases by symbol then date, every case with bars for its symbol', () => {
            const manifest = buildManifest(
                [barsInput('NVDA'), barsInput('AAPL')],
                createdAt
            );
            const keys = manifest.cases.map(c => `${c.symbol}|${c.asOf}`);
            expect(manifest.cases.length).toBeGreaterThan(0);
            expect(keys).toEqual(keys.toSorted());
            expect(
                manifest.cases.every(c => manifest.bars[c.symbol] !== undefined)
            ).toBe(true);
        });

        it('keeps no case within 20 bars of another of the same symbol', () => {
            const input = barsInput('NVDA', 900);
            const manifest = buildManifest([input], createdAt);
            const times = input.stored.bars.map(bar =>
                new Date(bar.time * 1000).toISOString().slice(0, 10)
            );
            const indices = manifest.cases.map(c => times.indexOf(c.asOf));
            const gaps = indices.slice(1).map((index, i) => index - indices[i]);
            expect(gaps.length).toBeGreaterThan(0);
            expect(Math.min(...gaps)).toBeGreaterThanOrEqual(MIN_GAP_BARS);
        });

        it('rejects bars that are not strictly increasing in time', () => {
            const input = barsInput('NVDA');
            const bars = input.stored.bars.map((bar, i) =>
                i === 5 ? { ...bar, time: input.stored.bars[4].time } : bar
            );
            expect(() =>
                buildManifest(
                    [{ ...input, stored: { ...input.stored, bars } }],
                    createdAt
                )
            ).toThrow('NVDA: bar 5');
        });

        it('rejects a non-finite price', () => {
            const input = barsInput('NVDA');
            const bars = input.stored.bars.map((bar, i) =>
                i === 3 ? { ...bar, close: Number.NaN } : bar
            );
            expect(() =>
                assertUsableBars('NVDA', { ...input.stored, bars })
            ).toThrow('bar 3');
        });

        it('rejects a bar that is not stamped at UTC midnight, naming the symbol and the first such bar', () => {
            const input = barsInput('NVDA');
            const bars = input.stored.bars.map((bar, i) =>
                i >= 7 ? { ...bar, time: bar.time + 3_600 } : bar
            );
            expect(() =>
                assertUsableBars('NVDA', { ...input.stored, bars })
            ).toThrow(/NVDA: bar 7 is not stamped at UTC midnight/);
            expect(() =>
                buildManifest(
                    [{ ...input, stored: { ...input.stored, bars } }],
                    createdAt
                )
            ).toThrow('UTC midnight');
        });

        it('accepts bars stamped at UTC midnight', () => {
            const input = barsInput('NVDA');
            expect(
                input.stored.bars.every(bar => bar.time % 86_400 === 0)
            ).toBe(true);
            expect(() => assertUsableBars('NVDA', input.stored)).not.toThrow();
        });

        it('rejects a file whose ticker is another symbol', () => {
            const input = barsInput('NVDA');
            expect(() => assertUsableBars('AAPL', input.stored)).toThrow(
                'names ticker NVDA'
            );
        });
    });

    describe('writeSet', () => {
        function barsDir(): string {
            const dir = temp();
            writeBarsDir(dir, [
                {
                    symbol: 'NVDA',
                    bars: tradingBars({
                        symbol: 'NVDA',
                        startIso: '2020-01-02',
                        count: 420,
                    }),
                },
                {
                    symbol: '005930.KS',
                    bars: tradingBars({
                        symbol: '005930.KS',
                        startIso: '2020-01-02',
                        count: 420,
                    }),
                },
            ]);
            return dir;
        }
        const options = {
            createdAt: '2026-11-20T00:00:00.000Z',
            allowPartial: true,
            force: false,
        };

        it('writes the manifest and a byte-identical copy of each bars file', () => {
            const source = barsDir();
            const out = join(temp(), 'set');
            const manifest = writeSet(source, out, options);
            expect(Object.keys(manifest.bars)).toEqual(['005930.KS', 'NVDA']);
            expect(
                JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf-8'))
            ).toEqual(manifest);
            Object.values(manifest.bars).forEach(entry => {
                expect(sha256Hex(readFileSync(join(out, entry.file)))).toBe(
                    entry.sha256
                );
            });
        });

        it('names the missing symbols and refuses unless partial builds are allowed', () => {
            const source = barsDir();
            expect(missingSymbols(source)).toContain('AAPL');
            expect(() =>
                writeSet(source, join(temp(), 'set'), {
                    ...options,
                    allowPartial: false,
                })
            ).toThrow(/missing bars for 63 symbols \(.*AAPL.*\)/);
        });

        it('refuses to replace an existing set unless forced', () => {
            const source = barsDir();
            const out = join(temp(), 'set');
            writeSet(source, out, options);
            expect(() => writeSet(source, out, options)).toThrow('--force');
            expect(() =>
                writeSet(source, out, { ...options, force: true })
            ).not.toThrow();
        });

        it('refuses an output directory inside the repository', () => {
            expect(() =>
                writeSet(barsDir(), join(REPO_ROOT, 'replay-set'), options)
            ).toThrow('inside the repository');
        });
    });
});
