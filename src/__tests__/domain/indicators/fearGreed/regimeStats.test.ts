import { describe, expect, it } from 'vitest';
import type { Bar } from '@/domain/types';
import {
    computeLabelTransitions,
    computeMarketScoreGap,
    EXTREME_ZONE_FORWARD_HORIZONS,
    EXTREME_ZONE_MIN_SAMPLE,
    EXTREME_ZONE_REENTRY_GAP,
    findExtremeZoneEntryOn,
    summarizeExtremeZoneEpisodes,
    summarizeExtremeZoneOutcomes,
} from '@/domain/indicators/fearGreed/regimeStats';
import { scoreToLabel } from '@/domain/indicators/fearGreed/composition';
import type {
    FearGreedLabel,
    FearGreedReading,
} from '@/domain/indicators/fearGreed/types';

/** Day `i` as an ISO date starting 2026-01-01 (calendar days; gaps are irrelevant here). */
function dateAt(i: number): string {
    const d = new Date(Date.UTC(2026, 0, 1 + i));
    return d.toISOString().slice(0, 10);
}

function reading(i: number, label: FearGreedLabel | null): FearGreedReading {
    const score =
        label === null
            ? null
            : {
                  EXTREME_FEAR: 10,
                  FEAR: 35,
                  NEUTRAL: 50,
                  GREED: 65,
                  EXTREME_GREED: 85,
              }[label];
    return { date: dateAt(i), score, label };
}

function historyOf(labels: (FearGreedLabel | null)[]): FearGreedReading[] {
    return labels.map((label, i) => reading(i, label));
}

function barsOf(closes: number[]): Bar[] {
    return closes.map((close, i) => ({
        time: Date.UTC(2026, 0, 1 + i) / 1000,
        open: close,
        high: close,
        low: close,
        close,
        volume: 1,
    }));
}

describe('computeLabelTransitions', () => {
    it('인접한 두 세션의 라벨이 다를 때만 전환으로 센다', () => {
        const history = historyOf(['FEAR', 'FEAR', 'NEUTRAL', 'NEUTRAL']);

        expect(computeLabelTransitions(history, 10)).toEqual([
            { date: dateAt(2), from: 'FEAR', to: 'NEUTRAL' },
        ]);
    });

    it('최신 전환이 먼저 오고 limit개까지만 돌려준다', () => {
        const history = historyOf(['FEAR', 'NEUTRAL', 'GREED', 'NEUTRAL']);

        expect(computeLabelTransitions(history, 2)).toEqual([
            { date: dateAt(3), from: 'GREED', to: 'NEUTRAL' },
            { date: dateAt(2), from: 'NEUTRAL', to: 'GREED' },
        ]);
    });

    it('라벨이 없는 세션은 전환 사슬을 끊는다 — 공백 직후 첫 라벨은 전환이 아니다', () => {
        const history = historyOf(['FEAR', null, 'GREED', 'GREED']);

        expect(computeLabelTransitions(history, 10)).toEqual([]);
    });

    it('limit이 1 이상의 정수가 아니면 빈 배열이다', () => {
        const history = historyOf(['FEAR', 'GREED']);

        expect(computeLabelTransitions(history, 0)).toEqual([]);
        expect(computeLabelTransitions(history, 1.5)).toEqual([]);
        expect(computeLabelTransitions(history, Number.NaN)).toEqual([]);
    });

    it('빈 히스토리는 빈 배열이다', () => {
        expect(computeLabelTransitions([], 5)).toEqual([]);
    });
});

