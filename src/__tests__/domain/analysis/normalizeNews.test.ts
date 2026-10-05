import { describe, it, expect } from 'vitest';
import {
    normalizeNewsAnalysisResponse,
    normalizeNewsCardAnalysis,
    stripInputMetaLead,
} from '@/domain/analysis/normalizeNews';

const validNewsAnalysis = {
    currentDriverKo: '최근 어닝 서프라이즈가 주가를 견인했습니다.',
    keyEventsKo: ['어닝 서프라이즈', 'CEO 교체'],
    upcomingEventsKo: ['다음 분기 실적 발표'],
    overallSentiment: 'bullish',
};

const validNewsCard = {
    titleKo: '애플, 어닝 서프라이즈 기록',
    bodyKo: '애플은 2분기 실적에서 예상치를 크게 웃도는 성과를 보였습니다.',
    summaryKo: '애플 어닝 서프라이즈',
    sentiment: 'bullish',
    category: 'earnings',
    priceImpact: 'high',
};

describe('normalizeNewsAnalysisResponse 함수는', () => {
    describe('완전하고 유효한 JSON이 주어졌을 때', () => {
        it('모든 필드를 올바르게 파싱하여 반환한다', () => {
            const result = normalizeNewsAnalysisResponse(
                JSON.stringify(validNewsAnalysis)
            );

            expect(result.currentDriverKo).toBe(
                '최근 어닝 서프라이즈가 주가를 견인했습니다.'
            );
            expect(result.overallSentiment).toBe('bullish');
            expect(result.keyEventsKo).toEqual(['어닝 서프라이즈', 'CEO 교체']);
            expect(result.upcomingEventsKo).toEqual(['다음 분기 실적 발표']);
        });
    });

    describe('마크다운 펜스로 감싸진 JSON이 주어졌을 때', () => {
        it('```json ... ``` 펜스를 제거하고 올바르게 파싱한다', () => {
            const fenced = `\`\`\`json\n${JSON.stringify(validNewsAnalysis)}\n\`\`\``;
            const result = normalizeNewsAnalysisResponse(fenced);
            expect(result.overallSentiment).toBe('bullish');
            expect(result.currentDriverKo).toBe(
                '최근 어닝 서프라이즈가 주가를 견인했습니다.'
            );
        });

        it('``` ... ``` 펜스(타입 없음)를 제거하고 올바르게 파싱한다', () => {
            const fenced = `\`\`\`\n${JSON.stringify(validNewsAnalysis)}\n\`\`\``;
            const result = normalizeNewsAnalysisResponse(fenced);
            expect(result.overallSentiment).toBe('bullish');
        });
    });

    describe('필드가 누락된 JSON이 주어졌을 때', () => {
        it('누락 필드를 기본값으로 채운다', () => {
            const result = normalizeNewsAnalysisResponse('{}');

            expect(result).toEqual({
                currentDriverKo: '',
                keyEventsKo: [],
                upcomingEventsKo: [],
                overallSentiment: 'neutral',
            });
        });

        it('문자열 배열의 잘못된 자식 값은 제거한다', () => {
            const result = normalizeNewsAnalysisResponse(
                JSON.stringify({
                    keyEventsKo: ['실적 발표', null, 1, ''],
                    upcomingEventsKo: ['FOMC', {}, ''],
                })
            );

            expect(result.keyEventsKo).toEqual(['실적 발표']);
            expect(result.upcomingEventsKo).toEqual(['FOMC']);
        });
    });

    describe('잘못된 enum 값이 주어졌을 때', () => {
        it('overallSentiment가 유효하지 않으면 neutral로 정규화한다', () => {
            const invalid = {
                ...validNewsAnalysis,
                overallSentiment: 'positive',
            };
            expect(
                normalizeNewsAnalysisResponse(JSON.stringify(invalid))
            ).toMatchObject({ overallSentiment: 'neutral' });
        });
    });

    describe('유효하지 않은 JSON 문자열이 주어졌을 때', () => {
        it('파싱 불가능한 문자열이면 에러를 던진다', () => {
            expect(() =>
                normalizeNewsAnalysisResponse('not valid json')
            ).toThrow();
        });
    });

    describe('객체가 아닌 값이 직접 주어졌을 때', () => {
        it('배열을 전달하면 빈 객체로 취급해 모든 기본값을 채운다', () => {
            // 배열은 typeof "object"라 JSON 파싱은 건너뛰지만 asObject가 거부 →
            // `?? {}` fallback 경로를 탄다.
            const result = normalizeNewsAnalysisResponse([1, 2, 3]);
            expect(result).toEqual({
                currentDriverKo: '',
                keyEventsKo: [],
                upcomingEventsKo: [],
                overallSentiment: 'neutral',
            });
        });
    });
});

