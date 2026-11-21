import { describe, it, expect } from 'vitest';
import { getPatternBarCount } from '@/domain/analysis/candle-detection';
import {
    detectCandlePattern,
    detectMultiCandlePattern,
} from '@/domain/analysis/candle';
import { calculateATR } from '@/domain/indicators/atr';
import type { Bar, MultiCandlePattern } from '@/domain/types';
import {
    CANDLE_MIN_SETUP_BODY_ATR,
    CANDLE_PRIOR_TREND_BARS,
} from '@/domain/analysis/candle-context';
import {
    makeTrendLead,
    type TrendLeadDirection,
} from '@/__tests__/fixtures/candle';

const makeBar = (
    open: number,
    high: number,
    low: number,
    close: number
): Bar => ({ time: 0, open, high, low, close, volume: 0 });

// flat: highLowRange === 0
const FLAT_BAR = makeBar(100, 100, 100, 100);

// doji: bodySize=0.5, range=20, bodyRatio=0.025 (≤0.1)
const DOJI_BAR = makeBar(100, 110, 90, 100.5);

// bullish_marubozu: bodySize=10, range=10, bodyRatio=1.0 (≥0.9), bullish
const BULLISH_MARUBOZU_BAR = makeBar(100, 110, 100, 110);

// bearish_marubozu: same structure, bearish
const BEARISH_MARUBOZU_BAR = makeBar(110, 110, 100, 100);

// shooting_star: open=100,close=97,high=115,low=96
//   bodySize=3, range=19, bodyRatio≈0.158
//   upperShadow=15(≥3*2=6), lowerShadow=1(≤3*1=3), bearish
const SHOOTING_STAR_BAR = makeBar(100, 115, 96, 97);

// inverted_hammer: same shape, bullish
const INVERTED_HAMMER_BAR = makeBar(97, 115, 96, 100);

// hammer: open=100,close=103,high=105,low=85
//   bodySize=3, range=20, bodyRatio=0.15
//   lowerShadow=15(≥3*2=6), upperShadow=2(≤3*1=3), bullish
const HAMMER_BAR = makeBar(100, 105, 85, 103);

// hanging_man: same shape, bearish
const HANGING_MAN_BAR = makeBar(103, 105, 85, 100);

// gravestone_doji: open=100,close=100.5,high=120,low=100
//   body=0.5, range=20, bodyRatio=0.025(≤0.1), lowerShadow=0(≤range*0.1=2)
const GRAVESTONE_DOJI_BAR = makeBar(100, 120, 100, 100.5);

// dragonfly_doji: open=100.5,close=100,high=101,low=80
//   body=0.5, range=21, bodyRatio≈0.024(≤0.1), upperShadow=1(≤range*0.1=2.1)
const DRAGONFLY_DOJI_BAR = makeBar(100.5, 101, 80, 100);

// spinning_top: open=100,close=103,high=110,low=93
//   body=3, range=17, bodyRatio≈0.176 (0.1<x≤0.4), upper=7, lower=7
//   hasLongUpper(7≥6)=true, hasShortLower(7≤3)=false → not shooting_star
//   hasLongLower(7≥6)=true, hasShortUpper(7≤3)=false → not hammer
const SPINNING_TOP_BAR = makeBar(100, 110, 93, 103);

// bullish_belt_hold: open=100,close=110,high=112,low=99
//   body=10, range=13, bodyRatio≈0.769(≥0.6), bullish, lowerShadow=1(≤body*0.1=1)
const BULLISH_BELT_HOLD_BAR = makeBar(100, 112, 99, 110);

// bearish_belt_hold: open=110,close=100,high=111,low=98
//   body=10, range=13, bodyRatio≈0.769(≥0.6), bearish, upperShadow=1(≤body*0.1=1)
const BEARISH_BELT_HOLD_BAR = makeBar(110, 111, 98, 100);

// regular bullish: open=100,close=105,high=107,low=98
//   bodySize=5, range=9, bodyRatio≈0.556
//   no long shadow conditions met
const BULLISH_BAR = makeBar(100, 107, 98, 105);

// regular bearish
const BEARISH_BAR = makeBar(105, 107, 98, 100);

// belt_hold fallthrough bullish: open=100,high=114.5,low=98,close=110
//   body=10, range=16.5, bodyRatio≈0.606(≥0.6) — enters belt hold block
//   lowerShadow=2 > body*0.1=1 → NOT bullish_belt_hold, falls through → 'bullish'
const BELT_HOLD_FALLTHROUGH_BULLISH_BAR = makeBar(100, 114.5, 98, 110);

// belt_hold fallthrough bearish: open=110,high=114.5,low=98,close=100
//   body=10, range=16.5, bodyRatio≈0.606(≥0.6) — enters belt hold block
//   upperShadow=4.5 > body*0.1=1 → NOT bearish_belt_hold, falls through → 'bearish'
const BELT_HOLD_FALLTHROUGH_BEARISH_BAR = makeBar(110, 114.5, 98, 100);

/**
 * 각 다봉 패턴이 요구하는 직전 움직임. 설계표를 테스트 쪽에서 따로 적은 것이라 구현의 규칙 표와
 * 독립적으로 어긋남을 잡는다.
 */
const PRIOR_OF = {
    bullish_engulfing: 'decline',
    bullish_harami: 'decline',
    bullish_harami_cross: 'decline',
    piercing_line: 'decline',
    bullish_counterattack_line: 'decline',
    morning_star: 'decline',
    morning_doji_star: 'decline',
    bullish_abandoned_baby: 'decline',
    three_white_soldiers: 'decline',
    three_inside_up: 'decline',
    three_outside_up: 'decline',
    bullish_triple_star: 'decline',
    ladder_bottom: 'decline',
    tweezers_bottom: 'decline',
    downside_gap_two_rabbits: 'decline',
    above_the_stomach: 'decline',
    falling_three_methods: 'decline',
    downside_gap_tasuki: 'decline',
    on_neck: 'decline',
    in_neck: 'decline',
    bearish_three_line_strike: 'decline',
    bearish_engulfing: 'advance',
    bearish_harami: 'advance',
    bearish_harami_cross: 'advance',
    dark_cloud_cover: 'advance',
    bearish_counterattack_line: 'advance',
    evening_star: 'advance',
    evening_doji_star: 'advance',
    bearish_abandoned_baby: 'advance',
    three_black_crows: 'advance',
    three_inside_down: 'advance',
    three_outside_down: 'advance',
    bearish_triple_star: 'advance',
    advance_block: 'advance',
    upside_gap_two_crows: 'advance',
    below_the_stomach: 'advance',
    tweezers_top: 'advance',
    rising_three_methods: 'advance',
    upside_gap_tasuki: 'advance',
    bullish_three_line_strike: 'advance',
} as const satisfies Record<
    MultiCandlePattern,
    Exclude<TrendLeadDirection, 'none'>
>;

/**
 * 패턴 앞에 추세 리드 봉(makeTrendLead)을 붙여 감지한다. 기하 조건만 보는 케이스는 그 패턴의
 * 컨텍스트 규칙이 요구하는 방향을 넘긴다. 규칙 자체는 candle-context.test.ts와 아래
 * '컨텍스트 규칙' 블록이 검증한다.
 */
const detectAfter = (
    direction: TrendLeadDirection,
    bars: readonly Bar[]
): MultiCandlePattern | null => {
    const all = [...makeTrendLead(direction, bars[0].open), ...bars];
    return detectMultiCandlePattern(all, calculateATR(all));
};

