import { describe, expect, it } from 'vitest';
import {
    AGENT_FOLLOW_UP_MARKER,
    splitAgentFollowUps,
} from '@/domain/agent/agentFollowUps';

const BODY = '결론입니다.\n\n- 근거 하나\n- 근거 둘';

describe('splitAgentFollowUps 함수는', () => {
    it('마커 상수는 [[followups]]이다', () => {
        expect(AGENT_FOLLOW_UP_MARKER).toBe('[[followups]]');
    });

    it('마지막 줄의 마커를 본문에서 떼고 항목을 돌려준다', () => {
        const result = splitAgentFollowUps(
            `${BODY}\n\n[[followups]] 지표별 근거 보여줘 | 옵션 가격대는? | 실적 숫자 자세히`
        );
        expect(result.body).toBe(BODY);
        expect(result.followUps).toEqual([
            '지표별 근거 보여줘',
            '옵션 가격대는?',
            '실적 숫자 자세히',
        ]);
    });

    it('항목 1개(Detailed)도 받는다', () => {
        expect(
            splitAgentFollowUps(`${BODY}\n[[followups]] 주봉으로도 볼까?`)
        ).toEqual({ body: BODY, followUps: ['주봉으로도 볼까?'] });
    });

    it('마커 뒤 공백 없이 붙어 있어도, 줄 앞뒤 공백이 있어도 받는다', () => {
        expect(
            splitAgentFollowUps(`${BODY}\n  [[followups]]A|B  \n`).followUps
        ).toEqual(['A', 'B']);
    });

    it('각 항목을 trim하고 빈 항목을 버린다', () => {
        expect(
            splitAgentFollowUps('본문\n[[followups]]  A  | | B ||').followUps
        ).toEqual(['A', 'B']);
    });

    it('항목은 3개까지만 남긴다', () => {
        expect(
            splitAgentFollowUps('본문\n[[followups]] 1 | 2 | 3 | 4 | 5')
                .followUps
        ).toEqual(['1', '2', '3']);
    });

    it('항목은 60자에서 자른다 (한글 포함, 코드 포인트 기준)', () => {
        const long = '가'.repeat(80);
        const [item] = splitAgentFollowUps(
            `본문\n[[followups]] ${long}`
        ).followUps;
        expect(Array.from(item)).toHaveLength(60);
        const exactly = '나'.repeat(60);
        expect(
            splitAgentFollowUps(`본문\n[[followups]] ${exactly}`).followUps
        ).toEqual([exactly]);
    });

    it('마지막이 아닌 줄의 마커는 일반 텍스트라 입력을 그대로 돌려준다', () => {
        const text = '[[followups]] A | B\n그 뒤에 이어지는 본문입니다.';
        expect(splitAgentFollowUps(text)).toEqual({
            body: text,
            followUps: [],
        });
    });

    it('줄 중간에 있는 마커는 무시한다', () => {
        const text = '답변 끝에 [[followups]] A | B 가 붙었습니다.';
        expect(splitAgentFollowUps(text)).toEqual({
            body: text,
            followUps: [],
        });
    });

    it('항목이 하나도 남지 않는 마커 줄은 형식 오류라 입력을 그대로 돌려준다', () => {
        // 끝이 마커 접두어가 아니라 항목 없이 닫힌 마커 + 구분자만 있는 경우.
        const text = '본문\n[[followups]] | |';
        expect(splitAgentFollowUps(text)).toEqual({
            body: text,
            followUps: [],
        });
    });

    it('[ 한 글자만 있는 줄이 아니라 일반 대괄호 줄(각주 등)은 건드리지 않는다', () => {
        const text = '본문\n[1] 각주입니다.';
        expect(splitAgentFollowUps(text)).toEqual({
            body: text,
            followUps: [],
        });
    });

    it('마커가 아닌 [[ 줄은 건드리지 않는다', () => {
        const text = '본문\n[[1]] 각주입니다.';
        expect(splitAgentFollowUps(text)).toEqual({
            body: text,
            followUps: [],
        });
    });

    describe('스트리밍 중 아직 덜 쓰인 마지막 줄은', () => {
        it.each([
            '[',
            '[[',
            '[[f',
            '[[follow',
            '[[followups]',
            '[[followups]]',
            '[[followups]]  ',
        ])('%s 이면 본문에서 감추고 followUps는 비운다', partial => {
            expect(splitAgentFollowUps(`${BODY}\n\n${partial}`)).toEqual({
                body: BODY,
                followUps: [],
            });
        });

        it('마커 줄이 다 닫히기 전의 항목은 줄 전체를 파싱한다 (완료 전엔 칩을 그리지 않는다는 전제)', () => {
            expect(
                splitAgentFollowUps(`${BODY}\n[[followups]] 지표별 근`)
            ).toEqual({ body: BODY, followUps: ['지표별 근'] });
        });
    });

    it('마커가 없으면 본문을 그대로 돌려준다', () => {
        expect(splitAgentFollowUps(BODY)).toEqual({
            body: BODY,
            followUps: [],
        });
    });

    it('빈 문자열·공백만 있는 입력도 그대로 돌려준다', () => {
        expect(splitAgentFollowUps('')).toEqual({ body: '', followUps: [] });
        expect(splitAgentFollowUps('  \n\n')).toEqual({
            body: '  \n\n',
            followUps: [],
        });
    });

    it('마커가 본문의 유일한 줄이면 본문은 빈 문자열이다', () => {
        expect(splitAgentFollowUps('[[followups]] A | B')).toEqual({
            body: '',
            followUps: ['A', 'B'],
        });
    });

    it('마커 줄 뒤에 빈 줄이 따라와도 마지막 비어 있지 않은 줄로 본다', () => {
        expect(
            splitAgentFollowUps(`${BODY}\n[[followups]] A | B\n\n\n`)
        ).toEqual({ body: BODY, followUps: ['A', 'B'] });
    });
});
