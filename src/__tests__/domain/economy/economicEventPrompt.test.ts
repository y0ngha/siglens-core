import { describe, it, expect } from 'vitest';
import { buildEconomicEventAnalysisPrompt as buildEconomicEventAnalysisPromptRaw } from '@/domain/economy/economicEventPrompt';
import type { EconomicEventAnalysisInput } from '@/domain/economy/types';

// `buildEconomicEventAnalysisPrompt` now returns `{ stable, dynamic }` (assembly
// split) — this file's call sites predate the split and assert
// against the single legacy combined string (`stable + '\n\n' + dynamic`,
// exactly the string dispatch still sends as the `prompt` fallback field).
const buildEconomicEventAnalysisPrompt = (
    ...args: Parameters<typeof buildEconomicEventAnalysisPromptRaw>
): string => {
    const { stable, dynamic } = buildEconomicEventAnalysisPromptRaw(...args);
    return `${stable}\n\n${dynamic}`;
};

const BASE_INPUT: EconomicEventAnalysisInput = {
    region: '미국',
    event: 'CPI MoM',
    impact: 'High',
    actual: 0.2,
    estimate: 0.3,
    previous: 0.4,
    unit: '%',
};

/**
 * `Input:` 다음 줄의 `Output:`을 집는다.
 *
 * few-shot 단언은 **Output 줄에 걸어야 한다.** `Input:` 줄에는 구조상
 * `interpretationKo`가 없어서, 거기에 `not.toContain('한국은행')` 같은 걸 걸면
 * 예시 내용과 무관하게 항상 참이 된다.
 */
function fewShotOutputFor(dynamic: string, inputFragment: string): string {
    const lines = dynamic.split('\n');
    const i = lines.findIndex(
        l => l.startsWith('Input: ') && l.includes(inputFragment)
    );
    if (i < 0) throw new Error(`few-shot Input을 찾지 못함: ${inputFragment}`);
    // **바로 다음 줄만** 본다. 앞으로 훑으면 그 예시의 Output이 지워졌을 때
    // 조용히 다음 예시의 Output을 집어, 없애려던 "항상 참" 단언이 되살아난다.
    const output = lines[i + 1];
    if (output?.startsWith('Output: ') !== true) {
        throw new Error(
            `few-shot Output이 Input 바로 뒤에 없음: ${inputFragment}`
        );
    }
    return output;
}

