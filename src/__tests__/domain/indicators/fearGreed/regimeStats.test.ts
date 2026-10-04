import { describe, expect, it } from 'vitest';
import type { Bar } from '@/domain/types';
import {
    computeLabelTransitions,
    computeMarketScoreGap,
    EXTREME_ZONE_FORWARD_HORIZONS,
    EXTREME_ZONE_MIN_SAMPLE,
    summarizeExtremeZoneOutcomes,
} from '@/domain/indicators/fearGreed/regimeStats';
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

    it('limit이 1보다 작으면 빈 배열이다', () => {
        const history = historyOf(['FEAR', 'GREED']);

        expect(computeLabelTransitions(history, 0)).toEqual([]);
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

        const zones = summarizeExtremeZoneOutcomes(history, bars).map(
            o => o.zone
        );

        expect(zones).toEqual(['EXTREME_FEAR', 'EXTREME_GREED']);
    });

    it('진입이 최소 표본보다 적으면 상태가 insufficient_sample이고 중앙값을 숨긴다', () => {
        const { history, bars } = fiveFearEntries();

        const [fear] = summarizeExtremeZoneOutcomes(history, bars, {
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
            horizons: [0, 1.5, -2, 2],
        });

        expect(fear.forward.map(f => f.horizon)).toEqual([2]);
    });

    it('히스토리와 봉 길이가 다르면 정렬을 추측하지 않고 빈 배열을 돌려준다', () => {
        const history = historyOf(['NEUTRAL', 'EXTREME_FEAR']);

        expect(summarizeExtremeZoneOutcomes(history, barsOf([1]))).toEqual([]);
    });

    it('결과에는 숫자와 상태값만 있고 문장 필드가 없다', () => {
        const { history, bars } = fiveFearEntries();

        const [fear] = summarizeExtremeZoneOutcomes(history, bars, {
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
