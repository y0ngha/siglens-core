import { describe, it, expect } from 'vitest';
import {
    CONFLUENCE_EXIT_MIN,
    CONFLUENCE_EXIT_SCORE,
    CONFLUENCE_EXPECTED_WEIGHT,
    CONFLUENCE_HTF_MODE,
    CONFLUENCE_MIN,
    CONFLUENCE_MIN_BARS,
    CONFLUENCE_SPAN,
    CONFLUENCE_TRIGGER_SCORE,
    confluenceFamilyWeight,
    evaluateConfluence,
    isConfluenceExit,
    scoreConfluence,
    signalFamily,
    VOLUME_FAMILIES,
} from '@/domain/signals/confluence';
import type {
    ConfluenceParams,
    ConfluenceSnapshot,
} from '@/domain/signals/confluence';
import type {
    Bar,
    ConfirmedSignalType,
    ExpectedSignalType,
} from '@/domain/types';

/** `closes`를 그대로 종가로 갖는 봉 배열. */
function buildBars(closes: number[]): Bar[] {
    return closes.map((c, i) => ({
        time: 1700000000 + i * 1800,
        open: c,
        high: c * 1.001,
        low: c * 0.999,
        close: c,
        volume: 1000 + i,
    }));
}

/** 우상향 n개 봉. */
function risingBars(n: number, start = 100, step = 0.5): Bar[] {
    return buildBars(Array.from({ length: n }, (_, i) => start + i * step));
}

const DEFAULT_PARAMS: ConfluenceParams = {
    min: CONFLUENCE_MIN,
    exitMin: CONFLUENCE_EXIT_MIN,
    span: CONFLUENCE_SPAN,
    expectedWeight: CONFLUENCE_EXPECTED_WEIGHT,
    htf: null,
    requireVolume: false,
};

function snapshot(over: Partial<ConfluenceSnapshot> = {}): ConfluenceSnapshot {
    return {
        timeframe: '30Min',
        barTime: 1700000000,
        close: 100,
        ma50: 90,
        bullish: [],
        bearish: [],
        freshBullish: [],
        freshBearish: [],
        htfTrend: null,
        params: DEFAULT_PARAMS,
        entryTrigger: false,
        exitTrigger: false,
        ...over,
    };
}

/**
 * core가 실제로 내보내는 시그널 타입 전수. 계열 매핑이 카탈로그를 빠짐없이 덮는지
 * 검증하는 데 쓴다 — 새 디텍터가 추가되면 이 목록도 타입 오류로 함께 깨진다.
 */
const CONFIRMED: ConfirmedSignalType[] = [
    'rsi_oversold',
    'rsi_overbought',
    'golden_cross',
    'death_cross',
    'macd_bullish_cross',
    'macd_bearish_cross',
    'bollinger_lower_bounce',
    'bollinger_upper_breakout',
    'bollinger_percentb_oversold',
    'bollinger_percentb_overbought',
    'supertrend_bullish_flip',
    'parabolic_sar_flip',
    'ichimoku_cloud_breakout',
    'cci_bullish_cross',
    'dmi_bullish_cross',
    'cmf_bullish_flip',
    'mfi_oversold_bounce',
    'keltner_upper_breakout',
    'squeeze_momentum_bullish',
    'keltner_lower_breakout',
    'supertrend_bearish_flip',
    'ichimoku_cloud_breakdown',
    'cci_bearish_cross',
    'dmi_bearish_cross',
    'cmf_bearish_flip',
    'mfi_overbought_reversal',
    'parabolic_sar_bearish_flip',
    'squeeze_momentum_bearish',
];

const EXPECTED: ExpectedSignalType[] = [
    'rsi_bullish_divergence',
    'rsi_bearish_divergence',
    'macd_histogram_bullish_convergence',
    'macd_histogram_bearish_convergence',
    'bollinger_squeeze_bullish',
    'bollinger_squeeze_bearish',
    'support_proximity_bullish',
    'resistance_proximity_bearish',
];

