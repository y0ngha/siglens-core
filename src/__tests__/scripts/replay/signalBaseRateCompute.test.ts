import { describe, expect, it } from 'vitest';
import { OUTCOME_HORIZON_BARS } from '@/domain/outcomes/constants';
import type { ConfirmedSignalDay } from '@/domain/signals/timeline';
import type {
    Bar,
    ConfirmedSignalType,
    Signal,
    SignalDirection,
    SignalType,
} from '@/domain/types';
import { BASE_RATE_MIN_N } from '../../../../scripts/replay/baseRateTableCompute';
import { EVAL_CONSTANTS } from '../../../../scripts/replay/engineEvalTypes';
import {
    SIGNAL_HORIZONS,
    SIGNAL_TYPES,
    SIGNAL_TYPE_DIRECTIONS,
    assertHorizonsUnchanged,
    episodeStarts,
    episodesForSymbol,
    isMeasuredType,
    signalTable,
    type SignalEpisode,
} from '../../../../scripts/replay/signalBaseRateCompute';
import { tradingBars } from './replayFixtures';

const FIRST = EVAL_CONSTANTS.minPriorBars - 1;

const signal = (type: SignalType, direction: SignalDirection): Signal => ({
    type,
    direction,
    phase: 'confirmed',
    detectedAt: 0,
});

const day = (
    signals: readonly Signal[] | null,
    time = 0
): ConfirmedSignalDay => ({
    time,
    close: 100,
    changePercent: null,
    signals,
});

const gapUp = signal('gap_up', 'bullish');
const gapDown = signal('gap_down', 'bearish');

describe('episodeStarts', () => {
    it('starts an episode on the first confirmed day of a run only', () => {
        const days = [day([]), day([gapUp]), day([gapUp]), day([gapUp])];
        expect(episodeStarts(days)).toEqual([
            { type: 'gap_up', direction: 'bullish', day: 1 },
        ]);
    });

    it('starts a new episode when the type drops out for a day and comes back', () => {
        const days = [day([]), day([gapUp]), day([]), day([gapUp])];
        expect(episodeStarts(days).map(s => s.day)).toEqual([1, 3]);
    });

    it('never starts on the first day: its previous bar is unknown', () => {
        expect(episodeStarts([day([gapUp]), day([gapUp])])).toEqual([]);
    });

    it('treats a day that could not be evaluated as unknown, on either side', () => {
        const days = [day([]), day(null), day([gapUp]), day([gapUp])];
        expect(episodeStarts(days)).toEqual([]);
        expect(episodeStarts([day([]), day([gapUp]), day(null)])).toHaveLength(
            1
        );
    });

    it('tracks every type on its own, one start per type and day', () => {
        const days = [day([gapUp]), day([gapUp, gapDown, gapDown])];
        expect(episodeStarts(days)).toEqual([
            { type: 'gap_down', direction: 'bearish', day: 1 },
        ]);
    });
});

describe('the type table and the horizons', () => {
    it('covers every confirmed type once, sorted, with a side', () => {
        expect(SIGNAL_TYPES).toHaveLength(34);
        expect(SIGNAL_TYPES).toEqual(SIGNAL_TYPES.toSorted());
        expect(
            SIGNAL_TYPES.every(
                t =>
                    SIGNAL_TYPE_DIRECTIONS[t] === 'bullish' ||
                    SIGNAL_TYPE_DIRECTIONS[t] === 'bearish'
            )
        ).toBe(true);
    });

    it('knows a confirmed type and refuses an anticipation type', () => {
        expect(isMeasuredType('golden_cross')).toBe(true);
        expect(isMeasuredType('rsi_bullish_divergence')).toBe(false);
        expect(isMeasuredType('toString')).toBe(false);
    });

    it('is written for the horizons core labels with', () => {
        expect([...SIGNAL_HORIZONS]).toEqual([...OUTCOME_HORIZON_BARS]);
        expect(() => assertHorizonsUnchanged()).not.toThrow();
    });
});