describe('detectCandlePattern', () => {
    describe('flat', () => {
        it('range가 0이면 flat을 반환한다', () => {
            expect(detectCandlePattern(FLAT_BAR, 'none')).toBe('flat');
        });

        it('직전 움직임과 무관하게 flat이다', () => {
            expect(detectCandlePattern(FLAT_BAR, 'decline')).toBe('flat');
        });
    });

    describe('doji', () => {
        it('몸통이 range의 10% 이하이고 양쪽 꼬리가 있으면 doji를 반환한다', () => {
            expect(detectCandlePattern(DOJI_BAR, 'none')).toBe('doji');
        });
    });

    describe('marubozu (모양만으로 결정)', () => {
        it.each(['decline', 'advance', 'none'] as const)(
            '직전 움직임이 %s여도 몸통이 range의 90% 이상인 양봉은 bullish_marubozu다',
            prior => {
                expect(detectCandlePattern(BULLISH_MARUBOZU_BAR, prior)).toBe(
                    'bullish_marubozu'
                );
            }
        );

        it.each(['decline', 'advance', 'none'] as const)(
            '직전 움직임이 %s여도 음봉은 bearish_marubozu다',
            prior => {
                expect(detectCandlePattern(BEARISH_MARUBOZU_BAR, prior)).toBe(
                    'bearish_marubozu'
                );
            }
        );
    });

    describe('긴 위꼬리 봉 (inverted_hammer / shooting_star)', () => {
        it('하락 뒤에는 음봉이어도 inverted_hammer다 (몸통 색이 아니라 직전 움직임이 정한다)', () => {
            expect(detectCandlePattern(SHOOTING_STAR_BAR, 'decline')).toBe(
                'inverted_hammer'
            );
        });

        it('하락 뒤 양봉도 inverted_hammer다', () => {
            expect(detectCandlePattern(INVERTED_HAMMER_BAR, 'decline')).toBe(
                'inverted_hammer'
            );
        });

        it('상승 뒤에는 양봉이어도 shooting_star다', () => {
            expect(detectCandlePattern(INVERTED_HAMMER_BAR, 'advance')).toBe(
                'shooting_star'
            );
        });

        it('상승 뒤 음봉도 shooting_star다', () => {
            expect(detectCandlePattern(SHOOTING_STAR_BAR, 'advance')).toBe(
                'shooting_star'
            );
        });

        it('직전 움직임이 없으면 이름을 붙이지 않고 나머지 검사(spinning_top)로 떨어진다', () => {
            expect(detectCandlePattern(INVERTED_HAMMER_BAR, 'none')).toBe(
                'spinning_top'
            );
            expect(detectCandlePattern(SHOOTING_STAR_BAR, 'none')).toBe(
                'spinning_top'
            );
        });

        it('직전 움직임이 없고 아래꼬리가 0이면 몸통 색 라벨까지 떨어진다', () => {
            // upper=15, lower=0: spinning_top needs lower > 0
            expect(detectCandlePattern(makeBar(97, 115, 97, 100), 'none')).toBe(
                'bullish'
            );
            expect(detectCandlePattern(makeBar(100, 115, 97, 97), 'none')).toBe(
                'bearish'
            );
        });
    });

    describe('긴 아래꼬리 봉 (hammer / hanging_man)', () => {
        it('하락 뒤에는 양봉이면 hammer다', () => {
            expect(detectCandlePattern(HAMMER_BAR, 'decline')).toBe('hammer');
        });

        it('하락 뒤에는 음봉이어도 hammer다 (몸통 색이 정하지 않는다)', () => {
            expect(detectCandlePattern(HANGING_MAN_BAR, 'decline')).toBe(
                'hammer'
            );
        });

        it('상승 뒤에는 음봉이면 hanging_man이다', () => {
            expect(detectCandlePattern(HANGING_MAN_BAR, 'advance')).toBe(
                'hanging_man'
            );
        });

        it('상승 뒤에는 양봉이어도 hanging_man이다', () => {
            expect(detectCandlePattern(HAMMER_BAR, 'advance')).toBe(
                'hanging_man'
            );
        });

        it('직전 움직임이 없으면 이름을 붙이지 않고 나머지 검사(spinning_top)로 떨어진다', () => {
            expect(detectCandlePattern(HAMMER_BAR, 'none')).toBe(
                'spinning_top'
            );
            expect(detectCandlePattern(HANGING_MAN_BAR, 'none')).toBe(
                'spinning_top'
            );
        });

        it('직전 움직임이 없고 위꼬리가 0이면 몸통 색 라벨까지 떨어진다', () => {
            // lower=15, upper=0: spinning_top needs upper > 0
            expect(
                detectCandlePattern(makeBar(100, 103, 85, 103), 'none')
            ).toBe('bullish');
            expect(
                detectCandlePattern(makeBar(103, 103, 85, 100), 'none')
            ).toBe('bearish');
        });
    });

    describe('bullish / bearish', () => {
        it('일반 양봉이면 bullish를 반환한다', () => {
            expect(detectCandlePattern(BULLISH_BAR, 'none')).toBe('bullish');
        });

        it('일반 음봉이면 bearish를 반환한다', () => {
            expect(detectCandlePattern(BEARISH_BAR, 'none')).toBe('bearish');
        });

        it('벨트홀드 조건(몸통 비율)에 들어도 꼬리 조건이 틀리면 bullish로 떨어진다', () => {
            expect(
                detectCandlePattern(
                    BELT_HOLD_FALLTHROUGH_BULLISH_BAR,
                    'decline'
                )
            ).toBe('bullish');
        });

        it('벨트홀드 조건(몸통 비율)에 들어도 꼬리 조건이 틀리면 bearish로 떨어진다', () => {
            expect(
                detectCandlePattern(
                    BELT_HOLD_FALLTHROUGH_BEARISH_BAR,
                    'advance'
                )
            ).toBe('bearish');
        });
    });

    describe('doji 변형 (gravestone / dragonfly)', () => {
        it('위꼬리가 긴 도지는 상승 뒤에만 gravestone_doji다', () => {
            expect(detectCandlePattern(GRAVESTONE_DOJI_BAR, 'advance')).toBe(
                'gravestone_doji'
            );
        });

        it.each(['decline', 'none'] as const)(
            '위꼬리가 긴 도지는 직전 움직임이 %s이면 doji다',
            prior => {
                expect(detectCandlePattern(GRAVESTONE_DOJI_BAR, prior)).toBe(
                    'doji'
                );
            }
        );

        it('아래꼬리가 긴 도지는 하락 뒤에만 dragonfly_doji다', () => {
            expect(detectCandlePattern(DRAGONFLY_DOJI_BAR, 'decline')).toBe(
                'dragonfly_doji'
            );
        });

        it.each(['advance', 'none'] as const)(
            '아래꼬리가 긴 도지는 직전 움직임이 %s이면 doji다',
            prior => {
                expect(detectCandlePattern(DRAGONFLY_DOJI_BAR, prior)).toBe(
                    'doji'
                );
            }
        );
    });

    describe('spinning_top (모양만으로 결정)', () => {
        it.each(['decline', 'advance', 'none'] as const)(
            '직전 움직임이 %s여도 spinning_top이다',
            prior => {
                expect(detectCandlePattern(SPINNING_TOP_BAR, prior)).toBe(
                    'spinning_top'
                );
            }
        );
    });

    describe('belt_hold', () => {
        it('상승 몸통에 아래꼬리가 거의 없으면 하락 뒤에만 bullish_belt_hold다', () => {
            expect(detectCandlePattern(BULLISH_BELT_HOLD_BAR, 'decline')).toBe(
                'bullish_belt_hold'
            );
        });

        it.each(['advance', 'none'] as const)(
            '상승 벨트홀드 모양도 직전 움직임이 %s이면 bullish로 떨어진다',
            prior => {
                expect(detectCandlePattern(BULLISH_BELT_HOLD_BAR, prior)).toBe(
                    'bullish'
                );
            }
        );

        it('하락 몸통에 위꼬리가 거의 없으면 상승 뒤에만 bearish_belt_hold다', () => {
            expect(detectCandlePattern(BEARISH_BELT_HOLD_BAR, 'advance')).toBe(
                'bearish_belt_hold'
            );
        });

        it.each(['decline', 'none'] as const)(
            '하락 벨트홀드 모양도 직전 움직임이 %s이면 bearish로 떨어진다',
            prior => {
                expect(detectCandlePattern(BEARISH_BELT_HOLD_BAR, prior)).toBe(
                    'bearish'
                );
            }
        );
    });
});

