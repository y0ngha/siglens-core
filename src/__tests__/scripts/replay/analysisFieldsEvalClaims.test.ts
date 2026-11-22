import { describe, expect, it } from 'vitest';
import {
    CLAIM_PATTERNS,
    claimsGates,
    isPositiveClaim,
    sentencesOf,
    compareClaims,
    readClaimCase,
    type ClaimCase,
} from '../../../../scripts/replay/analysisFieldsEvalClaims';
import type { CaseResultFile } from '../../../../scripts/replay/types';

const resultOf = (
    body: unknown,
    caseId = 'AAA|2024-01-02'
): CaseResultFile => ({
    caseId,
    symbol: 'AAA',
    asOf: '2024-01-02',
    repeat: 1,
    unfilteredResult: body,
    promptVersion: 'p34',
    promptHashes: null,
    promptDynamic: null,
    usage: null,
    exchangeCount: 1,
    latencyMs: 1,
    error: body === null ? 'failed' : null,
});

describe('the wording lists', () => {
    it('finds a positive reliability claim in Korean and not a neutral statistic', () => {
        const { reliability } = CLAIM_PATTERNS.ko;
        [
            '두 저점의 차이가 작아 신뢰도가 높은 편입니다',
            '높은 신뢰를 줍니다',
            '확률이 높습니다',
            '신뢰할 만한 모양입니다',
            '승률이 좋습니다',
            '적중률이 높습니다',
        ].forEach(text => expect(reliability.test(text)).toBe(true));
        expect(reliability.test('통계적으로 거의 무작위에 가깝습니다')).toBe(
            false
        );
    });

    it('counts only positive claims: not 상승률, not a negation, not a condition', () => {
        const positive = (text: string) => isPositiveClaim(text, 'ko');
        expect(positive('신뢰도가 높은 편입니다')).toBe(true);
        expect(
            positive('두 저점이 가까워 신뢰도가 높습니다. 거래량도 늘었습니다')
        ).toBe(true);
        expect(positive('상승률이 큽니다')).toBe(false);
        expect(positive('신뢰도가 높지 않습니다')).toBe(false);
        expect(positive('확률이 낮습니다')).toBe(false);
        expect(positive('승률 차이가 없습니다')).toBe(false);
        expect(positive('저항을 돌파하면 확률이 높아집니다')).toBe(false);
        // The condition is in another sentence: the claim stands.
        expect(positive('저항을 돌파하면 유효합니다. 신뢰도가 높습니다')).toBe(
            true
        );
        expect(isPositiveClaim('This is highly reliable', 'en')).toBe(true);
        expect(isPositiveClaim('This is not reliable', 'en')).toBe(false);
        expect(isPositiveClaim('If it breaks out it is reliable', 'en')).toBe(
            false
        );
    });

    it('keeps a positive claim when a negative word sits in another clause', () => {
        const positive = (text: string) => isPositiveClaim(text, 'ko');
        // 낮, 어렵, 없습니다 about something else, before or after the claim.
        expect(positive('거래량이 낮지만 신뢰도가 높습니다')).toBe(true);
        expect(positive('변동성이 낮고 신뢰도가 높습니다')).toBe(true);
        expect(positive('신뢰도가 높지만 진입 시점을 잡기 어렵습니다')).toBe(
            true
        );
        expect(positive('신뢰도가 높고, 반대 신호는 없습니다')).toBe(true);
        expect(positive('신뢰도가 높아 보이며 위험은 낮은 편입니다')).toBe(
            true
        );
        // The claim itself negated.
        expect(positive('신뢰도가 높다고 보기 어렵습니다')).toBe(false);
        expect(positive('신뢰도가 높지는 않습니다')).toBe(false);
        expect(positive('승률이 낮습니다')).toBe(false);
        expect(positive('적중률은 낮은 편입니다')).toBe(false);
        expect(positive('승률 차이는 없습니다')).toBe(false);
        expect(positive('신뢰도가 높다는 근거가 없습니다')).toBe(false);
    });

    it('splits sentences at a stop followed by whitespace, not inside a number or an abbreviation', () => {
        expect(sentencesOf('돌파하면 유효합니다. 신뢰도가 높습니다')).toEqual([
            '돌파하면 유효합니다.',
            '신뢰도가 높습니다',
        ]);
        expect(
            sentencesOf('수익률 3.5% 구간에서 신뢰도가 높습니다')
        ).toHaveLength(1);
        expect(sentencesOf('e.g. 이중바닥 신뢰도가 높습니다')).toHaveLength(1);
        expect(sentencesOf('1. 신뢰도가 높습니다')).toHaveLength(1);
        expect(sentencesOf('첫째\n둘째')).toEqual(['첫째', '둘째']);
        // A condition in the same sentence as a "3.5%" stays ahead of the claim.
        expect(isPositiveClaim('3.5% 넘으면 확률이 높아집니다', 'ko')).toBe(
            false
        );
    });

    it('separates the narrow strong-level wording from the broad one', () => {
        const { strongNarrow, strongBroad } = CLAIM_PATTERNS.ko;
        expect(strongNarrow.test('강한 지지가 겹칩니다')).toBe(true);
        expect(strongNarrow.test('견고한 저항')).toBe(true);
        expect(strongNarrow.test('핵심 지지 구간')).toBe(false);
        expect(strongBroad.test('핵심 지지 구간')).toBe(true);
        expect(strongNarrow.test('지지가 강한')).toBe(false);
    });

    it('has English equivalents for an English run', () => {
        const { reliability, strongNarrow, strongBroad } = CLAIM_PATTERNS.en;
        expect(reliability.test('This is a highly reliable setup')).toBe(true);
        expect(reliability.test('the hit rate is high')).toBe(true);
        expect(reliability.test('near random by itself')).toBe(false);
        expect(strongNarrow.test('Strong support at 100')).toBe(true);
        expect(strongNarrow.test('key support at 100')).toBe(false);
        expect(strongBroad.test('key support at 100')).toBe(true);
    });
});

