import { describe, expect, it } from 'vitest';
import { calculateIndicators } from '@/domain/indicators';
import { computeStockSignalResult } from '@/domain/dashboard';
import { detectSignals } from '@/domain/signals';
import { detectNewConfirmedSignals } from '@/domain/signals/newSignals';
import type { Bar, SectorStock, SignalType } from '@/domain/types';

function barsOf(closes: readonly number[]): Bar[] {
    return closes.map((close, i) => ({
        time: 1700000000 + i * 86400,
        open: close,
        high: close,
        low: close,
        close,
        volume: 1000,
    }));
}

function typesOf(signals: readonly { type: SignalType }[]): SignalType[] {
    return signals.map(s => s.type);
}

/** Every confirmed signal type on the bars, straight from the detectors. */
function confirmedTypesOf(bars: Bar[]): SignalType[] {
    return typesOf(
        detectSignals(bars, calculateIndicators(bars)).filter(
            s => s.phase === 'confirmed'
        )
    );
}

// 45 falling bars then a rising run: MA20 crosses above MA50 at the 60th bar.
const V_SHAPE: readonly number[] = [
    ...Array.from({ length: 45 }, (_, i) => 100 - i * 0.5),
    ...Array.from({ length: 30 }, (_, i) => 77.5 + i * 2),
];

// Flat, a rally, a drop out of overbought, then a second rally: RSI overbought
// holds on bars 33-44, is absent from 45 to 59 and restarts on the 60th bar.
const RESTART_SERIES: readonly number[] = [
    ...Array.from({ length: 30 }, (_, i) => 100 + Math.sin(i) * 0.5),
    ...Array.from({ length: 12 }, (_, i) => 100 + i * 2),
    ...Array.from({ length: 8 }, (_, i) => 122 - i * 3),
    ...Array.from({ length: 12 }, (_, i) => 101 + i * 2.5),
];

const STOCK: SectorStock = {
    symbol: 'TEST',
    koreanName: '테스트',
    sectorSymbol: 'XLK',
};