/** 2·3봉 패턴 하나씩의 기하 픽스처. */
const MULTI_PATTERN_FIXTURES: Array<[MultiCandlePattern, Bar[]]> = [
    [
        'bullish_engulfing',
        [makeBar(105, 106, 99, 100), makeBar(99, 108, 98, 107)],
    ],
    [
        'bearish_engulfing',
        [makeBar(100, 106, 99, 105), makeBar(106, 107, 97, 98)],
    ],
    [
        'bullish_harami',
        [makeBar(110, 111, 99, 100), makeBar(103, 106, 102, 105)],
    ],
    [
        'bullish_harami_cross',
        [makeBar(110, 111, 99, 100), makeBar(103, 107, 99, 103.2)],
    ],
    [
        'bearish_harami',
        [makeBar(100, 111, 99, 110), makeBar(109, 110, 104, 105)],
    ],
    [
        'bearish_harami_cross',
        [makeBar(100, 111, 99, 110), makeBar(105, 108, 102, 105.3)],
    ],
    ['piercing_line', [makeBar(110, 111, 99, 100), makeBar(98, 108, 97, 107)]],
    [
        'dark_cloud_cover',
        [makeBar(100, 111, 99, 110), makeBar(112, 113, 102, 103)],
    ],
    [
        'bullish_counterattack_line',
        [makeBar(110, 111, 99, 100), makeBar(90, 101, 89, 100.1)],
    ],
    [
        'bearish_counterattack_line',
        [makeBar(100, 111, 99, 110), makeBar(120, 121, 109, 110.1)],
    ],
    [
        'tweezers_bottom',
        [makeBar(105, 106, 90, 100), makeBar(90, 102, 90, 101)],
    ],
    ['tweezers_top', [makeBar(100, 110, 99, 105), makeBar(108, 110, 102, 103)]],
    ['on_neck', [makeBar(110, 111, 99, 100), makeBar(97, 100, 96, 99.1)]],
    ['in_neck', [makeBar(110, 111, 99, 100), makeBar(97, 103, 96, 100.5)]],
    [
        'three_white_soldiers',
        [
            makeBar(100, 109, 99, 108),
            makeBar(103, 114, 102, 113),
            makeBar(108, 120, 107, 119),
        ],
    ],
    [
        'three_black_crows',
        [
            makeBar(110, 111, 99, 100),
            makeBar(105, 106, 92, 93),
            makeBar(98, 99, 86, 87),
        ],
    ],
    [
        'morning_star',
        [
            makeBar(110, 111, 99, 100),
            makeBar(97, 99, 96, 98),
            makeBar(99, 108, 98, 107),
        ],
    ],
    [
        'morning_doji_star',
        [
            makeBar(110, 111, 99, 100),
            makeBar(97, 99, 95, 97.2),
            makeBar(99, 108, 98, 107),
        ],
    ],
    [
        'evening_star',
        [
            makeBar(100, 111, 99, 110),
            makeBar(113, 116, 112, 115),
            makeBar(109, 110, 102, 103),
        ],
    ],
    [
        'evening_doji_star',
        [
            makeBar(100, 111, 99, 110),
            makeBar(113, 116, 112, 113.3),
            makeBar(109, 110, 102, 103),
        ],
    ],
    [
        'bullish_abandoned_baby',
        [
            makeBar(110, 111, 99, 100),
            makeBar(95, 97, 93, 95.2),
            makeBar(99, 106, 98, 105),
        ],
    ],
    [
        'bearish_abandoned_baby',
        [
            makeBar(100, 111, 99, 110),
            makeBar(114, 116, 113, 114.2),
            makeBar(108, 112, 105, 106),
        ],
    ],
    [
        'three_inside_up',
        [
            makeBar(110, 111, 99, 100),
            makeBar(101, 106, 100, 105),
            makeBar(103, 113, 102, 112),
        ],
    ],
    [
        'three_inside_down',
        [
            makeBar(100, 111, 99, 110),
            makeBar(109, 110, 104, 105),
            makeBar(107, 108, 97, 98),
        ],
    ],
    [
        'three_outside_up',
        [
            makeBar(105, 106, 99, 100),
            makeBar(99, 108, 98, 107),
            makeBar(105, 111, 104, 110),
        ],
    ],
    [
        'three_outside_down',
        [
            makeBar(100, 106, 99, 105),
            makeBar(106, 107, 97, 98),
            makeBar(100, 101, 94, 95),
        ],
    ],
    [
        'bullish_triple_star',
        [
            makeBar(100, 105, 95, 100.5),
            makeBar(91, 93, 89, 91.3),
            makeBar(90, 92, 88, 90.3),
        ],
    ],
    [
        'bearish_triple_star',
        [
            makeBar(100, 105, 95, 100.5),
            makeBar(108, 110, 107, 108.3),
            makeBar(107, 109, 105, 106.7),
        ],
    ],
    [
        'upside_gap_two_crows',
        [
            makeBar(100, 109, 99, 108),
            makeBar(115, 116, 111, 112),
            makeBar(113, 114, 109, 110),
        ],
    ],
    [
        'downside_gap_two_rabbits',
        [
            makeBar(110, 111, 101, 102),
            makeBar(96, 100, 95, 99),
            makeBar(97, 101, 96, 100),
        ],
    ],
    [
        'advance_block',
        [
            makeBar(100, 109, 99, 108),
            makeBar(102, 113, 101, 108),
            makeBar(104, 117, 103, 108),
        ],
    ],
    [
        'upside_gap_tasuki',
        [
            makeBar(100, 108, 99, 107),
            makeBar(110, 116, 109, 115),
            makeBar(113, 114, 109, 110),
        ],
    ],
    [
        'downside_gap_tasuki',
        [
            makeBar(110, 111, 102, 103),
            makeBar(100, 101, 94, 95),
            makeBar(97, 101, 96, 100),
        ],
    ],
    [
        'ladder_bottom',
        [
            makeBar(110, 111, 99, 100),
            makeBar(108, 109, 94, 95),
            makeBar(110, 113, 109, 112),
        ],
    ],
    [
        'above_the_stomach',
        [makeBar(110, 111, 99, 100), makeBar(106, 113, 105, 112)],
    ],
    [
        'below_the_stomach',
        [makeBar(100, 111, 99, 110), makeBar(104, 105, 97, 98)],
    ],
];

/** 4·5봉 패턴 하나씩의 기하 픽스처 (3선 타격, 삼법형). */
const LONG_PATTERN_FIXTURES: Array<[MultiCandlePattern, Bar[]]> = [
    [
        'bullish_three_line_strike',
        [
            makeBar(100, 106, 99, 105),
            makeBar(104, 111, 103, 110),
            makeBar(109, 116, 108, 115),
            makeBar(116, 117, 97, 98),
        ],
    ],
    [
        'bearish_three_line_strike',
        [
            makeBar(110, 111, 104, 105),
            makeBar(106, 107, 100, 101),
            makeBar(102, 103, 96, 97),
            makeBar(96, 112, 95, 111),
        ],
    ],
    [
        'rising_three_methods',
        [
            makeBar(100, 111, 99, 110),
            makeBar(109, 110, 106, 107),
            makeBar(107, 108, 104, 105),
            makeBar(105, 106, 102, 103),
            makeBar(102.5, 116, 102, 115),
        ],
    ],
    [
        'falling_three_methods',
        [
            makeBar(110, 111, 99, 100),
            makeBar(101, 106, 100, 103),
            makeBar(102, 107, 101, 104),
            makeBar(103, 108, 102, 105),
            makeBar(104, 105, 93, 94),
        ],
    ],
];

