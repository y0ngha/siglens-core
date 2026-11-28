import { describe, expect, it } from 'vitest';
import {
    appendStopSentence,
    namesStop,
    rewriteStopInProse,
} from '@/domain/analysis/stopProse';

describe('rewriteStopInProse', () => {
    const usd = (text: string, from = 14.5, to = 14.23) =>
        rewriteStopInProse(text, from, to, 'USD', 'share');
    const krw = (text: string, from = 28000, to = 27400) =>
        rewriteStopInProse(text, from, to, 'KRW', 'share');

    it('replaces the stop figure with comma grouping, keeps the unit and drops the old level label', () => {
        expect(
            krw(
                '손절 기준은 28,000원(라운드)입니다. 진입 영역 하단 29,500원에서 1 ATR(1,549원) 이상 아래에 위치해'
            )
        ).toBe(
            '손절 기준은 27,400원입니다. 진입 영역 하단 29,500원에서 1 ATR(1,549원) 이상 아래에 위치해'
        );
    });

    it('keeps a figure written without commas without commas', () => {
        expect(krw('손절 28000원')).toBe('손절 27400원');
    });

    it('formats a dollar stop at the listing precision and keeps a leading $', () => {
        expect(
            usd(
                '14.50 (라운드 넘버) — 진입 구간 하단 15.18보다 1 ATR(0.855) 이상 아래'
            )
        ).toBe('14.23 — 진입 구간 하단 15.18보다 1 ATR(0.855) 이상 아래');
        expect(usd('손절 $14.5, 목표 $16')).toBe('손절 $14.23, 목표 $16');
        expect(usd('40.63달러(피봇 S1)를 손절 기준으로', 40.63, 37.85)).toBe(
            '37.85달러를 손절 기준으로'
        );
    });

    it('matches a KRW figure that rounds to the tick-rounded stop', () => {
        // 52,550 rounds to 52,600 at the 100-won tick; the stop field holds the rounded value.
        expect(
            rewriteStopInProse('손절 52,550원', 52600, 52300, 'KRW', 'share')
        ).toBe('손절 52,300원');
    });

    it('leaves other figures, percentages, longer numbers and labels with digits alone', () => {
        const text =
            '목표 145.00, 손절 근처 14.5%, 145, 1.45, Pivot S14.5, 14.505, 2014.50';
        expect(usd(text)).toBe(text);
    });

    it('returns the text unchanged when the stop did not move or a value is not finite', () => {
        expect(usd('손절 14.50', 14.5, 14.5)).toBe('손절 14.50');
        expect(usd('손절 14.50', Number.NaN, 14.23)).toBe('손절 14.50');
        expect(usd('손절 14.50', 14.5, Number.POSITIVE_INFINITY)).toBe(
            '손절 14.50'
        );
    });

    it('never rewrites an ATR multiple, a ratio or a percent, even when the stop is a small round number', () => {
        const one = (text: string) =>
            rewriteStopInProse(text, 1, 0.94, 'USD', 'share');
        const two = (text: string) =>
            rewriteStopInProse(text, 2, 1.88, 'USD', 'share');
        expect(one('손절은 1 ATR 아래, 1ATR, 1×ATR 기준')).toBe(
            '손절은 1 ATR 아래, 1ATR, 1×ATR 기준'
        );
        expect(two('거래량 2x, 2배, 2 ×, 2%, 2 %, 2％')).toBe(
            '거래량 2x, 2배, 2 ×, 2%, 2 %, 2％'
        );
        expect(usd('비중 14.5 %, 손절 14.5달러')).toBe(
            '비중 14.5 %, 손절 14.23달러'
        );
        expect(one('손절 $1, 1 ATR 아래')).toBe('손절 $0.9400, 1 ATR 아래');
    });

    it('drops full-width labels and keeps the ja/zh/en unit words', () => {
        expect(krw('損切りは28,000ウォン（ラウンド）です')).toBe(
            '損切りは27,400ウォンです'
        );
        expect(krw('止损 28,000韩元（整数关口），或 28,000韓元')).toBe(
            '止损 27,400韩元，或 27,400韓元'
        );
        expect(usd('Stop at 14.50 dollars (round number).')).toBe(
            'Stop at 14.23 dollars.'
        );
    });

    it('replaces a label whose parentheses hold the stop, but keeps a stop word and a space-separated label', () => {
        expect(krw('손절은 MA20(28,000원) 이탈 시, 또는 S1（28,000원）')).toBe(
            '손절은 27,400원 이탈 시, 또는 27,400원'
        );
        // Only the token before the parenthesis is the label; a word before it stays.
        expect(krw('피봇 S1(28,000원)')).toBe('피봇 27,400원');
        expect(krw('손절(28,000원) 기준')).toBe('손절(27,400원) 기준');
        // A label separated by a space is not recognised: the figure moves, the label stays.
        expect(krw('피봇 S1 28,000원 이탈 시 손절')).toBe(
            '피봇 S1 27,400원 이탈 시 손절'
        );
    });

    it('collapses two alternatives the rewrite made equal, keeping the second and its label', () => {
        expect(
            rewriteStopInProse(
                '손절 기준은 28,000원(라운드) 또는 27,400원(피봇 S3)입니다.',
                28000,
                27400,
                'KRW',
                'share'
            )
        ).toBe('손절 기준은 27,400원(피봇 S3)입니다.');
        expect(usd('stop 14.50 or 14.23 (S3); $14.5 / $14.23')).toBe(
            'stop 14.23 (S3); $14.23 / $14.23'
        );
        // Text the rewrite did not change is not collapsed.
        expect(usd('목표 15.00 또는 15.00')).toBe('목표 15.00 또는 15.00');
    });

    it('keeps a word before the parentheses that is not a level name, changing only the figure', () => {
        expect(krw('지지선 아래(28,000원) 이탈')).toBe(
            '지지선 아래(27,400원) 이탈'
        );
        expect(krw('1 ATR 아래(28,000원)')).toBe('1 ATR 아래(27,400원)');
        expect(krw('종가 기준(28,000원)')).toBe('종가 기준(27,400원)');
        expect(krw('약(28,000원)')).toBe('약(27,400원)');
        expect(usd('stop below(14.50) on close')).toBe(
            'stop below(14.23) on close'
        );
        expect(krw('손절 종가(28,000원)')).toBe('손절 종가(27,400원)');
    });

    it('keeps a trailing qualifier on how the stop is read, drops a level name or a stale distance', () => {
        expect(krw('손절 28,000원(종가 기준)')).toBe(
            '손절 27,400원(종가 기준)'
        );
        expect(usd('Stop below 14.50 (on a daily close basis).')).toBe(
            'Stop below 14.23 (on a daily close basis).'
        );
        expect(krw('손절 28,000원(-3.3%), 28,000원（VAH）')).toBe(
            '손절 27,400원, 27,400원'
        );
        expect(krw('손절 28,000원(예상 손실 감내)')).toBe(
            '손절 27,400원(예상 손실 감내)'
        );
        // Korean level names, and 기준 inside a level name, still drop; 지지 기준 alone stays.
        expect(
            krw(
                '28,000원(원형 숫자), 28,000원(60일 지수이동평균), 28,000원(스윙 저점 기준 AVWAP), 28,000원(지지 기준)'
            )
        ).toBe('27,400원, 27,400원, 27,400원, 27,400원(지지 기준)');
    });

    it('treats ·, = and an opening parenthesis as separators before a level name', () => {
        expect(krw('MA20(28,000원)·MA50(28,000원)')).toBe('27,400원·27,400원');
        expect(krw('손절선=MA20(28,000원)')).toBe('손절선=27,400원');
        expect(krw('손절((MA20(28,000원))')).toBe('손절((27,400원)');
    });

    it('collapses only pairs the rewrite produced: labels on either member, ranges, never unrelated pairs or ratios', () => {
        expect(
            rewriteStopInProse(
                '목표 27,400원 또는 27,400원, 손절 28,000원',
                28000,
                27400,
                'KRW',
                'share'
            )
        ).toBe('목표 27,400원 또는 27,400원, 손절 27,400원');
        expect(usd('R/R 14.50/14.23')).toBe('R/R 14.23/14.23');
        expect(krw('손절 27,400원(S3) 또는 28,000원')).toBe(
            '손절 27,400원(S3)'
        );
        // A stop band the rewrite made equal collapses; an entry-zone edge is never rewritten.
        expect(krw('손절 28,000~27,400원')).toBe('손절 27,400원');
        expect(krw('손절 28,000원 - 27,400원 구간')).toBe('손절 27,400원 구간');
        expect(usd('위험은 14.50~15.04 지지 이탈로')).toBe(
            '위험은 14.23~15.04 지지 이탈로'
        );
        expect(krw('28,000원 - 29,000원 구간 진입 시 손절 28,000원')).toBe(
            '28,000원 - 29,000원 구간 진입 시 손절 27,400원'
        );
        expect(usd('- 51.96~14.50달러 구간 진입 시, - 14.50달러 손절')).toBe(
            '- 51.96~14.50달러 구간 진입 시, - 14.23달러 손절'
        );
        expect(usd('14.50~15.00 진입 시 14.50 아래')).toBe(
            '14.50~15.00 진입 시 14.23 아래'
        );
    });

    it('needs a digit for S, R and P level tokens, so a ratio label is not a level name', () => {
        expect(usd('R/R(14.50) 기준')).toBe('R/R(14.23) 기준');
        expect(usd('R:R(14.50) 기준')).toBe('R:R(14.23) 기준');
        expect(krw('S(28,000원) 이탈')).toBe('S(27,400원) 이탈');
        expect(krw('S1(28,000원), PP(28,000원)')).toBe('27,400원, 27,400원');
    });

    it('skips an entry-zone edge only when an entry word follows or leads the range and no stop word leads the clause', () => {
        expect(krw('손절 28,000~27,400원 진입 시 무효')).toBe(
            '손절 27,400원 진입 시 무효'
        );
        expect(krw('손절 28,000원 - 29,000원 분할 매도')).toBe(
            '손절 27,400원 - 29,000원 분할 매도'
        );
        expect(krw('止损 28,000~27,400韩元 买入')).toBe('止损 27,400韩元 买入');
        expect(krw('진입 27,000~28,000원')).toBe('진입 27,000~28,000원');
        expect(krw('27,000~28,000원 분할 매수')).toBe(
            '27,000~28,000원 분할 매수'
        );
        expect(usd('buy 14.50-15.00, stop 14.50')).toBe(
            'buy 14.50-15.00, stop 14.23'
        );
        // The nearest role keyword before the range decides, not the start of the clause.
        expect(krw('손절 28,000원, 진입 28,000~29,000원')).toBe(
            '손절 27,400원, 진입 28,000~29,000원'
        );
        expect(krw('진입 28,000~29,000원, 손절 28,000원')).toBe(
            '진입 28,000~29,000원, 손절 27,400원'
        );
        // A stop word right after the range is nearer than an entry word earlier in the clause.
        expect(
            usd(
                '- 15.13~15.15 진입 시에도 동일하게 14.50~15.04가 손절 기준입니다.'
            )
        ).toBe(
            '- 15.13~15.15 진입 시에도 동일하게 14.23~15.04가 손절 기준입니다.'
        );
    });

    it('treats full-width separators like ASCII ones and knows the ja/zh level names', () => {
        expect(krw('損切り：MA20（28,000ウォン）')).toBe(
            '損切り：27,400ウォン'
        );
        expect(krw('止损、前低（28,000韩元）')).toBe('止损、27,400韩元');
        expect(krw('損切り，ピボットS1（28,000ウォン）')).toBe(
            '損切り，27,400ウォン'
        );
    });

    it('is idempotent: a second run with the same from and to changes nothing', () => {
        const texts = [
            '손절 기준은 28,000원(라운드) 또는 27,400원(피봇 S3)입니다. MA20(28,000원)',
            '止损 28,000韩元（整数关口）',
        ];
        for (const text of texts) {
            const once = krw(text);
            expect(krw(once)).toBe(once);
        }
        const once = usd('손절 $14.50 (S1), 14.5 or 14.23');
        expect(usd(once)).toBe(once);
    });

    it('replaces every mention and keeps a space that is not before a dropped label', () => {
        expect(usd('손절 14.50 아래, 다시 14.50 (스윙 저점) 이탈 시')).toBe(
            '손절 14.23 아래, 다시 14.23 이탈 시'
        );
    });

    it('원화는 모델 손절이 호가 단위가 아니어도 같은 호가로 반올림되는 본문 숫자를 바꾼다', () => {
        expect(krw('손절 28,050원 이탈 시', 28030)).toBe(
            '손절 27,400원 이탈 시'
        );
        expect(krw('손절 28,030원 이탈 시', 28030)).toBe(
            '손절 27,400원 이탈 시'
        );
    });
});

