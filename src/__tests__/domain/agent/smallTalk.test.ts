import { describe, expect, it } from 'vitest';
import { isSmallTalkMessage } from '@/domain/agent/smallTalk';

describe('isSmallTalkMessage', () => {
    it.each([
        '고마워',
        '고마워요!',
        'ㅇㅋ 고마워',
        '아 그렇구나',
        '아하 이해했어',
        '감사합니다~',
        '넵 감사해요 ㅋㅋ',
        '고마워ㅎ',
        'ㅇㅋㅋ 고마워',
        '오케이 고마워 👍',
        'Thanks!',
        'thank you',
        'got it, thanks',
        'ok understood',
        'ありがとう',
        '谢谢',
    ])('treats %j as small talk', message => {
        expect(isSmallTalkMessage(message)).toBe(true);
    });

    it.each([
        '',
        '   ',
        '고마워 근데 주봉은?',
        '그럼 지금 사면 안 되겠네?',
        '확실해?',
        '쉽게 말해줘',
        '한 줄로',
        '아 그럼 금리는?',
        'thanks, what about the weekly chart?',
        'ok so is it oversold',
        '네 그럼 엔비디아는?',
        // A bare yes/ok can accept a follow-up the assistant just offered.
        '네',
        '응',
        'ㅇㅇ',
        '넵 ㅋㅋ',
        '좋아',
        'ok',
        'okay cool',
        'got it',
        // Over the length cap even though every word is a thank-you.
        '고마워 고마워 고마워 고마워 고마워 고마워 고마워 고마워',
    ])('does not treat %j as small talk', message => {
        expect(isSmallTalkMessage(message)).toBe(false);
    });
});