describe('detectMultiCandlePattern', () => {
    describe('봉 수 부족', () => {
        it('봉이 1개이면 null을 반환한다', () => {
            expect(
                detectMultiCandlePattern([makeBar(100, 105, 95, 102)], [null])
            ).toBeNull();
        });
    });

    describe('2봉 패턴', () => {
        describe('engulfing', () => {
            it('음봉 후 포함하는 양봉이면 bullish_engulfing을 반환한다', () => {
                // prev: bearish (open=105, close=100)
                // curr: bullish engulfing (open=99, close=107)
                const prev = makeBar(105, 106, 99, 100);
                const curr = makeBar(99, 108, 98, 107);
                expect(detectAfter('decline', [prev, curr])).toBe(
                    'bullish_engulfing'
                );
            });

            it('양봉 후 포함하는 음봉이면 bearish_engulfing을 반환한다', () => {
                // prev: bullish (open=100, close=105)
                // curr: bearish engulfing (open=106, close=98)
                const prev = makeBar(100, 106, 99, 105);
                const curr = makeBar(106, 107, 97, 98);
                expect(detectAfter('advance', [prev, curr])).toBe(
                    'bearish_engulfing'
                );
            });
        });

        describe('harami', () => {
            it('긴 음봉 후 몸통 안에 드는 비도지 봉이면 bullish_harami를 반환한다', () => {
                // prev: long bearish (body=10, range=12)
                // curr: inside body, not doji (body=2, range=4, ratio=0.5)
                const prev = makeBar(110, 111, 99, 100);
                const curr = makeBar(103, 106, 102, 105);
                expect(detectAfter('decline', [prev, curr])).toBe(
                    'bullish_harami'
                );
            });

            it('긴 음봉 후 몸통 안에 드는 도지 봉이면 bullish_harami_cross를 반환한다', () => {
                // curr: doji inside prev body (body=0.2, range=4, ratio=0.05)
                const prev = makeBar(110, 111, 99, 100);
                const curr = makeBar(103, 107, 99, 103.2);
                expect(detectAfter('decline', [prev, curr])).toBe(
                    'bullish_harami_cross'
                );
            });

            it('긴 양봉 후 몸통 안에 드는 비도지 봉이면 bearish_harami를 반환한다', () => {
                // prev: long bullish (body=10, range=12)
                // curr: inside body, bearish, not doji (body=2, range=4)
                const prev = makeBar(100, 111, 99, 110);
                const curr = makeBar(109, 110, 104, 105);
                expect(detectAfter('advance', [prev, curr])).toBe(
                    'bearish_harami'
                );
            });

            it('긴 양봉 후 몸통 안에 드는 도지 봉이면 bearish_harami_cross를 반환한다', () => {
                // curr: doji inside prev body (body=0.3, range=6, ratio=0.05)
                const prev = makeBar(100, 111, 99, 110);
                const curr = makeBar(105, 108, 102, 105.3);
                expect(detectAfter('advance', [prev, curr])).toBe(
                    'bearish_harami_cross'
                );
            });
        });

        describe('piercing_line / dark_cloud_cover', () => {
            it('긴 음봉 후 중점 돌파 양봉이면 piercing_line을 반환한다', () => {
                // prev: long bearish (body=10, range=12), midpoint=105
                // curr: open<prev.close(100), close>midpoint(105) && close<prev.open(110)
                const prev = makeBar(110, 111, 99, 100);
                const curr = makeBar(98, 108, 97, 107);
                expect(detectAfter('decline', [prev, curr])).toBe(
                    'piercing_line'
                );
            });

            it('긴 양봉 후 중점 하락 음봉이면 dark_cloud_cover를 반환한다', () => {
                // prev: long bullish (body=10, range=12), midpoint=105
                // curr: open>prev.close(110), close<midpoint(105) && close>prev.open(100)
                const prev = makeBar(100, 111, 99, 110);
                const curr = makeBar(112, 113, 102, 103);
                expect(detectAfter('advance', [prev, curr])).toBe(
                    'dark_cloud_cover'
                );
            });
        });

        describe('counterattack_line', () => {
            it('긴 음봉 후 종가가 거의 같은 긴 양봉이면 bullish_counterattack_line을 반환한다', () => {
                // prev: long bearish, prev.close=100
                // curr: long bullish, curr.close≈100 (within 0.2%)
                const prev = makeBar(110, 111, 99, 100);
                const curr = makeBar(90, 101, 89, 100.1);
                expect(detectAfter('decline', [prev, curr])).toBe(
                    'bullish_counterattack_line'
                );
            });

            it('긴 양봉 후 종가가 거의 같은 긴 음봉이면 bearish_counterattack_line을 반환한다', () => {
                // prev: long bullish, prev.close=110
                // curr: long bearish, curr.close≈110 (within 0.2%)
                const prev = makeBar(100, 111, 99, 110);
                const curr = makeBar(120, 121, 109, 110.1);
                expect(detectAfter('advance', [prev, curr])).toBe(
                    'bearish_counterattack_line'
                );
            });
        });

        describe('tweezers', () => {
            it('직전 음봉과 저가가 거의 같으면 tweezers_bottom을 반환한다', () => {
                // prev: bearish, prev.low=90 / curr: bullish, curr.low=90
                const prev = makeBar(105, 106, 90, 100);
                const curr = makeBar(90, 102, 90, 101);
                expect(detectAfter('decline', [prev, curr])).toBe(
                    'tweezers_bottom'
                );
            });

            it('직전 양봉과 고가가 거의 같으면 tweezers_top을 반환한다', () => {
                // prev: bullish, prev.high=110 / curr: bearish, curr.high=110
                const prev = makeBar(100, 110, 99, 105);
                const curr = makeBar(108, 110, 102, 103);
                expect(detectAfter('advance', [prev, curr])).toBe(
                    'tweezers_top'
                );
            });
        });

        describe('on_neck / in_neck', () => {
            it('긴 음봉 후 저가 밑에서 시작해 저가 근처에서 마감하면 on_neck을 반환한다', () => {
                // prev: long bearish, prev.low=99
                // curr: open<99, close≈99 (within 0.2%)
                const prev = makeBar(110, 111, 99, 100);
                const curr = makeBar(97, 100, 96, 99.1);
                expect(detectAfter('decline', [prev, curr])).toBe('on_neck');
            });

            it('긴 음봉 후 저가 밑에서 시작해 전일 종가 5% 이내에서 마감하면 in_neck을 반환한다', () => {
                // prev: long bearish, prev.low=99, prev.close=100
                // curr: open<99, close>99 && close<105(=100*1.05), NOT isNearPrice(close, 99)
                const prev = makeBar(110, 111, 99, 100);
                const curr = makeBar(97, 103, 96, 100.5);
                expect(detectAfter('decline', [prev, curr])).toBe('in_neck');
            });
        });

        describe('above_the_stomach / below_the_stomach', () => {
            it('음봉 후 중간값 이상에서 시작·마감하는 양봉이면 above_the_stomach를 반환한다', () => {
                // prev: long bearish 110→100, midpoint=105
                // curr: bullish, open(106) ≥ 105, body [106,112] 밖이라 harami 아님
                const prev = makeBar(110, 111, 99, 100);
                const curr = makeBar(106, 113, 105, 112);
                expect(detectAfter('decline', [prev, curr])).toBe(
                    'above_the_stomach'
                );
            });

            it('시가가 정확히 중간값이면(경계 포함) above_the_stomach를 반환한다', () => {
                const prev = makeBar(110, 111, 99, 100);
                const curr = makeBar(105, 113, 104, 112);
                expect(detectAfter('decline', [prev, curr])).toBe(
                    'above_the_stomach'
                );
            });

            it('직전 음봉이 장대봉이 아니면 above_the_stomach가 아니다', () => {
                // prev: body 1 / range 6 — 짧은 음봉, midpoint 100.5
                const prev = makeBar(101, 103, 97, 100);
                const curr = makeBar(101, 104, 100.5, 103.5);
                expect(detectAfter('decline', [prev, curr])).toBeNull();
            });

            it('시가가 중간값 바로 아래면 above_the_stomach가 아니다', () => {
                // open 104.9 < midpoint 105 — 다른 2봉 패턴에도 해당 없음
                const prev = makeBar(110, 111, 99, 100);
                const curr = makeBar(104.9, 113, 104, 112);
                expect(detectAfter('decline', [prev, curr])).toBeNull();
            });

            it('양봉 후 중간값 이하에서 시작·마감하는 음봉이면 below_the_stomach를 반환한다', () => {
                // prev: long bullish 100→110, midpoint=105
                // curr: bearish, open(104) ≤ 105, bodyLow 98 < 100 이라 harami 아님
                const prev = makeBar(100, 111, 99, 110);
                const curr = makeBar(104, 105, 97, 98);
                expect(detectAfter('advance', [prev, curr])).toBe(
                    'below_the_stomach'
                );
            });

            it('시가가 정확히 중간값이면(경계 포함) below_the_stomach를 반환한다', () => {
                const prev = makeBar(100, 111, 99, 110);
                const curr = makeBar(105, 106, 97, 98);
                expect(detectAfter('advance', [prev, curr])).toBe(
                    'below_the_stomach'
                );
            });

            it('직전 봉의 몸통이 0(시가 = 종가)이면 below_the_stomach가 아니다', () => {
                // isBullishBar는 close ≥ open이라 몸통 0인 봉도 양봉으로 본다 —
                // 장대봉 조건이 이 도지를 걸러낸다.
                const prev = makeBar(100, 101, 99, 100);
                const curr = makeBar(99.99, 100.1, 99.7, 99.8);
                expect(detectAfter('decline', [prev, curr])).toBeNull();
            });

            it('시가가 중간값 바로 위면 below_the_stomach가 아니다', () => {
                const prev = makeBar(100, 111, 99, 110);
                const curr = makeBar(105.1, 106, 97, 98);
                expect(detectAfter('decline', [prev, curr])).toBeNull();
            });

            it('기존 2봉 패턴이 함께 성립하면 기존 라벨이 이긴다 (stomach는 폴백)', () => {
                // stomach 조건도 맞지만(open 106 ≥ 105) 몸통이 prev 몸통 안 → harami
                const prev = makeBar(110, 111, 99, 100);
                const curr = makeBar(106, 110, 105, 109);
                expect(detectAfter('decline', [prev, curr])).toBe(
                    'bullish_harami'
                );
            });
        });

        describe('null 반환', () => {
            it('어떤 2봉 패턴에도 해당하지 않으면 null을 반환한다', () => {
                // both small bullish bars with no relation
                const prev = makeBar(100, 103, 99, 102);
                const curr = makeBar(101, 104, 100, 103);
                expect(detectAfter('advance', [prev, curr])).toBeNull();
            });
        });
    });

    describe('3봉 패턴', () => {
        describe('three_white_soldiers / three_black_crows', () => {
            it('3연속 긴 양봉이면 three_white_soldiers를 반환한다', () => {
                // a: body=8, range=10 / b: open in a's body / c: open in b's body
                const a = makeBar(100, 109, 99, 108);
                const b = makeBar(103, 114, 102, 113);
                const c = makeBar(108, 120, 107, 119);
                expect(detectAfter('decline', [a, b, c])).toBe(
                    'three_white_soldiers'
                );
            });

            it('3연속 긴 음봉이면 three_black_crows를 반환한다', () => {
                // a: body=10, range=12 / b: open in a's body / c: open in b's body
                const a = makeBar(110, 111, 99, 100);
                const b = makeBar(105, 106, 92, 93);
                const c = makeBar(98, 99, 86, 87);
                expect(detectAfter('advance', [a, b, c])).toBe(
                    'three_black_crows'
                );
            });
        });

        describe('morning_star / morning_doji_star', () => {
            it('긴 음봉 + 갭다운 소봉 + 중심 돌파 양봉이면 morning_star를 반환한다', () => {
                // a: long bearish (body=10, range=12), midpoint=105
                // b: small non-doji gap below a (bodyHigh=98 < bodyLow(a)=100)
                // c: bullish, close(107) > midpoint(105)
                const a = makeBar(110, 111, 99, 100);
                const b = makeBar(97, 99, 96, 98);
                const c = makeBar(99, 108, 98, 107);
                expect(detectAfter('decline', [a, b, c])).toBe('morning_star');
            });

            it('긴 음봉 + 갭다운 도지 + 중심 돌파 양봉이면 morning_doji_star를 반환한다', () => {
                // b: doji (body=0.2, range=4, ratio=0.05)
                const a = makeBar(110, 111, 99, 100);
                const b = makeBar(97, 99, 95, 97.2);
                const c = makeBar(99, 108, 98, 107);
                expect(detectAfter('decline', [a, b, c])).toBe(
                    'morning_doji_star'
                );
            });
        });

        describe('evening_star / evening_doji_star', () => {
            it('긴 양봉 + 갭업 소봉 + 중심 하락 음봉이면 evening_star를 반환한다', () => {
                // a: long bullish (body=10, range=12), midpoint=105
                // b: non-doji gap above a (bodyLow=113 > bodyHigh(a)=110)
                // c: bearish, close(103) < midpoint(105)
                const a = makeBar(100, 111, 99, 110);
                const b = makeBar(113, 116, 112, 115);
                const c = makeBar(109, 110, 102, 103);
                expect(detectAfter('advance', [a, b, c])).toBe('evening_star');
            });

            it('긴 양봉 + 갭업 도지 + 중심 하락 음봉이면 evening_doji_star를 반환한다', () => {
                // b: doji (body=0.3, range=4, ratio=0.075)
                const a = makeBar(100, 111, 99, 110);
                const b = makeBar(113, 116, 112, 113.3);
                const c = makeBar(109, 110, 102, 103);
                expect(detectAfter('advance', [a, b, c])).toBe(
                    'evening_doji_star'
                );
            });
        });

        describe('abandoned_baby', () => {
            it('긴 음봉 + 갭다운 도지 + 갭업 양봉이면 bullish_abandoned_baby를 반환한다', () => {
                // a: long bearish, a.low=99
                // b: doji, b.high=97 < a.low=99 (gapDown)
                // c: bullish, c.low=98 > b.high=97 (gapUp)
                const a = makeBar(110, 111, 99, 100);
                const b = makeBar(95, 97, 93, 95.2);
                const c = makeBar(99, 106, 98, 105);
                expect(detectAfter('decline', [a, b, c])).toBe(
                    'bullish_abandoned_baby'
                );
            });

            it('긴 양봉 + 갭업 도지 + 갭다운 음봉이면 bearish_abandoned_baby를 반환한다', () => {
                // a: long bullish (body=10, range=12), midpoint(a)=105
                // b: doji, b.low=113 > a.high=111 (gapUp)
                // c: bearish, c.high=112 < b.low=113 (gapDown)
                //   c.close(106) >= midpoint(a)(105) → evening_doji_star 조건 불충족
                const a = makeBar(100, 111, 99, 110);
                const b = makeBar(114, 116, 113, 114.2);
                const c = makeBar(108, 112, 105, 106);
                expect(detectAfter('advance', [a, b, c])).toBe(
                    'bearish_abandoned_baby'
                );
            });
        });

        describe('three_inside', () => {
            it('긴 음봉 + 내부 양봉 + 확인 양봉이면 three_inside_up을 반환한다', () => {
                // a: long bearish, a.open=110
                // b: bullish inside a (bodyLow=101≥100, bodyHigh=105≤110)
                // c: bullish, c.close(112) > a.open(110)
                const a = makeBar(110, 111, 99, 100);
                const b = makeBar(101, 106, 100, 105);
                const c = makeBar(103, 113, 102, 112);
                expect(detectAfter('decline', [a, b, c])).toBe(
                    'three_inside_up'
                );
            });

            it('긴 양봉 + 내부 음봉 + 확인 음봉이면 three_inside_down을 반환한다', () => {
                // a: long bullish, a.open=100
                // b: bearish inside a (bodyLow=105≥100, bodyHigh=109≤110)
                // c: bearish, c.close(98) < a.open(100)
                const a = makeBar(100, 111, 99, 110);
                const b = makeBar(109, 110, 104, 105);
                const c = makeBar(107, 108, 97, 98);
                expect(detectAfter('advance', [a, b, c])).toBe(
                    'three_inside_down'
                );
            });
        });

        describe('three_outside', () => {
            it('음봉 + 포함 양봉 + 확인 양봉이면 three_outside_up을 반환한다', () => {
                // a: bearish (a.open=105, a.close=100)
                // b: bullish engulfing (b.close≥a.open=105, b.open≤a.close=100)
                // c: bullish, c.close(110) > b.close(107)
                const a = makeBar(105, 106, 99, 100);
                const b = makeBar(99, 108, 98, 107);
                const c = makeBar(105, 111, 104, 110);
                expect(detectAfter('decline', [a, b, c])).toBe(
                    'three_outside_up'
                );
            });

            it('양봉 + 포함 음봉 + 확인 음봉이면 three_outside_down을 반환한다', () => {
                // a: bullish (a.open=100, a.close=105)
                // b: bearish engulfing (b.close≤a.open=100, b.open≥a.close=105)
                // c: bearish, c.close(95) < b.close(98)
                const a = makeBar(100, 106, 99, 105);
                const b = makeBar(106, 107, 97, 98);
                const c = makeBar(100, 101, 94, 95);
                expect(detectAfter('advance', [a, b, c])).toBe(
                    'three_outside_down'
                );
            });
        });

        describe('triple_star', () => {
            it('3도지 + 갭다운 + 마지막 양봉이면 bullish_triple_star를 반환한다', () => {
                // a: doji (body=0.5, range=10, ratio=0.05), a.low=95
                // b: doji, b.high=93 < a.low=95 (gapDown)
                // c: bullish doji
                const a = makeBar(100, 105, 95, 100.5);
                const b = makeBar(91, 93, 89, 91.3);
                const c = makeBar(90, 92, 88, 90.3);
                expect(detectAfter('decline', [a, b, c])).toBe(
                    'bullish_triple_star'
                );
            });

            it('3도지 + 갭업 + 마지막 음봉이면 bearish_triple_star를 반환한다', () => {
                // a: doji (body=0.5, range=10), a.high=105
                // b: doji, b.low=107 > a.high=105 (gapUp)
                // c: bearish doji
                const a = makeBar(100, 105, 95, 100.5);
                const b = makeBar(108, 110, 107, 108.3);
                const c = makeBar(107, 109, 105, 106.7);
                expect(detectAfter('advance', [a, b, c])).toBe(
                    'bearish_triple_star'
                );
            });
        });

        describe('gap_two', () => {
            it('긴 양봉 + 갭업 후 두 음봉이 하락하면 upside_gap_two_crows를 반환한다', () => {
                // a: long bullish, bodyHigh(a)=108
                // b: bearish, bodyLow(b)=112 > 108
                // c: bearish, c.open(113)≤b.open(115), c.close(110)≤b.close(112), c.open(113)>108
                const a = makeBar(100, 109, 99, 108);
                const b = makeBar(115, 116, 111, 112);
                const c = makeBar(113, 114, 109, 110);
                expect(detectAfter('advance', [a, b, c])).toBe(
                    'upside_gap_two_crows'
                );
            });

            it('긴 음봉 + 갭다운 후 두 양봉이 상승하면 downside_gap_two_rabbits를 반환한다', () => {
                // a: long bearish, bodyLow(a)=102
                // b: bullish, bodyHigh(b)=99 < 102
                // c: bullish, c.open(97)≥b.open(96), c.close(100)≥b.close(99), c.open(97)<102
                const a = makeBar(110, 111, 101, 102);
                const b = makeBar(96, 100, 95, 99);
                const c = makeBar(97, 101, 96, 100);
                expect(detectAfter('decline', [a, b, c])).toBe(
                    'downside_gap_two_rabbits'
                );
            });
        });

        describe('advance_block', () => {
            it('3연속 양봉이나 몸통 줄고 위꼬리 늘면 advance_block을 반환한다', () => {
                // a: long bullish (body=8, range=10), upperShadow=1
                // b: bullish (body=6<8, range=12), upperShadow=5>1
                // c: bullish (body=4<6, range=14), upperShadow=9>5
                const a = makeBar(100, 109, 99, 108);
                const b = makeBar(102, 113, 101, 108);
                const c = makeBar(104, 117, 103, 108);
                expect(detectAfter('advance', [a, b, c])).toBe('advance_block');
            });
        });

        describe('gap_tasuki', () => {
            it('갭업 후 두 양봉 사이 음봉이면 upside_gap_tasuki를 반환한다', () => {
                // a: bullish, a.high=108
                // b: bullish, b.low=109 > a.high=108 (gapUp)
                // c: bearish, c.open(113)<b.close(115), c.close(110)>a.high(108)
                const a = makeBar(100, 108, 99, 107);
                const b = makeBar(110, 116, 109, 115);
                const c = makeBar(113, 114, 109, 110);
                expect(detectAfter('advance', [a, b, c])).toBe(
                    'upside_gap_tasuki'
                );
            });

            it('갭다운 후 두 음봉 사이 양봉이면 downside_gap_tasuki를 반환한다', () => {
                // a: bearish, a.low=102
                // b: bearish, b.high=101 < a.low=102 (gapDown)
                // c: bullish, c.open(97)>b.close(95), c.close(100)<a.low(102)
                const a = makeBar(110, 111, 102, 103);
                const b = makeBar(100, 101, 94, 95);
                const c = makeBar(97, 101, 96, 100);
                expect(detectAfter('decline', [a, b, c])).toBe(
                    'downside_gap_tasuki'
                );
            });
        });

        describe('ladder_bottom', () => {
            it('두 음봉 하락 후 긴 음봉 상단에서 양봉이면 ladder_bottom을 반환한다', () => {
                // a: bearish (a.open=110, a.close=100)
                // b: long bearish (body=13, range=15), b.open=108 (a.close<108<a.open)
                // c: bullish, c.open(110)>b.open(108), c.close(112)>a.open(110)
                const a = makeBar(110, 111, 99, 100);
                const b = makeBar(108, 109, 94, 95);
                const c = makeBar(110, 113, 109, 112);
                expect(detectAfter('decline', [a, b, c])).toBe('ladder_bottom');
            });
        });

        describe('null 반환', () => {
            it('어떤 3봉 패턴에도 해당하지 않으면 2봉 패턴을 시도하고 없으면 null을 반환한다', () => {
                // 3봉도, 마지막 2봉도 패턴 없음
                const a = makeBar(100, 103, 99, 102);
                const b = makeBar(101, 104, 100, 103);
                const c = makeBar(102, 105, 101, 104);
                expect(detectAfter('decline', [a, b, c])).toBeNull();
            });
        });
    });

    describe('4봉 패턴 (three-line strike)', () => {
        // b1–b3: 양봉, 종가 105 → 110 → 115 연속 상승
        const up1 = makeBar(100, 106, 99, 105);
        const up2 = makeBar(104, 111, 103, 110);
        const up3 = makeBar(109, 116, 108, 115);

        it('세 양봉 뒤 b3 종가 이상에서 시작해 b1 시가 아래로 마감하는 음봉이면 bullish_three_line_strike를 반환한다', () => {
            // b4: open 116 ≥ b3.close 115, close 98 < b1.open 100
            const strike = makeBar(116, 117, 97, 98);
            expect(detectAfter('advance', [up1, up2, up3, strike])).toBe(
                'bullish_three_line_strike'
            );
        });

        it('b4 시가가 b3 종가와 같으면(경계 포함) bullish_three_line_strike를 반환한다', () => {
            const strike = makeBar(115, 117, 97, 98);
            expect(detectAfter('advance', [up1, up2, up3, strike])).toBe(
                'bullish_three_line_strike'
            );
        });

        it('b4 종가가 b1 시가와 같으면(< 아님) strike가 아니고 2봉 패턴으로 떨어진다', () => {
            // close 100 == b1.open — strike 불성립, 마지막 2봉은 하락 장악형
            const strike = makeBar(116, 117, 99, 100);
            expect(detectAfter('advance', [up1, up2, up3, strike])).toBe(
                'bearish_engulfing'
            );
        });

        it('b1–b3 종가가 연속 상승하지 않으면 bullish_three_line_strike가 아니다', () => {
            // b2 종가(105)가 b1 종가(105)와 같다
            const flat2 = makeBar(104, 106, 103, 105);
            const strike = makeBar(116, 117, 97, 98);
            expect(detectAfter('advance', [up1, flat2, up3, strike])).not.toBe(
                'bullish_three_line_strike'
            );
        });

        it('세 음봉 뒤 b3 종가 이하에서 시작해 b1 시가 위로 마감하는 양봉이면 bearish_three_line_strike를 반환한다', () => {
            // b1–b3 종가 110 → 105 → 100 연속 하락, b4: open 99 ≤ 100, close 117 > b1.open 115
            const down1 = makeBar(115, 116, 109, 110);
            const down2 = makeBar(111, 112, 104, 105);
            const down3 = makeBar(106, 107, 99, 100);
            const strike = makeBar(99, 118, 98, 117);
            expect(detectAfter('decline', [down1, down2, down3, strike])).toBe(
                'bearish_three_line_strike'
            );
        });

        it('b4 시가가 b3 종가와 같으면(경계 포함) bearish_three_line_strike를 반환한다', () => {
            const down1 = makeBar(115, 116, 109, 110);
            const down2 = makeBar(111, 112, 104, 105);
            const down3 = makeBar(106, 107, 99, 100);
            const strike = makeBar(100, 118, 98, 117);
            expect(detectAfter('decline', [down1, down2, down3, strike])).toBe(
                'bearish_three_line_strike'
            );
        });

        it('b4 시가가 b3 종가보다 높으면 bearish_three_line_strike가 아니다', () => {
            const down1 = makeBar(115, 116, 109, 110);
            const down2 = makeBar(111, 112, 104, 105);
            const down3 = makeBar(106, 107, 99, 100);
            const strike = makeBar(100.5, 118, 98, 117);
            expect(
                detectAfter('decline', [down1, down2, down3, strike])
            ).not.toBe('bearish_three_line_strike');
        });

        it('4봉 패턴이 2봉 패턴보다 우선한다 — 마지막 2봉만 보면 하락 장악형', () => {
            const strike = makeBar(116, 117, 97, 98);
            expect(detectAfter('advance', [up3, strike])).toBe(
                'bearish_engulfing'
            );
            expect(detectAfter('advance', [up1, up2, up3, strike])).toBe(
                'bullish_three_line_strike'
            );
        });
    });

    describe('5봉 패턴 (three methods)', () => {
        // b1: 장대 양봉 100→110 (body 10 / range 12), 범위 [99, 111]
        const longUp = makeBar(100, 111, 99, 110);
        // b2–b4: 장대 아닌 작은 음봉, 모두 b1 범위 안
        const rest1 = makeBar(109, 110, 106, 107);
        const rest2 = makeBar(107, 108, 104, 105);
        const rest3 = makeBar(105, 106, 102, 103);
        // b5: 장대 양봉, close 115 > b1.close 110 (open 102.5 ≤ b4.close → 마지막 2봉은 상승 장악형)
        const breakUp = makeBar(102.5, 116, 102, 115);

        it('장대 양봉 + b1 범위 안의 작은 봉 3개 + 더 높이 마감하는 장대 양봉이면 rising_three_methods를 반환한다', () => {
            expect(
                detectAfter('advance', [longUp, rest1, rest2, rest3, breakUp])
            ).toBe('rising_three_methods');
        });

        it('중간 봉의 고가·저가가 b1 고가·저가와 같으면(경계 포함) 여전히 rising_three_methods다', () => {
            const touchesHigh = makeBar(109, 111, 106, 107);
            const touchesLow = makeBar(102, 103, 99, 100.5);
            expect(
                detectAfter('advance', [
                    longUp,
                    touchesHigh,
                    rest2,
                    touchesLow,
                    breakUp,
                ])
            ).toBe('rising_three_methods');
        });

        it('중간 봉이 b1 고가를 넘으면 rising_three_methods가 아니고 4봉 패턴으로 떨어진다', () => {
            // b2–b4는 종가가 연속 하락하는 음봉 3개, b5는 b4 종가 아래서 열어
            // b2 시가(109) 위로 마감 → bearish_three_line_strike
            const breaksHigh = makeBar(109, 111.5, 106, 107);
            expect(
                detectAfter('decline', [
                    longUp,
                    breaksHigh,
                    rest2,
                    rest3,
                    breakUp,
                ])
            ).toBe('bearish_three_line_strike');
        });

        it('중간 봉이 장대봉이면 rising_three_methods가 아니다', () => {
            // body 4 / range 5 = 0.8 ≥ LONG_DAY_BODY_RATIO
            const longRest = makeBar(108, 108.5, 103.5, 104);
            expect(
                detectAfter('advance', [
                    longUp,
                    rest1,
                    longRest,
                    rest3,
                    breakUp,
                ])
            ).not.toBe('rising_three_methods');
        });

        it('b5 종가가 b1 종가를 넘지 못하면 rising_three_methods가 아니다', () => {
            // close 110 == b1.close
            const weakBreak = makeBar(99.5, 111, 99, 110);
            expect(
                detectAfter('advance', [longUp, rest1, rest2, rest3, weakBreak])
            ).not.toBe('rising_three_methods');
        });

        it('장대 음봉 + b1 범위 안의 작은 봉 3개 + 더 낮게 마감하는 장대 음봉이면 falling_three_methods를 반환한다', () => {
            // b1: 110→100, 범위 [99, 111]; b5: 107.5→95 (body 12.5 / range 14)
            const longDown = makeBar(110, 111, 99, 100);
            const up1 = makeBar(101, 104, 100, 103);
            const up2 = makeBar(103, 106, 102, 105);
            const up3 = makeBar(105, 108, 104, 107);
            const breakDown = makeBar(107.5, 108, 94, 95);
            expect(
                detectAfter('decline', [longDown, up1, up2, up3, breakDown])
            ).toBe('falling_three_methods');
        });

        it('b5 종가가 b1 종가와 같으면(< 아님) falling_three_methods가 아니다', () => {
            const longDown = makeBar(110, 111, 99, 100);
            const up1 = makeBar(101, 104, 100, 103);
            const up2 = makeBar(103, 106, 102, 105);
            const up3 = makeBar(105, 108, 104, 107);
            // long bearish (body 9 / range 10), close 100 == b1.close
            const weakBreak = makeBar(109, 109.5, 99.5, 100);
            expect(
                detectAfter('decline', [longDown, up1, up2, up3, weakBreak])
            ).not.toBe('falling_three_methods');
        });

        it('중간 봉이 b1 저가 아래로 내려가면 falling_three_methods가 아니다', () => {
            const longDown = makeBar(110, 111, 99, 100);
            const breaksLow = makeBar(101, 104, 98.5, 103);
            const up2 = makeBar(103, 106, 102, 105);
            const up3 = makeBar(105, 108, 104, 107);
            const breakDown = makeBar(107.5, 108, 94, 95);
            expect(
                detectAfter('decline', [
                    longDown,
                    breaksLow,
                    up2,
                    up3,
                    breakDown,
                ])
            ).not.toBe('falling_three_methods');
        });

        it('5봉 패턴이 4·2봉 패턴보다 우선한다 — 마지막 4봉은 bearish_three_line_strike, 마지막 2봉은 상승 장악형', () => {
            expect(detectAfter('decline', [rest1, rest2, rest3, breakUp])).toBe(
                'bearish_three_line_strike'
            );
            expect(detectAfter('decline', [rest3, breakUp])).toBe(
                'bullish_engulfing'
            );
        });
    });

    describe('긴 창에서도 기존 2·3봉 결과는 불변', () => {
        // 앞에 20봉 리드가 붙은 긴 창에서도 4·5봉 패턴이 끼어들지 않고 기존 2·3봉 결과가 그대로여야 한다.

        it.each(MULTI_PATTERN_FIXTURES)(
            '%s: 앞의 긴 리드 봉이 있어도 기하 결과는 같은 라벨이다',
            (expected, fixture) => {
                expect(detectAfter(PRIOR_OF[expected], fixture)).toBe(expected);
            }
        );
    });
});

