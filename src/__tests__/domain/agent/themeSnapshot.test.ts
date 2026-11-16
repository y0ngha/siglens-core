import { describe, expect, it } from 'vitest';
import { findAgentTheme } from '@/domain/agent/themes';
import { summarizeTheme } from '@/domain/agent/themeSnapshot';

const theme = findAgentTheme('quantum')!;
/** n개 종가: start에서 시작해 매일 step만큼 변한다. */
const series = (n: number, start: number, step: number) =>
    Array.from({ length: n }, (_, i) => start + i * step);

describe('summarizeTheme', () => {
    it('종목별 1·5·20거래일 등락률과 52주 고점 대비를 구한다', () => {
        const closes = [...series(251, 50, 0), 100, 90]; // 253개: 고점 100, 마지막 90
        const snap = summarizeTheme(theme, [
            { symbol: 'IONQ', name: 'IonQ', closes, lastDate: '2026-11-13' },
        ]);
        expect(snap.members[0]).toEqual({
            symbol: 'IONQ',
            name: 'IonQ',
            lastClose: 90,
            lastDate: '2026-11-13',
            changePct: { '1d': -10, '5d': 80, '20d': 80 },
            fromHigh52wPct: -10,
        });
    });

    it('기간별 동일가중 평균·중앙값(짝수 개)·상승/하락 수·최고·최저', () => {
        const member = (symbol: string, last: number) => ({
            symbol,
            name: null,
            closes: [100, last],
            lastDate: '2026-11-13',
        });
        const snap = summarizeTheme(theme, [
            member('A', 110),
            member('B', 95),
            member('C', 100),
            member('D', 120),
        ]);
        expect(snap.summary['1d']).toEqual({
            members: 4,
            avgPct: 6.25,
            medianPct: 5,
            up: 2,
            down: 1,
            flat: 1,
            best: { symbol: 'D', pct: 20 },
            worst: { symbol: 'B', pct: -5 },
        });
        expect(snap.members.map(m => m.symbol)).toEqual(['D', 'A', 'C', 'B']);
    });

    it('종가가 없는 종목은 missing, 기간에 모자란 종목은 그 기간에서만 빠진다', () => {
        const snap = summarizeTheme(theme, [
            { symbol: 'A', name: null, closes: [], lastDate: null },
            {
                symbol: 'B',
                name: null,
                closes: [100, 101],
                lastDate: '2026-11-13',
            },
            {
                symbol: 'C',
                name: null,
                closes: series(21, 100, 1),
                lastDate: '2026-11-13',
            },
        ]);
        expect(snap.missing).toEqual(['A']);
        expect(snap.summary['1d'].members).toBe(2);
        expect(snap.summary['20d'].members).toBe(1);
        expect(
            snap.members.find(m => m.symbol === 'B')?.fromHigh52wPct
        ).toBeNull();
    });

    it('아무 종목도 없으면 집계는 null·0', () => {
        const snap = summarizeTheme(theme, []);
        expect(snap.summary['5d']).toEqual({
            members: 0,
            avgPct: null,
            medianPct: null,
            up: 0,
            down: 0,
            flat: 0,
            best: null,
            worst: null,
        });
        expect(snap.theme).toEqual({
            id: 'quantum',
            nameKo: '양자컴퓨팅',
            nameEn: 'Quantum computing',
            market: 'us',
        });
    });

    it('중간의 잘못된 종가는 거기서 시계열을 끊어, 기간이 연속 거래일로만 센다', () => {
        const snap = summarizeTheme(theme, [
            {
                symbol: 'A',
                name: null,
                closes: [100, 100, 100, 100, 100, 100, Number.NaN, 90, 99],
                lastDate: '2026-11-13',
            },
            {
                symbol: 'B',
                name: null,
                closes: [100, 101, 0],
                lastDate: '2026-11-13',
            },
        ]);
        const a = snap.members.find(m => m.symbol === 'A')!;
        expect(a.changePct['1d']).toBe(10);
        expect(a.changePct['5d']).toBeNull();
        expect(snap.missing).toEqual(['B']);
    });

    it('반올림된 0은 -0이 아니다', () => {
        const snap = summarizeTheme(theme, [
            { symbol: 'A', name: null, closes: [100, 99.9999], lastDate: null },
        ]);
        expect(Object.is(snap.members[0]!.changePct['1d'], 0)).toBe(true);
        expect(snap.summary['1d'].flat).toBe(1);
    });
});