describe('signalFamily', () => {
    it('카탈로그 36종이 모두 계열에 매핑돼 있다', () => {
        const unmapped = [...CONFIRMED, ...EXPECTED].filter(
            t => signalFamily(t) === t
        );
        expect(unmapped).toEqual([]);
    });

    it('14개 계열로 접힌다 — 36종은 지표 14개의 변형이다', () => {
        const families = new Set([...CONFIRMED, ...EXPECTED].map(signalFamily));
        expect(families.size).toBe(14);
    });

    it('같은 지표의 시그널은 같은 계열이다', () => {
        expect(signalFamily('rsi_oversold')).toBe(
            signalFamily('rsi_bullish_divergence')
        );
        expect(signalFamily('golden_cross')).toBe(signalFamily('death_cross'));
        expect(signalFamily('bollinger_lower_bounce')).toBe(
            signalFamily('bollinger_squeeze_bullish')
        );
    });

    it('미등록 타입은 자기 자신이 계열이다 — 새 디텍터가 0표가 되지 않는다', () => {
        expect(signalFamily('some_future_detector')).toBe(
            'some_future_detector'
        );
    });

    it('거래량 계열은 core에서 거래량을 쓰는 것들뿐이다', () => {
        expect([...VOLUME_FAMILIES].sort()).toEqual(['cmf', 'mfi']);
        expect(VOLUME_FAMILIES.has(signalFamily('cmf_bullish_flip'))).toBe(
            true
        );
        expect(VOLUME_FAMILIES.has(signalFamily('mfi_oversold_bounce'))).toBe(
            true
        );
        expect(VOLUME_FAMILIES.has(signalFamily('rsi_oversold'))).toBe(false);
    });
});

describe('confluenceFamilyWeight', () => {
    it('confirmed 시그널은 계열당 1표', () => {
        expect(confluenceFamilyWeight(['cci_bullish_cross'])).toBe(1);
        expect(
            confluenceFamilyWeight(['cci_bullish_cross', 'macd_bullish_cross'])
        ).toBe(2);
    });

    it('같은 계열이 여러 종 켜져도 한 표다', () => {
        expect(
            confluenceFamilyWeight([
                'bollinger_lower_bounce',
                'bollinger_percentb_oversold',
                'bollinger_squeeze_bullish',
            ])
        ).toBe(1);
    });

    it('expected는 반표다', () => {
        expect(confluenceFamilyWeight(['support_proximity_bullish'])).toBe(0.5);
        expect(
            confluenceFamilyWeight([
                'cci_bullish_cross',
                'support_proximity_bullish',
            ])
        ).toBe(1.5);
    });

    it('한 계열에 confirmed와 expected가 같이 있으면 높은 쪽만 센다', () => {
        expect(
            confluenceFamilyWeight(['rsi_oversold', 'rsi_bullish_divergence'])
        ).toBe(1);
    });

    it('expected 8종이 전부 반표로 잡힌다 — 목록 누락 회귀', () => {
        for (const t of EXPECTED) {
            expect(confluenceFamilyWeight([t]), t).toBe(
                CONFLUENCE_EXPECTED_WEIGHT
            );
        }
    });

    it('confirmed 28종은 전부 온표다', () => {
        for (const t of CONFIRMED) {
            expect(confluenceFamilyWeight([t]), t).toBe(1);
        }
    });

    it('가중치가 비정상이면 expected를 0표로 흡수한다', () => {
        expect(
            confluenceFamilyWeight(['support_proximity_bullish'], Number.NaN)
        ).toBe(0);
        expect(confluenceFamilyWeight(['support_proximity_bullish'], -1)).toBe(
            0
        );
        expect(confluenceFamilyWeight(['support_proximity_bullish'], 5)).toBe(
            1
        );
    });

    it('빈 배열은 0', () => {
        expect(confluenceFamilyWeight([])).toBe(0);
    });
});

