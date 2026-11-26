import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { technicalChangesBetween } from '@/domain/analysis/technicalChanges';
import type { Bar } from '@/domain/types';
import {
    parseMeasureArgs,
    runMeasure,
} from '../../../../scripts/measure/technicalChanges';
import {
    ALMOST_DAILY_THRESHOLD,
    HUB_SIGNAL_TYPES,
    LIST_SIZE,
    REVERT_SESSIONS,
    START_INDEX,
    WINDOW_BARS,
    atLeastOneInSample,
    lineShares,
    measureSymbol,
    revertedShare,
    summarize,
    type SessionRecord,
    type SymbolSessions,
} from '../../../../scripts/measure/technicalChangesCompute';
import { makeTempDir } from '../replay/replayFixtures';

// Each case runs several indicator suites; a loaded CI worker needs more than the 5 s default.
vi.setConfig({ testTimeout: 60_000 });

const temps = new Set<() => void>();
afterEach(() => {
    [...temps].forEach(remove => remove());
    temps.clear();
});

const session = (
    time: number,
    over: Partial<SessionRecord> = {}
): SessionRecord => ({
    time,
    measured: true,
    trendMeasured: true,
    unevaluatedSignalDays: 0,
    trend: null,
    signals: [],
    ...over,
});

const flip = (from: 'bullish' | 'neutral', to: 'bullish' | 'neutral') => ({
    from,
    to,
});

const walk = (length: number): Bar[] => {
    const state = { s: 5, price: 100 };
    return Array.from({ length }, (_, i) => {
        state.s = (state.s * 1664525 + 1013904223) % 4294967296;
        state.price *= 1 + (state.s / 4294967296 - 0.5) * 0.05;
        return {
            time: 1_600_000_000 + i * 86_400,
            open: state.price,
            high: state.price * 1.01,
            low: state.price * 0.99,
            close: state.price,
            volume: 1000,
        };
    });
};

describe('pre-registered constants', () => {
    it('keeps the rule values the brief fixed', () => {
        expect(REVERT_SESSIONS).toBe(3);
        expect(LIST_SIZE).toBe(10);
        expect(ALMOST_DAILY_THRESHOLD).toBe(0.8);
        expect(START_INDEX).toBe(300);
        expect(HUB_SIGNAL_TYPES).toHaveLength(8);
        expect(WINDOW_BARS).toBeGreaterThan(365);
    });
});

describe('atLeastOneInSample', () => {
    it('is the hypergeometric chance of hitting one of m in a k-sample of n', () => {
        expect(atLeastOneInSample(20, 0, 10)).toBe(0);
        expect(atLeastOneInSample(20, 11, 10)).toBe(1);
        expect(atLeastOneInSample(20, 1, 10)).toBeCloseTo(0.5, 12);
        // 1 - C(8,2)/C(10,2) = 1 - 28/45
        expect(atLeastOneInSample(10, 2, 2)).toBeCloseTo(1 - 28 / 45, 12);
    });

    it('samples the whole list when there are fewer symbols than the list size', () => {
        expect(atLeastOneInSample(4, 1, 10)).toBe(1);
        expect(atLeastOneInSample(0, 0, 10)).toBe(0);
    });
});

describe('revertedShare', () => {
    it('counts a change back to the old label within three sessions', () => {
        const sessions = [
            session(1, { trend: flip('neutral', 'bullish') }),
            session(2),
            session(3, { trend: flip('bullish', 'neutral') }),
            session(4),
            // second change: stays
            session(5, { trend: flip('neutral', 'bullish') }),
            session(6),
            session(7),
            session(8),
        ];
        // Change 1 reverts at session 3; change 2 (to neutral) is back to bullish at session 5;
        // change 3 has sessions 6..8 and stays.
        expect(revertedShare([{ symbol: 'A', sessions }])).toEqual({
            changes: 3,
            reverted: 2,
            share: 2 / 3,
        });
    });

    it('ignores a change without three measured sessions after it', () => {
        const sessions = [
            session(1, { trend: flip('neutral', 'bullish') }),
            session(2),
            session(3, { measured: false }),
            session(4),
            session(5, { trend: flip('neutral', 'bullish') }),
            session(6),
        ];
        expect(revertedShare([{ symbol: 'A', sessions }])).toEqual({
            changes: 0,
            reverted: 0,
            share: null,
        });
    });

    it('leaves out a change followed by a session whose trend was not measured', () => {
        const sessions = [
            session(1, { trend: flip('neutral', 'bullish') }),
            session(2),
            session(3, { trendMeasured: false }),
            session(4),
        ];
        expect(revertedShare([{ symbol: 'A', sessions }])).toEqual({
            changes: 0,
            reverted: 0,
            share: null,
        });
    });

    it('reads a flip-flop through an intermediate label as reverted', () => {
        const sessions = [
            session(1, { trend: flip('neutral', 'bullish') }),
            session(2, { trend: flip('bullish', 'neutral') }),
            session(3),
            session(4),
        ];
        expect(revertedShare([{ symbol: 'A', sessions }])).toMatchObject({
            changes: 1,
            reverted: 1,
        });
    });
});

