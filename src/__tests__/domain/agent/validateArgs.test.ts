import { describe, expect, it } from 'vitest';
import { validateArgs } from '@/domain/agent/validateArgs';
import type { JsonSchemaObject } from '@/domain/ports/agentProvider';

const schema: JsonSchemaObject = {
    type: 'object',
    properties: {
        symbol: { type: 'string' },
        timeframe: { type: 'string', enum: ['1Day', '1Hour'] },
        bars: { type: 'integer', minimum: 10, maximum: 60 },
        includeBody: { type: 'boolean' },
        symbols: { type: 'array', items: { type: 'string' } },
    },
    required: ['symbol'],
    additionalProperties: false,
};

describe('validateArgs', () => {
    it('필수·타입·enum·범위를 통과하면 ok', () => {
        const r = validateArgs(schema, {
            symbol: 'AAPL',
            timeframe: '1Day',
            bars: 30,
            includeBody: true,
            symbols: ['AAPL', 'MSFT'],
        });
        expect(r.ok).toBe(true);
    });

    it('필수 누락', () => {
        const r = validateArgs(schema, { timeframe: '1Day' });
        expect(r).toEqual({
            ok: false,
            issues: [{ path: 'symbol', message: 'required' }],
        });
    });

    it('타입·enum·범위·미지 필드 위반을 전부 모아 돌려준다', () => {
        const r = validateArgs(schema, {
            symbol: 12,
            timeframe: '2Day',
            bars: 999,
            extra: 1,
            symbols: [1],
        });
        expect(r.ok).toBe(false);
        if (r.ok) return;
        expect(r.issues.map(i => i.path).sort()).toEqual(
            ['bars', 'extra', 'symbol', 'symbols[0]', 'timeframe'].sort()
        );
    });

    it('object가 아니면 단일 issue', () => {
        expect(validateArgs(schema, 'nope')).toEqual({
            ok: false,
            issues: [{ path: '', message: 'expected object' }],
        });
    });

    it('integer는 정수만, number는 실수 허용', () => {
        expect(validateArgs(schema, { symbol: 'A', bars: 10.5 }).ok).toBe(
            false
        );
    });

    describe('LLM이 흔히 보내는 잘못된 인자', () => {
        it('boolean 필드에 문자열 "true"를 보내면 expected boolean', () => {
            expect(
                validateArgs(schema, { symbol: 'AAPL', includeBody: 'true' })
            ).toEqual({
                ok: false,
                issues: [{ path: 'includeBody', message: 'expected boolean' }],
            });
        });

        it('integer 필드에 숫자 문자열 "30"을 보내면 expected integer (타입 불일치)', () => {
            expect(
                validateArgs(schema, { symbol: 'AAPL', bars: '30' })
            ).toEqual({
                ok: false,
                issues: [{ path: 'bars', message: 'expected integer' }],
            });
        });

        it('number 필드의 NaN은 숫자로 인정하지 않는다', () => {
            const numberSchema: JsonSchemaObject = {
                type: 'object',
                properties: { ratio: { type: 'number' } },
                additionalProperties: false,
            };
            expect(validateArgs(numberSchema, { ratio: NaN })).toEqual({
                ok: false,
                issues: [{ path: 'ratio', message: 'expected number' }],
            });
        });

        it('number 필드는 소수를 허용한다 (integer 전용 규칙이 적용되지 않음)', () => {
            const numberSchema: JsonSchemaObject = {
                type: 'object',
                properties: { ratio: { type: 'number', maximum: 1 } },
                additionalProperties: false,
            };
            expect(validateArgs(numberSchema, { ratio: 0.25 })).toEqual({
                ok: true,
                value: { ratio: 0.25 },
            });
        });

        it('범위 경계: minimum·maximum 값 자체는 통과하고 한 칸 밖은 거부한다', () => {
            expect(validateArgs(schema, { symbol: 'A', bars: 10 }).ok).toBe(
                true
            );
            expect(validateArgs(schema, { symbol: 'A', bars: 60 }).ok).toBe(
                true
            );
            expect(validateArgs(schema, { symbol: 'A', bars: 9 })).toEqual({
                ok: false,
                issues: [{ path: 'bars', message: 'minimum 10' }],
            });
            expect(validateArgs(schema, { symbol: 'A', bars: 61 })).toEqual({
                ok: false,
                issues: [{ path: 'bars', message: 'maximum 60' }],
            });
        });

        it('enum 위반 메시지는 허용값 목록을 | 로 이어 알려준다', () => {
            expect(
                validateArgs(schema, { symbol: 'A', timeframe: '1day' })
            ).toEqual({
                ok: false,
                issues: [
                    {
                        path: 'timeframe',
                        message: 'expected one of 1Day|1Hour',
                    },
                ],
            });
        });

        it('array 필드에 단일 문자열을 보내면 expected array', () => {
            expect(
                validateArgs(schema, { symbol: 'AAPL', symbols: 'AAPL,MSFT' })
            ).toEqual({
                ok: false,
                issues: [{ path: 'symbols', message: 'expected array' }],
            });
        });

        it('배열 원소 위반은 인덱스가 붙은 경로로 전부 보고한다', () => {
            const r = validateArgs(schema, {
                symbol: 'AAPL',
                symbols: ['AAPL', 2, null],
            });
            expect(r).toEqual({
                ok: false,
                issues: [
                    { path: 'symbols[1]', message: 'expected string' },
                    { path: 'symbols[2]', message: 'expected string' },
                ],
            });
        });

        it('items 스키마가 없는 array는 원소 타입을 검사하지 않는다', () => {
            const looseSchema: JsonSchemaObject = {
                type: 'object',
                properties: { tags: { type: 'array' } },
                additionalProperties: false,
            };
            expect(validateArgs(looseSchema, { tags: [1, 'a', null] })).toEqual(
                { ok: true, value: { tags: [1, 'a', null] } }
            );
        });

        it('인자 자체가 배열이나 null이면 expected object', () => {
            const expected = {
                ok: false,
                issues: [{ path: '', message: 'expected object' }],
            };
            expect(validateArgs(schema, ['AAPL'])).toEqual(expected);
            expect(validateArgs(schema, null)).toEqual(expected);
        });

        it('선택 필드가 undefined면 타입 검사를 건너뛴다', () => {
            expect(
                validateArgs(schema, { symbol: 'AAPL', bars: undefined })
            ).toEqual({ ok: true, value: { symbol: 'AAPL', bars: undefined } });
        });

        it('스키마가 지원하지 않는 타입을 선언하면 unknown type 이슈로 막는다 (타입 밖 스키마 방어)', () => {
            const foreignSchema = {
                type: 'object',
                properties: { filter: { type: 'object' } },
                additionalProperties: false,
            } as unknown as JsonSchemaObject;
            expect(validateArgs(foreignSchema, { filter: {} })).toEqual({
                ok: false,
                issues: [{ path: 'filter', message: 'unknown type object' }],
            });
        });
    });
});