describe('summarizeExtremeZoneOutcomes', () => {
    /**
     * 진입 5회: 각 진입 직후 2세션 뒤 종가가 +10%, +20%, +30%, +40%, +50%.
     * 패턴 한 묶음 = [중립(100), 극심한 공포(100), 중립, 중립(100×(1+r))].
     */
    function fiveFearEntries(): { history: FearGreedReading[]; bars: Bar[] } {
        const rises = [0.1, 0.2, 0.3, 0.4, 0.5];
        const labels: FearGreedLabel[] = rises.flatMap((): FearGreedLabel[] => [
            'NEUTRAL',
            'EXTREME_FEAR',
            'NEUTRAL',
            'NEUTRAL',
        ]);
        const closes = rises.flatMap(r => [100, 100, 100, 100 * (1 + r)]);
        return { history: historyOf(labels), bars: barsOf(closes) };
    }

    it('기본 구간은 5·20·60세션, 기본 최소 표본은 5다', () => {
        expect([...EXTREME_ZONE_FORWARD_HORIZONS]).toEqual([5, 20, 60]);
        expect(EXTREME_ZONE_MIN_SAMPLE).toBe(5);
    });

    it('진입 횟수와 구간별 변화율 중앙값(퍼센트)을 낸다', () => {
        const { history, bars } = fiveFearEntries();

        const [fear] = summarizeExtremeZoneOutcomes(history, bars, {
            reentryGap: 0,
            horizons: [2],
        });

        expect(fear.zone).toBe('EXTREME_FEAR');
        expect(fear.entryCount).toBe(5);
        expect(fear.status).toBe('ok');
        expect(fear.forward).toHaveLength(1);
        expect(fear.forward[0].horizon).toBe(2);
        expect(fear.forward[0].sampleSize).toBe(5);
        expect(fear.forward[0].median).toBeCloseTo(30);
    });

    it('극심한 공포 다음에 극심한 탐욕 순서로 돌려준다', () => {
        const { history, bars } = fiveFearEntries();

        const zones = summarizeExtremeZoneOutcomes(history, bars, {
            reentryGap: 0,
        }).map(o => o.zone);

        expect(zones).toEqual(['EXTREME_FEAR', 'EXTREME_GREED']);
    });

    it('진입이 최소 표본보다 적으면 상태가 insufficient_sample이고 중앙값을 숨긴다', () => {
        const { history, bars } = fiveFearEntries();

        const [fear] = summarizeExtremeZoneOutcomes(history, bars, {
            reentryGap: 0,
            horizons: [2],
            minSample: 6,
        });

        expect(fear.status).toBe('insufficient_sample');
        expect(fear.entryCount).toBe(5);
        expect(fear.forward[0].sampleSize).toBe(5);
        expect(fear.forward[0].median).toBeNull();
    });

    it('뒤에 구간만큼 데이터가 없는 진입은 그 구간 표본에서 빠진다', () => {
        const { history, bars } = fiveFearEntries();

        // 마지막 진입(인덱스 17) 뒤에는 2세션만 남아 3세션 구간을 잴 수 없다.
        const [fear] = summarizeExtremeZoneOutcomes(history, bars, {
            reentryGap: 0,
            horizons: [3],
            minSample: 4,
        });

        expect(fear.status).toBe('ok');
        expect(fear.forward[0].sampleSize).toBe(4);
        expect(fear.forward[0].median).not.toBeNull();
    });

    it('구간 표본이 최소 표본보다 작으면 진입 수가 충분해도 그 구간 중앙값은 null이다', () => {
        const { history, bars } = fiveFearEntries();

        const [fear] = summarizeExtremeZoneOutcomes(history, bars, {
            reentryGap: 0,
            horizons: [3],
        });

        expect(fear.status).toBe('ok');
        expect(fear.forward[0].sampleSize).toBe(4);
        expect(fear.forward[0].median).toBeNull();
    });

    it('구간 안에 머무는 동안은 다시 진입으로 세지 않는다', () => {
        const history = historyOf([
            'NEUTRAL',
            'EXTREME_GREED',
            'EXTREME_GREED',
            'EXTREME_GREED',
        ]);

        const [, greed] = summarizeExtremeZoneOutcomes(
            history,
            barsOf([1, 1, 1, 1])
        );

        expect(greed.entryCount).toBe(1);
    });

    it('라벨 공백 직후 바로 극단 구간이면 진입으로 세지 않는다', () => {
        const history = historyOf([null, 'EXTREME_FEAR', 'NEUTRAL']);

        const [fear] = summarizeExtremeZoneOutcomes(history, barsOf([1, 1, 1]));

        expect(fear.entryCount).toBe(0);
    });

    it('기준 종가가 0 이하인 진입은 변화율을 계산하지 않는다', () => {
        const history = historyOf(['NEUTRAL', 'EXTREME_FEAR', 'NEUTRAL']);

        const [fear] = summarizeExtremeZoneOutcomes(
            history,
            barsOf([1, 0, 5]),
            { horizons: [1], minSample: 1 }
        );

        expect(fear.entryCount).toBe(1);
        expect(fear.forward[0].sampleSize).toBe(0);
        expect(fear.forward[0].median).toBeNull();
    });

    it('1 미만이거나 정수가 아닌 구간은 무시한다', () => {
        const { history, bars } = fiveFearEntries();

        const [fear] = summarizeExtremeZoneOutcomes(history, bars, {
            reentryGap: 0,
            horizons: [0, 1.5, -2, 2],
        });

        expect(fear.forward.map(f => f.horizon)).toEqual([2]);
    });

    it('기본 재진입 간격은 20세션이다', () => {
        expect(EXTREME_ZONE_REENTRY_GAP).toBe(20);
    });

    it('재진입 간격 안에 같은 구간으로 돌아오면 같은 국면으로 보고 다시 세지 않는다', () => {
        // 경계에서 하루씩 들락날락: 진입(1) → 이탈 → 3세션 뒤 재진입(4)
        const history = historyOf([
            'NEUTRAL',
            'EXTREME_FEAR',
            'NEUTRAL',
            'NEUTRAL',
            'EXTREME_FEAR',
        ]);
        const bars = barsOf([1, 1, 1, 1, 1]);

        const [withGap] = summarizeExtremeZoneOutcomes(history, bars, {
            reentryGap: 3,
        });
        const [noGap] = summarizeExtremeZoneOutcomes(history, bars, {
            reentryGap: 0,
        });

        expect(withGap.entryCount).toBe(1);
        expect(noGap.entryCount).toBe(2);
    });

    it('재진입 간격보다 오래 떨어져 있다 돌아오면 새 진입으로 센다', () => {
        const history = historyOf([
            'NEUTRAL',
            'EXTREME_FEAR',
            'NEUTRAL',
            'NEUTRAL',
            'NEUTRAL',
            'EXTREME_FEAR',
        ]);

        const [fear] = summarizeExtremeZoneOutcomes(
            history,
            barsOf([1, 1, 1, 1, 1, 1]),
            { reentryGap: 3 }
        );

        expect(fear.entryCount).toBe(2);
    });

    it('재진입 간격이 0 이상의 정수가 아니면 기본값(20)을 쓴다', () => {
        const history = historyOf([
            'NEUTRAL',
            'EXTREME_FEAR',
            'NEUTRAL',
            'EXTREME_FEAR',
        ]);
        const bars = barsOf([1, 1, 1, 1]);

        const [negative] = summarizeExtremeZoneOutcomes(history, bars, {
            reentryGap: -1,
        });
        const [fraction] = summarizeExtremeZoneOutcomes(history, bars, {
            reentryGap: 1.5,
        });

        expect(negative.entryCount).toBe(1);
        expect(fraction.entryCount).toBe(1);
    });

    it('종가에 유한하지 않은 값이 섞인 진입은 표본에서 뺀다', () => {
        // 기준 종가(인덱스 1)는 정상이고 1세션 뒤 종가가 NaN — `returnOver`는
        // null이 아니라 NaN을 돌려주므로 `Number.isFinite` 가드만 이 진입을 거른다.
        const history = historyOf(['NEUTRAL', 'EXTREME_FEAR', 'NEUTRAL']);

        const [fear] = summarizeExtremeZoneOutcomes(
            history,
            barsOf([1, 1, Number.NaN]),
            { horizons: [1], minSample: 1 }
        );

        expect(fear.entryCount).toBe(1);
        expect(fear.forward[0].sampleSize).toBe(0);
        expect(fear.forward[0].median).toBeNull();
    });

    it('히스토리와 봉 길이가 다르면 정렬을 추측하지 않고 빈 배열을 돌려준다', () => {
        const history = historyOf(['NEUTRAL', 'EXTREME_FEAR']);

        expect(summarizeExtremeZoneOutcomes(history, barsOf([1]))).toEqual([]);
    });

    it('결과에는 숫자와 상태값만 있고 문장 필드가 없다', () => {
        const { history, bars } = fiveFearEntries();

        const [fear] = summarizeExtremeZoneOutcomes(history, bars, {
            reentryGap: 0,
            horizons: [2],
        });

        expect(Object.keys(fear).toSorted()).toEqual(
            ['entryCount', 'forward', 'status', 'zone'].toSorted()
        );
        expect(Object.keys(fear.forward[0]).toSorted()).toEqual(
            ['horizon', 'median', 'sampleSize'].toSorted()
        );
    });
});