describe('scoreConfluence', () => {
    it('null은 중립 50', () => {
        expect(scoreConfluence(null)).toBe(50);
    });

    it('방향 신호가 없으면 중립 50', () => {
        expect(scoreConfluence(snapshot())).toBe(50);
    });

    it('강세 1계열은 축소 계수 때문에 극단으로 튀지 않는다', () => {
        // 1 / (1+1) × 15 = 7.5
        expect(
            scoreConfluence(snapshot({ bullish: ['cci_bullish_cross'] }))
        ).toBe(58);
    });

    it('강세와 약세가 동수면 50', () => {
        expect(
            scoreConfluence(
                snapshot({
                    bullish: ['cci_bullish_cross'],
                    bearish: ['macd_bearish_cross'],
                })
            )
        ).toBe(50);
    });

    it('연속 점수는 50 ± span을 벗어나지 않는다', () => {
        const allBull = scoreConfluence(
            snapshot({ bullish: CONFIRMED.filter(t => t.includes('bullish')) })
        );
        const allBear = scoreConfluence(
            snapshot({ bearish: CONFIRMED.filter(t => t.includes('bearish')) })
        );
        expect(allBull).toBeLessThanOrEqual(50 + CONFLUENCE_SPAN);
        expect(allBear).toBeGreaterThanOrEqual(50 - CONFLUENCE_SPAN);
    });

    it('진입 트리거는 92로 스냅된다', () => {
        expect(
            scoreConfluence(
                snapshot({ bullish: ['cci_bullish_cross'], entryTrigger: true })
            )
        ).toBe(CONFLUENCE_TRIGGER_SCORE);
    });

    it('청산 트리거는 8로 스냅된다', () => {
        expect(
            scoreConfluence(
                snapshot({ bearish: ['cci_bearish_cross'], exitTrigger: true })
            )
        ).toBe(CONFLUENCE_EXIT_SCORE);
    });

    it('트리거 단독으로는 매수 임계(70)를 넘기지 못하도록 설계됐다', () => {
        // 92 × 12 + 50 × 23 = 2254 → /35 = 64.4. 다른 축이 받쳐줘야 70에 닿는다.
        const weighted = (CONFLUENCE_TRIGGER_SCORE * 12 + 50 * 23) / 35;
        expect(Math.round(weighted)).toBeLessThan(70);
    });

    describe('스냅샷에 실린 파라미터를 따른다', () => {
        it('span이 폭을 정한다', () => {
            const wide = scoreConfluence(
                snapshot({
                    bullish: ['cci_bullish_cross'],
                    params: { ...DEFAULT_PARAMS, span: 30 },
                })
            );
            expect(wide).toBe(65);
        });

        it('expectedWeight가 expected의 무게를 정한다', () => {
            const zero = scoreConfluence(
                snapshot({
                    bullish: ['support_proximity_bullish'],
                    params: { ...DEFAULT_PARAMS, expectedWeight: 0 },
                })
            );
            expect(zero).toBe(50);
        });

        it('손상된 span은 기본값으로 되돌린다 — 음수는 점수의 부호를 뒤집는다', () => {
            const healthy = scoreConfluence(
                snapshot({ bullish: ['cci_bullish_cross'] })
            );
            for (const span of [-100, Number.NaN, Number.POSITIVE_INFINITY]) {
                const corrupt = scoreConfluence(
                    snapshot({
                        bullish: ['cci_bullish_cross'],
                        params: { ...DEFAULT_PARAMS, span },
                    })
                );
                expect(corrupt, `span=${String(span)}`).toBe(healthy);
            }
        });

        it('손상된 expectedWeight도 기본값으로 되돌린다', () => {
            const healthy = scoreConfluence(
                snapshot({ bullish: ['support_proximity_bullish'] })
            );
            const corrupt = scoreConfluence(
                snapshot({
                    bullish: ['support_proximity_bullish'],
                    params: { ...DEFAULT_PARAMS, expectedWeight: Number.NaN },
                })
            );
            expect(corrupt).toBe(healthy);
        });
    });
});