describe('readClaimCase', () => {
    it('counts pattern and candle cards, their claims and the strong-level wording', () => {
        const claim = readClaimCase(
            resultOf({
                summary: '지지선이 있습니다',
                patternSummaries: [
                    { detected: true, summary: '신뢰도가 높은 편입니다' },
                    { detected: true, summary: '모양이 보입니다' },
                    {
                        detected: false,
                        summary: '신뢰도가 높은 모양은 없습니다',
                    },
                ],
                candlePatterns: [
                    { detected: true, summary: '승률이 높습니다' },
                ],
                keyLevels: {
                    support: [{ price: 1, reason: '강한 지지 구간' }],
                    resistance: [{ price: 2, reason: '핵심 저항' }],
                },
            }),
            'ko'
        );
        expect(claim).toMatchObject({
            cards: 3,
            reliabilityClaims: 2,
            reliabilityRaw: 2,
            strongNarrow: true,
            strongBroad: true,
        });
    });

    it('leaves out the cards of patterns that were not detected', () => {
        expect(
            readClaimCase(
                resultOf({
                    patternSummaries: [
                        { detected: false, summary: '승률이 높습니다' },
                    ],
                    candlePatterns: [{ summary: '승률이 높습니다' }],
                }),
                'ko'
            )
        ).toMatchObject({ cards: 0, reliabilityClaims: 0 });
    });

    it('reads the point of control reason and the summary for the strong-level wording', () => {
        expect(
            readClaimCase(
                resultOf({
                    summary: '두터운 지지가 있습니다',
                    keyLevels: { support: [], resistance: [] },
                }),
                'ko'
            )?.strongNarrow
        ).toBe(true);
        expect(
            readClaimCase(
                resultOf({
                    summary: '',
                    keyLevels: {
                        support: [],
                        resistance: [],
                        poc: { price: 1, reason: '핵심 지지' },
                    },
                }),
                'ko'
            )
        ).toMatchObject({ strongNarrow: false, strongBroad: true });
    });

    it('keeps the raw count beside the positive-only one', () => {
        const claim = readClaimCase(
            resultOf({
                patternSummaries: [
                    { detected: true, summary: '신뢰도가 높지 않습니다' },
                    { detected: true, summary: '상승률이 큽니다' },
                    { detected: true, summary: '신뢰도가 높습니다' },
                ],
            }),
            'ko'
        );
        expect(claim).toMatchObject({
            reliabilityRaw: 3,
            reliabilityClaims: 1,
        });
    });

    it('is null for a failed call and tolerates a body without cards', () => {
        expect(readClaimCase(resultOf(null), 'ko')).toBeNull();
        expect(readClaimCase(resultOf({ summary: 'x' }), 'ko')).toMatchObject({
            cards: 0,
            reliabilityClaims: 0,
            strongNarrow: false,
        });
    });
});