describe('computeMarketScoreGap', () => {
    const symbolHistory: FearGreedReading[] = [
        { date: '2026-10-01', score: 60, label: 'GREED' },
        { date: '2026-10-02', score: 70, label: 'GREED' },
    ];

    it('같은 날짜의 종목 점수 − 시장 점수를 돌려준다', () => {
        const gap = computeMarketScoreGap(symbolHistory, {
            date: '2026-10-01',
            score: 45,
            label: 'NEUTRAL',
        });

        expect(gap).toEqual({
            date: '2026-10-01',
            symbolScore: 60,
            marketScore: 45,
            gap: 15,
        });
    });

    it('같은 날짜가 없으면 다른 날끼리 비교하지 않고 null이다', () => {
        const gap = computeMarketScoreGap(symbolHistory, {
            date: '2026-10-03',
            score: 45,
            label: 'NEUTRAL',
        });

        expect(gap).toBeNull();
    });

    it('시장 점수가 null이면 null이다', () => {
        const gap = computeMarketScoreGap(symbolHistory, {
            date: '2026-10-02',
            score: null,
            label: null,
        });

        expect(gap).toBeNull();
    });

    it('그 날짜의 종목 점수가 null이면 null이다', () => {
        const gap = computeMarketScoreGap(
            [{ date: '2026-10-02', score: null, label: null }],
            { date: '2026-10-02', score: 50, label: 'NEUTRAL' }
        );

        expect(gap).toBeNull();
    });
});

