import { describe, expect, it } from 'vitest';
import type { AnalysisResponse } from '@/domain/types';
import { roundAnalysisPrices } from '@/domain/analysis/roundAnalysisPrices';
import { postProcessAnalysisWithReconcile } from '@/domain/analysis/ai-levels';
import { krxTickSize } from '@/domain/analysis/krxTick';

const response = (): AnalysisResponse => ({
    summary: '요약',
    trend: 'bearish',
    indicatorResults: [],
    riskLevel: 'medium',
    keyLevels: {
        support: [{ price: 205_325, reason: '카마릴라 S3' }],
        resistance: [{ price: 224_565, reason: '켈트너 하단' }],
        poc: { price: 56_663, reason: 'POC' },
    },
    priceTargets: {
        bullish: {
            targets: [{ price: 240_300, basis: '매수 유동성' }],
            condition: '회복',
        },
        bearish: null,
    },
    patternSummaries: [
        {
            id: 'p1',
            patternName: 'double_top',
            skillName: 'double-top',
            detected: true,
            trend: 'bearish',
            summary: '',
            keyPrices: [{ label: '측정 목표가', price: 202_437.5 }],
        } as AnalysisResponse['patternSummaries'][number],
    ],
    strategyResults: [],
    candlePatterns: [],
    trendlines: [
        {
            direction: 'descending',
            start: { time: 1, price: 363_000 },
            end: { time: 2, price: 271_192.31 },
        } as AnalysisResponse['trendlines'][number],
    ],
    actionRecommendation: {
        positionAnalysis: '',
        entry: '',
        exit: '',
        riskReward: '',
        entryPrices: [210_000, 215_120],
        stopLoss: 204_480,
        takeProfitPrices: [224_565, 230_000],
        reconciledLevels: {
            stopLoss: 204_480,
            takeProfitPrices: [224_565],
            exit: '',
            riskReward: '',
            reason: '',
        },
    },
});

describe('roundAnalysisPrices', () => {
    it('rounds every quoted price of a KRW analysis to its KRX tick', () => {
        const out = roundAnalysisPrices(response(), 'KRW');
        expect(out.keyLevels).toEqual({
            support: [{ price: 205_500, reason: '카마릴라 S3' }],
            resistance: [{ price: 224_500, reason: '켈트너 하단' }],
            poc: { price: 56_700, reason: 'POC' },
        });
        expect(out.priceTargets.bullish?.targets[0].price).toBe(240_500);
        expect(out.priceTargets.bearish).toBeNull();
        expect(out.patternSummaries[0].keyPrices).toEqual([
            { label: '측정 목표가', price: 202_500 },
        ]);
        expect(out.actionRecommendation).toMatchObject({
            entryPrices: [210_000, 215_000],
            stopLoss: 204_500,
            takeProfitPrices: [224_500, 230_000],
            reconciledLevels: {
                stopLoss: 204_500,
                takeProfitPrices: [224_500],
            },
        });
    });

    it('rounds on the ETF/ETN table when asked, and on the share table by default', () => {
        const etp = roundAnalysisPrices(response(), 'KRW', 'etp');
        // ≥ 2,000 won an ETP ticks 5: 205,325 → 205,325; 224,565 → 224,565;
        // 56,663 → 56,665; the share grid would give 205,500 / 224,500 / 56,700.
        expect(etp.keyLevels).toEqual({
            support: [{ price: 205_325, reason: '카마릴라 S3' }],
            resistance: [{ price: 224_565, reason: '켈트너 하단' }],
            poc: { price: 56_665, reason: 'POC' },
        });
        expect(etp.priceTargets.bullish?.targets[0].price).toBe(240_300);
        expect(etp.patternSummaries[0].keyPrices).toEqual([
            { label: '측정 목표가', price: 202_440 },
        ]);
        expect(etp.actionRecommendation).toMatchObject({
            entryPrices: [210_000, 215_120],
            stopLoss: 204_480,
            reconciledLevels: { stopLoss: 204_480 },
        });
        expect(roundAnalysisPrices(response(), 'KRW', 'share')).toEqual(
            roundAnalysisPrices(response(), 'KRW')
        );
    });

    it('ignores the table for a non-KRW listing (same reference)', () => {
        const usd = response();
        expect(roundAnalysisPrices(usd, 'USD', 'etp')).toBe(usd);
    });

    it('leaves drawing coordinates exact', () => {
        const out = roundAnalysisPrices(response(), 'KRW');
        expect(out.trendlines).toEqual(response().trendlines);
    });

    it('is idempotent, and a no-op (same reference) for any other currency', () => {
        const once = roundAnalysisPrices(response(), 'KRW');
        expect(roundAnalysisPrices(once, 'KRW')).toEqual(once);
        const usd = response();
        expect(roundAnalysisPrices(usd, 'USD')).toBe(usd);
        expect(roundAnalysisPrices(usd)).toBe(usd);
    });

    it('keeps absent optional fields absent', () => {
        const bare = {
            ...response(),
            keyLevels: { support: [], resistance: [] },
            actionRecommendation: undefined,
        };
        const out = roundAnalysisPrices(bare, 'KRW');
        expect('poc' in out.keyLevels).toBe(false);
        expect(out.actionRecommendation).toBeUndefined();
    });

    it('a stop the tick rounding lands on the entry is reconciled to a fallback below it, at its own tick', () => {
        // 1,999.8 rounds to 2,000 (1-won band) and 2,000.2 to 2,000 (5-won
        // band): the stop meets the entry, so post-processing treats it as
        // invalid and derives an ATR fallback — itself a KRX tick under the entry.
        const rounded = roundAnalysisPrices(
            {
                ...response(),
                actionRecommendation: {
                    ...response().actionRecommendation!,
                    entryPrices: [2_000.2],
                    stopLoss: 1_999.8,
                    takeProfitPrices: [2_180],
                    reconciledLevels: undefined,
                },
            },
            'KRW'
        );
        expect(rounded.actionRecommendation).toMatchObject({
            entryPrices: [2_000],
            stopLoss: 2_000,
        });
        const out = postProcessAnalysisWithReconcile(rounded, 2_000, 30, 'KRW');
        const stop = out.actionRecommendation?.reconciledLevels?.stopLoss;
        expect(stop).toBeDefined();
        expect(stop!).toBeLessThan(2_000);
        expect(stop! % krxTickSize(stop!)).toBe(0);
    });
});