describe('lineShares', () => {
    const symbols = (n: number, withLine: number): SymbolSessions[] =>
        Array.from({ length: n }, (_, i) => ({
            symbol: `S${i}`,
            sessions: [
                session(100, {
                    signals:
                        i < withLine
                            ? [{ type: 'golden_cross', direction: 'bullish' }]
                            : [],
                }),
            ],
        }));

    it('averages the chance over dates and splits trend from signals', () => {
        const shares = lineShares(symbols(20, 1));
        expect(shares.dates).toBe(1);
        expect(shares.anyLine).toBeCloseTo(0.5, 12);
        expect(shares.signalOnly).toBeCloseTo(0.5, 12);
        expect(shares.trendOnly).toBe(0);
    });

    it('skips dates with fewer measured symbols than the list size', () => {
        expect(lineShares(symbols(LIST_SIZE - 1, 3))).toEqual({
            dates: 0,
            anyLine: null,
            trendOnly: null,
            signalOnly: null,
        });
    });

    it('keeps a session whose trend was not measured out of the trend denominator', () => {
        const all: SymbolSessions[] = Array.from({ length: 20 }, (_, i) => ({
            symbol: `S${i}`,
            sessions: [
                session(100, {
                    trendMeasured: i >= 10,
                    trend: i === 15 ? flip('neutral', 'bullish') : null,
                }),
            ],
        }));
        // 10 known sessions, 1 with a line: 1 - C(9,10)/C(10,10) = 1.
        const shares = lineShares(all);
        expect(shares.trendOnly).toBeCloseTo(1, 12);
        expect(shares.dates).toBe(1);
        const tooFew = all.map((s, i) => ({
            ...s,
            sessions: [{ ...s.sessions[0], trendMeasured: i >= 11 }],
        }));
        expect(lineShares(tooFew).trendOnly).toBeNull();
    });

    it('keeps sessions with unevaluated signal days out of the signal denominator', () => {
        const all: SymbolSessions[] = Array.from({ length: 20 }, (_, i) => ({
            symbol: `S${i}`,
            sessions: [
                session(100, {
                    unevaluatedSignalDays: i < 10 ? 2 : 0,
                    signals:
                        i === 15
                            ? [{ type: 'golden_cross', direction: 'bullish' }]
                            : [],
                }),
            ],
        }));
        expect(lineShares(all).signalOnly).toBeCloseTo(1, 12);
        // The unevaluated session that has a line still counts for "any line".
        const withLine = all.map((s, i) =>
            i === 0
                ? {
                      ...s,
                      sessions: [
                          {
                              ...s.sessions[0],
                              signals: [
                                  {
                                      type: 'golden_cross' as const,
                                      direction: 'bullish' as const,
                                  },
                              ],
                          },
                      ],
                  }
                : s
        );
        expect(lineShares(withLine).anyLine).not.toBeNull();
    });

    it('ignores sessions that could not be measured', () => {
        const unmeasured: SymbolSessions[] = Array.from(
            { length: 20 },
            (_, i) => ({
                symbol: `U${i}`,
                sessions: [session(100, { measured: false })],
            })
        );
        expect(lineShares(unmeasured).dates).toBe(0);
    });
});

describe('summarize', () => {
    const trendHeavy = (revertEvery: boolean): SymbolSessions => ({
        symbol: 'T',
        sessions: revertEvery
            ? [
                  session(1, { trend: flip('neutral', 'bullish') }),
                  session(2, { trend: flip('bullish', 'neutral') }),
                  session(3),
                  session(4),
              ]
            : [
                  session(1, { trend: flip('neutral', 'bullish') }),
                  session(2),
                  session(3),
                  session(4),
              ],
    });

    it('chooses the per-symbol suppression key above the revert threshold', () => {
        expect(
            summarize([trendHeavy(true)]).decisions.trendSuppressionKey
        ).toBe('per_symbol');
    });

    it('keeps the per-label key at or below the threshold and with no changes', () => {
        expect(
            summarize([trendHeavy(false)]).decisions.trendSuppressionKey
        ).toBe('per_target_label');
        expect(summarize([]).decisions).toEqual({
            trendSuppressionKey: 'per_target_label',
            reportAlmostDaily: false,
        });
    });

    it('reports the sessions left out of the denominators apart from the shares', () => {
        const result = summarize([
            {
                symbol: 'A',
                sessions: [
                    session(1, { trendMeasured: false }),
                    session(2, { unevaluatedSignalDays: 1 }),
                    session(3, { measured: false }),
                    session(4),
                ],
            },
        ]);
        expect(result).toMatchObject({
            sessions: 3,
            unmeasured: 1,
            excluded: { trendUnmeasured: 1, signalUnevaluated: 1 },
        });
    });

    it('flags an almost-daily mail above 80% and counts changes by kind and type', () => {
        const all: SymbolSessions[] = Array.from({ length: 12 }, (_, i) => ({
            symbol: `S${i}`,
            sessions: [
                session(100, {
                    trend: flip('neutral', 'bullish'),
                    signals: [{ type: 'golden_cross', direction: 'bullish' }],
                }),
            ],
        }));
        const result = summarize(all);
        expect(result.decisions.reportAlmostDaily).toBe(true);
        expect(result.counts).toMatchObject({
            trendChanged: 12,
            signalStarted: 12,
            signalStartedByType: { golden_cross: 12 },
            levelCrossed: 0,
            planPositionChanged: 0,
        });
        expect(result).toMatchObject({
            symbols: 12,
            sessions: 12,
            unmeasured: 0,
        });
    });
});

