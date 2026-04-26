import { describe, it, expect } from 'vitest';
import {
    validateActionPrices,
    extractReconciledActionLines,
} from '@/domain/analysis/actionRecommendation';
import type { ActionRecommendation } from '@/domain/types';

const baseRec: ActionRecommendation = {
    positionAnalysis: '',
    entry: '',
    exit: '',
    riskReward: '',
    entryRecommendation: 'enter',
    entryPrices: [150],
    stopLoss: 145,
    takeProfitPrices: [160, 170],
};

describe('validateActionPrices', () => {
    it('undefined rec이면 undefined를 반환한다', () => {
        expect(validateActionPrices(undefined)).toBeUndefined();
    });

    it('양수인 entryPrices, stopLoss, takeProfitPrices를 반환한다', () => {
        const result = validateActionPrices(baseRec);

        expect(result).toBeDefined();
        expect(result!.entryPrices).toEqual([150]);
        expect(result!.stopLoss).toBe(145);
        expect(result!.takeProfitPrices).toEqual([160, 170]);
    });

    it('price가 0 이하인 entryPrices를 제거한다', () => {
        const rec: ActionRecommendation = {
            ...baseRec,
            entryPrices: [0, -10, 150],
        };

        const result = validateActionPrices(rec);

        expect(result!.entryPrices).toEqual([150]);
    });

    it('stopLoss가 0 이하이면 undefined를 반환한다', () => {
        const rec: ActionRecommendation = { ...baseRec, stopLoss: 0 };

        const result = validateActionPrices(rec);

        expect(result!.stopLoss).toBeUndefined();
    });

    it('price가 0 이하인 takeProfitPrices를 제거한다', () => {
        const rec: ActionRecommendation = {
            ...baseRec,
            takeProfitPrices: [0, -5, 160],
        };

        const result = validateActionPrices(rec);

        expect(result!.takeProfitPrices).toEqual([160]);
    });

    it('모든 레벨이 유효하지 않으면 undefined를 반환한다', () => {
        const rec: ActionRecommendation = {
            ...baseRec,
            entryPrices: [],
            stopLoss: undefined,
            takeProfitPrices: [],
        };

        expect(validateActionPrices(rec)).toBeUndefined();
    });
});

describe('extractReconciledActionLines', () => {
    it('undefined rec이면 undefined를 반환한다', () => {
        expect(extractReconciledActionLines(undefined)).toBeUndefined();
    });

    it('reconciledLevels가 없으면 undefined를 반환한다', () => {
        expect(extractReconciledActionLines(baseRec)).toBeUndefined();
    });

    it('AI값과 동일한 reconciledSl이면 stopLoss를 생략한다', () => {
        const rec: ActionRecommendation = {
            ...baseRec,
            stopLoss: 145,
            reconciledLevels: {
                stopLoss: 145,
                takeProfitPrices: [165],
                exit: '',
                riskReward: '',
                reason: '',
            },
        };

        const result = extractReconciledActionLines(rec);

        // stopLoss는 동일하므로 생략, tpPrices[0]이 다르면 반환
        expect(result?.stopLoss).toBeUndefined();
    });

    it('AI값과 다른 reconciledSl이면 stopLoss를 반환한다', () => {
        const rec: ActionRecommendation = {
            ...baseRec,
            stopLoss: 145,
            reconciledLevels: {
                stopLoss: 143,
                takeProfitPrices: [],
                exit: '',
                riskReward: '',
                reason: '',
            },
        };

        const result = extractReconciledActionLines(rec);

        expect(result?.stopLoss).toBe(143);
    });

    it('AI TP와 다른 reconciledTp를 반환한다', () => {
        const rec: ActionRecommendation = {
            ...baseRec,
            takeProfitPrices: [160],
            reconciledLevels: {
                stopLoss: undefined,
                takeProfitPrices: [162],
                exit: '',
                riskReward: '',
                reason: '',
            },
        };

        const result = extractReconciledActionLines(rec);

        expect(result?.takeProfitPrices).toHaveLength(1);
        expect(result?.takeProfitPrices[0].price).toBe(162);
        expect(result?.takeProfitPrices[0].index).toBe(0);
        expect(result?.takeProfitPrices[0].totalCount).toBe(1);
    });

    it('AI TP와 동일한 reconciledTp는 생략한다', () => {
        const rec: ActionRecommendation = {
            ...baseRec,
            takeProfitPrices: [160],
            reconciledLevels: {
                stopLoss: undefined,
                takeProfitPrices: [160],
                exit: '',
                riskReward: '',
                reason: '',
            },
        };

        const result = extractReconciledActionLines(rec);

        expect(result).toBeUndefined();
    });

    it('reconciledTp가 0 이하이면 생략한다', () => {
        const rec: ActionRecommendation = {
            ...baseRec,
            takeProfitPrices: [160],
            reconciledLevels: {
                stopLoss: undefined,
                takeProfitPrices: [0],
                exit: '',
                riskReward: '',
                reason: '',
            },
        };

        const result = extractReconciledActionLines(rec);

        expect(result).toBeUndefined();
    });
});
