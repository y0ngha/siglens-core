/**
 * `claims` mode of the analysis-fields evaluation (WP-18 §8.1, gates C1 and C2): how often
 * the model writes a positive reliability claim on a pattern or candle card, and how often a
 * result calls a level strong. Pure functions over stored results; `analysisFieldsEval.ts`
 * loads the runs.
 *
 * The wording lists are the instrument's own pre-registered regexes (WP-18 §1). A mention is
 * not a measurement of the truth of the claim; the point is that the prompt no longer invites
 * it, so the rate is compared between an after and a before run, paired by case, with a
 * case-clustered bootstrap.
 */
import { bootstrapCi, type Ci } from './analysisFieldsEvalOutput';
import { FIELDS_EVAL_CONSTANTS as C } from './analysisFieldsEvalTypes';
import type { GateResult } from './analysisFieldsEvalTypes';
import { mean } from './stats';
import type { CaseResultFile } from './types';

export const CLAIM_LANGUAGES = ['ko', 'en'] as const;
export type ClaimLanguage = (typeof CLAIM_LANGUAGES)[number];

/**
 * - `reliability`: a positive reliability claim on a pattern or candle card (the card says
 *   the shape is reliable, high-probability, wins often).
 * - `strongNarrow`: a level called strong, firm or heavy (the C2 wording).
 * - `strongBroad`: the same plus key / major, reported beside it.
 */
export const CLAIM_PATTERNS: Record<
    ClaimLanguage,
    {
        /** The pre-registered list as WP-18 section 1 wrote it (raw count). */
        reliabilityRaw: RegExp;
        /** The raw list without its false hits (`상승률` is not a win rate). */
        reliability: RegExp;
        /** A sentence with this is not a positive claim ("not high", "no difference"). */
        negation: RegExp;
        /** A claim after this in a sentence is conditional ("if it breaks out, the odds rise"). */
        conditional: RegExp;
        strongNarrow: RegExp;
        strongBroad: RegExp;
    }
> = {
    ko: {
        reliabilityRaw: /신뢰도가 높|높은 신뢰|확률이 높|신뢰할 만|승률|적중률/,
        reliability:
            /신뢰도가 높|높은 신뢰|확률이 높|신뢰할 만|(?<!상)승률|적중률/,
        negation: /높지 않|높지는 않|낮|차이가 없|없습니다|아닙니다|어렵/,
        conditional: /면[\s,]/,
        strongNarrow: /(강한|강력한|견고한|두터운) (지지|저항)/,
        strongBroad: /(강한|강력한|견고한|두터운|핵심|중요한) (지지|저항)/,
    },
    en: {
        reliabilityRaw:
            /high(?:ly)? (?:confidence|reliab)|reliable|high(?:er)? probability|likely to|win rate|hit rate|success rate/i,
        reliability:
            /high(?:ly)? (?:confidence|reliab)|reliable|high(?:er)? probability|likely to|win rate|hit rate|success rate/i,
        negation: /\b(not|no|never|low|unlikely|neither)\b/i,
        conditional: /\b(if|when|once|unless)\b/i,
        strongNarrow:
            /\b(strong|firm|solid|heavy|thick|robust) (support|resistance)/i,
        strongBroad:
            /\b(strong|firm|solid|heavy|thick|robust|key|major|critical) (support|resistance)/i,
    },
};

export interface ClaimCase {
    caseId: string;
    /** Pattern and candle cards the result carries. */
    cards: number;
    /** Cards whose summary makes a positive reliability claim (no negation, not conditional). */
    reliabilityClaims: number;
    /** Cards the pre-registered raw list matches, negated or conditional ones included. */
    reliabilityRaw: number;
    strongNarrow: boolean;
    strongBroad: boolean;
}

type Rec = Record<string, unknown>;

const asRec = (value: unknown): Rec | null =>
    typeof value === 'object' && value !== null && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value))
        : null;

const asArray = (value: unknown): readonly unknown[] =>
    Array.isArray(value) ? value : [];

const asText = (value: unknown): string =>
    typeof value === 'string' ? value : '';

/** The text of every level's reason (support, resistance, POC). */
function levelReasons(keyLevels: Rec | null): readonly string[] {
    return [
        ...asArray(keyLevels?.support),
        ...asArray(keyLevels?.resistance),
        keyLevels?.poc,
    ].map(level => asText(asRec(level)?.reason));
}

/** Sentences of a card: split at full stops, question and exclamation marks and line breaks. */
const sentencesOf = (text: string): readonly string[] =>
    text.split(/(?<=[.!?。])\s*|\n+/).filter(part => part.trim() !== '');

