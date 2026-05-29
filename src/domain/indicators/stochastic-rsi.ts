import type { StochRSIResult } from '@/domain/types';
import { calculateRSI } from '@/domain/indicators/rsi';
import {
    STOCH_RSI_D_PERIOD,
    STOCH_RSI_K_PERIOD,
    STOCH_RSI_RSI_PERIOD,
    STOCH_RSI_STOCH_PERIOD,
} from '@/domain/indicators/constants';
/**
 * @internal Stochastic RSI — %K / %D oscillator applied to RSI values.
 *
 * Stochastic RSI = (RSI - min(RSI, stochPeriod)) / (max(RSI, stochPeriod) - min(RSI, stochPeriod))
 * %K = SMA(Stochastic RSI, kSmoothing)
 * %D = SMA(%K, dPeriod)
 *
 * Range: 0.0 - 1.0 (not multiplied by 100)
 * Default: RSI(14), Stoch(14), K(3), D(3)
 *
 * Note: all three passes use circular buffers (for loops) to avoid per-bar
 * slice() allocations that caused O(N × period) intermediate arrays.
 */
export function calculateStochRSI(
    closes: number[],
    rsiPeriod = STOCH_RSI_RSI_PERIOD,
    stochPeriod = STOCH_RSI_STOCH_PERIOD,
    kSmoothing = STOCH_RSI_K_PERIOD,
    dPeriod = STOCH_RSI_D_PERIOD
): StochRSIResult[] {
    if (closes.length === 0) return [];

    const rsiValues = calculateRSI(closes, rsiPeriod);

    // ── Pass 1: raw Stochastic RSI ─────────────────────────────────────────────
    // Maintain a circular buffer of the last stochPeriod non-null RSI values.
    // Once RSI becomes non-null it stays non-null, so the buffer fills contiguously.
    const rawStochRSI: (number | null)[] = new Array(rsiValues.length).fill(
        null
    );
    const rsiCircBuf = new Array<number>(stochPeriod).fill(0);
    let rsiCircHead = 0;
    let rsiCircSize = 0;

    for (let i = 0; i < rsiValues.length; i++) {
        const rsi = rsiValues[i];
        if (rsi === null) continue;

        if (rsiCircSize < stochPeriod) {
            rsiCircBuf[(rsiCircHead + rsiCircSize) % stochPeriod] = rsi;
            rsiCircSize++;
        } else {
            rsiCircBuf[rsiCircHead] = rsi;
            rsiCircHead = (rsiCircHead + 1) % stochPeriod;
        }

        if (rsiCircSize < stochPeriod) continue;

        let maxRSI = -Infinity;
        let minRSI = Infinity;
        for (let k = 0; k < stochPeriod; k++) {
            const v = rsiCircBuf[k];
            if (v > maxRSI) maxRSI = v;
            if (v < minRSI) minRSI = v;
        }

        const range = maxRSI - minRSI;
        rawStochRSI[i] = range === 0 ? 0 : (rsi - minRSI) / range;
    }

    // ── Pass 2: %K — running SMA of non-null rawStochRSI values ───────────────
    const kValues: (number | null)[] = new Array(rawStochRSI.length).fill(null);
    let kSum = 0;
    let kBufHead = 0;
    let kBufSize = 0;
    const kBuf = new Array<number>(kSmoothing).fill(0);

    for (let i = 0; i < rawStochRSI.length; i++) {
        const raw = rawStochRSI[i];
        if (raw === null) continue;

        if (kBufSize < kSmoothing) {
            kBuf[(kBufHead + kBufSize) % kSmoothing] = raw;
            kSum += raw;
            kBufSize++;
        } else {
            kSum -= kBuf[kBufHead];
            kBuf[kBufHead] = raw;
            kBufHead = (kBufHead + 1) % kSmoothing;
            kSum += raw;
        }

        if (kBufSize >= kSmoothing) kValues[i] = kSum / kSmoothing;
    }

    // ── Pass 3: %D — running SMA of non-null %K values ────────────────────────
    const dValues: (number | null)[] = new Array(kValues.length).fill(null);
    let dSum = 0;
    let dBufHead = 0;
    let dBufSize = 0;
    const dBuf = new Array<number>(dPeriod).fill(0);

    for (let i = 0; i < kValues.length; i++) {
        const k = kValues[i];
        if (k === null) continue;

        if (dBufSize < dPeriod) {
            dBuf[(dBufHead + dBufSize) % dPeriod] = k;
            dSum += k;
            dBufSize++;
        } else {
            dSum -= dBuf[dBufHead];
            dBuf[dBufHead] = k;
            dBufHead = (dBufHead + 1) % dPeriod;
            dSum += k;
        }

        if (dBufSize >= dPeriod) dValues[i] = dSum / dPeriod;
    }

    return closes.map(
        (_, i): StochRSIResult => ({
            k: kValues[i] ?? null,
            d: dValues[i] ?? null,
        })
    );
}
