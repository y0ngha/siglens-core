import { describe, expect, it, vi } from 'vitest';
import {
    FIXTURE_QUOTAS,
    classify,
    extractRawText,
    selectCandidates,
    type FixtureClass,
} from '../../../../scripts/fixtures/buildAnalysisExchangeFixtures';
import { evaluateAnalysisExchange } from '../../../../scripts/fixtures/evaluateAnalysisExchange';
import {
    ANALYSIS_EXCHANGE_FIXTURES,
    EXPECTED_EXCHANGES,
} from './loadAnalysisExchanges';

const sse = (...events: unknown[]): string =>
    events
        .map(
            event =>
                `event: ${(event as { type: string }).type}\ndata: ${JSON.stringify(event)}\n`
        )
        .join('\n');

describe('extractRawText', () => {
    it('concatenates the output text deltas in order and ignores every other event', () => {
        const stream = sse(
            { type: 'response.created', response: { id: 'x' } },
            { type: 'response.output_text.delta', delta: '{"a":' },
            { type: 'response.in_progress' },
            { type: 'response.output_text.delta', delta: '1}' },
            { type: 'response.output_text.done', text: '{"a":1}' }
        );
        expect(extractRawText(stream)).toBe('{"a":1}');
    });

    it('skips a data line that is not JSON and a delta that is not a string', () => {
        const stream = `${sse({ type: 'response.output_text.delta', delta: 'ok' })}\ndata: not json\n\ndata: ${JSON.stringify({ type: 'response.output_text.delta', delta: 3 })}`;
        expect(extractRawText(stream)).toBe('ok');
    });

    it('is empty for a stream without deltas', () => {
        expect(extractRawText('event: response.created\n')).toBe('');
    });
});

describe('selectCandidates', () => {
    const classesByCandidate: Record<string, readonly FixtureClass[]> = {
        a: ['clean'],
        b: ['salvage', 'clean'],
        c: ['clean'],
        d: ['reversed_entry'],
        e: ['clean'],
        f: ['clean'],
    };
    const classesOf = (candidate: string): ReadonlySet<FixtureClass> =>
        new Set(classesByCandidate[candidate]);
    const sameTicker = (): string => 'T';

    it('fills classes in quota order, in scan order, never using a candidate twice', () => {
        const chosen = selectCandidates(
            ['a', 'b', 'c', 'd', 'e', 'f'],
            classesOf,
            sameTicker,
            [
                { cls: 'salvage', count: 1 },
                { cls: 'reversed_entry', count: 1 },
                { cls: 'clean', count: 3 },
            ]
        );
        expect(chosen).toEqual([
            { cls: 'salvage', candidate: 'b' },
            { cls: 'reversed_entry', candidate: 'd' },
            { cls: 'clean', candidate: 'a' },
            { cls: 'clean', candidate: 'c' },
            { cls: 'clean', candidate: 'e' },
        ]);
    });

    it('stops evaluating once a class is full', () => {
        const spy = vi.fn(classesOf);
        selectCandidates(['a', 'b', 'c', 'd', 'e', 'f'], spy, sameTicker, [
            { cls: 'clean', count: 1 },
        ]);
        expect(spy).toHaveBeenCalledTimes(1);
    });

    it('evaluates a candidate once even when several classes scan it', () => {
        const spy = vi.fn(classesOf);
        selectCandidates(['a', 'b'], spy, sameTicker, [
            { cls: 'salvage', count: 1 },
            { cls: 'clean', count: 5 },
        ]);
        expect(
            spy.mock.calls.map(([candidate]) => candidate).toSorted()
        ).toEqual(['a', 'b']);
    });

    it('returns fewer than the quota when the data has fewer matches', () => {
        expect(
            selectCandidates(['a', 'd'], classesOf, sameTicker, [
                { cls: 'reversed_entry', count: 3 },
            ])
        ).toEqual([{ cls: 'reversed_entry', candidate: 'd' }]);
    });

    it('spreads a class over tickers before repeating one, then repeats when it must', () => {
        const tickerOf = (candidate: string): string => candidate[0];
        const chosen = selectCandidates(
            ['x1', 'x2', 'y1', 'z1'],
            () => new Set<FixtureClass>(['clean']),
            tickerOf,
            [{ cls: 'clean', count: 4 }]
        );
        expect(chosen.map(pick => pick.candidate)).toEqual([
            'x1',
            'y1',
            'z1',
            'x2',
        ]);
    });

    it('takes twelve exchanges with the documented quotas', () => {
        expect(
            FIXTURE_QUOTAS.reduce((total, quota) => total + quota.count, 0)
        ).toBe(12);
    });
});

describe('classify', () => {
    it.each(ANALYSIS_EXCHANGE_FIXTURES)(
        'puts $id into the class it was chosen for',
        fixture => {
            const classes = classify(evaluateAnalysisExchange(fixture));
            expect(classes.has(EXPECTED_EXCHANGES[fixture.id].class)).toBe(
                true
            );
        }
    );

    const clean = ANALYSIS_EXCHANGE_FIXTURES.find(
        fixture => EXPECTED_EXCHANGES[fixture.id].class === 'clean'
    );
    const cleanEvaluation = evaluateAnalysisExchange(
        clean ?? ANALYSIS_EXCHANGE_FIXTURES[0]
    );

    it('keeps a clean exchange out of every defect class', () => {
        expect([...classify(cleanEvaluation)]).toEqual(['clean']);
    });

    it('is not clean once the reply needed a salvage', () => {
        const classes = classify({
            ...cleanEvaluation,
            needsTrailingContentSalvage: true,
        });
        expect(classes.has('salvage')).toBe(true);
        expect(classes.has('clean')).toBe(false);
    });

    it('is not clean with an ungrounded plan price', () => {
        const classes = classify({
            ...cleanEvaluation,
            provenance: {
                ...cleanEvaluation.provenance,
                plan: [{ field: 'stopLoss', value: 1 }],
            },
        });
        expect(classes.has('ungrounded_plan_price')).toBe(true);
        expect(classes.has('clean')).toBe(false);
    });

    it('is not clean when the post-processed plan still breaks an invariant', () => {
        const classes = classify({
            ...cleanEvaluation,
            invariants: [{ id: 'targets_ascending', detail: '' }],
        });
        expect(classes.has('clean')).toBe(false);
    });

    it('is not clean for an avoid verdict (no plan to judge)', () => {
        const classes = classify({
            ...cleanEvaluation,
            rawRecommendation: cleanEvaluation.rawRecommendation && {
                ...cleanEvaluation.rawRecommendation,
                entryRecommendation: 'avoid',
            },
        });
        expect(classes.has('clean')).toBe(false);
    });

    it('is not clean without a recommendation', () => {
        expect(
            classify({ ...cleanEvaluation, rawRecommendation: undefined }).has(
                'clean'
            )
        ).toBe(false);
    });
});