describe('normalizeNewsCardAnalysis 함수는', () => {
    describe('완전하고 유효한 JSON이 주어졌을 때', () => {
        it('모든 필드를 올바르게 파싱하여 반환한다', () => {
            const result = normalizeNewsCardAnalysis(
                JSON.stringify(validNewsCard)
            );

            expect(result.titleKo).toBe('애플, 어닝 서프라이즈 기록');
            expect(result.bodyKo).toBe(
                '애플은 2분기 실적에서 예상치를 크게 웃도는 성과를 보였습니다.'
            );
            expect(result.summaryKo).toBe('애플 어닝 서프라이즈');
            expect(result.sentiment).toBe('bullish');
            expect(result.category).toBe('earnings');
            expect(result.priceImpact).toBe('high');
        });

        it('bodyKo가 null인 경우도 허용한다', () => {
            const withNullBody = { ...validNewsCard, bodyKo: null };
            const result = normalizeNewsCardAnalysis(
                JSON.stringify(withNullBody)
            );
            expect(result.bodyKo).toBeNull();
        });
    });

    describe('마크다운 펜스로 감싸진 JSON이 주어졌을 때', () => {
        it('```json ... ``` 펜스를 제거하고 올바르게 파싱한다', () => {
            const fenced = `\`\`\`json\n${JSON.stringify(validNewsCard)}\n\`\`\``;
            const result = normalizeNewsCardAnalysis(fenced);
            expect(result.sentiment).toBe('bullish');
            expect(result.category).toBe('earnings');
        });
    });

    describe('필드가 누락된 JSON이 주어졌을 때', () => {
        it('누락 필드를 기본값으로 채운다', () => {
            const result = normalizeNewsCardAnalysis('{}');

            expect(result).toEqual({
                titleKo: '',
                bodyKo: null,
                summaryKo: '',
                sentiment: 'neutral',
                category: 'other',
                priceImpact: 'negligible',
            });
        });

        it('bodyKo가 문자열이나 null이 아니면 null로 정규화한다', () => {
            const result = normalizeNewsCardAnalysis(
                JSON.stringify({ bodyKo: { text: '본문' } })
            );

            expect(result.bodyKo).toBeNull();
        });
    });

    describe('잘못된 enum 값이 주어졌을 때', () => {
        it('sentiment가 유효하지 않으면 neutral로 정규화한다', () => {
            const invalid = { ...validNewsCard, sentiment: 'positive' };
            const result = normalizeNewsCardAnalysis(JSON.stringify(invalid));
            expect(result.sentiment).toBe('neutral');
        });

        it('category가 유효하지 않으면 other로 정규화한다', () => {
            const invalid = { ...validNewsCard, category: 'sports' };
            const result = normalizeNewsCardAnalysis(JSON.stringify(invalid));
            expect(result.category).toBe('other');
        });

        it('priceImpact가 유효하지 않으면 negligible로 정규화한다', () => {
            const invalid = { ...validNewsCard, priceImpact: 'critical' };
            const result = normalizeNewsCardAnalysis(JSON.stringify(invalid));
            expect(result.priceImpact).toBe('negligible');
        });
    });

    describe('유효하지 않은 JSON 문자열이 주어졌을 때', () => {
        it('파싱 불가능한 문자열이면 에러를 던진다', () => {
            expect(() => normalizeNewsCardAnalysis('not valid json')).toThrow();
        });
    });

    describe('객체가 아닌 값이 직접 주어졌을 때', () => {
        it('배열을 전달하면 빈 객체로 취급해 모든 기본값을 채운다', () => {
            const result = normalizeNewsCardAnalysis([1, 2, 3]);
            expect(result).toEqual({
                titleKo: '',
                bodyKo: null,
                summaryKo: '',
                sentiment: 'neutral',
                category: 'other',
                priceImpact: 'negligible',
            });
        });
    });
});

