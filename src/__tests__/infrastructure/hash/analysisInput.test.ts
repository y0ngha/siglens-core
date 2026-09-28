import { describe, it, expect } from 'vitest';
import {
    analysisSeed,
    hashAnalysisInput,
    hashSkillCatalog,
    macroCalendarFingerprintParts,
    MAX_INT32,
    normalizeSkillsForHash,
} from '@/infrastructure/hash/analysisInput';
import type { EconomicCalendarEvent, Skill } from '@/domain/types';

const makeSkill = (name: string, overrides: Partial<Skill> = {}): Skill => ({
    name,
    description: `${name} description`,
    type: 'indicator_guide',
    category: 'neutral',
    indicators: [],
    confidenceWeight: 0.8,
    content: `${name} body`,
    gating: { tier: 'always_on' },
    tokenCost: 500,
    ...overrides,
});

describe('hashAnalysisInput', () => {
    it('동일한 입력은 항상 동일한 해시를 반환한다 (deterministic)', () => {
        const input = JSON.stringify({
            symbol: 'AAPL',
            valuation: { per: 30 },
        });
        expect(hashAnalysisInput(input)).toBe(hashAnalysisInput(input));
    });

    it('서로 다른 입력은 서로 다른 해시를 반환한다', () => {
        const hashA = hashAnalysisInput(JSON.stringify({ symbol: 'AAPL' }));
        const hashB = hashAnalysisInput(JSON.stringify({ symbol: 'GOOG' }));
        expect(hashA).not.toBe(hashB);
    });

    it('출력이 정확히 16자임', () => {
        const hash = hashAnalysisInput('some input string');
        expect(hash).toHaveLength(16);
    });

    it('출력이 소문자 16진수 문자열임 (/^[a-f0-9]{16}$/)', () => {
        const hash = hashAnalysisInput('another test input');
        expect(hash).toMatch(/^[a-f0-9]{16}$/);
    });

    it('빈 문자열 입력도 16자 hex 해시를 반환한다', () => {
        const hash = hashAnalysisInput('');
        expect(hash).toHaveLength(16);
        expect(hash).toMatch(/^[a-f0-9]{16}$/);
    });
});

describe('analysisSeed', () => {
    it('동일한 입력은 항상 동일한 seed를 반환한다 (deterministic)', () => {
        const input = JSON.stringify({ symbol: 'AAPL', timeframe: '1Day' });
        expect(analysisSeed(input)).toBe(analysisSeed(input));
    });

    it('seed는 음수가 아니고 0x7fffffff 이하인 정수다', () => {
        for (const input of ['', 'AAPL', 'a much longer prompt string', '{}']) {
            const seed = analysisSeed(input);
            expect(Number.isInteger(seed)).toBe(true);
            expect(seed).toBeGreaterThanOrEqual(0);
            expect(seed).toBeLessThanOrEqual(MAX_INT32);
        }
    });

    it('서로 다른 입력은 (일반적으로) 서로 다른 seed를 반환한다', () => {
        expect(analysisSeed('prompt A')).not.toBe(analysisSeed('prompt B'));
    });

    it('알려진 입력은 안정적인 기대값을 반환한다', () => {
        // Locked snapshot: sha256('AAPL|1Day')[0..8] parsed as int & 0x7fffffff.
        expect(analysisSeed('AAPL|1Day')).toBe(415931526);
    });
});

describe('hashSkillCatalog', () => {
    const catalog = [makeSkill('RSI Guide'), makeSkill('Bollinger Guide')];

    it('카탈로그 로딩 순서가 달라도 같은 fingerprint를 낸다', () => {
        expect(hashSkillCatalog(catalog)).toBe(
            hashSkillCatalog(catalog.toReversed())
        );
    });

    it('gating 변경은 fingerprint를 바꾼다 (캐시 무효화 대상)', () => {
        const regated = [
            makeSkill('RSI Guide', {
                gating: {
                    tier: 'gated',
                    signalKind: 'event',
                    triggers: ['rsi_oversold'],
                },
            }),
            catalog[1],
        ];
        expect(hashSkillCatalog(regated)).not.toBe(hashSkillCatalog(catalog));
    });

    it('tokenCost 변경은 fingerprint를 바꾼다', () => {
        const recosted = [
            makeSkill('RSI Guide', { tokenCost: 501 }),
            catalog[1],
        ];
        expect(hashSkillCatalog(recosted)).not.toBe(hashSkillCatalog(catalog));
    });

    it('본문·설명 변경은 fingerprint를 바꾸지 않는다 (과잉 무효화 방지)', () => {
        const edited = [
            makeSkill('RSI Guide', {
                content: 'rewritten body',
                description: 'rewritten description',
                confidenceWeight: 0.1,
            }),
            catalog[1],
        ];
        expect(hashSkillCatalog(edited)).toBe(hashSkillCatalog(catalog));
    });

    it('gating·tokenCost가 없는 스킬은 null로 정규화되어 명시적 값과 구별된다', () => {
        const bare = [
            makeSkill('RSI Guide', { gating: undefined, tokenCost: undefined }),
        ];
        expect(hashSkillCatalog(bare)).toBe(
            hashAnalysisInput(
                JSON.stringify([
                    { name: 'RSI Guide', gating: null, tokenCost: null },
                ])
            )
        );
        expect(hashSkillCatalog(bare)).not.toBe(
            hashSkillCatalog([makeSkill('RSI Guide')])
        );
    });

    it('빈 카탈로그도 16자 hex fingerprint를 낸다', () => {
        const fingerprint = hashSkillCatalog([]);

        expect(fingerprint).toMatch(/^[0-9a-f]{16}$/);
        expect(fingerprint).toBe(hashAnalysisInput('[]'));
    });
});