describe('isConfluenceExit', () => {
    it('트리거만 본다 — 약세 신호 수는 보지 않는다', () => {
        expect(isConfluenceExit(snapshot({ exitTrigger: true }))).toBe(true);
        expect(
            isConfluenceExit(
                snapshot({
                    bearish: CONFIRMED.slice(0, 10),
                    exitTrigger: false,
                })
            )
        ).toBe(false);
    });

    it('null은 false', () => {
        expect(isConfluenceExit(null)).toBe(false);
    });
});

describe('기본값 — 실측으로 정한 값이라 조용히 바뀌면 안 된다', () => {
    it('진입 문턱 2.5, 청산 문턱 2.5, 폭 15', () => {
        // 2.5는 타입을 세던 시절 3종이 받아들이던 조합("확정 2 + 예상 1")과 같은 모양이다.
        // 3으로 두면 단위를 바꾸면서 문턱까지 같이 올리는 셈이라 진입이 17%로 떨어졌다.
        expect(CONFLUENCE_MIN).toBe(2.5);
        expect(CONFLUENCE_EXIT_MIN).toBe(2.5);
        expect(CONFLUENCE_SPAN).toBe(15);
        expect(CONFLUENCE_EXPECTED_WEIGHT).toBe(0.5);
    });

    it('거래량 요구는 기본 꺼짐 — 근거 없이 신호를 반으로 줄이지 않는다', () => {
        const snap = evaluateConfluence(risingBars(CONFLUENCE_MIN_BARS + 1), {
            timeframe: '30Min',
        })!;
        expect(snap.params.requireVolume).toBe(false);
    });

    it('상위 시간축 모드 기본값은 uptrend — 기존 소비자와 일봉 백테스트를 움직이지 않는다', () => {
        // 1시간봉 실측은 이 기본값을 지지하지 않는다(`CONFLUENCE_HTF_MODE` 주석). 그래도
        // 기본값을 조용히 바꾸면 모든 소비자가 한꺼번에 움직이므로 옵트인으로 둔다.
        expect(CONFLUENCE_HTF_MODE).toBe('uptrend');
        const snap = evaluateConfluence(risingBars(CONFLUENCE_MIN_BARS + 1), {
            timeframe: '30Min',
        })!;
        expect(snap.params.htfMode).toBe('uptrend');
    });

    it('상위 시간축 게이트는 봉을 주면 켜진다', () => {
        const snap = evaluateConfluence(risingBars(CONFLUENCE_MIN_BARS + 1), {
            timeframe: '30Min',
            htfBars: risingBars(200, 50, 1),
            htfLabel: '1Day',
        })!;
        expect(snap.params.htf).toBe('1Day');
    });
});

