import { describe, expect, it } from 'vitest';
import { computeStockSignalResult } from '@/domain/dashboard';
import { calculateIndicators } from '@/domain/indicators';
import { detectSignals } from '@/domain/signals';
import { detectNewConfirmedSignals } from '@/domain/signals/newSignals';
import {
    confirmedSignalTimeline,
    SIGNAL_SCAN_DAILY_LOOKBACK_DAYS,
} from '@/domain/signals/timeline';
import { lookbackIsoFromNow } from '@/domain/dashboard';
import type { Bar, SectorStock, Signal, SignalType } from '@/domain/types';

const DAY_SECONDS = 86_400;
const START_TIME = 1_600_000_000;

/** Deterministic pseudo-random in [0, 1) so fixtures never change between runs. */
function seededRandom(seed: number): () => number {
    const state = { value: seed };
    return () => {
        state.value = (state.value * 1_664_525 + 1_013_904_223) % 4_294_967_296;
        return state.value / 4_294_967_296;
    };
}

/** A wavy random walk: crosses, RSI extremes, MACD flips and 52-week breaks all occur. */
function wavyBars(count: number, seed = 7): Bar[] {
    const random = seededRandom(seed);
    return Array.from({ length: count }, (_, i) => {
        const close =
            100 + Math.sin(i / 23) * 18 + i * 0.04 + (random() - 0.5) * 4;
        return {
            time: START_TIME + i * DAY_SECONDS,
            open: close - 0.3,
            high: close + 1.2,
            low: close - 1.2,
            close,
            volume: 1000 + Math.floor(random() * 500),
        };
    });
}

function typesOf(signals: readonly Signal[]): SignalType[] {
    return signals.map(s => s.type);
}

function confirmedOnly(signals: readonly Signal[]): Signal[] {
    return signals.filter(s => s.phase === 'confirmed');
}

const STOCK: SectorStock = {
    symbol: 'TEST',
    koreanName: '테스트',
    sectorSymbol: 'XLK',
};

const BARS = wavyBars(560);

