import { describe, it, expect } from 'vitest';
import {
    analysisSeed,
    hashAnalysisInput,
} from '@/infrastructure/hash/analysisInput';

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
            expect(seed).toBeLessThanOrEqual(0x7fffffff);
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