describe('stripInputMetaLead 함수는 (UX audit 2026-10-05 §C2)', () => {
    it('문장 첫머리의 "제공된 N건의 "를 걷어 낸다', () => {
        expect(
            stripInputMetaLead(
                '제공된 25건의 뉴스는 금리 인하 기대를 다룹니다.'
            )
        ).toBe('뉴스는 금리 인하 기대를 다룹니다.');
    });

    it('"제공된 ", "주어진 ", "입력된 " 첫머리를 걷어 낸다', () => {
        expect(stripInputMetaLead('제공된 기사들은 실적을 다룹니다.')).toBe(
            '기사들은 실적을 다룹니다.'
        );
        expect(stripInputMetaLead('주어진 기사 흐름은 둔화입니다.')).toBe(
            '기사 흐름은 둔화입니다.'
        );
        expect(stripInputMetaLead('입력된 3건의 기사가 같은 방향입니다.')).toBe(
            '기사가 같은 방향입니다.'
        );
    });

    it('영어 "The provided articles"는 걷어 내고 다음 글자를 대문자로 만든다', () => {
        expect(
            stripInputMetaLead('The provided articles point to a softer tape.')
        ).toBe('Articles point to a softer tape.');
        expect(
            stripInputMetaLead('The provided 12 articles agree on direction.')
        ).toBe('Articles agree on direction.');
    });

    it('입력 명사가 아닌 단어 앞의 한정어는 실제 내용이라 건드리지 않는다', () => {
        expect(stripInputMetaLead('제공된 가이던스는 상향되었습니다.')).toBe(
            '제공된 가이던스는 상향되었습니다.'
        );
        expect(stripInputMetaLead('주어진 환경에서 수요가 둔화됩니다.')).toBe(
            '주어진 환경에서 수요가 둔화됩니다.'
        );
        expect(stripInputMetaLead('The provided guidance was raised.')).toBe(
            'The provided guidance was raised.'
        );
    });

    it('입력 명사로 시작하는 더 긴 낱말 앞의 한정어도 건드리지 않는다', () => {
        expect(stripInputMetaLead('제공된 정보기술 업종이 강합니다.')).toBe(
            '제공된 정보기술 업종이 강합니다.'
        );
        expect(stripInputMetaLead('제공된 데이터센터 투자가 늘었습니다.')).toBe(
            '제공된 데이터센터 투자가 늘었습니다.'
        );
        expect(stripInputMetaLead('제공된 뉴스레터는 짧습니다.')).toBe(
            '제공된 뉴스레터는 짧습니다.'
        );
    });

    it('입력 명사 앞에 짧은 수식어가 끼어도 한정어와 건수만 걷어 낸다 (암호화폐 다이제스트)', () => {
        expect(
            stripInputMetaLead(
                '제공된 암호화폐 카테고리 뉴스는 ETF 유입을 다룹니다.'
            )
        ).toBe('암호화폐 카테고리 뉴스는 ETF 유입을 다룹니다.');
        expect(
            stripInputMetaLead(
                '제공된 25건의 암호화폐 뉴스는 비트코인 강세를 가리킵니다.'
            )
        ).toBe('암호화폐 뉴스는 비트코인 강세를 가리킵니다.');
        expect(
            stripInputMetaLead('주어진 증시 관련 기사들은 실적을 다룹니다.')
        ).toBe('증시 관련 기사들은 실적을 다룹니다.');
    });

    it('조사로 끝나는 주어(수식어가 아닌 실제 내용) 뒤에 입력 명사가 와도 걷어 내지 않는다', () => {
        // 명사 뒤 경계는 통과하므로(`뉴스에`, `뉴스는`) 조사 제외 규칙만이 이를 막는다.
        const guidance = '제공된 가이던스는 뉴스에 이미 반영됐습니다.';
        expect(stripInputMetaLead(guidance)).toBe(guidance);
        const env = '주어진 환경에서 뉴스는 중요하지 않습니다.';
        expect(stripInputMetaLead(env)).toBe(env);
    });

    it('조사 없는 수식어가 셋 이상이면 걷어 내지 않는다 (수식어 상한 2개)', () => {
        const three = '제공된 매우 긴 여러 뉴스는 같습니다.';
        expect(stripInputMetaLead(three)).toBe(three);
        const four = '제공된 매우 긴 여러 수식어 뉴스는 같습니다.';
        expect(stripInputMetaLead(four)).toBe(four);
        // 두 개까지는 걷어 낸다.
        expect(stripInputMetaLead('제공된 매우 긴 뉴스는 같습니다.')).toBe(
            '매우 긴 뉴스는 같습니다.'
        );
    });

    it('수식어가 문장부호를 건너면 걷어 내지 않는다', () => {
        const period = '제공된 변화 없음. 뉴스는 다릅니다.';
        expect(stripInputMetaLead(period)).toBe(period);
        const comma = '제공된 변화 없음, 뉴스는 다릅니다.';
        expect(stripInputMetaLead(comma)).toBe(comma);
    });

    it('자료·정보·본문·데이터·뉴스·기사 앞의 한정어를 모두 걷어 낸다', () => {
        for (const noun of ['자료', '정보', '본문', '데이터', '뉴스', '기사']) {
            expect(
                stripInputMetaLead(`제공된 ${noun}는 같은 방향입니다.`)
            ).toBe(`${noun}는 같은 방향입니다.`);
        }
        expect(stripInputMetaLead('The provided headlines lean bearish.')).toBe(
            'Headlines lean bearish.'
        );
    });

    it('문장 중간의 같은 표현은 건드리지 않는다', () => {
        const mid = '시장은 제공된 25건의 뉴스보다 금리에 더 반응했습니다.';
        expect(stripInputMetaLead(mid)).toBe(mid);
        const en = 'Traders ignored the provided articles and watched yields.';
        expect(stripInputMetaLead(en)).toBe(en);
    });

    it('일반 문장·빈 문자열은 그대로 돌려준다', () => {
        expect(stripInputMetaLead('엔비디아가 신제품을 공개했습니다.')).toBe(
            '엔비디아가 신제품을 공개했습니다.'
        );
        expect(stripInputMetaLead('')).toBe('');
    });

    it('걷어 내면 아무것도 남지 않는 경우에는 원문을 유지한다', () => {
        expect(stripInputMetaLead('제공된 ')).toBe('제공된 ');
    });
});

