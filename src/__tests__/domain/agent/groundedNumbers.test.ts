import { describe, expect, it } from 'vitest';
import { findUngroundedNumbers } from '@/domain/agent/groundedNumbers';

describe('findUngroundedNumbers', () => {
    it('툴 결과에 그대로 있는 숫자는 근거 있음으로 본다', () => {
        const answer = '현재가는 187.20달러입니다.';
        const results = ['{"price":187.20,"change":1.5}'];
        expect(findUngroundedNumbers(answer, results)).toEqual([]);
    });

    it('표시 소수 자릿수로 반올림한 값이 일치하면 근거 있음으로 본다', () => {
        const answer = 'AAPL은 $187.20 근처입니다.';
        const results = ['{"price":187.1953}'];
        expect(findUngroundedNumbers(answer, results)).toEqual([]);
    });

    it('₩ 원화 인접 표기와 쉼표 구분자를 정규화해 비교한다', () => {
        const answer = '목표가는 ₩71,000 입니다.';
        const results = ['{"targetPrice":71000}'];
        expect(findUngroundedNumbers(answer, results)).toEqual([]);
    });

    it('퍼센트 토큰도 값만 일치하면 근거 있음으로 본다', () => {
        const answer = '성장률은 3.5%로 전망됩니다.';
        const results = ['{"growthRate":3.5}'];
        expect(findUngroundedNumbers(answer, results)).toEqual([]);
    });

    it('툴 결과 어디에도 없는 숫자는 근거 없음으로 보고한다', () => {
        const answer = '현재가는 $999.99입니다.';
        const results = ['{"price":187.20}'];
        expect(findUngroundedNumbers(answer, results)).toEqual(['999.99']);
    });

    it('3자리 미만 정수와 4자리 연도는 무의미한 숫자로 무시한다', () => {
        const answer = '3개의 패턴이 2026년에 감지되었습니다.';
        expect(findUngroundedNumbers(answer, [])).toEqual([]);
    });

    it('연도가 아닌 4자리 정수는 근거 확인 대상이다', () => {
        const answer = '거래량은 1234주였습니다.';
        expect(findUngroundedNumbers(answer, [])).toEqual(['1234']);
        expect(findUngroundedNumbers(answer, ['{"volume":1234}'])).toEqual([]);
    });

    it('ISO 날짜 조각은 연도 범위를 벗어나도 무시한다', () => {
        const answer = '기준일은 2231-05-01 입니다.';
        expect(findUngroundedNumbers(answer, [])).toEqual([]);
    });

    it('시:분 형태의 숫자는 자릿수와 무관하게 무시한다', () => {
        const answer = '경과 시간은 100:30 이었습니다.';
        expect(findUngroundedNumbers(answer, [])).toEqual([]);
    });

    it('목록 번호는 무시하지만 본문의 같은 숫자는 그대로 검사한다', () => {
        const answer = '125) 이번 분기 매출은 125달러 증가했습니다.';
        expect(findUngroundedNumbers(answer, [])).toEqual(['125']);
    });

    it('중복 등장한 근거 없는 숫자는 최초 등장 순서로 한 번만 반환한다', () => {
        const answer = '$500이 두 번, $500 나옵니다. 그리고 $700도 있습니다.';
        expect(findUngroundedNumbers(answer, [])).toEqual(['500', '700']);
    });

    it('파생 계산값(합/차)은 알려진 한계로 근거 없음으로 보고될 수 있다', () => {
        const answer = '두 값의 차이는 12.34입니다.';
        const results = ['{"a":50.00,"b":37.66}'];
        expect(findUngroundedNumbers(answer, results)).toEqual(['12.34']);
    });

    it('"-" 범위 구분자는 단항 부호로 오인하지 않는다 (5-10%)', () => {
        const answer = '예상 변동폭은 5-10% 입니다.';
        expect(findUngroundedNumbers(answer, ['{"low":5,"high":10}'])).toEqual(
            []
        );
        // 10%만 없으면 10만 근거 없음으로 보고되고 -10%로 합쳐지지 않는다.
        expect(findUngroundedNumbers(answer, ['{"low":5}'])).not.toContain(
            '-10%'
        );
    });

    it('"~" 범위 구분자도 두 숫자로 분리한다 (5~10%)', () => {
        const answer = '예상 변동폭은 5~10% 입니다.';
        expect(findUngroundedNumbers(answer, ['{"low":5,"high":10}'])).toEqual(
            []
        );
    });

    it('진짜 음수는 부호를 유지해 검사한다', () => {
        const answer = '전일 대비 -5.2% 하락했습니다.';
        expect(findUngroundedNumbers(answer, ['{"change":-5.2}'])).toEqual([]);
        expect(findUngroundedNumbers(answer, ['{"change":5.2}'])).toEqual([
            '-5.2%',
        ]);
    });

    it('가짜 음수(범위 구분자에서 나온)가 실제 음수 툴 값에 잘못 근거되지 않는다', () => {
        const answer = '거래 범위는 3-5 사이입니다.';
        // 툴에 -5가 있어도 "3-5"의 "5"는 양수이므로 근거되면 안 된다.
        expect(findUngroundedNumbers(answer, ['{"delta":-5}'])).toEqual([]);
        // 5는 <3자리라 애초에 무시 대상 — 좀 더 큰 값으로 재검증.
        const answer2 = '거래 범위는 300-500 사이입니다.';
        expect(findUngroundedNumbers(answer2, ['{"delta":-500}'])).toEqual([
            '300',
            '500',
        ]);
    });

    it('과학적 표기법(JSON 숫자)은 하나의 값으로 파싱된다', () => {
        const answer = '오차율은 0.00001234 수준입니다.';
        const results = ['{"epsilon":1.234e-5}'];
        expect(findUngroundedNumbers(answer, results)).toEqual([]);
    });

    it('과학적 표기법(JSON 문자열 안)도 하나의 값으로 파싱된다', () => {
        const answer = '성장률은 3400입니다.';
        const results = ['{"note":"grew by 3.4E+3 percent"}'];
        expect(findUngroundedNumbers(answer, results)).toEqual([]);
    });

    it('과학적 표기법(비-JSON 텍스트 폴백)도 1.234와 -5로 쪼개지지 않는다', () => {
        const answer = '오차율은 0.00001234 수준입니다.';
        const results = ['epsilon value: 1.234e-5 measured this cycle'];
        expect(findUngroundedNumbers(answer, results)).toEqual([]);
    });

    it('JSON 배열의 콤마가 숫자 그룹핑으로 오인되지 않는다', () => {
        const answer = '값은 2와 3입니다.';
        // 과거 정규식 방식이면 "[1,2,3]"이 "1,2,3"(=123)으로 합쳐 잘못 파싱될 수 있었다.
        const results = ['{"values":[1,2,3]}'];
        expect(findUngroundedNumbers(answer, results)).toEqual([]);
        expect(findUngroundedNumbers('값은 123입니다.', results)).toEqual([
            '123',
        ]);
    });

    it('단일 한국 단위(억/조/만)는 실수 값으로 환산해 근거를 확인한다', () => {
        const answer = '시가총액은 1.2억원입니다.';
        expect(
            findUngroundedNumbers(answer, ['{"marketCap":120000000}'])
        ).toEqual([]);
        // 반올림 허용: 1.2억의 1자리 소수 정밀도로 반올림해 일치.
        expect(
            findUngroundedNumbers(answer, ['{"marketCap":119800000}'])
        ).toEqual([]);
        expect(
            findUngroundedNumbers(answer, ['{"marketCap":300000000}'])
        ).toEqual(['1.2억']);

        const jo = '예상 매출은 3조 5천억원입니다.';
        // "3조"는 3e12로 근거되고, "5"(천억의 앞자리)는 자릿수 미만이라 무시된다 —
        // 복합 단위는 변환하지 않고 건드리지 않는 알려진 한계.
        expect(findUngroundedNumbers(jo, ['{"revenue":3e12}'])).toEqual([]);
    });
    it('JSON 파싱 시 Infinity가 되는 값(1e400)은 근거 집합에 넣지 않고, 나머지 값은 그대로 근거로 쓴다', () => {
        const results = ['{"huge":1e400,"price":187.25}'];
        expect(
            findUngroundedNumbers('가격은 187.25달러입니다.', results)
        ).toEqual([]);
        expect(
            findUngroundedNumbers('가격은 999.5달러입니다.', results)
        ).toEqual(['999.5']);
    });

    it('JSON의 null 리프는 건너뛰고 형제 값은 JSON 경로로 계속 수집한다', () => {
        const results = [
            '{"price":null,"nested":{"close":null,"open":71200},"values":[1,2,3]}',
        ];
        expect(
            findUngroundedNumbers('시가는 71,200원입니다.', results)
        ).toEqual([]);
        // null에서 던지고 정규식 폴백으로 떨어지면 "[1,2,3]"이 123으로 합쳐져
        // 근거로 잡힌다 — JSON 경로가 유지되어야 123은 근거 없음이다.
        expect(findUngroundedNumbers('값은 123입니다.', results)).toEqual([
            '123',
        ]);
    });

    it('숫자가 답변 문자열의 맨 끝에 와도(다음 문자 없음) 정상 판정한다', () => {
        expect(
            findUngroundedNumbers('종가 71200', ['{"close":71200}'])
        ).toEqual([]);
        expect(
            findUngroundedNumbers('종가 71300', ['{"close":71200}'])
        ).toEqual(['71300']);
    });

    it('지수/벤치마크 이름에 붙은 숫자는 이름의 일부로 보아 근거 확인 대상에서 뺀다', () => {
        expect(
            findUngroundedNumbers('S&P 500: 7,656.98 (+0.86%)', [
                '{"price":7656.98,"changesPercentage":0.86}',
            ])
        ).toEqual([]);
        expect(
            findUngroundedNumbers('나스닥100 지수가 상승했습니다.', [])
        ).toEqual([]);
        expect(
            findUngroundedNumbers('코스피 지수는 2,650입니다.', [
                '{"price":2650}',
            ])
        ).toEqual([]);
    });

    it('지수 이름이 아닌 일반 숫자는 여전히 근거 확인 대상이다', () => {
        expect(findUngroundedNumbers('총 500명이 참여했습니다.', [])).toEqual([
            '500',
        ]);
    });

    it('이동평균/기간 라벨(200일선, MA200, EMA50, 50-day)은 값 주장이 아니므로 무시한다', () => {
        expect(
            findUngroundedNumbers('200일선을 상향 돌파했습니다.', [])
        ).toEqual([]);
        // MA200/EMA50은 숫자가 문자 "A" 바로 뒤에 붙어 있어 NUMBER_RE 자체가
        // 애초에 매치하지 않는다 — 별도 패턴 없이도 이미 무시 대상이다.
        expect(
            findUngroundedNumbers('MA200을 지지선으로 삼고 있습니다.', [])
        ).toEqual([]);
        expect(
            findUngroundedNumbers('EMA50 아래에서 거래되고 있습니다.', [])
        ).toEqual([]);
        expect(
            findUngroundedNumbers('50-day 이동평균선을 회복했습니다.', [])
        ).toEqual([]);
        expect(
            findUngroundedNumbers('200일 이동평균선 위에 있습니다.', [])
        ).toEqual([]);
    });

    it('진짜 날짜 기준 주장("300일 기준 종가")은 기간 라벨과 달리 그대로 검사한다', () => {
        expect(
            findUngroundedNumbers('300일 기준 종가는 187달러입니다.', [])
        ).toEqual(['300', '187']);
    });

    it('소수점이 있는 기간 라벨("12.5-day")도 소수부까지 통째로 무시한다', () => {
        expect(
            findUngroundedNumbers('12.5-day 이동평균을 회복했습니다.', [])
        ).toEqual([]);
    });

    it('퍼센트 토큰은 툴이 비율(소수)로 반환해도 ×100 환산으로 근거를 확인한다', () => {
        const answer = '영업이익률 33.17%, 순이익률 27.62%, ROE 137.18%';
        const results = [
            '{"operatingMargin":0.3317,"netMargin":0.2762,"roe":1.3718}',
        ];
        expect(findUngroundedNumbers(answer, results)).toEqual([]);
    });

    it('퍼센트 ×100 환산은 대응하는 비율이 없으면 여전히 근거 없음으로 남긴다', () => {
        const answer = '영업이익률 33.17%입니다.';
        expect(
            findUngroundedNumbers(answer, ['{"operatingMargin":0.5}'])
        ).toEqual(['33.17%']);
    });

    it('정수 툴 값은 ×100 환산 대상에서 제외한다 — count:3이 300%를 근거해주면 안 된다', () => {
        expect(
            findUngroundedNumbers('참여율은 300%입니다.', ['{"count":3}'])
        ).toEqual(['300%']);
    });

    it('절댓값이 10을 넘는 큰 비율은 ×100 환산 대상에서 제외한다 — PE 37.93이 3793%를 근거해주면 안 된다', () => {
        expect(
            findUngroundedNumbers('상승률은 3793%입니다.', ['{"pe":37.93}'])
        ).toEqual(['3793%']);
    });

    it('절댓값 10 이하 소수 비율은 ×100 환산으로 근거를 확인한다 — ROE 1.3718 → 137.18%, margin 0.5 → 50%', () => {
        expect(
            findUngroundedNumbers('ROE는 137.18%입니다.', ['{"roe":1.3718}'])
        ).toEqual([]);
        expect(
            findUngroundedNumbers('마진은 50%입니다.', ['{"margin":0.5}'])
        ).toEqual([]);
    });

    it('알려진 한계: 툴 결과 JSON이 숫자 중간에서 잘리면 실제로 근거 있는 값도 근거 없음으로 보고된다', () => {
        // "26333.0391"가 "26333.0"에서 잘려 JSON.parse가 실패하고, 정규식
        // 폴백이 잘린 값을 그대로 읽어 "26,333.04"와 어긋난다 — 호출자의
        // 툴 실행기가 JSON-safe 경계에서 자르지 않는 한 이 함수로는 복구 불가능.
        const truncated = '{"price":26333.0';
        expect(findUngroundedNumbers('나스닥: 26,333.04', [truncated])).toEqual(
            ['26,333.04']
        );
    });
});