/**
 * A positive reliability claim: a sentence the list matches, without a negation and with no
 * condition ahead of the match in the same sentence.
 */
export function isPositiveClaim(
    text: string,
    language: ClaimLanguage
): boolean {
    const { reliability, negation, conditional } = CLAIM_PATTERNS[language];
    return sentencesOf(text).some(sentence => {
        const hit = reliability.exec(sentence);
        return (
            hit !== null &&
            !negation.test(sentence) &&
            !conditional.test(sentence.slice(0, hit.index))
        );
    });
}

/**
 * Reads one stored result; `null` for a failed call (no result). Cards are the detected
 * entries of `patternSummaries` and `candlePatterns`; the strong-level wording is looked for
 * in the summary and in the level reasons.
 */
export function readClaimCase(
    result: CaseResultFile,
    language: ClaimLanguage
): ClaimCase | null {
    const body = asRec(result.unfilteredResult);
    if (body === null) return null;
    const patterns = CLAIM_PATTERNS[language];
    // A card of a pattern the engine did not detect says so ("no double top is visible"): only
    // detected patterns and candles are claims about a shape on the chart.
    const cards = [
        ...asArray(body.patternSummaries),
        ...asArray(body.candlePatterns),
    ].flatMap(card => {
        const rec = asRec(card);
        return rec?.detected === true ? [asText(rec.summary)] : [];
    });
    const prose = [
        asText(body.summary),
        ...levelReasons(asRec(body.keyLevels)),
    ];
    return {
        caseId: result.caseId,
        cards: cards.length,
        reliabilityClaims: cards.filter(text => isPositiveClaim(text, language))
            .length,
        reliabilityRaw: cards.filter(text => patterns.reliabilityRaw.test(text))
            .length,
        strongNarrow: prose.some(text => patterns.strongNarrow.test(text)),
        strongBroad: prose.some(text => patterns.strongBroad.test(text)),
    };
}

// ─── Comparison ───────────────────────────────────────────────────────────────

export interface ClaimRate {
    count: number;
    n: number;
    share: number | null;
}

const rate = (count: number, n: number): ClaimRate => ({
    count,
    n,
    share: n === 0 ? null : count / n,
});

export interface ClaimsComparison {
    /** Cases paired (a result in both runs); a failed call is not paired. */
    paired: number;
    /** Cases of the after run that have no counterpart with a result. */
    unpaired: number;
    /** C1: claims per pattern and candle card, pooled over the paired cases. */
    reliability: {
        before: ClaimRate;
        after: ClaimRate;
        repeat: ClaimRate | null;
        /** `after − before`, case-clustered bootstrap. */
        diff: Ci;
        /** The pre-registered raw list's counts beside the positive-only ones, reported, not gating. */
        raw: { before: ClaimRate; after: ClaimRate };
    };
    /** C2: share of results calling a level strong, narrow wording. */
    strongNarrow: {
        before: ClaimRate;
        after: ClaimRate;
        repeat: ClaimRate | null;
        diff: Ci;
    };
    /** The broad wording (key, major), reported, not gating. */
    strongBroad: { before: ClaimRate; after: ClaimRate; diff: Ci };
}

const poolRate = (
    cases: readonly ClaimCase[],
    count: (c: ClaimCase) => number,
    total: (c: ClaimCase) => number
): ClaimRate =>
    rate(
        cases.reduce((s, c) => s + count(c), 0),
        cases.reduce((s, c) => s + total(c), 0)
    );

/** Pooled `Σ count / Σ cards` over the cases at `indices`; `null` without a card. */
const pooled = (
    cases: readonly ClaimCase[],
    indices: readonly number[]
): number | null => {
    const claims = indices.reduce((s, i) => s + cases[i].reliabilityClaims, 0);
    const cards = indices.reduce((s, i) => s + cases[i].cards, 0);
    return cards === 0 ? null : claims / cards;
};

/**
 * Pairs the runs by case and measures C1 and C2. `repeat` (a second run of the before arm)
 * only gives the noise beside the difference; it never decides a gate.
 */