describe('evaluateConfluence', () => {
    describe('기권', () => {
        it('봉이 최소치 이하면 null', () => {
            expect(
                evaluateConfluence(risingBars(CONFLUENCE_MIN_BARS), {
                    timeframe: '30Min',
                })
            ).toBeNull();
        });

        it('minBars를 낮추면 짧은 이력으로도 계산한다', () => {
            const snap = evaluateConfluence(risingBars(80), {
                timeframe: '30Min',
                minBars: 60,
            });
            expect(snap).not.toBeNull();
        });

        it('마지막 종가가 비정상이면 null', () => {
            const bars = risingBars(CONFLUENCE_MIN_BARS + 1);
            bars[bars.length - 1] = {
                ...bars[bars.length - 1]!,
                close: Number.NaN,
            };
            expect(evaluateConfluence(bars, { timeframe: '30Min' })).toBeNull();
        });

        it('빈 배열은 null', () => {
            expect(evaluateConfluence([], { timeframe: '30Min' })).toBeNull();
        });
    });

    describe('스냅샷 내용', () => {
        it('마지막 봉의 시각·종가와 타임프레임 라벨을 담는다', () => {
            const bars = risingBars(CONFLUENCE_MIN_BARS + 1);
            const last = bars[bars.length - 1]!;
            const snap = evaluateConfluence(bars, { timeframe: '30Min' })!;

            expect(snap.timeframe).toBe('30Min');
            expect(snap.barTime).toBe(last.time);
            expect(snap.close).toBe(last.close);
        });

        it('적용된 파라미터를 기록한다 — 저장된 행이 설명 가능해야 한다', () => {
            const snap = evaluateConfluence(
                risingBars(CONFLUENCE_MIN_BARS + 1),
                {
                    timeframe: '30Min',
                    min: 4,
                    span: 20,
                    expectedWeight: 0.25,
                    requireVolume: false,
                }
            )!;

            expect(snap.params).toEqual({
                min: 4,
                exitMin: CONFLUENCE_EXIT_MIN,
                span: 20,
                expectedWeight: 0.25,
                htf: null,
                requireVolume: false,
                htfMode: 'uptrend',
            });
        });

        it('exitMin은 min과 독립이다 — 진입을 조여도 청산이 따라 조여지면 안 된다', () => {
            const snap = evaluateConfluence(
                risingBars(CONFLUENCE_MIN_BARS + 1),
                {
                    timeframe: '30Min',
                    min: 8,
                }
            )!;

            expect(snap.params.min).toBe(8);
            expect(snap.params.exitMin).toBe(CONFLUENCE_EXIT_MIN);
        });

        it('exitMin만 따로 올릴 수 있다', () => {
            const snap = evaluateConfluence(
                risingBars(CONFLUENCE_MIN_BARS + 1),
                {
                    timeframe: '30Min',
                    exitMin: 5,
                }
            )!;

            expect(snap.params.min).toBe(CONFLUENCE_MIN);
            expect(snap.params.exitMin).toBe(5);
        });

        it('청산 트리거는 exitMin을 본다 — 실측 회귀', () => {
            // 계열 2.5짜리 약세 조합(확정 2 + 상태 1)은 구 규칙에서 3종으로 잡혔었다.
            // exitMin 기본 2.5면 살아남고, min을 아무리 올려도 영향받지 않아야 한다.
            const falling = buildBars(
                Array.from(
                    { length: CONFLUENCE_MIN_BARS + 3 },
                    (_, i) => 200 - i * 0.4
                )
            );
            const strictEntry = evaluateConfluence(falling, {
                timeframe: '30Min',
                min: 14,
            })!;
            const loose = evaluateConfluence(falling, {
                timeframe: '30Min',
                min: 1,
            })!;

            expect(strictEntry.exitTrigger).toBe(loose.exitTrigger);
        });

        it('비정상 파라미터는 기본값으로 되돌린다', () => {
            const snap = evaluateConfluence(
                risingBars(CONFLUENCE_MIN_BARS + 1),
                {
                    timeframe: '30Min',
                    min: Number.NaN,
                    span: -5,
                    expectedWeight: 9,
                }
            )!;

            expect(snap.params.min).toBe(CONFLUENCE_MIN);
            expect(snap.params.span).toBe(CONFLUENCE_SPAN);
            expect(snap.params.expectedWeight).toBe(1);
        });

        it('SMA 주기보다 봉이 적으면 ma50이 null이고 두 트리거가 모두 서지 않는다', () => {
            const snap = evaluateConfluence(risingBars(70), {
                timeframe: '30Min',
                minBars: 60,
                trendMaPeriod: 200,
            })!;

            expect(snap.ma50).toBeNull();
            expect(snap.entryTrigger).toBe(false);
            expect(snap.exitTrigger).toBe(false);
        });

        it('강세·약세 목록은 정렬돼 있다 — 스냅샷이 감사 로그로 저장된다', () => {
            const snap = evaluateConfluence(
                risingBars(CONFLUENCE_MIN_BARS + 1),
                {
                    timeframe: '30Min',
                }
            )!;
            expect(snap.bullish).toEqual([...snap.bullish].sort());
            expect(snap.bearish).toEqual([...snap.bearish].sort());
        });
    });

    describe('상위 시간축 정렬 게이트', () => {
        it('상위 봉을 주지 않으면 게이트가 꺼진다', () => {
            const snap = evaluateConfluence(
                risingBars(CONFLUENCE_MIN_BARS + 1),
                {
                    timeframe: '30Min',
                }
            )!;
            expect(snap.htfTrend).toBeNull();
            expect(snap.params.htf).toBeNull();
        });

        it('상위 봉을 주면 추세를 판정해 기록한다', () => {
            const snap = evaluateConfluence(
                risingBars(CONFLUENCE_MIN_BARS + 1),
                {
                    timeframe: '30Min',
                    htfBars: risingBars(200, 50, 1),
                    htfLabel: '1Day',
                }
            )!;

            expect(snap.params.htf).toBe('1Day');
            expect(snap.htfTrend).not.toBeNull();
        });

        it('상위 봉이 워밍업에 못 미치면 판정하지 않는다 (fail-open)', () => {
            const snap = evaluateConfluence(
                risingBars(CONFLUENCE_MIN_BARS + 1),
                {
                    timeframe: '30Min',
                    htfBars: risingBars(5),
                    htfLabel: '1Day',
                }
            )!;
            expect(snap.htfTrend).toBeNull();
        });

        it('빈 상위 봉 배열은 게이트 off로 취급한다', () => {
            const snap = evaluateConfluence(
                risingBars(CONFLUENCE_MIN_BARS + 1),
                {
                    timeframe: '30Min',
                    htfBars: [],
                    htfLabel: '1Day',
                }
            )!;
            expect(snap.params.htf).toBeNull();
            expect(snap.htfTrend).toBeNull();
        });
    });

    describe('상위 시간축 모드 (htfMode)', () => {
        /**
         * 횡보 뒤 마지막 봉 급등 — 게이트 없이 진입 룰이 성립하는 봉.
         * 신규 강세 신호 다수 + 종가 > SMA50이라 상위 추세만이 판정을 가른다.
         */
        const breakout = buildBars([
            ...Array.from(
                { length: CONFLUENCE_MIN_BARS + 5 },
                (_, i) => 100 + Math.sin(i / 3) * 0.5
            ),
            104,
        ]);
        const htfUp = risingBars(200, 50, 1);
        const htfDown = buildBars(
            Array.from({ length: 200 }, (_, i) => 300 - i)
        );
        const htfFlat = buildBars(Array.from({ length: 200 }, () => 100));

        const entry = (
            htfBars: Bar[] | null,
            htfMode?: 'uptrend' | 'notUptrend'
        ): boolean =>
            evaluateConfluence(breakout, {
                timeframe: '1Hour',
                htfBars,
                htfLabel: '1Day',
                ...(htfMode ? { htfMode } : {}),
            })!.entryTrigger;

        it('전제 — 게이트가 꺼져 있으면 이 봉에서 진입 룰이 성립한다', () => {
            expect(entry(null)).toBe(true);
        });

        describe('uptrend (기본)', () => {
            it('상위 추세가 상승일 때만 허용한다', () => {
                expect(entry(htfUp)).toBe(true);
                expect(entry(htfFlat)).toBe(false);
                expect(entry(htfDown)).toBe(false);
            });
        });

        describe('notUptrend', () => {
            it('상위 추세가 상승이면 막는다 — 이미 뻗은 자리의 추격', () => {
                expect(entry(htfUp, 'notUptrend')).toBe(false);
            });

            it('횡보·하락이면 허용한다', () => {
                expect(entry(htfFlat, 'notUptrend')).toBe(true);
                expect(entry(htfDown, 'notUptrend')).toBe(true);
            });

            it('추세를 판정할 수 없으면 통과시킨다 (fail-open)', () => {
                expect(entry(risingBars(5), 'notUptrend')).toBe(true);
            });

            it('적용 모드를 params에 기록한다 — 전후 비교의 근거', () => {
                const snap = evaluateConfluence(breakout, {
                    timeframe: '1Hour',
                    htfBars: htfFlat,
                    htfLabel: '1Day',
                    htfMode: 'notUptrend',
                })!;
                expect(snap.params.htfMode).toBe('notUptrend');
                expect(snap.htfTrend).toBe('sideways');
            });
        });

        it('모르는 값은 기본 모드로 되돌린다 — 설정 오타가 게이트를 뒤집지 않는다', () => {
            const snap = evaluateConfluence(breakout, {
                timeframe: '1Hour',
                htfBars: htfUp,
                htfLabel: '1Day',
                htfMode: 'downtrend' as unknown as 'uptrend',
            })!;
            expect(snap.params.htfMode).toBe('uptrend');
            expect(snap.entryTrigger).toBe(true);
        });
    });

    describe('진입 전용 게이트 — 원칙 7', () => {
        /**
         * 하락 국면의 봉. 약세 시그널이 서고 종가가 MA 아래로 내려간다.
         * 상위 추세는 **상승**으로 주어 진입이라면 막힐 상황을 만든다.
         */
        const fallingThenCrash = [
            ...buildBars(
                Array.from(
                    { length: CONFLUENCE_MIN_BARS },
                    (_, i) => 200 - i * 0.3
                )
            ),
            ...buildBars([120, 110, 100]),
        ];

        it('청산 트리거는 상위 추세 정렬을 요구하지 않는다', () => {
            const gated = evaluateConfluence(fallingThenCrash, {
                timeframe: '30Min',
                htfBars: risingBars(200, 50, 1),
                htfLabel: '1Day',
            })!;
            const ungated = evaluateConfluence(fallingThenCrash, {
                timeframe: '30Min',
            })!;

            // 상위 추세를 주든 말든 청산 판정은 같아야 한다.
            expect(gated.exitTrigger).toBe(ungated.exitTrigger);
        });

        it('청산 트리거는 상위 시간축 모드와 무관하다', () => {
            const byMode = (htfMode: 'uptrend' | 'notUptrend'): boolean =>
                evaluateConfluence(fallingThenCrash, {
                    timeframe: '30Min',
                    htfBars: risingBars(200, 50, 1),
                    htfLabel: '1Day',
                    htfMode,
                })!.exitTrigger;

            expect(byMode('notUptrend')).toBe(byMode('uptrend'));
        });

        it('청산 트리거는 거래량 확인을 요구하지 않는다', () => {
            const required = evaluateConfluence(fallingThenCrash, {
                timeframe: '30Min',
                requireVolume: true,
            })!;
            const notRequired = evaluateConfluence(fallingThenCrash, {
                timeframe: '30Min',
                requireVolume: false,
            })!;

            expect(required.exitTrigger).toBe(notRequired.exitTrigger);
        });

        it('거래량 요구는 진입 트리거에만 영향을 준다', () => {
            const bars = risingBars(CONFLUENCE_MIN_BARS + 1);
            const strict = evaluateConfluence(bars, {
                timeframe: '30Min',
                requireVolume: true,
            })!;
            const loose = evaluateConfluence(bars, {
                timeframe: '30Min',
                requireVolume: false,
            })!;

            // 진입은 완화 시 같거나 더 잘 서고, 청산은 어느 쪽이든 동일하다.
            expect(
                strict.entryTrigger === true ? loose.entryTrigger : true
            ).toBe(true);
            expect(strict.exitTrigger).toBe(loose.exitTrigger);
        });
    });

    describe('트리거 구성', () => {
        it('min을 계열 수 이상으로 올리면 어떤 트리거도 서지 않는다', () => {
            const snap = evaluateConfluence(
                risingBars(CONFLUENCE_MIN_BARS + 1),
                {
                    timeframe: '30Min',
                    min: 99,
                }
            )!;
            expect(snap.entryTrigger).toBe(false);
            expect(snap.exitTrigger).toBe(false);
        });

        it('두 트리거는 동시에 설 수 없다 — 종가는 MA의 한쪽에만 있다', () => {
            for (const bars of [
                risingBars(CONFLUENCE_MIN_BARS + 1),
                fallingBars(),
            ]) {
                const snap = evaluateConfluence(bars, {
                    timeframe: '30Min',
                    min: 0,
                })!;
                expect(snap.entryTrigger && snap.exitTrigger).toBe(false);
            }
        });
    });
});

function fallingBars(): Bar[] {
    return buildBars(
        Array.from({ length: CONFLUENCE_MIN_BARS + 1 }, (_, i) => 200 - i * 0.5)
    );
}
