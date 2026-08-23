import { describe, it, expect } from 'vitest';
import {
    computeOverallScore,
    OVERALL_AXIS_WEIGHTS,
    type OverallAxis,
    type OverallScoreInput,
} from '@/domain/analysis/overallScore';
import type {
    AnalysisResponse,
    FinancialsScorecard,
    FundamentalAnalysisResponse,
    NewsAnalysisResponse,
    OptionsAnalysisResponse,
    OptionsTone,
    Timeframe,
    Trend,
} from '@/domain/types';

const TIMEFRAMES: Timeframe[] = [
    '5Min',
    '15Min',
    '30Min',
    '1Hour',
    '4Hour',
    '1Day',
];

function technical(trend: Trend): AnalysisResponse {
    return { trend } as AnalysisResponse;
}

function fundamental(overallSentiment: Trend): FundamentalAnalysisResponse {
    return { overallSentiment } as FundamentalAnalysisResponse;
}

function news(overallSentiment: Trend): NewsAnalysisResponse {
    return { overallSentiment } as NewsAnalysisResponse;
}

function options(tones: OptionsTone[]): OptionsAnalysisResponse {
    return {
        summary: '',
        perExpiration: tones.map((tone, i) => ({
            expirationDate: `2026-0${i + 1}-01`,
            commentary: '',
            tone,
        })),
        signals: [],
        analyzedAt: '2026-08-23T00:00:00.000Z',
    };
}

function financials(score: number): FinancialsScorecard {
    return {
        composite: { score, grade: 'B', summaryKo: '' },
    } as FinancialsScorecard;
}

function scoreOf(
    result: ReturnType<typeof computeOverallScore>,
    axis: OverallAxis
) {
    return result.axes.find(a => a.axis === axis);
}

describe('OVERALL_AXIS_WEIGHTS', () => {
    it('shifts emphasis from price action to valuation as the timeframe lengthens', () => {
        // 프롬프트가 산문으로 이미 주장하던 것의 수치 형태다. 순서가 깨지면 산문과
        // 숫자가 서로 다른 말을 하게 된다.
        const technicalWeights = TIMEFRAMES.map(
            tf => OVERALL_AXIS_WEIGHTS[tf].technical
        );
        const fundamentalWeights = TIMEFRAMES.map(
            tf => OVERALL_AXIS_WEIGHTS[tf].fundamental
        );

        // 인자 없는 toSorted()는 문자열 정렬이라 [14,13,...,8]을 통과시키지 못한다.
        const desc = (a: number, b: number) => b - a;
        const asc = (a: number, b: number) => a - b;
        expect(technicalWeights).toEqual([...technicalWeights].toSorted(desc));
        expect(fundamentalWeights).toEqual(
            [...fundamentalWeights].toSorted(asc)
        );
        expect(OVERALL_AXIS_WEIGHTS['5Min'].technical).toBeGreaterThan(
            OVERALL_AXIS_WEIGHTS['5Min'].fundamental
        );
        expect(OVERALL_AXIS_WEIGHTS['1Day'].fundamental).toBeGreaterThanOrEqual(
            OVERALL_AXIS_WEIGHTS['1Day'].technical
        );
    });

    it('gives every axis a positive weight on every timeframe', () => {
        // 가중치 0은 "축이 죽었다"는 뜻이고, 그건 이 테이블이 아니라 기권 경로가
        // 표현해야 한다. 상수로 0을 박으면 데이터가 있는데도 투표하지 못한다.
        for (const tf of TIMEFRAMES) {
            for (const [axis, weight] of Object.entries(
                OVERALL_AXIS_WEIGHTS[tf]
            )) {
                expect(weight, `${tf}.${axis}`).toBeGreaterThan(0);
            }
        }
    });
});

