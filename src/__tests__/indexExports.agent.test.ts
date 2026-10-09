import { describe, expect, it } from 'vitest';
import * as clientApi from '@/index.client';
import {
    AGENT_FOLLOW_UP_MARKER,
    AGENT_TOOL_SPECS,
    CounterStoreUnavailableError,
    findUngroundedNumbers,
    peekMacroBriefingCacheEntry,
    runAgentTurn,
    splitAgentFollowUps,
} from '@/index';

describe('index — agent exports', () => {
    it('runAgentTurn·툴 카탈로그·CounterStoreUnavailableError를 값으로 내보낸다', () => {
        expect(typeof runAgentTurn).toBe('function');
        expect(AGENT_TOOL_SPECS.length).toBe(14);
        expect(new CounterStoreUnavailableError('p')).toBeInstanceOf(Error);
    });

    it('findUngroundedNumbers를 값으로 내보낸다', () => {
        expect(typeof findUngroundedNumbers).toBe('function');
    });

    it('후속 질문 마커·파서를 서버·브라우저 진입점 양쪽으로 내보낸다 (UX audit 2026-10-05 §E5-d)', () => {
        expect(AGENT_FOLLOW_UP_MARKER).toBe('[[followups]]');
        expect(splitAgentFollowUps('본문\n[[followups]] A').followUps).toEqual([
            'A',
        ]);
        expect(clientApi.AGENT_FOLLOW_UP_MARKER).toBe(AGENT_FOLLOW_UP_MARKER);
        expect(clientApi.splitAgentFollowUps).toBe(splitAgentFollowUps);
    });

    it('peekMacroBriefingCacheEntry를 서버 진입점으로 내보낸다 (UX audit 2026-10-05 §C1)', () => {
        expect(typeof peekMacroBriefingCacheEntry).toBe('function');
    });
});