describe('summarizeExtremeZoneEpisodes', () => {
    /** `n`개의 같은 라벨. */
    const run = (label: FearGreedLabel | null, n: number) =>
        Array.from({ length: n }, () => label);

    function zoneOf(
        history: FearGreedReading[],
        zone: 'EXTREME_FEAR' | 'EXTREME_GREED',
        reentryGap?: number
    ) {
        const result = summarizeExtremeZoneEpisodes(history, { reentryGap });
        const found = result.find(r => r.zone === zone);
        expect(found).toBeDefined();
        return found!;
    }

    it('구간마다 하나씩, 공포 다음 탐욕 순서로 돌려준다', () => {
        const result = summarizeExtremeZoneEpisodes(historyOf(['NEUTRAL']));

        expect(result.map(r => r.zone)).toEqual([
            'EXTREME_FEAR',
            'EXTREME_GREED',
        ]);
    });

    it('기록이 없으면 진입 0회, 빈 목록, 머문 기간 중앙값 null이다', () => {
        const fear = zoneOf(historyOf(run('NEUTRAL', 10)), 'EXTREME_FEAR');

        expect(fear).toEqual({
            zone: 'EXTREME_FEAR',
            entryCount: 0,
            medianSessionsInZone: null,
            episodes: [],
        });
    });

    it('진입일·마지막 날·머문 세션 수를 기록한다', () => {
        const history = historyOf([
            'NEUTRAL',
            'EXTREME_FEAR',
            'EXTREME_FEAR',
            'EXTREME_FEAR',
            'NEUTRAL',
            'NEUTRAL',
        ]);

        expect(zoneOf(history, 'EXTREME_FEAR').episodes).toEqual([
            {
                startDate: dateAt(1),
                endDate: dateAt(3),
                sessionsInZone: 3,
                peakScore: 10,
                ongoing: false,
            },
        ]);
    });

    it('재진입 간격 안에 돌아온 날은 같은 기록으로 묶고, 잠깐 빠진 날은 세지 않는다', () => {
        const history = historyOf([
            'NEUTRAL',
            'EXTREME_FEAR',
            'EXTREME_FEAR',
            'FEAR',
            'FEAR',
            'EXTREME_FEAR',
            'NEUTRAL',
        ]);

        const fear = zoneOf(history, 'EXTREME_FEAR', 5);

        expect(fear.entryCount).toBe(1);
        expect(fear.episodes).toEqual([
            expect.objectContaining({
                startDate: dateAt(1),
                endDate: dateAt(5),
                sessionsInZone: 3,
            }),
        ]);
    });

    it('재진입 간격보다 늦게 돌아오면 새 기록이고, 최신 기록이 먼저 온다', () => {
        const history = historyOf([
            'NEUTRAL',
            'EXTREME_FEAR',
            ...run('NEUTRAL', 3),
            'EXTREME_FEAR',
            'EXTREME_FEAR',
            'NEUTRAL',
        ]);

        const fear = zoneOf(history, 'EXTREME_FEAR', 2);

        expect(fear.entryCount).toBe(2);
        expect(fear.episodes.map(e => [e.startDate, e.sessionsInZone])).toEqual(
            [
                [dateAt(5), 2],
                [dateAt(1), 1],
            ]
        );
        expect(fear.medianSessionsInZone).toBe(1.5);
    });

    it('공포는 가장 낮은 점수, 탐욕은 가장 높은 점수를 극값으로 둔다', () => {
        const history: FearGreedReading[] = [
            { date: dateAt(0), score: 50, label: 'NEUTRAL' },
            { date: dateAt(1), score: 20, label: 'EXTREME_FEAR' },
            { date: dateAt(2), score: 7, label: 'EXTREME_FEAR' },
            { date: dateAt(3), score: 15, label: 'EXTREME_FEAR' },
            { date: dateAt(4), score: 50, label: 'NEUTRAL' },
            { date: dateAt(5), score: 80, label: 'EXTREME_GREED' },
            { date: dateAt(6), score: 93, label: 'EXTREME_GREED' },
            { date: dateAt(7), score: 82, label: 'EXTREME_GREED' },
        ];

        expect(zoneOf(history, 'EXTREME_FEAR').episodes[0].peakScore).toBe(7);
        expect(zoneOf(history, 'EXTREME_GREED').episodes[0].peakScore).toBe(93);
    });

    it('점수가 빠진 비정상 세션은 극값에서 빼고, 점수가 하나도 없으면 null이다', () => {
        const partial: FearGreedReading[] = [
            { date: dateAt(0), score: 50, label: 'NEUTRAL' },
            { date: dateAt(1), score: null, label: 'EXTREME_FEAR' },
            { date: dateAt(2), score: 12, label: 'EXTREME_FEAR' },
        ];
        const none: FearGreedReading[] = [
            { date: dateAt(0), score: 50, label: 'NEUTRAL' },
            { date: dateAt(1), score: null, label: 'EXTREME_FEAR' },
        ];

        expect(zoneOf(partial, 'EXTREME_FEAR').episodes[0].peakScore).toBe(12);
        expect(zoneOf(none, 'EXTREME_FEAR').episodes[0].peakScore).toBeNull();
    });

    it('히스토리의 마지막 세션이 그 구간이면 진행 중으로 표시한다', () => {
        const history = historyOf([
            'NEUTRAL',
            'EXTREME_GREED',
            'EXTREME_GREED',
        ]);

        expect(zoneOf(history, 'EXTREME_GREED').episodes[0]).toEqual(
            expect.objectContaining({ endDate: dateAt(2), ongoing: true })
        );
    });

    it('마지막 세션이 구간을 잠깐 벗어나 있으면 진행 중이 아니다', () => {
        const history = historyOf(['NEUTRAL', 'EXTREME_GREED', 'GREED']);

        expect(zoneOf(history, 'EXTREME_GREED').episodes[0].ongoing).toBe(
            false
        );
    });

    it('워밍업 공백 뒤 바로 이어진 구간 세션은 진입이 아니고 앞 기록을 늘리지도 않는다', () => {
        const history = historyOf([
            'NEUTRAL',
            'EXTREME_FEAR',
            'NEUTRAL',
            ...run(null, 4),
            'EXTREME_FEAR',
            'EXTREME_FEAR',
        ]);

        const fear = zoneOf(history, 'EXTREME_FEAR', 2);

        expect(fear.entryCount).toBe(1);
        expect(fear.episodes).toEqual([
            expect.objectContaining({
                startDate: dateAt(1),
                endDate: dateAt(1),
                sessionsInZone: 1,
                ongoing: false,
            }),
        ]);
    });

    it('정수가 아니거나 음수인 재진입 간격은 기본값으로 처리한다', () => {
        const history = historyOf([
            'NEUTRAL',
            'EXTREME_FEAR',
            // 기본 간격과 정확히 같은 거리 — 기본값이면 같은 기록, 0이면 새 진입.
            ...run('NEUTRAL', EXTREME_ZONE_REENTRY_GAP - 1),
            'EXTREME_FEAR',
        ]);

        expect(zoneOf(history, 'EXTREME_FEAR', -1).entryCount).toBe(1);
        expect(zoneOf(history, 'EXTREME_FEAR', 1.5).entryCount).toBe(1);
        expect(zoneOf(history, 'EXTREME_FEAR', 0).entryCount).toBe(2);
    });

    it('진입 횟수는 수익률 집계(summarizeExtremeZoneOutcomes)와 같다', () => {
        const labels: FearGreedLabel[] = [
            'NEUTRAL',
            'EXTREME_FEAR',
            'FEAR',
            'EXTREME_FEAR',
            ...run('NEUTRAL', 25),
            'EXTREME_GREED',
            'GREED',
            ...run('NEUTRAL', 25),
            'EXTREME_FEAR',
            'EXTREME_GREED',
        ] as FearGreedLabel[];
        const history = historyOf(labels);
        const bars = barsOf(labels.map(() => 100));

        const episodes = summarizeExtremeZoneEpisodes(history);
        const outcomes = summarizeExtremeZoneOutcomes(history, bars);

        expect(episodes.map(e => [e.zone, e.entryCount])).toEqual(
            outcomes.map(o => [o.zone, o.entryCount])
        );
        expect(episodes.map(e => e.episodes.length)).toEqual(
            episodes.map(e => e.entryCount)
        );
    });
});