describe('buildEconomicEventAnalysisPrompt', () => {
    it('이벤트 이름을 프롬프트에 포함', () => {
        const p = buildEconomicEventAnalysisPrompt(BASE_INPUT);
        expect(p).toContain('CPI MoM');
    });

    /**
     * 발표치는 **게시된 자릿수 그대로** 들어간다. 2자리 고정 헬퍼를 쓰던 시절
     * 국고채 10년 낙찰금리 `4.415`가 `4.42`로 반올림돼 요약에 실렸다.
     */
    it('actual/estimate/previous 수치를 반올림 없이 포함', () => {
        const p = buildEconomicEventAnalysisPrompt(BASE_INPUT);
        // 보간되는 `Event Details` 줄을 직접 본다 — `0.2`만 보면 옛 헬퍼가 만들던
        // `0.20`에도 걸려 아무것도 검증하지 못한다.
        expect(p).toContain('- Actual: 0.2%');
        expect(p).toContain('- Estimate: 0.3%');
        expect(p).toContain('- Previous: 0.4%');
    });

    it('3자리 소수를 잘라내지 않는다', () => {
        const p = buildEconomicEventAnalysisPrompt({
            ...BASE_INPUT,
            event: '10-Year KTB Auction',
            actual: 4.415,
            previous: 4.21,
        });

        // few-shot에도 `4.415`가 정적으로 들어 있으므로, 보간 줄을 앵커로 삼는다.
        expect(p).toContain('- Actual: 4.415%');
        expect(p).not.toContain('- Actual: 4.42');
    });

    it('unit을 포함', () => {
        const p = buildEconomicEventAnalysisPrompt(BASE_INPUT);
        expect(p).toContain('%');
    });

    it('impact 수준을 포함', () => {
        const p = buildEconomicEventAnalysisPrompt(BASE_INPUT);
        expect(p).toContain('High');
    });

    it('## Data Boundary 섹션 포함', () => {
        const p = buildEconomicEventAnalysisPrompt(BASE_INPUT);
        expect(p).toContain('## Data Boundary');
    });

    it('## Output Schema 섹션 포함', () => {
        const p = buildEconomicEventAnalysisPrompt(BASE_INPUT);
        expect(p).toContain('## Output Schema');
    });

    it('sentiment 허용값 포함(bullish/neutral/bearish)', () => {
        const p = buildEconomicEventAnalysisPrompt(BASE_INPUT);
        expect(p).toContain('"bullish"');
        expect(p).toContain('"neutral"');
        expect(p).toContain('"bearish"');
    });

    it('summaryKo / interpretationKo 스키마 필드 포함', () => {
        const p = buildEconomicEventAnalysisPrompt(BASE_INPUT);
        expect(p).toContain('"summaryKo"');
        expect(p).toContain('"interpretationKo"');
    });

    it('## Allowed Values 섹션 포함', () => {
        const p = buildEconomicEventAnalysisPrompt(BASE_INPUT);
        expect(p).toContain('## Allowed Values');
    });

    it('actual=null 이면 N/A로 표기', () => {
        const p = buildEconomicEventAnalysisPrompt({
            ...BASE_INPUT,
            actual: null,
        });
        expect(p).toContain('Actual: N/A');
    });

    it('estimate=null 이면 N/A로 표기', () => {
        const p = buildEconomicEventAnalysisPrompt({
            ...BASE_INPUT,
            estimate: null,
        });
        expect(p).toContain('Estimate: N/A');
    });

    it('previous=null 이면 N/A로 표기', () => {
        const p = buildEconomicEventAnalysisPrompt({
            ...BASE_INPUT,
            previous: null,
        });
        expect(p).toContain('Previous: N/A');
    });

    it('unit 빈 문자열이어도 throw 없이 문자열 반환', () => {
        const p = buildEconomicEventAnalysisPrompt({ ...BASE_INPUT, unit: '' });
        expect(typeof p).toBe('string');
        expect(p.length).toBeGreaterThan(0);
    });

    it('모든 값이 null이어도 throw 없이 문자열 반환', () => {
        const p = buildEconomicEventAnalysisPrompt({
            region: '미국',
            event: 'Fed Rate Decision',
            impact: 'High',
            actual: null,
            estimate: null,
            previous: null,
            unit: '%',
        });
        expect(typeof p).toBe('string');
        expect(p).toContain('Fed Rate Decision');
    });

    it('Low impact 이벤트도 포함', () => {
        const p = buildEconomicEventAnalysisPrompt({
            ...BASE_INPUT,
            impact: 'Low',
        });
        expect(p).toContain('Low');
    });

    it('JSON only 지시 포함', () => {
        const p = buildEconomicEventAnalysisPrompt(BASE_INPUT);
        expect(p).toContain('valid JSON only');
    });
});

/**
 * 국가가 이름에 없는 발표(`Interest Rate Decision`, `CPI YoY`)는 두 경제권에서
 * 문자열이 완전히 같다. region이 없으면 모델이 사전 지식으로 미국을 가정해
 * 한국은행 결정을 연준 맥락으로 서술하고, 저장이 `analyzed_at IS NULL` 가드라
 * 그 서술을 되돌릴 방법이 없다.
 */
