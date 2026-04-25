// ─── Squeeze Momentum Indicator ─────────────────────────────────────────────
// Original concept: "Squeeze Momentum Indicator [LazyBear]" by LazyBear
// PineScript source: https://kr.tradingview.com/script/nqQ1DT5a-Squeeze-Momentum-Indicator-LazyBear/
// This is an independent TypeScript implementation based on the publicly
// documented algorithm. Not a direct port of the PineScript source code.
//
// Algorithm:
//   BB: basis = SMA(close, length), dev = kcMult * stdDev(close, length)
//       (Note: uses kcMult=1.5 for BB dev — faithful to the original script)
//   KC: ma = SMA(close, kcLength), rangema = SMA(trueRange, kcLength)
//       upper/lower = ma ± rangema * kcMult
//   sqzOn  = lowerBB > lowerKC AND upperBB < upperKC  (BB inside KC)
//   sqzOff = lowerBB < lowerKC AND upperBB > upperKC  (BB outside KC)
//   noSqz  = NOT sqzOn AND NOT sqzOff
//   momentum = linreg(close - avg(avg(highest(high, n), lowest(low, n)), SMA(close, n)), n, 0)
// ─────────────────────────────────────────────────────────────────────────────

import type { Bar, SqueezeMomentumResult } from '@/domain/types';
import {
    SQUEEZE_MOMENTUM_BB_LENGTH,
    SQUEEZE_MOMENTUM_KC_LENGTH,
    SQUEEZE_MOMENTUM_KC_MULT,
} from '@/domain/indicators/constants';
import { slidingMax, slidingMin } from './utils';

type BarComputed = Omit<SqueezeMomentumResult, 'increasing'>;

const NULL_COMPUTED: BarComputed = {
    momentum: null,
    sqzOn: null,
    sqzOff: null,
    noSqz: null,
};

function trueRangeAt(bar: Bar, prev: Bar): number {
    return Math.max(
        bar.high - bar.low,
        Math.abs(bar.high - prev.close),
        Math.abs(bar.low - prev.close)
    );
}