describe('confirmedSignalTimeline', () => {
    describe('입력이 비어 있거나 days가 1 미만이면', () => {
        it('빈 배열을 반환한다', () => {
            expect(confirmedSignalTimeline([], { days: 5 })).toEqual([]);
            expect(confirmedSignalTimeline(BARS, { days: 0 })).toEqual([]);
            expect(confirmedSignalTimeline(BARS, { days: -3 })).toEqual([]);
            expect(confirmedSignalTimeline(BARS, { days: Number.NaN })).toEqual(
                []
            );
        });
    });

    describe('days가 bars보다 크면', () => {
        it('bars 길이로 제한한다', () => {
            const bars = wavyBars(30);
            const timeline = confirmedSignalTimeline(bars, { days: 500 });
            expect(timeline).toHaveLength(30);
            expect(timeline.map(d => d.time)).toEqual(bars.map(b => b.time));
        });
    });

    describe('days: 1이면', () => {
        it('대시보드 스캐너의 확정 신호와 같다', () => {
            const ends = [120, 260, 400, 480, 560];
            const nonEmpty = ends.map(end => {
                const window = BARS.slice(0, end);
                const [day] = confirmedSignalTimeline(window, { days: 1 });
                const cutoff =
                    window[window.length - 1].time -
                    SIGNAL_SCAN_DAILY_LOOKBACK_DAYS * DAY_SECONDS;
                const scanned = computeStockSignalResult(
                    STOCK,
                    window.filter(b => b.time >= cutoff),
                    null
                );
                const expected = scanned ? confirmedOnly(scanned.signals) : [];
                expect(day.signals).toEqual(expected);
                return expected.length;
            });
            // The comparison is not vacuous: some prefixes do fire signals.
            expect(nonEmpty.some(n => n > 0)).toBe(true);
        });

        it('신호가 없는 봉은 빈 signals 배열을 반환한다', () => {
            const flat: Bar[] = Array.from({ length: 80 }, (_, i) => ({
                time: START_TIME + i * DAY_SECONDS,
                open: 100,
                high: 100,
                low: 100,
                close: 100,
                volume: 1000,
            }));
            const [day] = confirmedSignalTimeline(flat, { days: 1 });
            expect(day.signals).toEqual([]);
            expect(computeStockSignalResult(STOCK, flat, null)).toBeNull();
        });
    });

    describe('각 날짜는', () => {
        it('time, close, changePercent를 해당 봉에서 가져온다', () => {
            const timeline = confirmedSignalTimeline(BARS, { days: 3 });
            const base = BARS.length - 3;
            timeline.forEach((day, offset) => {
                const bar = BARS[base + offset];
                const prev = BARS[base + offset - 1];
                expect(day.time).toBe(bar.time);
                expect(day.close).toBe(bar.close);
                expect(day.changePercent).toBeCloseTo(
                    ((bar.close - prev.close) / prev.close) * 100,
                    10
                );
            });
        });

        it('첫 봉이거나 직전 종가가 0이면 changePercent가 null이다', () => {
            const bars = wavyBars(5).map((b, i) =>
                i === 1 ? { ...b, close: 0 } : b
            );
            const timeline = confirmedSignalTimeline(bars, { days: 5 });
            expect(timeline[0].changePercent).toBeNull();
            expect(timeline[1].changePercent).not.toBeNull();
            expect(timeline[2].changePercent).toBeNull();
        });

        it('미래 봉을 읽지 않는다: 접두 구간의 결과와 같다', () => {
            const full = confirmedSignalTimeline(BARS, { days: 40 });
            const base = BARS.length - 40;
            [0, 7, 19, 39].forEach(offset => {
                const prefix = BARS.slice(0, base + offset + 1);
                const [alone] = confirmedSignalTimeline(prefix, { days: 1 });
                expect(full[offset]).toEqual(alone);
            });
        });
    });

    describe('창 경계', () => {
        const bars = wavyBars(120);
        const last = bars[bars.length - 1];

        it('lookbackDays 만큼 오래된 봉은 포함하고 하루 더 오래된 봉은 제외한다', () => {
            const lookbackDays = 40;
            const [day] = confirmedSignalTimeline(bars, {
                days: 1,
                lookbackDays,
            });
            const inclusive = bars.filter(
                b => b.time >= last.time - lookbackDays * DAY_SECONDS
            );
            // Exactly lookbackDays + 1 bars: the one 40 days old is in, 41 is out.
            expect(inclusive).toHaveLength(lookbackDays + 1);
            const expected = confirmedOnly(
                detectSignals(inclusive, calculateIndicators(inclusive))
            );
            expect(day.signals).toEqual(expected);

            const shorter = bars.slice(-lookbackDays);
            const withoutBoundary = confirmedOnly(
                detectSignals(shorter, calculateIndicators(shorter))
            );
            // Dropping the boundary bar changes the window, so the test can tell the two apart.
            expect(shorter).toHaveLength(lookbackDays);
            expect(withoutBoundary).not.toEqual(expected);
        });

        it('창이 2봉 미만이면 신호 없이 반환한다', () => {
            const sparse: Bar[] = [
                { ...bars[0], time: START_TIME },
                { ...bars[1], time: START_TIME + 100 * DAY_SECONDS },
            ];
            const timeline = confirmedSignalTimeline(sparse, {
                days: 2,
                lookbackDays: 10,
            });
            expect(timeline.map(d => d.signals)).toEqual([null, null]);
        });
    });

    describe('평가할 수 없는 창은', () => {
        const BAD = 190;
        const bars = wavyBars(200).map((b, i) =>
            i === BAD ? { ...b, close: Number.NaN } : b
        );

        it('종가가 깨진 봉이 창에 있는 날은 signals가 null이다', () => {
            const timeline = confirmedSignalTimeline(bars, { days: 10 });
            expect(timeline.map(d => d.signals)).toEqual(
                Array.from({ length: 10 }, () => null)
            );
            // The break at bar 190 also voids the change of the next bar.
            expect(timeline[0].changePercent).toBeNull();
            expect(timeline[1].changePercent).toBeNull();
            expect(timeline[2].changePercent).not.toBeNull();
        });

        it('신호가 없는 정상 창은 null이 아니라 빈 배열이다', () => {
            const flat: Bar[] = Array.from({ length: 80 }, (_, i) => ({
                time: START_TIME + i * DAY_SECONDS,
                open: 100,
                high: 100,
                low: 100,
                close: 100,
                volume: 1000,
            }));
            const [day] = confirmedSignalTimeline(flat, { days: 1 });
            expect(day.signals).toEqual([]);
            expect(day.signals).not.toBeNull();
        });

        it('깨진 봉 이전 날짜는 정상 평가한다', () => {
            const before = confirmedSignalTimeline(bars, { days: 60 }).slice(
                0,
                BAD - (bars.length - 60)
            );
            expect(before).toHaveLength(50);
            expect(before.every(d => Array.isArray(d.signals))).toBe(true);
            const clean = confirmedSignalTimeline(bars.slice(0, BAD), {
                days: 50,
            });
            expect(before.map(d => d.signals)).toEqual(
                clean.map(d => d.signals)
            );
        });

        it('깨진 봉이 창을 벗어나면 다시 평가한다', () => {
            const lookbackDays = 20;
            // Bar 190 leaves a 20-day window once the evaluated bar is 21+ days later.
            const longer = wavyBars(230).map((b, i) =>
                i === BAD ? { ...b, close: Number.NaN } : b
            );
            const after = confirmedSignalTimeline(longer, {
                days: 30,
                lookbackDays,
            });
            const byIndex = (i: number) => after[i - (longer.length - 30)];
            expect(byIndex(BAD + lookbackDays).signals).toBeNull();
            expect(byIndex(BAD + lookbackDays + 1).signals).not.toBeNull();
            expect(byIndex(longer.length - 1).signals).not.toBeNull();
        });

        it('깨진 종가 자체의 changePercent는 null이다', () => {
            const broken = wavyBars(20).map((b, i) =>
                i === 19 ? { ...b, close: Number.POSITIVE_INFINITY } : b
            );
            const [day] = confirmedSignalTimeline(broken, { days: 1 });
            expect(day.changePercent).toBeNull();
            expect(day.signals).toBeNull();
        });

        it('시간순이 아닌 bars는 모든 날이 null이다', () => {
            const shuffled = [...BARS.slice(0, 100)].reverse();
            const timeline = confirmedSignalTimeline(shuffled, { days: 5 });
            expect(timeline).toHaveLength(5);
            expect(timeline.every(d => d.signals === null)).toBe(true);
            const duplicate = BARS.slice(0, 100).map((b, i) =>
                i === 50 ? { ...b, time: BARS[49].time } : b
            );
            expect(
                confirmedSignalTimeline(duplicate, { days: 3 }).map(
                    d => d.signals
                )
            ).toEqual([null, null, null]);
        });
    });

    describe('lookbackDays가 유효하지 않으면', () => {
        it('음수, 0, NaN, Infinity는 기본값과 같은 결과를 준다', () => {
            const expected = confirmedSignalTimeline(BARS, { days: 5 });
            [-5, 0, Number.NaN, Number.POSITIVE_INFINITY].forEach(
                lookbackDays => {
                    expect(
                        confirmedSignalTimeline(BARS, { days: 5, lookbackDays })
                    ).toEqual(expected);
                }
            );
        });
    });

    describe('detectNewConfirmedSignals와', () => {
        it('전날 없던 타입은 정확히 그 접두 구간의 새 신호와 같다', () => {
            const lookbackDays = 100_000; // window always covers the whole prefix
            const days = 80;
            const timeline = confirmedSignalTimeline(BARS, {
                days: days + 1,
                lookbackDays,
            });
            const base = BARS.length - days - 1;
            const newCounts = Array.from({ length: days }, (_, offset) => {
                const k = offset + 1;
                const previous = new Set(
                    typesOf(timeline[k - 1].signals ?? [])
                );
                const derived = (timeline[k].signals ?? []).filter(
                    s => !previous.has(s.type)
                );
                const direct = detectNewConfirmedSignals(
                    BARS.slice(0, base + k + 1)
                );
                expect(typesOf(derived)).toEqual(typesOf(direct));
                return direct.length;
            });
            expect(newCounts.some(n => n > 0)).toBe(true);
        });
    });

    describe('감지기 목록을 따로 갖지 않으므로', () => {
        it('detectSignals가 내놓는 모든 확정 타입이 나타날 수 있다', () => {
            const timeline = confirmedSignalTimeline(BARS, { days: 300 });
            const seen = new Set(
                timeline.flatMap(d => typesOf(d.signals ?? []))
            );
            expect(seen.size).toBeGreaterThan(5);
            expect(
                timeline
                    .flatMap(d => d.signals ?? [])
                    .every(s => s.phase === 'confirmed')
            ).toBe(true);
        });
    });
});

describe('SIGNAL_SCAN_DAILY_LOOKBACK_DAYS', () => {
    it("대시보드 '1Day' 룩백과 같은 값이다", () => {
        const now = new Date('2026-06-01T00:00:00.000Z');
        const from = new Date(lookbackIsoFromNow('1Day', now));
        expect((now.getTime() - from.getTime()) / (DAY_SECONDS * 1000)).toBe(
            SIGNAL_SCAN_DAILY_LOOKBACK_DAYS
        );
    });
});