describe('appendStopSentence', () => {
    const sentence = '손절가는 $126.98입니다.';
    const usd = (text: string, stop = 126.98, line = sentence) =>
        appendStopSentence(text, stop, line, 'USD', 'share');

    it('appends the stop sentence and leaves the prose as written (QA AN-01 NVDA)', () => {
        const nvda =
            '상방 시나리오의 목표는 159.23(단기 POC), 164.27(장기 스윙 저점), 167.82(EMA20) 순이며, 손절 기준은 진입 구간 아래 145.00입니다.';
        expect(usd(nvda)).toBe(`${nvda}\n\n${sentence}`);
    });

    it('leaves an exit that already names the stop unchanged', () => {
        const text = '목표 159.23, 손절 126.98입니다.';
        expect(usd(text)).toBe(text);
    });

    it('matches the stop at its quoted precision and with commas', () => {
        expect(usd('손절 457.65', 457.65104650260713)).toBe('손절 457.65');
        expect(usd('Stop at $1,234.50.', 1234.5)).toBe('Stop at $1,234.50.');
    });

    it('matches a KRW figure at the KRX tick', () => {
        const text = '손절 27,400원 이탈 시 무효입니다.';
        expect(
            appendStopSentence(
                text,
                27412,
                '손절가는 27,400원입니다.',
                'KRW',
                'share'
            )
        ).toBe(text);
        expect(namesStop('손절 27400원', 27412, 'KRW', 'share')).toBe(true);
        expect(namesStop('손절 28,000원', 27412, 'KRW', 'share')).toBe(false);
    });

    it.each([
        ['127', 126.98, true],
        ['127.0', 126.98, true],
        ['0.0825', 0.08253, true],
        ['0.083', 0.08253, true],
        ['126.98', 126.975, true],
        ['130', 126.98, false],
        ['126.9', 126.98, false],
        ['0.08', 0.08253, false],
        ['5', 5.44, false],
        ['5.4', 5.44, true],
    ] as const)('reads %s as the stop %s: %s', (figure, stop, named) => {
        expect(namesStop(`손절 ${figure}`, stop, 'USD', 'share')).toBe(named);
    });

    it('does not read an ATR multiple or a percent as the stop', () => {
        expect(namesStop('1.5 ATR 아래, 1.5% 손실', 1.5, 'USD', 'share')).toBe(
            false
        );
    });

    it.each([
        ['en', 'The stop is set below 145.00.', 'The stop is $126.98.'],
        ['ja', '損切りは145.00の下です。', '損切りは$126.98です。'],
        ['zh', '止损位于145.00下方。', '止损价为$126.98。'],
    ])('appends in %s', (_locale, text, line) => {
        expect(usd(text, 126.98, line)).toBe(`${text}\n\n${line}`);
    });

    it('trims trailing whitespace before the new paragraph and is idempotent', () => {
        const once = usd('손절 145.00\n\n');
        expect(once).toBe(`손절 145.00\n\n${sentence}`);
        expect(usd(once)).toBe(once);
    });

    it('leaves an empty exit empty and ignores an unusable stop', () => {
        expect(usd('')).toBe('');
        expect(usd('손절 145.00', Number.NaN)).toBe('손절 145.00');
    });
});