describe('computeOverallScore', () => {
    it('maps a three-value axis to 25/50/75, not 0/50/100', () => {
        // 3값 enum은 방향이지 크기가 아니다. 0/100이면 축 하나가 종합을 50점 끌고 간다.
        const bull = computeOverallScore(
            { technical: technical('bullish') },
            '1Day'
        );
        const flat = computeOverallScore(
            { technical: technical('neutral') },
            '1Day'
        );
        const bear = computeOverallScore(
            { technical: technical('bearish') },
            '1Day'
        );

        expect(scoreOf(bull, 'technical')?.score).toBe(75);
        expect(scoreOf(flat, 'technical')?.score).toBe(50);
        expect(scoreOf(bear, 'technical')?.score).toBe(25);
    });

    it('weights the reporting axes and rounds to one decimal', () => {
        const result = computeOverallScore(
            { technical: technical('bullish'), news: news('bearish') },
            '1Day'
        );
        // (75×8 + 25×6) / 14
        expect(result.composite).toBeCloseTo(53.6, 1);
    });

    it('drops an absent axis from the denominator instead of voting neutral', () => {
        // 암호화폐에 펀더멘털이 없는 것은 데이터 부재이지 중립 의견이 아니다.
        const withOnlyTechnical = computeOverallScore(
            { technical: technical('bullish') },
            '1Day'
        );

        expect(withOnlyTechnical.composite).toBe(75);
        expect(scoreOf(withOnlyTechnical, 'fundamental')).toMatchObject({
            score: null,
            weight: 0,
        });
    });

    it('returns a null composite when every axis abstains', () => {
        const empty = computeOverallScore({}, '1Day');
        expect(empty.composite).toBeNull();
        expect(empty.axes.every(a => a.score === null && a.weight === 0)).toBe(
            true
        );
    });

    it('is timeframe sensitive — the same axes score differently', () => {
        const input: OverallScoreInput = {
            technical: technical('bearish'),
            fundamental: fundamental('bullish'),
        };
        const intraday = computeOverallScore(input, '5Min');
        const daily = computeOverallScore(input, '1Day');

        // 5분봉은 기술적 축이 압도하므로 약세로, 일봉은 펀더멘털이 맞서므로 중립 쪽으로.
        expect(intraday.composite).toBeLessThan(daily.composite as number);
        expect(intraday.composite).toBeLessThan(50);
    });

    describe('options axis', () => {
        it('averages the per-expiration tones', () => {
            const result = computeOverallScore(
                { options: options(['bullish', 'bullish', 'bearish']) },
                '1Day'
            );
            // (1 + 1 − 1) / 3 × 25 + 50
            expect(scoreOf(result, 'options')?.score).toBeCloseTo(58.33, 1);
        });

        it('treats cautious as half a bearish vote, not as neutral', () => {
            // cautious는 방어적 포지셔닝이다. neutral로 접으면 tone union이 구분하려던
            // 정보가 사라진다.
            const cautious = computeOverallScore(
                { options: options(['cautious', 'cautious']) },
                '1Day'
            );
            const neutral = computeOverallScore(
                { options: options(['neutral', 'neutral']) },
                '1Day'
            );

            expect(scoreOf(cautious, 'options')?.score).toBeLessThan(
                scoreOf(neutral, 'options')?.score as number
            );
            expect(scoreOf(cautious, 'options')?.score).toBeGreaterThan(25);
        });

        it('abstains when the analysis carries no expiration tones', () => {
            const result = computeOverallScore(
                { options: options([]) },
                '1Day'
            );
            expect(scoreOf(result, 'options')).toMatchObject({
                score: null,
                weight: 0,
            });
        });

        it('stays inside the directional band even when every tone agrees', () => {
            const result = computeOverallScore(
                { options: options(['bullish', 'bullish']) },
                '1Day'
            );
            expect(scoreOf(result, 'options')?.score).toBe(75);
        });
    });

    describe('financials axis', () => {
        it('passes its own 0–100 composite through unchanged', () => {
            const result = computeOverallScore(
                { financials: financials(82) },
                '1Day'
            );
            expect(scoreOf(result, 'financials')?.score).toBe(82);
        });

        it('clamps an out-of-range score rather than letting it skew the average', () => {
            const high = computeOverallScore(
                { financials: financials(140) },
                '1Day'
            );
            const low = computeOverallScore(
                { financials: financials(-20) },
                '1Day'
            );
            expect(scoreOf(high, 'financials')?.score).toBe(100);
            expect(scoreOf(low, 'financials')?.score).toBe(0);
        });

        it('abstains on a non-finite score instead of producing NaN', () => {
            const result = computeOverallScore(
                { financials: financials(Number.NaN) },
                '1Day'
            );
            expect(scoreOf(result, 'financials')?.score).toBeNull();
            expect(result.composite).toBeNull();
        });
    });

    it('records a basis for every axis so a stored score stays explainable', () => {
        const result = computeOverallScore(
            {
                technical: technical('bullish'),
                news: news('neutral'),
                options: options(['bearish']),
                financials: financials(60),
            },
            '30Min'
        );

        expect(scoreOf(result, 'technical')?.basis).toBe('trend bullish');
        expect(scoreOf(result, 'news')?.basis).toBe('sentiment neutral');
        expect(scoreOf(result, 'options')?.basis).toBe('1 expiration tones');
        expect(scoreOf(result, 'fundamental')?.basis).toBe(
            'no fundamental analysis'
        );
    });
});
