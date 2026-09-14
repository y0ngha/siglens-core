import { describe, expect, it } from 'vitest';
import {
    AGENT_TOOL_SPECS,
    CounterStoreUnavailableError,
    findUngroundedNumbers,
    runAgentTurn,
} from '@/index';

describe('index — agent exports', () => {
    it('runAgentTurn·툴 카탈로그·CounterStoreUnavailableError를 값으로 내보낸다', () => {
        expect(typeof runAgentTurn).toBe('function');
        expect(AGENT_TOOL_SPECS.length).toBe(13);
        expect(new CounterStoreUnavailableError('p')).toBeInstanceOf(Error);
    });

    it('findUngroundedNumbers를 값으로 내보낸다', () => {
        expect(typeof findUngroundedNumbers).toBe('function');
    });
});