export function calculateSqueezeMomentum(
    bars: Bar[],
    bbLength = SQUEEZE_MOMENTUM_BB_LENGTH,
    kcLength = SQUEEZE_MOMENTUM_KC_LENGTH,
    kcMult = SQUEEZE_MOMENTUM_KC_MULT
): SqueezeMomentumResult[] {
    if (bars.length === 0) return [];

    const n = bars.length;
    const closes = bars.map(b => b.close);
    const highs = bars.map(b => b.high);
    const lows = bars.map(b => b.low);

    // trValues[i] = TR at bars[i+1], so trValues.length = n - 1
    const trValues = new Array<number>(n - 1);
    for (let i = 1; i < n; i++) {
        trValues[i - 1] = trueRangeAt(bars[i], bars[i - 1]);
    }

    // ── Pass 1: deltas — O(N) via slidingMax/slidingMin + circular close SMA ──
    // delta[i] = close[i] - avg(avg(highest(high,n), lowest(low,n)), SMA(close,n))
    const winMaxH = slidingMax(highs, kcLength);
    const winMinL = slidingMin(lows, kcLength);
    const deltas = new Array<number | null>(n).fill(null);

    {
        let closeSum = 0;
        const closeBuf = new Array<number>(kcLength).fill(0);
        let closeBufHead = 0;
        let closeBufSize = 0;

        for (let i = 0; i < n; i++) {
            if (closeBufSize < kcLength) {
                closeBuf[(closeBufHead + closeBufSize) % kcLength] = closes[i];
                closeSum += closes[i];
                closeBufSize++;
            } else {
                closeSum -= closeBuf[closeBufHead];
                closeBuf[closeBufHead] = closes[i];
                closeBufHead = (closeBufHead + 1) % kcLength;
                closeSum += closes[i];
            }
            if (closeBufSize < kcLength) continue;
            const maxH = winMaxH[i];
            const minL = winMinL[i];
            if (maxH === null || minL === null) continue;
            deltas[i] =
                closes[i] - ((maxH + minL) / 2 + closeSum / kcLength) / 2;
        }
    }

    // ── Pass 2: intermediate — O(N) via circular buffers + running sums ───────
    //
    // BB state (bbLength window of closes)
    let bbSum = 0;
    let bbSumSq = 0;
    const bbBuf = new Array<number>(bbLength).fill(0);
    let bbHead = 0;
    let bbSize = 0;

    // KC close state (kcLength window of closes)
    let kcCloseSum = 0;
    const kcCloseBuf = new Array<number>(kcLength).fill(0);
    let kcCloseHead = 0;
    let kcCloseSize = 0;

    // KC TR state (kcLength window of trValues; trValues[i] = TR at bar i+1)
    let kcTrSum = 0;
    const kcTrBuf = new Array<number>(kcLength).fill(0);
    let kcTrHead = 0;
    let kcTrSize = 0;

    // Linreg state — running sumY and sumXY over kcLength window of deltas.
    // Nulls (first kcLength-1 deltas) are stored as 0; lrNullCount tracks them.
    // Update rule when sliding: new_sumXY = old_sumXY - old_sumY + evicted + (n-1)*incoming
    let lrSumY = 0;
    let lrSumXY = 0;
    const lrBuf = new Array<number>(kcLength).fill(0);
    let lrHead = 0;
    let lrSize = 0;
    let lrNullCount = 0;

    // Precompute constants for inline linreg (x = 0..kcLength-1)
    const lrN = kcLength;
    const lrSumX = (lrN * (lrN - 1)) / 2;
    const lrSumX2 = (lrN * (lrN - 1) * (2 * lrN - 1)) / 6;
    const lrDenom = lrN * lrSumX2 - lrSumX * lrSumX;

    const intermediate = new Array<BarComputed>(n);

    for (let i = 0; i < n; i++) {
        // ── BB buffer (closes, bbLength) ──────────────────────────────────
        if (bbSize < bbLength) {
            bbBuf[(bbHead + bbSize) % bbLength] = closes[i];
            bbSum += closes[i];
            bbSumSq += closes[i] * closes[i];
            bbSize++;
        } else {
            const old = bbBuf[bbHead];
            bbBuf[bbHead] = closes[i];
            bbHead = (bbHead + 1) % bbLength;
            bbSum += closes[i] - old;
            bbSumSq += closes[i] * closes[i] - old * old;
        }

        // ── KC close buffer (closes, kcLength) ────────────────────────────
        if (kcCloseSize < kcLength) {
            kcCloseBuf[(kcCloseHead + kcCloseSize) % kcLength] = closes[i];
            kcCloseSum += closes[i];
            kcCloseSize++;
        } else {
            const old = kcCloseBuf[kcCloseHead];
            kcCloseBuf[kcCloseHead] = closes[i];
            kcCloseHead = (kcCloseHead + 1) % kcLength;
            kcCloseSum += closes[i] - old;
        }

        // ── KC TR buffer (trValues[i-1] = TR at bar i, kcLength) ─────────
        if (i >= 1) {
            const tr = trValues[i - 1];
            if (kcTrSize < kcLength) {
                kcTrBuf[(kcTrHead + kcTrSize) % kcLength] = tr;
                kcTrSum += tr;
                kcTrSize++;
            } else {
                const old = kcTrBuf[kcTrHead];
                kcTrBuf[kcTrHead] = tr;
                kcTrHead = (kcTrHead + 1) % kcLength;
                kcTrSum += tr - old;
            }
        }

        // ── Linreg buffer (deltas, kcLength) ──────────────────────────────
        // deltas[j] is null for j < kcLength-1; thereafter always non-null.
        const d = deltas[i];
        const dVal = d ?? 0; // null → 0 placeholder; lrNullCount tracks these
        const dIsNull = d === null;

        if (lrSize < kcLength) {
            lrBuf[(lrHead + lrSize) % kcLength] = dVal;
            lrSumY += dVal;
            lrSumXY += lrSize * dVal; // x = lrSize (before increment)
            if (dIsNull) lrNullCount++;
            lrSize++;
        } else {
            const evicted = lrBuf[lrHead];
            // sliding update: new_sumXY = old_sumXY - old_sumY + evicted + (n-1)*dVal
            lrSumXY = lrSumXY - lrSumY + evicted + (kcLength - 1) * dVal;
            lrSumY = lrSumY - evicted + dVal;
            lrBuf[lrHead] = dVal;
            lrHead = (lrHead + 1) % kcLength;
            // evicted is delta[i - kcLength]; null iff i - kcLength < kcLength - 1
            if (i - kcLength < kcLength - 1) lrNullCount--;
            if (dIsNull) lrNullCount++;
        }

        // ── Ready check ───────────────────────────────────────────────────
        if (
            bbSize < bbLength ||
            kcCloseSize < kcLength ||
            kcTrSize < kcLength ||
            lrSize < kcLength ||
            lrNullCount > 0
        ) {
            intermediate[i] = NULL_COMPUTED;
            continue;
        }

        // ── Bollinger Bands ───────────────────────────────────────────────
        const basis = bbSum / bbLength;
        const variance = bbSumSq / bbLength - basis * basis;
        const sd = Math.sqrt(Math.max(0, variance));
        const upperBB = basis + kcMult * sd;
        const lowerBB = basis - kcMult * sd;

        // ── Keltner Channel ───────────────────────────────────────────────
        const ma = kcCloseSum / kcLength;
        const rangema = kcTrSum / kcLength;
        const upperKC = ma + rangema * kcMult;
        const lowerKC = ma - rangema * kcMult;

        // ── Squeeze state ─────────────────────────────────────────────────
        const sqzOn = lowerBB > lowerKC && upperBB < upperKC;
        const sqzOff = lowerBB < lowerKC && upperBB > upperKC;
        const noSqz = !sqzOn && !sqzOff;

        // ── Momentum via inline linreg on lrBuf ───────────────────────────
        const slope =
            lrDenom !== 0 ? (lrN * lrSumXY - lrSumX * lrSumY) / lrDenom : 0;
        const intercept = (lrSumY - slope * lrSumX) / lrN;
        const momentum = intercept + slope * (lrN - 1);

        intermediate[i] = { momentum, sqzOn, sqzOff, noSqz };
    }

    // ── Pass 3: add increasing field ──────────────────────────────────────────
    return intermediate.map((r, i) => {
        if (r.momentum === null) return { ...r, increasing: null };
        const prevMomentum = i > 0 ? intermediate[i - 1].momentum : null;
        return {
            ...r,
            increasing:
                prevMomentum !== null ? r.momentum > prevMomentum : null,
        };
    });
}