describe('normalizeSkillsForHash', () => {
    it('이름순으로 정렬하고 해시에 쓰는 필드만 남긴다', () => {
        const result = normalizeSkillsForHash([
            makeSkill('b-skill'),
            makeSkill('a-skill', { category: 'fundamental' }),
        ]);
        expect(result).toEqual([
            {
                name: 'a-skill',
                content: 'a-skill body',
                confidenceWeight: 0.8,
                category: 'fundamental',
                gating: { tier: 'always_on' },
            },
            {
                name: 'b-skill',
                content: 'b-skill body',
                confidenceWeight: 0.8,
                category: 'neutral',
                gating: { tier: 'always_on' },
            },
        ]);
    });

    it('category·gating이 없으면 undefined 대신 null을 넣어 JSON 직렬화에서 키가 사라지지 않게 한다', () => {
        const [normalized] = normalizeSkillsForHash([
            makeSkill('x', { category: undefined, gating: undefined }),
        ]);
        expect(normalized.category).toBeNull();
        expect(normalized.gating).toBeNull();
        expect(JSON.stringify(normalized)).toContain('"category":null');
        expect(JSON.stringify(normalized)).toContain('"gating":null');
    });

    it('입력 배열을 변경하지 않는다', () => {
        const input = [makeSkill('b'), makeSkill('a')];
        normalizeSkillsForHash(input);
        expect(input.map(s => s.name)).toEqual(['b', 'a']);
    });
});

describe('macroCalendarFingerprintParts', () => {
    const makeEvent = (
        overrides: Partial<EconomicCalendarEvent> = {}
    ): EconomicCalendarEvent => ({
        date: '2026-10-01 08:30:00',
        event: 'Core PCE Price Index MoM',
        impact: 'High',
        actual: null,
        estimate: 0.3,
        previous: 0.2,
        unit: '%',
        ...overrides,
    });

    it('빈 배열은 빈 배열을 반환한다 (기존 호출과 바이트 동일성 보장)', () => {
        expect(macroCalendarFingerprintParts([])).toEqual([]);
    });

    it('각 이벤트를 date|event|impact|actual|estimate|previous|unit 형식으로 직렬화한다 (렌더되는 필드 전체)', () => {
        const result = macroCalendarFingerprintParts([
            makeEvent({ actual: 0.3, estimate: 0.3, previous: 0.2 }),
        ]);
        expect(result).toEqual([
            '2026-10-01 08:30:00|Core PCE Price Index MoM|High|0.3|0.3|0.2|%',
        ]);
    });

    it('actual이 null이면 리터럴 문자열 "null"로 직렬화한다', () => {
        const result = macroCalendarFingerprintParts([
            makeEvent({ actual: null }),
        ]);
        expect(result).toEqual([
            '2026-10-01 08:30:00|Core PCE Price Index MoM|High|null|0.3|0.2|%',
        ]);
    });

    it('actual 값이 채워지면(null → 숫자) fingerprint가 달라진다 — 재분석 트리거', () => {
        const before = macroCalendarFingerprintParts([
            makeEvent({ actual: null }),
        ]);
        const after = macroCalendarFingerprintParts([
            makeEvent({ actual: 0.3 }),
        ]);
        expect(before).not.toEqual(after);
    });

    it('estimate·previous 변경도 fingerprint를 바꾼다 (렌더되는 필드는 전부 반영 — review round 1 finding 5)', () => {
        // 초기 추정치 수정이나 이전 기간 재작성도 프롬프트 바이트를 바꾼다 —
        // actual이 채워질 때와 동일한 이유로 캐시가 무효화되어야 한다.
        const a = macroCalendarFingerprintParts([
            makeEvent({ estimate: 0.3, previous: 0.2 }),
        ]);
        const b = macroCalendarFingerprintParts([
            makeEvent({ estimate: 0.5, previous: 0.9 }),
        ]);
        expect(a).not.toEqual(b);
    });

    it('impact 변경도 fingerprint를 바꾼다', () => {
        const low = macroCalendarFingerprintParts([
            makeEvent({ impact: 'Low' }),
        ]);
        const high = macroCalendarFingerprintParts([
            makeEvent({ impact: 'High' }),
        ]);
        expect(low).not.toEqual(high);
    });

    it('unit 변경도 fingerprint를 바꾼다', () => {
        const pct = macroCalendarFingerprintParts([makeEvent({ unit: '%' })]);
        const none = macroCalendarFingerprintParts([makeEvent({ unit: '' })]);
        expect(pct).not.toEqual(none);
    });

    it('입력 순서와 무관하게 정렬된 결과를 반환한다', () => {
        const eventA = makeEvent({ date: '2026-10-01 08:30:00', event: 'A' });
        const eventB = makeEvent({ date: '2026-10-05 08:30:00', event: 'B' });
        expect(macroCalendarFingerprintParts([eventB, eventA])).toEqual(
            macroCalendarFingerprintParts([eventA, eventB])
        );
    });

    it('입력 배열을 변경하지 않는다', () => {
        const input = [makeEvent({ event: 'B' }), makeEvent({ event: 'A' })];
        macroCalendarFingerprintParts(input);
        expect(input.map(e => e.event)).toEqual(['B', 'A']);
    });
});