describe('입력 설명 문구 제거가 정규화에 적용될 때', () => {
    it('normalizeNewsAnalysisResponse는 currentDriverKo와 keyEventsKo 각 항목 첫머리를 걷어 낸다', () => {
        const result = normalizeNewsAnalysisResponse({
            ...validNewsAnalysis,
            currentDriverKo:
                '제공된 25건의 뉴스는 반도체 업황 개선을 가리킵니다.',
            keyEventsKo: [
                '제공된 기사 중 실적 발표가 가장 큽니다.',
                '금리 동결',
            ],
            upcomingEventsKo: ['제공된 일정 없음'],
        });
        expect(result.currentDriverKo).toBe(
            '뉴스는 반도체 업황 개선을 가리킵니다.'
        );
        expect(result.keyEventsKo).toEqual([
            '기사 중 실적 발표가 가장 큽니다.',
            '금리 동결',
        ]);
        // upcomingEventsKo는 대상이 아니다.
        expect(result.upcomingEventsKo).toEqual(['제공된 일정 없음']);
    });

    it('normalizeNewsCardAnalysis는 summaryKo 첫머리를 걷어 내되 titleKo·bodyKo는 건드리지 않는다', () => {
        const result = normalizeNewsCardAnalysis({
            ...validNewsCard,
            titleKo: '제공된 자료 요약',
            bodyKo: '제공된 본문 그대로',
            summaryKo: '제공된 기사는 실적 상향을 알립니다.',
        });
        expect(result.summaryKo).toBe('기사는 실적 상향을 알립니다.');
        expect(result.titleKo).toBe('제공된 자료 요약');
        expect(result.bodyKo).toBe('제공된 본문 그대로');
    });
});