export function compareClaims(input: {
    after: readonly ClaimCase[];
    before: readonly ClaimCase[];
    repeat: readonly ClaimCase[] | null;
}): ClaimsComparison {
    const beforeBy = new Map(input.before.map(c => [c.caseId, c]));
    const pairs = input.after.flatMap(a => {
        const b = beforeBy.get(a.caseId);
        return b === undefined ? [] : [{ a, b }];
    });
    const afterCases = pairs.map(p => p.a);
    const beforeCases = pairs.map(p => p.b);
    const indices = pairs.map((_, i) => i);
    const repeatBy =
        input.repeat === null
            ? null
            : new Map(input.repeat.map(c => [c.caseId, c]));
    const repeatCases =
        repeatBy === null
            ? null
            : pairs.flatMap(p => {
                  const r = repeatBy.get(p.a.caseId);
                  return r === undefined ? [] : [r];
              });
    const reliabilityDiff = bootstrapCi(indices, picked => {
        const [a, b] = [
            pooled(afterCases, picked),
            pooled(beforeCases, picked),
        ];
        return a === null || b === null ? null : a - b;
    });
    const flagDiff = (flag: (c: ClaimCase) => boolean): Ci =>
        bootstrapCi(
            pairs.map(p => (flag(p.a) ? 1 : 0) - (flag(p.b) ? 1 : 0)),
            mean
        );
    const flagRate = (
        cases: readonly ClaimCase[],
        flag: (c: ClaimCase) => boolean
    ): ClaimRate => rate(cases.filter(flag).length, cases.length);
    const narrow = (c: ClaimCase): boolean => c.strongNarrow;
    const broad = (c: ClaimCase): boolean => c.strongBroad;
    return {
        paired: pairs.length,
        unpaired: input.after.length - pairs.length,
        reliability: {
            before: poolRate(
                beforeCases,
                c => c.reliabilityClaims,
                c => c.cards
            ),
            after: poolRate(
                afterCases,
                c => c.reliabilityClaims,
                c => c.cards
            ),
            repeat:
                repeatCases === null
                    ? null
                    : poolRate(
                          repeatCases,
                          c => c.reliabilityClaims,
                          c => c.cards
                      ),
            diff: reliabilityDiff,
            raw: {
                before: poolRate(
                    beforeCases,
                    c => c.reliabilityRaw,
                    c => c.cards
                ),
                after: poolRate(
                    afterCases,
                    c => c.reliabilityRaw,
                    c => c.cards
                ),
            },
        },
        strongNarrow: {
            before: flagRate(beforeCases, narrow),
            after: flagRate(afterCases, narrow),
            repeat: repeatCases === null ? null : flagRate(repeatCases, narrow),
            diff: flagDiff(narrow),
        },
        strongBroad: {
            before: flagRate(beforeCases, broad),
            after: flagRate(afterCases, broad),
            diff: flagDiff(broad),
        },
    };
}

// ─── Gates ────────────────────────────────────────────────────────────────────

const pct = (v: number | null): string =>
    v === null ? 'n/a' : `${(v * 100).toFixed(2)}%`;
const pp = (v: number | null): string =>
    v === null ? 'n/a' : `${(v * 100).toFixed(2)} pp`;

/**
 * C1 and C2: the claim rate must fall, i.e. the upper bound of the 95% interval of
 * `after − before` is below zero. Not computable when fewer than `minPairedShare` of the
 * after run's cases are paired, or when the interval is.
 */
export function claimsGates(
    c: ClaimsComparison,
    /** Every case of the after run, a failed call included: the population the gate must cover. */
    afterCases: number
): readonly GateResult[] {
    const covered =
        afterCases > 0 &&
        c.paired >= Math.ceil(C.gates.minPairedShare * afterCases - 1e-9);
    const upperBelowZero = (diff: Ci): boolean | null =>
        !covered || diff.high === null ? null : diff.high < 0;
    const describe = (before: ClaimRate, after: ClaimRate, diff: Ci): string =>
        `${pct(before.share)} -> ${pct(after.share)} (${before.count}/${before.n} -> ${after.count}/${after.n}), diff ${pp(diff.point)} (95% ${pp(diff.low)} to ${pp(diff.high)})${covered ? '' : `; only ${c.paired} of ${afterCases} cases paired`}`;
    return [
        {
            id: 'C1',
            description:
                'positive reliability claims per pattern and candle card, after minus before',
            pass: upperBelowZero(c.reliability.diff),
            value: describe(
                c.reliability.before,
                c.reliability.after,
                c.reliability.diff
            ),
            threshold: '95% upper bound < 0 (case-clustered)',
        },
        {
            id: 'C2',
            description:
                'results calling a level strong, firm or heavy, after minus before',
            pass: upperBelowZero(c.strongNarrow.diff),
            value: describe(
                c.strongNarrow.before,
                c.strongNarrow.after,
                c.strongNarrow.diff
            ),
            threshold: '95% upper bound < 0 (case-clustered)',
        },
    ];
}