describe('rewriteStopInProse — Korean particles', () => {
    // The new figure's last spoken syllable decides the particle: 2/4/5/9 (이·사·오·구) have no
    // final consonant, 1/7/8 (일·칠·팔) end in ㄹ, 0/3/6 (영·삼·육) and an integer ending in zeros
    // (십·백·천·만) end in another consonant.
    it.each([
        // no final consonant
        ['손절 100.00이 무너지면', 100.02, '손절 100.02가 무너지면'],
        ['손절 100.00은 유효', 100.04, '손절 100.04는 유효'],
        ['손절 100.00을 지키면', 100.05, '손절 100.05를 지키면'],
        ['손절 100.00과 목표', 100.09, '손절 100.09와 목표'],
        ['손절 100.00으로 둔다', 100.05, '손절 100.05로 둔다'],
        // another final consonant
        ['손절 100.05가 무너지면', 100.1, '손절 100.10이 무너지면'],
        ['손절 100.05는 유효', 100.03, '손절 100.03은 유효'],
        ['손절 100.05를 지키면', 100.06, '손절 100.06을 지키면'],
        ['손절 100.05와 목표', 100.03, '손절 100.03과 목표'],
        ['손절 100.05로 둔다', 100.06, '손절 100.06으로 둔다'],
        ['손절 95가 무너지면', 90, '손절 90이 무너지면'],
        ['손절 28,050원가 무너지면', 28000, '손절 28,000원가 무너지면'],
        ['손절 28050가 무너지면', 28000, '손절 28000이 무너지면'],
        // ㄹ: 이/은/을/과 stay, 으로 becomes 로
        ['손절 100.05가 무너지면', 100.01, '손절 100.01이 무너지면'],
        ['손절 100.05는 유효', 100.07, '손절 100.07은 유효'],
        ['손절 100.05를 지키면', 100.08, '손절 100.08을 지키면'],
        ['손절 100.05와 목표', 100.01, '손절 100.01과 목표'],
        ['손절 100.00으로 둔다', 100.08, '손절 100.08로 둔다'],
        ['손절 100.05로 둔다', 100.07, '손절 100.07로 둔다'],
        // not a particle: a word starting with the same syllable
        ['손절 100.05이후 재진입', 100.1, '손절 100.10이후 재진입'],
        ['손절 100.00가격대 이탈', 100.1, '손절 100.10가격대 이탈'],
        ['손절 100.00로는 부족', 100.1, '손절 100.10로는 부족'],
    ] as const)('%s → %s', (text, to, expected) => {
        const from = Number(
            /[\d,]+(?:\.\d+)?/.exec(text)?.[0].replace(/,/g, '')
        );
        expect(
            rewriteStopInProse(
                text,
                from,
                to,
                text.includes('원') || !text.includes('.') ? 'KRW' : 'USD',
                'share'
            )
        ).toBe(expected);
    });

    it('keeps the particle after a figure with a currency symbol in front', () => {
        expect(
            rewriteStopInProse(
                '손절 $84.04가 무너지면',
                84.04,
                82.71,
                'USD',
                'share'
            )
        ).toBe('손절 $82.71가 무너지면');
    });

    it('fits the particle after a unitless figure to the new figure', () => {
        expect(
            rewriteStopInProse(
                '손절 84.04가 무너지면',
                84.04,
                82.71,
                'USD',
                'share'
            )
        ).toBe('손절 82.71이 무너지면');
        expect(
            rewriteStopInProse(
                '손절 28,000원이 무너지면',
                28000,
                27400,
                'KRW',
                'share'
            )
        ).toBe('손절 27,400원이 무너지면');
    });
});