describe('findExtremeZoneEntryOn', () => {
    const run = (label: FearGreedLabel | null, n: number) =>
        Array.from({ length: n }, () => label);

    describe('구간 진입 세션이면', () => {
        it('구간·날짜·점수·직전 라벨을 담은 진입을 반환한다', () => {
            const history = historyOf(['NEUTRAL', 'FEAR', 'EXTREME_FEAR']);

            expect(findExtremeZoneEntryOn(history, dateAt(2))).toEqual({
                zone: 'EXTREME_FEAR',
                date: dateAt(2),
                score: 10,
                previousLabel: 'FEAR',
            });
        });

        it('탐욕 쪽 진입도 반환한다', () => {
            const history = historyOf(['GREED', 'EXTREME_GREED']);

            expect(findExtremeZoneEntryOn(history, dateAt(1))).toEqual({
                zone: 'EXTREME_GREED',
                date: dateAt(1),
                score: 85,
                previousLabel: 'GREED',
            });
        });
    });

    describe('진입이 아닌 세션이면 null이다', () => {
        it('구간에 머무르는 둘째 날 이후', () => {
            const history = historyOf([
                'NEUTRAL',
                'EXTREME_FEAR',
                'EXTREME_FEAR',
                'EXTREME_FEAR',
            ]);

            expect(findExtremeZoneEntryOn(history, dateAt(1))).not.toBeNull();
            expect(findExtremeZoneEntryOn(history, dateAt(2))).toBeNull();
            expect(findExtremeZoneEntryOn(history, dateAt(3))).toBeNull();
        });

        it('극단 구간이 아닌 라벨', () => {
            const history = historyOf(['NEUTRAL', 'FEAR', 'GREED']);

            expect(findExtremeZoneEntryOn(history, dateAt(1))).toBeNull();
            expect(findExtremeZoneEntryOn(history, dateAt(2))).toBeNull();
        });

        it('히스토리에 없는 날짜', () => {
            const history = historyOf(['NEUTRAL', 'EXTREME_FEAR']);

            expect(findExtremeZoneEntryOn(history, '2025-01-01')).toBeNull();
            expect(findExtremeZoneEntryOn([], dateAt(0))).toBeNull();
        });

        it('같은 날짜가 두 번 나오면 모호하므로 null이다(첫 일치를 고르지 않는다)', () => {
            const history = historyOf(['NEUTRAL', 'EXTREME_FEAR']);
            const duplicated = [...history, { ...history[1] }];

            expect(findExtremeZoneEntryOn(history, dateAt(1))).not.toBeNull();
            expect(findExtremeZoneEntryOn(duplicated, dateAt(1))).toBeNull();
        });

        it('직전 세션 라벨이 null이면(워밍업 공백) 진입이 아니다', () => {
            const history = historyOf([null, 'EXTREME_GREED']);

            expect(findExtremeZoneEntryOn(history, dateAt(1))).toBeNull();
        });

        it('히스토리 첫 세션(직전 세션이 없다)', () => {
            const history = historyOf(['EXTREME_FEAR', 'NEUTRAL']);

            expect(findExtremeZoneEntryOn(history, dateAt(0))).toBeNull();
        });

        it('워밍업 공백(label: null) 바로 뒤 첫 라벨 세션', () => {
            const history = historyOf([null, null, 'EXTREME_FEAR', 'NEUTRAL']);

            expect(findExtremeZoneEntryOn(history, dateAt(2))).toBeNull();
        });
    });

    describe('재진입 간격 경계', () => {
        // 마지막 구간 세션이 인덱스 1이면, 인덱스 r에서의 재진입은
        // r - 1 > reentryGap 일 때만 새 진입이다. 기본값 20이면 r = 22부터.
        it('간격이 정확히 reentryGap이면 같은 국면이라 null이다', () => {
            const history = historyOf([
                'NEUTRAL',
                'EXTREME_FEAR',
                ...run('NEUTRAL', EXTREME_ZONE_REENTRY_GAP - 1),
                'EXTREME_FEAR',
            ]);
            const last = history.length - 1;

            expect(last - 1).toBe(EXTREME_ZONE_REENTRY_GAP);
            expect(findExtremeZoneEntryOn(history, dateAt(last))).toBeNull();
        });

        it('간격이 reentryGap + 1이면 새 진입이다', () => {
            const history = historyOf([
                'NEUTRAL',
                'EXTREME_FEAR',
                ...run('NEUTRAL', EXTREME_ZONE_REENTRY_GAP),
                'EXTREME_FEAR',
            ]);
            const last = history.length - 1;

            expect(last - 1).toBe(EXTREME_ZONE_REENTRY_GAP + 1);
            expect(findExtremeZoneEntryOn(history, dateAt(last))).toEqual({
                zone: 'EXTREME_FEAR',
                date: dateAt(last),
                score: 10,
                previousLabel: 'NEUTRAL',
            });
        });

        it('options.reentryGap을 따른다(간격 3: 3 이하면 같은 국면)', () => {
            const history = historyOf([
                'NEUTRAL',
                'EXTREME_FEAR',
                'NEUTRAL',
                'NEUTRAL',
                'EXTREME_FEAR',
            ]);

            expect(findExtremeZoneEntryOn(history, dateAt(4))).toBeNull();
            expect(
                findExtremeZoneEntryOn(history, dateAt(4), { reentryGap: 3 })
            ).toBeNull();
            expect(
                findExtremeZoneEntryOn(history, dateAt(4), { reentryGap: 2 })
            ).not.toBeNull();
            expect(
                findExtremeZoneEntryOn(history, dateAt(4), { reentryGap: 0 })
            ).not.toBeNull();
        });

        it('잘못된 reentryGap은 기본값으로 되돌린다', () => {
            const history = historyOf([
                'NEUTRAL',
                'EXTREME_FEAR',
                'NEUTRAL',
                'EXTREME_FEAR',
            ]);

            [-1, 1.5, Number.NaN].forEach(reentryGap => {
                expect(
                    findExtremeZoneEntryOn(history, dateAt(3), { reentryGap })
                ).toBeNull();
            });
        });

        it('다른 구간의 방문은 간격에 영향을 주지 않는다', () => {
            const history = historyOf([
                'NEUTRAL',
                'EXTREME_FEAR',
                'EXTREME_GREED',
                'EXTREME_FEAR',
            ]);

            expect(findExtremeZoneEntryOn(history, dateAt(2))).not.toBeNull();
            expect(findExtremeZoneEntryOn(history, dateAt(3))).toBeNull();
        });
    });

    describe('25 / 75 경계(scoreToLabel로 만든 라벨)', () => {
        function historyFromScores(scores: number[]): FearGreedReading[] {
            return scores.map((score, i) => ({
                date: dateAt(i),
                score,
                label: scoreToLabel(score),
            }));
        }

        it('25점은 극단 공포가 아니라 진입이 아니다, 24.99점은 진입이다', () => {
            const at25 = historyFromScores([50, 25]);
            const below = historyFromScores([50, 24.99]);

            expect(findExtremeZoneEntryOn(at25, dateAt(1))).toBeNull();
            expect(findExtremeZoneEntryOn(below, dateAt(1))).toEqual({
                zone: 'EXTREME_FEAR',
                date: dateAt(1),
                score: 24.99,
                previousLabel: 'NEUTRAL',
            });
        });

        it('75점은 극단 탐욕 진입이고, 74.99점은 진입이 아니다', () => {
            const at75 = historyFromScores([60, 75]);
            const below = historyFromScores([60, 74.99]);

            expect(findExtremeZoneEntryOn(at75, dateAt(1))).toEqual({
                zone: 'EXTREME_GREED',
                date: dateAt(1),
                score: 75,
                previousLabel: 'GREED',
            });
            expect(findExtremeZoneEntryOn(below, dateAt(1))).toBeNull();
        });
    });

    describe('비정상 입력은 fail-closed다', () => {
        it('진입 세션의 점수가 null이면 null이다', () => {
            const history: FearGreedReading[] = [
                { date: dateAt(0), score: 50, label: 'NEUTRAL' },
                { date: dateAt(1), score: null, label: 'EXTREME_FEAR' },
            ];

            expect(findExtremeZoneEntryOn(history, dateAt(1))).toBeNull();
        });

        it.each([Number.NaN, Number.POSITIVE_INFINITY])(
            '진입 세션의 점수가 %s이면 null이다',
            score => {
                const history: FearGreedReading[] = [
                    { date: dateAt(0), score: 50, label: 'NEUTRAL' },
                    { date: dateAt(1), score, label: 'EXTREME_FEAR' },
                ];

                expect(findExtremeZoneEntryOn(history, dateAt(1))).toBeNull();
            }
        );

        it('입력 히스토리를 변경하지 않는다', () => {
            const history = historyOf(['NEUTRAL', 'EXTREME_FEAR']);
            const snapshot = JSON.stringify(history);

            findExtremeZoneEntryOn(history, dateAt(1));

            expect(JSON.stringify(history)).toBe(snapshot);
        });
    });

    describe('summarizeExtremeZoneEpisodes와의 일치', () => {
        it('긴 합성 히스토리에서 모든 episode.startDate는 진입이고 다른 날짜는 진입이 아니다', () => {
            // 결정적 의사 난수로 5개 라벨을 섞고, 워밍업 공백도 끼워 넣는다.
            const labels: (FearGreedLabel | null)[] = Array.from(
                { length: 600 },
                (_, i) => {
                    if (i < 3 || (i >= 300 && i < 303)) return null;
                    const r = (i * 7919 + (i % 13) * 104729) % 100;
                    if (r < 8) return 'EXTREME_FEAR';
                    if (r < 25) return 'FEAR';
                    if (r < 70) return 'NEUTRAL';
                    if (r < 92) return 'GREED';
                    return 'EXTREME_GREED';
                }
            );
            const history = historyOf(labels);

            [undefined, 0, 5, EXTREME_ZONE_REENTRY_GAP].forEach(reentryGap => {
                const options = { reentryGap };
                const starts = new Set(
                    summarizeExtremeZoneEpisodes(history, options).flatMap(
                        summary => summary.episodes.map(e => e.startDate)
                    )
                );
                const entryDates = history
                    .map(point => point.date)
                    .filter(
                        date =>
                            findExtremeZoneEntryOn(history, date, options) !==
                            null
                    );

                expect(starts.size).toBeGreaterThan(5);
                expect(new Set(entryDates)).toEqual(starts);
                expect(entryDates.length).toBe(starts.size);
            });
        });
    });
});
