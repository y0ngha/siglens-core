import { describe, expect, it } from 'vitest';
import type { AnalysisResponse } from '@/domain/types';
import { roundAnalysisPrices } from '@/domain/analysis/roundAnalysisPrices';

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
});
