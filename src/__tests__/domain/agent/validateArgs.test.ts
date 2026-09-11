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
});