describe('다봉 패턴 컨텍스트 규칙', () => {
    /** ATR을 상수로 고정해 문턱(몸통 하한)을 정확히 다룬다. */
    const detectWithAtr = (
        direction: TrendLeadDirection,
        bars: readonly Bar[],
        atrValue: number
    ): MultiCandlePattern | null => {
        const all = [...makeTrendLead(direction, bars[0].open), ...bars];
        return detectMultiCandlePattern(
            all,
            all.map(() => atrValue)
        );
    };

    describe('요구하는 직전 움직임 (패턴 전체 × 하락·상승·없음)', () => {
        const OPPOSITE = {
            decline: 'advance',
            advance: 'decline',
        } as const;

        it.each(MULTI_PATTERN_FIXTURES)(
            '%s: 요구 방향 뒤에서만 감지된다',
            (expected, fixture) => {
                const needed = PRIOR_OF[expected];
                expect(detectAfter(needed, fixture)).toBe(expected);
                expect(detectAfter(OPPOSITE[needed], fixture)).not.toBe(
                    expected
                );
                expect(detectAfter('none', fixture)).not.toBe(expected);
            }
        );

        it('움직임을 잴 수 없으면(ATR이 전부 null) 어떤 패턴도 감지하지 않는다', () => {
            const [prev, curr] = MULTI_PATTERN_FIXTURES[0][1];
            const all = [...makeTrendLead('decline', prev.open), prev, curr];
            expect(
                detectMultiCandlePattern(
                    all,
                    all.map(() => null)
                )
            ).toBeNull();
        });

        it('패턴 첫 봉 앞에 봉이 CANDLE_PRIOR_TREND_BARS + 1개 미만이면 감지하지 않는다', () => {
            const [prev, curr] = MULTI_PATTERN_FIXTURES[0][1];
            const short = [
                ...makeTrendLead('decline', prev.open, CANDLE_PRIOR_TREND_BARS),
                prev,
                curr,
            ];
            expect(
                detectMultiCandlePattern(short, calculateATR(short))
            ).toBeNull();
        });
    });

    describe('4봉·5봉 패턴의 방향', () => {
        const up = [
            makeBar(100, 106, 99, 105),
            makeBar(104, 111, 103, 110),
            makeBar(109, 116, 108, 115),
        ];
        const longUp = makeBar(100, 111, 99, 110);
        const rests = [
            makeBar(109, 110, 106, 107),
            makeBar(107, 108, 104, 105),
            makeBar(105, 106, 102, 103),
        ];
        const breakUp = makeBar(102.5, 116, 102, 115);
        const strike = makeBar(116, 117, 97, 98);

        it('bullish_three_line_strike는 상승 뒤에만, 하락 뒤에서는 4봉이 아무것도 내지 않는다', () => {
            expect(detectAfter('advance', [...up, strike])).toBe(
                'bullish_three_line_strike'
            );
            expect(detectAfter('decline', [...up, strike])).not.toBe(
                'bullish_three_line_strike'
            );
        });

        it('rising_three_methods는 상승 뒤에만 감지된다', () => {
            const bars = [longUp, ...rests, breakUp];
            expect(detectAfter('advance', bars)).toBe('rising_three_methods');
            expect(detectAfter('decline', bars)).not.toBe(
                'rising_three_methods'
            );
        });
    });

    describe('4봉·5봉 패턴 픽스처의 방향 (통과 / 반대 / 없음)', () => {
        it.each(LONG_PATTERN_FIXTURES)(
            '%s: 요구 방향 뒤에서만 감지된다',
            (expected, fixture) => {
                const needed = PRIOR_OF[expected];
                const opposite = needed === 'decline' ? 'advance' : 'decline';
                expect(detectAfter(needed, fixture)).toBe(expected);
                expect(detectAfter(opposite, fixture)).not.toBe(expected);
                expect(detectAfter('none', fixture)).not.toBe(expected);
            }
        );
    });

    describe('패턴 봉 수의 단일 출처', () => {
        const ALL = [...MULTI_PATTERN_FIXTURES, ...LONG_PATTERN_FIXTURES];

        it('픽스처가 모든 MultiCandlePattern을 덮는다', () => {
            expect(ALL.map(([name]) => name).toSorted()).toEqual(
                Object.keys(PRIOR_OF).toSorted()
            );
        });

        it.each(ALL)(
            '%s: getPatternBarCount는 실제 감지기가 쓰는 봉 수와 같다',
            (pattern, fixture) => {
                expect(getPatternBarCount(pattern)).toBe(fixture.length);
                // 첫 봉을 어떤 패턴과도 무관한 봉으로 바꾸면 감지기가 그 봉을 읽어
                // 같은 패턴을 더 찾지 못한다: 게이트가 쓴 길이가 곧 봉 수다.
                // (no single bar breaks every pattern, so try a doji and both marubozus)
                const garbage = [
                    makeBar(100, 101, 99, 100.05),
                    makeBar(100, 200, 100, 200),
                    makeBar(200, 200, 100, 100),
                ];
                const found = garbage.map(first =>
                    detectAfter(PRIOR_OF[pattern], [first, ...fixture.slice(1)])
                );
                expect(found.some(label => label !== pattern)).toBe(true);
            }
        );
    });

    describe('같은 길이의 낮은 우선순위 라벨로 내려가지 않는다', () => {
        // 세 장대 양봉: 적삼병 기하와 전진 저지 기하를 모두 만족한다 (적삼병이 우선)
        const soldiersAndBlock = [
            makeBar(100, 110.5, 99.5, 110),
            makeBar(103, 111, 102.5, 109),
            makeBar(105, 112, 105, 109.5),
        ];

        it('상승 뒤: 적삼병이 맥락에 실패하면 전진 저지(advance_block)로 내려가지 않는다', () => {
            expect(detectAfter('advance', soldiersAndBlock)).not.toBe(
                'advance_block'
            );
            expect(detectAfter('advance', soldiersAndBlock)).not.toBe(
                'three_white_soldiers'
            );
        });

        it('하락 뒤: 같은 봉은 three_white_soldiers다', () => {
            expect(detectAfter('decline', soldiersAndBlock)).toBe(
                'three_white_soldiers'
            );
        });
    });

    describe('4봉·5봉이 맥락에 실패하면 더 짧은 길이로 내려간다', () => {
        it('5봉 rising_three_methods가 맥락에 실패해도 마지막 4봉·2봉 결과가 남는다 (하락 뒤: 4봉 bearish_three_line_strike)', () => {
            const bars = [
                makeBar(100, 111, 99, 110),
                makeBar(109, 110, 106, 107),
                makeBar(107, 108, 104, 105),
                makeBar(105, 106, 102, 103),
                makeBar(102.5, 116, 102, 115),
            ];
            expect(detectAfter('decline', bars)).not.toBe(
                'rising_three_methods'
            );
            expect(detectAfter('decline', bars)).toBe(
                'bearish_three_line_strike'
            );
        });
    });

    describe('첫 봉 몸통 하한 (CANDLE_MIN_SETUP_BODY_ATR × ATR)', () => {
        const ATR = 2;
        // 별(star) 봉: 장대 음봉 a의 몸통 아래에서 마감 · 양봉 c가 a 중점 위로 회복
        const star = makeBar(100.5, 100.5, 99.5, 99.5);
        const recover = makeBar(99, 102, 99, 102);
        /** a: 몸통이 body인 장대 음봉 (high = open, low = close). */
        const bodyBar = (body: number): Bar =>
            makeBar(101 + body, 101 + body, 101, 101);

        it('몸통이 정확히 하한이면 3봉 morning_star를 통과시킨다', () => {
            const body = CANDLE_MIN_SETUP_BODY_ATR * ATR;
            expect(
                detectWithAtr('decline', [bodyBar(body), star, recover], ATR)
            ).toBe('morning_star');
        });

        it('몸통이 하한보다 작으면 3봉은 아무것도 내지 않고 마지막 2봉 bullish_engulfing으로 떨어진다', () => {
            const body = CANDLE_MIN_SETUP_BODY_ATR * ATR - 0.1;
            expect(
                detectWithAtr('decline', [bodyBar(body), star, recover], ATR)
            ).toBe('bullish_engulfing');
        });

        it('하한은 2봉 반전의 첫 봉에도 적용된다 (harami)', () => {
            // prev: 몸통 = 하한인 장대 음봉(range = body), curr: 몸통 안의 비도지 봉
            const at = (body: number): MultiCandlePattern | null =>
                detectWithAtr(
                    'decline',
                    [
                        makeBar(101 + body, 101 + body, 101, 101),
                        makeBar(
                            101.1,
                            101.1 + body / 2,
                            101.1,
                            101.1 + body / 2
                        ),
                    ],
                    ATR
                );
            expect(at(CANDLE_MIN_SETUP_BODY_ATR * ATR)).toBe('bullish_harami');
            expect(at(CANDLE_MIN_SETUP_BODY_ATR * ATR - 0.1)).toBeNull();
        });

        it('하한이 없는 패턴(three_white_soldiers)은 작은 첫 봉도 통과한다', () => {
            // 몸통 0.2(ATR 2 기준 하한 0.5 미만)인 연속 장대 양봉 세 개
            const soldiers = [
                makeBar(100, 100.2, 100, 100.2),
                makeBar(100.1, 100.4, 100.1, 100.4),
                makeBar(100.3, 100.6, 100.3, 100.6),
            ];
            expect(detectWithAtr('decline', soldiers, ATR)).toBe(
                'three_white_soldiers'
            );
        });
    });

    describe('첫 봉이 도지 크기이면 거부 (engulfing, three outside, tweezers)', () => {
        // 하한이 이 규칙을 가리지 않도록 ATR을 작게 둔다 (하한 0.1)
        const ATR = 0.4;
        const DOJI_AT_RATIO = makeBar(101, 105, 95, 100); // 몸통 1 / range 10 = 0.1
        const JUST_ABOVE = makeBar(101.1, 105, 95, 100); // 0.11

        it('도지 크기 음봉을 덮는 양봉은 bullish_engulfing이 아니다', () => {
            const curr = makeBar(99, 109, 98, 108);
            expect(
                detectWithAtr('decline', [DOJI_AT_RATIO, curr], ATR)
            ).toBeNull();
        });

        it('도지 비율을 넘는 첫 봉이면 bullish_engulfing이다', () => {
            const curr = makeBar(99, 109, 98, 108);
            expect(detectWithAtr('decline', [JUST_ABOVE, curr], ATR)).toBe(
                'bullish_engulfing'
            );
        });

        it('three_outside_up도 도지 크기 첫 봉이면 3봉을 내지 않는다', () => {
            const b = makeBar(99, 109, 98, 108);
            const c = makeBar(107, 112, 106, 111);
            expect(
                detectWithAtr('decline', [DOJI_AT_RATIO, b, c], ATR)
            ).not.toBe('three_outside_up');
            expect(detectWithAtr('decline', [JUST_ABOVE, b, c], ATR)).toBe(
                'three_outside_up'
            );
        });

        it('tweezers_bottom도 도지 크기 첫 봉이면 거부한다', () => {
            // 저가 90 일치, 둘째 봉은 첫 봉 종가 위에서 마감
            const prev = makeBar(100.5, 105, 90, 99.5);
            const curr = makeBar(90, 102, 90, 101);
            expect(detectWithAtr('decline', [prev, curr], ATR)).toBeNull();
            const sizable = makeBar(105, 106, 90, 100);
            expect(detectWithAtr('decline', [sizable, curr], ATR)).toBe(
                'tweezers_bottom'
            );
        });
    });

    describe('tweezers 확인 종가', () => {
        const ATR = 2;

        it('tweezers_bottom: 둘째 봉 종가가 첫 봉 종가보다 높아야 한다 (같으면 거부)', () => {
            const prev = makeBar(105, 106, 90, 100);
            expect(
                detectWithAtr('decline', [prev, makeBar(90, 102, 90, 101)], ATR)
            ).toBe('tweezers_bottom');
            expect(
                detectWithAtr('decline', [prev, makeBar(90, 102, 90, 100)], ATR)
            ).toBeNull();
            expect(
                detectWithAtr('decline', [prev, makeBar(90, 102, 90, 95)], ATR)
            ).toBeNull();
        });

        it('tweezers_top: 둘째 봉 종가가 첫 봉 종가보다 낮아야 한다 (같으면 거부)', () => {
            const prev = makeBar(100, 110, 99, 105);
            expect(
                detectWithAtr(
                    'advance',
                    [prev, makeBar(108, 110, 102, 104)],
                    ATR
                )
            ).toBe('tweezers_top');
            expect(
                detectWithAtr(
                    'advance',
                    [prev, makeBar(108, 110, 102, 105)],
                    ATR
                )
            ).toBeNull();
            expect(
                detectWithAtr(
                    'advance',
                    [prev, makeBar(108, 110, 102, 109)],
                    ATR
                )
            ).toBeNull();
        });
    });
});