describe('buildEconomicEventAnalysisPrompt — region', () => {
    const KR_INPUT = {
        region: '한국',
        event: 'Interest Rate Decision',
        impact: 'High' as const,
        actual: 2.75,
        estimate: 2.75,
        previous: 2.75,
        unit: '%',
    };

    it('Event Details에 Region 줄을 넣는다', () => {
        const dynamic = buildEconomicEventAnalysisPrompt(KR_INPUT);

        expect(dynamic).toContain('- Region: 한국');
    });

    it('미국을 가정하지 말라는 규칙을 명시한다', () => {
        const dynamic = buildEconomicEventAnalysisPrompt(KR_INPUT);

        expect(dynamic).toContain('This release belongs to 한국');
        expect(dynamic).toContain(
            'never assume the United States, the Federal Reserve, or USD'
        );
    });

    it('few-shot이 두 경제권을 모두 보여 준다', () => {
        const dynamic = buildEconomicEventAnalysisPrompt(KR_INPUT);

        expect(dynamic).toContain('Input: Region=미국');
        expect(dynamic).toContain('Input: Region=한국');
        // 한국 예시는 연준이 아니라 한국은행을 가리켜야 한다.
        expect(dynamic).toContain('한국은행');
    });

    it('region은 프롬프트 안에서 그대로 흐른다', () => {
        const dynamic = buildEconomicEventAnalysisPrompt({
            ...KR_INPUT,
            region: '유로존',
        });

        expect(dynamic).toContain('- Region: 유로존');
        expect(dynamic).toContain('This release belongs to 유로존');
    });

    /**
     * **지역 중립 규칙의 falsifiable 잠금.**
     *
     * sentiment 정의와 `interpretationKo` 규칙이 예전에는 USD를 박아 놨다 —
     * 7줄 위에서 "USD를 가정하지 말라"고 해놓고 아래에서 USD 기준 분류를 요구하는
     * 모순이었다. 그 문구를 되돌려도 Region 줄·규칙·few-shot 단언은 전부 통과하므로,
     * 규칙 본문을 직접 본다.
     */
    it('sentiment·해석 규칙이 region을 쓰고 USD를 박지 않는다', () => {
        const dynamic = buildEconomicEventAnalysisPrompt(KR_INPUT);

        expect(dynamic).toContain('easier policy or stronger demand for 한국');
        expect(dynamic).toContain('tighter policy or weaker demand');
        // 통화 방향만으로 라벨을 정하지 말라는 가드.
        expect(dynamic).toContain(
            'A weaker domestic currency is not automatically bullish'
        );
        expect(dynamic).toContain(
            "한국's risk assets, interest rates, or its own currency"
        );
        // 금지 규칙 문장(위 Region rule)에는 USD가 남아야 하므로 그 한 줄만 제외하고 센다.
        const usdMentions = dynamic
            .split('\n')
            .filter(l => l.includes('USD') && !l.startsWith('Region rule:'));
        expect(usdMentions).toEqual([]);
    });

    /**
     * few-shot 구성과 스키마 placeholder는 **되돌려도 스위트가 초록**이었다.
     * 세 예시가 각각 무엇을 가르치는지 직접 못박는다.
     */
    describe('few-shot 구성', () => {
        it('반전 지표(높을수록 나쁜 지표)의 bearish 예시를 포함한다', () => {
            const dynamic = buildEconomicEventAnalysisPrompt(KR_INPUT);

            // 라벨을 **그 예시 자신의 Output**에 걸어야 한다 — 그냥
            // `toContain('"bearish"')`는 국고채 예시로도 충족된다.
            const output = fewShotOutputFor(dynamic, 'Region=한국, CPI YoY');
            expect(output).toContain('"sentiment": "bearish"');
            expect(output).toContain('예상치');
            // 한국 예시에 미국 기관이 새면 이 브랜치의 목적이 무너진다.
            expect(output).not.toContain('연준');
        });

        it('estimate가 없는 발표 예시를 포함한다', () => {
            const dynamic = buildEconomicEventAnalysisPrompt(KR_INPUT);

            expect(dynamic).toContain(
                '10-Year KTB Auction, actual=4.415%, estimate=N/A'
            );
            // 입찰은 한국은행 발표가 아니므로 **해설(Output)** 이 한국은행을
            // 끌어오면 안 된다. `Input:` 줄에 걸면 거기엔 구조상 해설이 없어
            // 예시 내용과 무관하게 항상 참이 된다.
            const output = fewShotOutputFor(dynamic, '10-Year KTB Auction');
            expect(output).not.toContain('한국은행');
            expect(output).not.toContain('연준');
            expect(output).toContain('장기 금리');
        });

        it('세 예시가 서로 다른 sentiment를 보여 준다', () => {
            const dynamic = buildEconomicEventAnalysisPrompt(KR_INPUT);
            const examples = dynamic
                .split('\n')
                .filter(l => l.startsWith('Output: '));

            expect(examples).toHaveLength(3);
            expect(examples.filter(l => l.includes('"bearish"'))).toHaveLength(
                2
            );
            expect(examples.filter(l => l.includes('"bullish"'))).toHaveLength(
                1
            );
        });
    });

    /**
     * 옛 스키마는 `"sentiment": "neutral"`로 **실제 허용값 하나**를 놔둬서 값싼
     * 모델이 기본값으로 읽었다. 나머지 필드처럼 설명형 placeholder여야 한다.
     */
    it('sentiment placeholder가 특정 값이 아니라 선택지를 보여 준다', () => {
        const dynamic = buildEconomicEventAnalysisPrompt(KR_INPUT);

        expect(dynamic).toContain('"sentiment": "bullish | neutral | bearish"');
        expect(dynamic).not.toContain('"sentiment": "neutral",');
    });

    /** 중앙은행 게이트가 규칙과 few-shot 사이에서 모순되지 않아야 한다. */
    it('중앙은행 명시 규칙이 물가·고용 발표를 포함한다', () => {
        const dynamic = buildEconomicEventAnalysisPrompt(KR_INPUT);

        expect(dynamic).toContain(
            'Name its central bank when the release bears on the policy path'
        );
        expect(dynamic).toContain('an inflation or employment print');
    });
});