describe('detectNewConfirmedSignals', () => {
    describe('입력이 2봉 미만이면', () => {
        it('빈 배열을 반환한다', () => {
            expect(detectNewConfirmedSignals([])).toEqual([]);
            expect(detectNewConfirmedSignals(barsOf([100]))).toEqual([]);
        });
    });

    describe('골든크로스가 마지막 봉에서 처음 확정되면', () => {
        it('반환하고, 이전 봉에서 이미 있던 신호는 빼며, 확정 신호만 담는다', () => {
            const bars = barsOf(V_SHAPE.slice(0, 60));
            const result = detectNewConfirmedSignals(bars);

            // 이전 봉(59봉)에는 없고 마지막 봉(60봉)에만 있는 확정 신호 하나.
            expect(confirmedTypesOf(bars.slice(0, -1))).not.toContain(
                'golden_cross'
            );
            expect(typesOf(result)).toEqual(['golden_cross']);
            expect(result.every(s => s.phase === 'confirmed')).toBe(true);
        });
    });

    describe('골든크로스가 한 봉 전에 발생했으면(lookback 안)', () => {
        it('detectSignals에는 남아 있어도 새 신호가 아니다', () => {
            const bars = barsOf(V_SHAPE.slice(0, 61));

            expect(confirmedTypesOf(bars)).toContain('golden_cross');
            expect(typesOf(detectNewConfirmedSignals(bars))).not.toContain(
                'golden_cross'
            );
        });
    });

    describe('RSI 과매수가 계속 이어지면', () => {
        it('새 신호가 아니다', () => {
            // 60봉에서도 과매수 상태이고 59봉에서도 과매수 상태.
            const bars = barsOf(V_SHAPE.slice(0, 60));

            expect(confirmedTypesOf(bars)).toContain('rsi_overbought');
            expect(confirmedTypesOf(bars.slice(0, -1))).toContain(
                'rsi_overbought'
            );
            expect(typesOf(detectNewConfirmedSignals(bars))).not.toContain(
                'rsi_overbought'
            );
        });
    });

    describe('신호가 끝났다가 마지막 봉에서 다시 시작하면', () => {
        it('새 신호로 반환한다', () => {
            const bars = barsOf(RESTART_SERIES.slice(0, 60));

            // 앞선 구간(40봉)에는 있었고, 59봉에는 없고, 60봉에 다시 켜진다.
            expect(
                confirmedTypesOf(barsOf(RESTART_SERIES.slice(0, 40)))
            ).toContain('rsi_overbought');
            expect(confirmedTypesOf(bars.slice(0, -1))).not.toContain(
                'rsi_overbought'
            );
            expect(typesOf(detectNewConfirmedSignals(bars))).toContain(
                'rsi_overbought'
            );
        });

        it('다음 봉에서는 이어지는 상태라 더는 새 신호가 아니다', () => {
            const bars = barsOf(RESTART_SERIES.slice(0, 61));

            expect(typesOf(detectNewConfirmedSignals(bars))).not.toContain(
                'rsi_overbought'
            );
        });
    });

    describe('예상(expected) 단계 신호는', () => {
        it.each([
            [
                '재시작 시리즈 46봉',
                RESTART_SERIES,
                46,
                'macd_histogram_bearish_convergence',
            ],
            ['V자 시리즈 51봉', V_SHAPE, 51, 'resistance_proximity_bearish'],
        ] as const)(
            '%s: 마지막 봉에서 새로 켜진 %s 신호를 반환하지 않는다',
            (_, series, n, type) => {
                const bars = barsOf(series.slice(0, n));
                const before = bars.slice(0, -1);
                const expectedNow = detectSignals(
                    bars,
                    calculateIndicators(bars)
                ).filter(s => s.phase === 'expected');
                const expectedBefore = detectSignals(
                    before,
                    calculateIndicators(before)
                ).filter(s => s.phase === 'expected');

                // 전제: 이 예상 신호는 마지막 봉에서 새로 나타난다.
                expect(typesOf(expectedNow)).toContain(type);
                expect(typesOf(expectedBefore)).not.toContain(type);

                const result = detectNewConfirmedSignals(bars);

                expect(typesOf(result)).not.toContain(type);
                expect(result.every(s => s.phase === 'confirmed')).toBe(true);
            }
        );
    });

    // 이 블록은 허브 정의와의 일치(parity)만 확인한다. 둘 다 같은 detectSignals
    // 파이프라인을 거치므로 "새 신호" 규칙 자체는 위의 구체 케이스들이 지킨다.
    describe('허브 정의 일치(computeStockSignalResult와 같은 파이프라인, 규칙 검증 아님)', () => {
        it.each([
            ['V자 시리즈', V_SHAPE],
            ['재시작 시리즈', RESTART_SERIES],
        ])(
            '%s의 모든 접두 구간에서 "마지막 봉 확정 − 직전 봉 확정"과 같다',
            (_, series) => {
                const prefixLengths = Array.from(
                    { length: series.length - 1 },
                    (_, i) => i + 2
                );

                prefixLengths.forEach(n => {
                    const bars = barsOf(series.slice(0, n));
                    const nowSignals =
                        computeStockSignalResult(STOCK, bars, null)?.signals ??
                        [];
                    const prevSignals =
                        computeStockSignalResult(STOCK, bars.slice(0, -1), null)
                            ?.signals ?? [];
                    const prevConfirmed = new Set(
                        typesOf(
                            prevSignals.filter(s => s.phase === 'confirmed')
                        )
                    );
                    const expected = nowSignals.filter(
                        s =>
                            s.phase === 'confirmed' &&
                            !prevConfirmed.has(s.type)
                    );

                    expect(detectNewConfirmedSignals(bars)).toEqual(expected);
                });
            }
        );

        it('결과는 감지기 순서(detectSignals의 순서)를 따른다', () => {
            const bars = barsOf(RESTART_SERIES.slice(0, 60));
            const order = typesOf(
                detectSignals(bars, calculateIndicators(bars))
            );
            const result = typesOf(detectNewConfirmedSignals(bars));

            expect(result).toEqual(order.filter(t => result.includes(t)));
        });
    });

    describe('입력을 변경하지 않는다', () => {
        it('bars 배열 길이와 내용이 그대로다', () => {
            const bars = barsOf(V_SHAPE.slice(0, 60));
            const snapshot = JSON.stringify(bars);

            detectNewConfirmedSignals(bars);

            expect(JSON.stringify(bars)).toBe(snapshot);
        });
    });
});