describe('measureSymbol', () => {
    it('measures from START_INDEX on, honouring the stride', () => {
        const bars = walk(START_INDEX + 25);
        expect(measureSymbol('X', bars).sessions).toHaveLength(25);
        expect(measureSymbol('X', bars, 5).sessions).toHaveLength(5);
        expect(measureSymbol('X', walk(START_INDEX)).sessions).toEqual([]);
    });

    it('reports exactly what technicalChangesBetween finds on the trailing window', () => {
        const bars = walk(START_INDEX + 25);
        const { sessions } = measureSymbol('X', bars);
        expect(sessions.some(s => s.signals.length > 0)).toBe(true);
        sessions.forEach((record, k) => {
            const index = START_INDEX + k;
            const window = bars.slice(
                Math.max(0, index + 1 - WINDOW_BARS),
                index + 1
            );
            const direct = technicalChangesBetween(window, {
                fromIndex: window.length - 2,
                signalTypes: HUB_SIGNAL_TYPES,
            });
            if (!direct.ok) throw new Error('unexpected');
            expect(record.time).toBe(bars[index].time);
            expect(record.signals.map(s => s.type)).toEqual(
                direct.changes.flatMap(c =>
                    c.kind === 'signal_started' ? [c.type] : []
                )
            );
            expect(record.trend !== null).toBe(
                direct.changes.some(c => c.kind === 'trend_changed')
            );
        });
    });

    it('carries what the change result could not read into each session', () => {
        const { sessions } = measureSymbol('X', walk(START_INDEX + 5));
        expect(sessions.every(s => s.trendMeasured)).toBe(true);
        expect(sessions.every(s => s.unevaluatedSignalDays === 0)).toBe(true);
    });

    it('marks a session that cannot be measured', () => {
        const bars = walk(START_INDEX + 2).map((bar, i) =>
            i === START_INDEX + 1 ? { ...bar, close: NaN } : bar
        );
        const { sessions } = measureSymbol('X', bars);
        expect(sessions[1]).toMatchObject({
            measured: false,
            trendMeasured: false,
            unevaluatedSignalDays: 0,
            trend: null,
            signals: [],
        });
    });
});

describe('CLI', () => {
    it('needs --set or --merge and validates the flags', () => {
        expect(() => parseMeasureArgs([])).toThrow('missing --set or --merge');
        expect(() =>
            parseMeasureArgs(['--set', '/s', '--stride', '0'])
        ).toThrow('--stride must be a positive integer');
        expect(() => parseMeasureArgs(['--set', '/s', '--shard', '2'])).toThrow(
            '--shard must be <k>/<n>'
        );
        expect(() =>
            parseMeasureArgs(['--set', '/s', '--shard', '3/3'])
        ).toThrow('--shard needs 0 <= k < n');
        expect(
            parseMeasureArgs(['--set', '/s', '--shard', '1/3']).shard
        ).toEqual({
            index: 1,
            count: 3,
        });
    });

    it('merges shard files into one summary and refuses an output inside the repository', () => {
        const { dir, remove } = makeTempDir('measure-');
        temps.add(remove);
        const a: SymbolSessions[] = [{ symbol: 'A', sessions: [session(1)] }];
        const b: SymbolSessions[] = [
            {
                symbol: 'B',
                sessions: [session(1, { trend: flip('neutral', 'bullish') })],
            },
        ];
        writeFileSync(join(dir, 'a.json'), JSON.stringify(a));
        writeFileSync(join(dir, 'b.json'), JSON.stringify(b));
        const lines: string[] = [];
        const code = runMeasure(
            parseMeasureArgs([
                '--merge',
                `${join(dir, 'a.json')},${join(dir, 'b.json')}`,
            ]),
            line => lines.push(line)
        );
        expect(code).toBe(0);
        expect(JSON.parse(lines.join('\n'))).toMatchObject({
            symbols: 2,
            sessions: 2,
            counts: { trendChanged: 1 },
        });
        expect(() =>
            runMeasure(
                parseMeasureArgs([
                    '--merge',
                    join(dir, 'a.json'),
                    '--out',
                    'scripts/x.json',
                ]),
                () => undefined
            )
        ).toThrow('inside the repository');
    });
});
