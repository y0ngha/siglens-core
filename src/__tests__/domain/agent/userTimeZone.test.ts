import { describe, expect, it } from 'vitest';
import {
    formatAgentTimestamp,
    localizeTimestamps,
    resolveAgentTimeZone,
} from '@/domain/agent/userTimeZone';

describe('resolveAgentTimeZone', () => {
    it('유효한 IANA 시간대는 그대로 쓴다', () => {
        expect(resolveAgentTimeZone('Europe/London', 'ko')).toBe(
            'Europe/London'
        );
        expect(resolveAgentTimeZone(' Asia/Tokyo ', 'en')).toBe('Asia/Tokyo');
    });
    it.each([
        [undefined, 'ko', 'Asia/Seoul'],
        ['', 'en', 'America/New_York'],
        ['Mars/Olympus', 'ja', 'Asia/Tokyo'],
        ['x'.repeat(100), 'zh', 'Asia/Shanghai'],
    ] as const)(
        '없거나 잘못된 값(%j)은 로케일 기본값',
        (raw, locale, expected) => {
            expect(resolveAgentTimeZone(raw, locale)).toBe(expected);
        }
    );
});

describe('formatAgentTimestamp', () => {
    const instant = new Date('2026-09-11T21:42:00Z');
    it.each([
        ['Asia/Seoul', '2026-09-12 06:42 KST'],
        ['America/New_York', '2026-09-11 17:42 EDT'],
        ['Asia/Tokyo', '2026-09-12 06:42 JST'],
    ])('%s → %s', (zone, expected) => {
        expect(formatAgentTimestamp(instant, zone)).toBe(expected);
    });
    it('약어가 없는 시간대는 일반 이름으로 표기하고 GMT 오프셋을 쓰지 않는다', () => {
        const shanghai = formatAgentTimestamp(instant, 'Asia/Shanghai');
        expect(shanghai).toMatch(/^2026-09-12 05:42 \S/);
        expect(shanghai).not.toMatch(/GMT|UTC/);
        const london = formatAgentTimestamp(instant, 'Europe/London');
        expect(london).toMatch(/^2026-09-11 22:42 \S/);
        expect(london).not.toMatch(/GMT|UTC/);
    });
});

describe('localizeTimestamps', () => {
    it('중첩된 ISO 시각만 사용자 시간대로 바꾸고 나머지는 그대로 둔다', () => {
        expect(
            localizeTimestamps(
                {
                    asOf: '2026-09-11T21:42:00.000Z',
                    news: [
                        {
                            title: '2026-09-11',
                            publishedAt: '2026-09-11T12:00:00+09:00',
                        },
                    ],
                    bars: [{ t: '2026-09-11T13:30' }],
                    price: 332.27,
                    note: null,
                },
                'Asia/Seoul'
            )
        ).toEqual({
            asOf: '2026-09-12 06:42 KST',
            news: [
                { title: '2026-09-11', publishedAt: '2026-09-11 12:00 KST' },
            ],
            bars: [{ t: '2026-09-11T13:30' }],
            price: 332.27,
            note: null,
        });
    });
    it.each([
        '2026-13-01T10:00:00Z',
        '2026-01-32T10:00:00Z',
        '2026-01-01T10:99:00Z',
        '2026-01-01T10:00:00+99:99',
    ])(
        '형식은 맞지만 실제로는 없는 시각(%s)은 원본 문자열을 그대로 둔다',
        bad => {
            expect(localizeTimestamps({ bad }, 'Asia/Seoul')).toEqual({ bad });
        }
    );

    it('순환 참조가 있어도 멈추지 않는다', () => {
        const cyclic: Record<string, unknown> = {
            asOf: '2026-09-11T21:42:00Z',
        };
        cyclic.self = cyclic;
        expect(() => localizeTimestamps(cyclic, 'Asia/Seoul')).not.toThrow();
    });
});