/** Closes from `close(i)`; ATR is positive from the second bar on. */
const barsOf = (
    count: number,
    close: (i: number) => number,
    symbol = 'AAA'
): Bar[] => tradingBars({ symbol, startIso: '2019-01-02', count, close });

const rising = (i: number): number => 100 + i * 0.5;
const falling = (i: number): number => 1000 - i * 0.5;
const wavy = (i: number): number => 100 + 8 * Math.sin(i / 3) + (i % 7);

/** Timeline of `bars` with `signals` confirmed on the given bar indexes. */
const daysOf = (
    bars: readonly Bar[],
    confirmed: Readonly<Record<number, Signal>>
): ConfirmedSignalDay[] =>
    bars.slice(FIRST).map((bar, i) => ({
        time: bar.time,
        close: bar.close,
        changePercent: null,
        signals:
            confirmed[FIRST + i] === undefined ? [] : [confirmed[FIRST + i]],
    }));

describe('episodesForSymbol', () => {
    const bars = barsOf(600, rising);

    it('reads the outcome of a bullish episode at every horizon, against its placebo', () => {
        const t = 300;
        const { episodes } = episodesForSymbol(
            'AAA',
            'us',
            bars,
            daysOf(bars, { [t]: gapUp })
        );
        expect(episodes).toHaveLength(1);
        const [episode] = episodes;
        expect(episode).toMatchObject({
            symbol: 'AAA',
            market: 'us',
            type: 'gap_up',
            direction: 'bullish',
            index: t,
            date: new Date(bars[t].time * 1000).toISOString().slice(0, 10),
        });
        // A strictly rising series: the event and every placebo date move up at every horizon.
        expect(episode.outcomes).toEqual(
            SIGNAL_HORIZONS.map(() => ({ hit: 1, placeboShare: 1 }))
        );
    });

    it('applies the signal side: the same rising series is a miss for a bearish episode', () => {
        const { episodes } = episodesForSymbol(
            'AAA',
            'us',
            bars,
            daysOf(bars, { 300: gapDown })
        );
        expect(episodes[0].outcomes).toEqual(
            SIGNAL_HORIZONS.map(() => ({ hit: 0, placeboShare: 0 }))
        );
        const down = barsOf(600, falling);
        expect(
            episodesForSymbol('AAA', 'us', down, daysOf(down, { 300: gapDown }))
                .episodes[0].outcomes[0]
        ).toEqual({ hit: 1, placeboShare: 1 });
    });

    it('counts a zero move as a miss, for the event and for its placebo', () => {
        const flat = barsOf(600, () => 100);
        const [episode] = episodesForSymbol(
            'AAA',
            'us',
            flat,
            daysOf(flat, { 300: gapUp })
        ).episodes;
        expect(episode.outcomes).toEqual(
            SIGNAL_HORIZONS.map(() => ({ hit: 0, placeboShare: 0 }))
        );
    });

    it('leaves a horizon beyond the data out of that horizon only', () => {
        const t = bars.length - 1 - 7;
        const [episode] = episodesForSymbol(
            'AAA',
            'us',
            bars,
            daysOf(bars, { [t]: gapUp })
        ).episodes;
        expect(episode.outcomes.map(o => o !== null)).toEqual([
            true, // 1
            true, // 5
            false, // 10
            false, // 20
        ]);
    });

    it('drops an episode with fewer than minPlacebo eligible dates, and counts it', () => {
        const short = barsOf(270, rising);
        const result = episodesForSymbol(
            'AAA',
            'us',
            short,
            daysOf(short, { 262: gapUp })
        );
        expect(result.episodes).toEqual([]);
        expect(result.dropped).toEqual({ gap_up: 1 });
    });

    it('draws the same placebo for the same key and another one for another symbol', () => {
        const wave = barsOf(600, wavy);
        const run = (symbol: string): SignalEpisode[] =>
            episodesForSymbol(
                symbol,
                'us',
                wave,
                daysOf(wave, { 300: gapUp, 400: gapUp })
            ).episodes;
        expect(run('AAA')).toEqual(run('AAA'));
        const a = run('AAA').map(e => e.outcomes);
        expect(run('BBB').map(e => e.outcomes)).not.toEqual(a);
        // The event's own hit does not depend on the draw.
        expect(run('BBB').map(e => e.outcomes.map(o => o?.hit))).toEqual(
            run('AAA').map(e => e.outcomes.map(o => o?.hit))
        );
    });

    it('matches placebo dates on the prior-move bucket of the anchor', () => {
        // Falls for 600 bars, then rises. An anchor in the decline sees only placebo dates
        // that also follow a decline (all of which keep falling); one in the advance only
        // dates that follow an advance (all of which keep rising).
        const turning = barsOf(900, i =>
            i < 600 ? 1000 - i : 400 + (i - 600) * 2
        );
        const share = (t: number): number | undefined =>
            episodesForSymbol(
                'AAA',
                'us',
                turning,
                daysOf(turning, { [t]: gapUp })
            ).episodes[0]?.outcomes[0]?.placeboShare;
        expect(share(300)).toBe(0);
        expect(share(750)).toBe(1);
    });

    it('refuses a type outside the table and a side that disagrees with the declaration', () => {
        expect(() =>
            episodesForSymbol(
                'AAA',
                'us',
                bars,
                daysOf(bars, {
                    300: signal('rsi_bullish_divergence', 'bullish'),
                })
            )
        ).toThrow('not in SIGNAL_TYPE_DIRECTIONS');
        expect(() =>
            episodesForSymbol(
                'AAA',
                'us',
                bars,
                daysOf(bars, { 300: signal('gap_up', 'bearish') })
            )
        ).toThrow('detected as bearish but is declared bullish');
    });

    it('does not start an episode before the minimum history', () => {
        // A drift too small to leave the prior-move bucket, so placebo dates exist everywhere.
        const slow = barsOf(600, i => 100 + i * 0.1);
        const at = (index: number): SignalEpisode[] =>
            episodesForSymbol(
                'AAA',
                'us',
                slow,
                daysOf(slow, { [index]: gapUp })
            ).episodes;
        // Bar 259 is the first evaluated day: it only supplies the previous bar.
        expect(at(FIRST)).toEqual([]);
        expect(at(FIRST + 1)[0]?.index).toBe(EVAL_CONSTANTS.minPriorBars);
    });

    it('counts the days it could not evaluate', () => {
        const days = daysOf(bars, {}).map((d, i) =>
            i === 5 ? { ...d, signals: null } : d
        );
        expect(episodesForSymbol('AAA', 'us', bars, days).unevaluatedDays).toBe(
            1
        );
    });
});