const claimCase = (i: number, over: Partial<ClaimCase> = {}): ClaimCase => ({
    caseId: `C${i}`,
    cards: 2,
    reliabilityClaims: 0,
    reliabilityRaw: 0,
    strongNarrow: false,
    strongBroad: false,
    ...over,
});

const cases = (
    count: number,
    over: (i: number) => Partial<ClaimCase> = () => ({})
): ClaimCase[] =>
    Array.from({ length: count }, (_, i) => claimCase(i, over(i)));

describe('compareClaims and claimsGates', () => {
    it('passes both gates when the claims disappear', () => {
        const before = cases(60, i => ({
            reliabilityClaims: i % 2,
            strongNarrow: i % 3 === 0,
            strongBroad: i % 3 === 0,
        }));
        const after = cases(60);
        const comparison = compareClaims({ after, before, repeat: null });
        expect(comparison.paired).toBe(60);
        expect(comparison.reliability.before.share).toBeCloseTo(30 / 120);
        expect(comparison.reliability.after).toEqual({
            count: 0,
            n: 120,
            share: 0,
        });
        expect(comparison.reliability.diff.high).toBeLessThan(0);
        expect(comparison.strongNarrow.diff.point).toBeCloseTo(-1 / 3);
        const gates = claimsGates(comparison, after.length);
        expect(gates.map(g => [g.id, g.pass])).toEqual([
            ['C1', true],
            ['C2', true],
        ]);
    });

    it('fails when nothing changes (the interval holds zero)', () => {
        const same = cases(60, i => ({
            reliabilityClaims: i % 2,
            strongNarrow: i % 3 === 0,
        }));
        const gates = claimsGates(
            compareClaims({ after: same, before: same, repeat: null }),
            60
        );
        expect(gates.map(g => g.pass)).toEqual([false, false]);
    });

    it('cannot decide a gate when too few cases are paired or the interval is empty', () => {
        const before = cases(60, () => ({ reliabilityClaims: 1 }));
        const after = cases(60).map((c, i) => ({
            ...c,
            caseId: i < 30 ? c.caseId : `X${i}`,
        }));
        const comparison = compareClaims({ after, before, repeat: null });
        expect(comparison.paired).toBe(30);
        expect(comparison.unpaired).toBe(30);
        expect(claimsGates(comparison, 60).map(g => g.pass)).toEqual([
            null,
            null,
        ]);
        const noCards = compareClaims({
            after: cases(10, () => ({ cards: 0 })),
            before: cases(10, () => ({ cards: 0 })),
            repeat: null,
        });
        expect(noCards.reliability.diff.point).toBeNull();
        expect(claimsGates(noCards, 10)[0].pass).toBeNull();
        expect(
            claimsGates(
                compareClaims({ after: [], before: [], repeat: null }),
                0
            )[0].pass
        ).toBeNull();
    });

    it('reports the repeat run beside the before run without letting it decide', () => {
        const before = cases(40, i => ({ reliabilityClaims: i % 2 }));
        const repeat = cases(40, i => ({ reliabilityClaims: (i + 1) % 2 }));
        const comparison = compareClaims({ after: cases(40), before, repeat });
        expect(comparison.reliability.repeat?.count).toBe(20);
        expect(comparison.strongNarrow.repeat?.count).toBe(0);
        expect(
            compareClaims({ after: cases(40), before, repeat: null })
                .reliability.repeat
        ).toBeNull();
    });
});