describe('buildEconomicEventAnalysisPrompt numeric rendering', () => {
    it('strips binary float noise from released figures', () => {
        const p = buildEconomicEventAnalysisPrompt({
            ...BASE_INPUT,
            actual: 0.30000000000000004,
        });
        expect(p).not.toContain('0.30000000000000004');
        expect(p).toMatch(/- Actual: 0\.3\b/);
    });

    it('renders a non-finite figure as N/A instead of NaN', () => {
        const p = buildEconomicEventAnalysisPrompt({
            ...BASE_INPUT,
            estimate: Number.NaN,
        });
        expect(p).toMatch(/- Estimate: N\/A\n/);
        expect(p).not.toContain('NaN');
    });
});

describe('buildEconomicEventAnalysisPrompt — Actual vs Estimate/Previous', () => {
    it('renders "below" and "lower" when actual missed and decelerated', () => {
        // actual 0.2, estimate 0.3, previous 0.4 (BASE_INPUT)
        const p = buildEconomicEventAnalysisPrompt(BASE_INPUT);
        expect(p).toContain('- Actual vs Estimate: -0.10pp (below)');
        expect(p).toContain('- Actual vs Previous: -0.20pp (lower)');
    });

    it('renders "above" and "higher" when actual beat and accelerated', () => {
        const p = buildEconomicEventAnalysisPrompt({
            ...BASE_INPUT,
            actual: 0.5,
            estimate: 0.3,
            previous: 0.4,
        });
        expect(p).toContain('- Actual vs Estimate: +0.20pp (above)');
        expect(p).toContain('- Actual vs Previous: +0.10pp (higher)');
    });

    it('renders "in line" / "unchanged" within the tolerance band', () => {
        const p = buildEconomicEventAnalysisPrompt({
            ...BASE_INPUT,
            actual: 0.301,
            estimate: 0.3,
            previous: 0.301,
        });
        expect(p).toContain('(in line)');
        expect(p).toContain('(unchanged)');
    });

    it('is N/A when actual is null (release pending)', () => {
        const p = buildEconomicEventAnalysisPrompt({
            ...BASE_INPUT,
            actual: null,
        });
        expect(p).toContain('- Actual vs Estimate: N/A');
        expect(p).toContain('- Actual vs Previous: N/A');
    });

    it('is N/A vs estimate when estimate is null, but still computes vs previous', () => {
        const p = buildEconomicEventAnalysisPrompt({
            ...BASE_INPUT,
            estimate: null,
        });
        expect(p).toContain('- Actual vs Estimate: N/A');
        expect(p).toContain('- Actual vs Previous: -0.20pp (lower)');
    });

    it('is N/A vs previous when previous is null', () => {
        const p = buildEconomicEventAnalysisPrompt({
            ...BASE_INPUT,
            previous: null,
        });
        expect(p).toContain('- Actual vs Previous: N/A');
    });

    it('is N/A when actual is NaN', () => {
        const p = buildEconomicEventAnalysisPrompt({
            ...BASE_INPUT,
            actual: Number.NaN,
        });
        expect(p).toContain('- Actual vs Estimate: N/A');
        expect(p).toContain('- Actual vs Previous: N/A');
    });

    it('the Key signal line points at the precomputed fields instead of asking the model to compare', () => {
        const p = buildEconomicEventAnalysisPrompt(BASE_INPUT);
        expect(p).toContain('already computed');
        expect(p).toContain('never recompute the deviation yourself');
    });

    it('never renders -0.00pp for a delta that rounds to exactly zero', () => {
        const p = buildEconomicEventAnalysisPrompt({
            ...BASE_INPUT,
            actual: 0.3001,
            estimate: 0.3,
            previous: 0.3001,
        });
        expect(p).not.toContain('-0.00pp');
        expect(p).toContain('+0.00pp');
    });

    it('a non-percent unit renders the delta as "value unit" (with space), never pp', () => {
        const p = buildEconomicEventAnalysisPrompt({
            ...BASE_INPUT,
            event: 'Nonfarm Payrolls',
            actual: 150,
            estimate: 180,
            previous: 200,
            unit: 'K',
        });
        expect(p).toContain('- Actual vs Estimate: -30.00 K (below)');
        expect(p).toContain('- Actual vs Previous: -50.00 K (lower)');
        expect(p).not.toMatch(/-30\.00pp|-50\.00pp/);
    });

    it('a percent unit attaches to Actual/Estimate/Previous with no leading space', () => {
        const p = buildEconomicEventAnalysisPrompt(BASE_INPUT);
        expect(p).toContain('- Actual: 0.2%');
        expect(p).not.toContain('- Actual: 0.2 %');
    });

    it('a non-percent unit attaches to Actual/Estimate/Previous with a leading space', () => {
        const p = buildEconomicEventAnalysisPrompt({
            ...BASE_INPUT,
            actual: 150,
            estimate: 180,
            previous: 200,
            unit: 'K',
        });
        expect(p).toContain('- Actual: 150 K');
    });
});