// ─── signalTable ──────────────────────────────────────────────────────────────

const WEEKS = Array.from(
    { length: 52 },
    (_, i) => `2021-W${String(i + 1).padStart(2, '0')}`
);

const slotOf = (
    i: number
): Pick<SignalEpisode, 'week' | 'market' | 'half' | 'date'> => ({
    week: WEEKS[i % WEEKS.length],
    market: i % 2 === 0 ? 'us' : 'kr',
    half: Math.floor(i / 2) % 2 === 0 ? 'early' : 'late',
    date: `2021-${String((i % 12) + 1).padStart(2, '0')}-15`,
});

interface Spec {
    count: number;
    /** Event hit at episode `i`. */
    hit?: (i: number) => 0 | 1;
    placebo?: number;
    /** Episodes with an index at or above this have no outcome at horizon 20. */
    noH20From?: number;
}

function episodesOf(type: ConfirmedSignalType, spec: Spec): SignalEpisode[] {
    const { count, hit = () => 0, placebo = 0.5, noH20From } = spec;
    return Array.from({ length: count }, (_, i) => ({
        symbol: 'AAA',
        type,
        direction: SIGNAL_TYPE_DIRECTIONS[type],
        index: 300 + i,
        ...slotOf(i),
        outcomes: SIGNAL_HORIZONS.map(h =>
            h === 20 && noH20From !== undefined && i >= noH20From
                ? null
                : { hit: hit(i), placeboShare: placebo }
        ),
    }));
}

