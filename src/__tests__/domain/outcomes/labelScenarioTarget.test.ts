import { describe, expect, it } from 'vitest';
import { labelScenarioTarget } from '@/domain/outcomes/labelScenarioTarget';
import { flat, makeWindow, type Ohlc } from '../../helpers/outcomeWindows';

/** Reference price 100, ATR 2. */
function at(offset: number, bar: Ohlc): Ohlc[] {
    return [...Array.from({ length: offset - 1 }, () => flat(100)), bar];
}

describe('labelScenarioTarget', () => {
    it('touches a bullish target on the first high that reaches it', () => {
        expect(
            labelScenarioTarget(
                { side: 'bullish', price: 104 },
                makeWindow({ forward: at(3, [100, 104, 100, 103]) })
            )
        ).toEqual({
            side: 'bullish',
            price: 104,
            distanceAtr: 2,
            touched: true,
            touchOffset: 3,
        });
    });

    it('does not touch a bullish target the highs stop just short of', () => {
        expect(
            labelScenarioTarget(
                { side: 'bullish', price: 104 },
                makeWindow({ forward: at(3, [100, 103.99, 100, 103]) })
            )
        ).toMatchObject({ touched: false, touchOffset: null, distanceAtr: 2 });
    });

    it('touches a bearish target on the first low that reaches it', () => {
        expect(
            labelScenarioTarget(
                { side: 'bearish', price: 96 },
                makeWindow({ forward: at(2, [100, 100, 96, 97]) })
            )
        ).toEqual({
            side: 'bearish',
            price: 96,
            distanceAtr: 2,
            touched: true,
            touchOffset: 2,
        });
    });

    it('does not touch a bearish target the lows stop just short of', () => {
        expect(
            labelScenarioTarget(
                { side: 'bearish', price: 96 },
                makeWindow({ forward: at(2, [100, 100, 96.01, 97]) })
            ).touched
        ).toBe(false);
    });

    it.each([
        ['a bullish target under the reference price', 'bullish', 99],
        ['a bullish target at the reference price', 'bullish', 100],
        ['a bearish target over the reference price', 'bearish', 101],
        ['a bearish target at the reference price', 'bearish', 100],
    ] as const)(
        'never touches %s, even when the bars cross it',
        (_name, side, price) => {
            expect(
                labelScenarioTarget(
                    { side, price },
                    makeWindow({ forward: [[100, 110, 90, 100]] })
                )
            ).toEqual({
                side,
                price,
                distanceAtr: null,
                touched: false,
                touchOffset: null,
            });
        }
    );

    it('still reports a touch, with no distance, when there is no ATR', () => {
        expect(
            labelScenarioTarget(
                { side: 'bullish', price: 104 },
                makeWindow({ atr: null, forward: [[100, 105, 100, 103]] })
            )
        ).toMatchObject({ distanceAtr: null, touched: true, touchOffset: 1 });
        expect(
            labelScenarioTarget(
                { side: 'bullish', price: 104 },
                makeWindow({ atr: 0 })
            ).distanceAtr
        ).toBeNull();
    });
});