/** Hits in runs of four episodes: independent of the market (parity) and the half (pairs). */
const ALT = (i: number): 0 | 1 => (Math.floor(i / 4) % 2 === 0 ? 0 : 1);

const MARKETS = [
    { market: 'us', symbols: 2 },
    { market: 'kr', symbols: 1 },
] as const;

/** Every type with `fallback`, the named ones with their own spec. */
function allTypes(
    specs: Partial<Record<ConfirmedSignalType, Spec>>,
    fallback: Spec = { count: 150, hit: ALT }
): SignalEpisode[] {
    return SIGNAL_TYPES.flatMap(type =>
        episodesOf(type, specs[type] ?? fallback)
    );
}

describe('signalTable', () => {
    const table = signalTable(
        allTypes({
            golden_cross: { count: 150, hit: () => 1, placebo: 0.5 },
            death_cross: { count: 10, hit: () => 1 },
            gap_up: { count: 150, hit: () => 1, placebo: 0.5, noH20From: 40 },
        }),
        WEEKS,
        MARKETS
    );
    const row = (type: ConfirmedSignalType) =>
        table.rows.find(r => r.signalType === type);

    it('has one row per type, in key order, each with all four horizons in order', () => {
        expect(table.rows.map(r => r.signalType)).toEqual([...SIGNAL_TYPES]);
        expect(
            table.rows.every(
                r =>
                    JSON.stringify(r.horizons.map(h => h.h)) ===
                    JSON.stringify([1, 5, 10, 20])
            )
        ).toBe(true);
        expect(row('gap_down')?.direction).toBe('bearish');
    });

    it('says beats_placebo only when the placebo is cleared in every half and market', () => {
        const cells = row('golden_cross')?.horizons;
        expect(cells?.map(c => c.verdict)).toEqual([
            'beats_placebo',
            'beats_placebo',
            'beats_placebo',
            'beats_placebo',
        ]);
        expect(cells?.[1].stats).toMatchObject({
            eventShare: 1,
            placeboShare: 0.5,
        });
        expect(cells?.[1].stats?.difference.mean).toBeCloseTo(0.5, 12);
        expect(cells?.[1].stats?.difference.low ?? 0).toBeGreaterThan(0);
    });

    it('says no_edge when the event does about as well as its placebo', () => {
        const cells = row('rsi_oversold')?.horizons ?? [];
        expect(cells.map(c => c.verdict)).toEqual([
            'no_edge',
            'no_edge',
            'no_edge',
            'no_edge',
        ]);
        expect(cells[0].n).toBe(150);
    });

    it('says insufficient_sample below the floor and states nothing then', () => {
        const cells = row('death_cross')?.horizons ?? [];
        expect(cells.every(c => c.verdict === 'insufficient_sample')).toBe(
            true
        );
        expect(cells.every(c => c.stats === null && c.n === 10)).toBe(true);
    });

    it('lets a horizon beyond the data reduce its own n only', () => {
        const cells = row('gap_up')?.horizons ?? [];
        expect(cells.map(c => c.n)).toEqual([150, 150, 150, 40]);
        expect(cells[3].verdict).toBe('insufficient_sample');
        expect(cells[3].stats).toBeNull();
        expect(cells[2].verdict).toBe('beats_placebo');
        expect(BASE_RATE_MIN_N).toBeGreaterThan(40);
    });

    it('does not let a sign that fails in one market pass: the market a type misses fails it', () => {
        const onlyUs = signalTable(
            allTypes({
                golden_cross: {
                    count: 150,
                    hit: ALT,
                    placebo: 0.2,
                },
            }),
            WEEKS,
            MARKETS
        );
        // Better than the placebo overall, but make the Korean half worse than it.
        const mixed = onlyUs.rows.find(r => r.signalType === 'golden_cross');
        expect(mixed?.horizons[0].verdict).toBe('beats_placebo');
        const krLoses = signalTable(
            SIGNAL_TYPES.flatMap(type =>
                episodesOf(
                    type,
                    type === 'golden_cross'
                        ? {
                              count: 150,
                              hit: ALT,
                              placebo: 0.2,
                          }
                        : { count: 150, hit: ALT }
                ).map(e =>
                    type === 'golden_cross' && e.market === 'kr'
                        ? {
                              ...e,
                              outcomes: e.outcomes.map(o =>
                                  o === null
                                      ? null
                                      : { ...o, placeboShare: 0.9 }
                              ),
                          }
                        : e
                )
            ),
            WEEKS,
            MARKETS
        );
        expect(
            krLoses.rows.find(r => r.signalType === 'golden_cross')?.horizons[0]
                .verdict
        ).toBe('no_edge');
    });

    it('carries the pooled scope: markets, symbols and the anchor period', () => {
        const scope = row('golden_cross')?.scope;
        expect(scope).toEqual({
            timeframe: '1Day',
            markets: [
                { market: 'us', symbols: 2 },
                { market: 'kr', symbols: 1 },
            ],
            composition: 'pooled',
            symbols: 3,
            from: '2021-01-15',
            to: '2021-12-15',
        });
        expect(new Set(table.rows.map(r => r.scope)).size).toBe(1);
    });

    it('records what the verdict read, per type and horizon', () => {
        expect(table.details).toHaveLength(SIGNAL_TYPES.length * 4);
        const detail = table.details.find(
            d => d.type === 'golden_cross' && d.h === 5
        );
        expect(detail?.inputs.n).toBe(150);
        expect(detail?.inputs.splits.kr).toBeCloseTo(0.5, 12);
        expect(table.episodeCounts.golden_cross).toBe(150);
    });

    it('is reproducible: the same episodes give the same table', () => {
        const again = signalTable(
            allTypes({
                golden_cross: { count: 150, hit: () => 1, placebo: 0.5 },
                death_cross: { count: 10, hit: () => 1 },
                gap_up: {
                    count: 150,
                    hit: () => 1,
                    placebo: 0.5,
                    noH20From: 40,
                },
            }),
            WEEKS,
            MARKETS
        );
        expect(JSON.stringify(again)).toBe(JSON.stringify(table));
    });

    it('fails closed when a type has no episode at all', () => {
        const without = allTypes({}).filter(e => e.type !== 'new_52w_low');
        expect(() => signalTable(without, WEEKS, MARKETS)).toThrow(
            'no episode at all for new_52w_low'
        );
    });

    it('fails closed on a figure it cannot compute at or above the floor', () => {
        const broken = allTypes({}).map(e =>
            e.type === 'gap_up'
                ? {
                      ...e,
                      outcomes: e.outcomes.map(o =>
                          o === null ? null : { ...o, placeboShare: Number.NaN }
                      ),
                  }
                : e
        );
        expect(() => signalTable(broken, WEEKS, MARKETS)).toThrow(
            'is not computable'
        );
    });

    it('never stores a return figure: a cell holds shares and counts only', () => {
        const cell = row('golden_cross')?.horizons[0];
        expect(Object.keys(cell ?? {}).toSorted()).toEqual([
            'h',
            'n',
            'stats',
            'verdict',
        ]);
        expect(Object.keys(cell?.stats ?? {}).toSorted()).toEqual([
            'difference',
            'eventShare',
            'placeboShare',
        ]);
    });
});
