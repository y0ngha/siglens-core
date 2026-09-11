import { describe, expect, it } from 'vitest';
import type {
    AgentMessage,
    AgentProviderResult,
    CallAgentProvider,
} from '@/domain/ports/agentProvider';

describe('agentProvider port', () => {
    it('포트 시그니처대로 fake provider를 만들 수 있다', async () => {
        const fake: CallAgentProvider = async o => {
            o.onEvent({ type: 'text', delta: 'hi' });
            const result: AgentProviderResult = {
                text: 'hi',
                toolCalls: [],
                stopReason: 'end',
                usage: {
                    promptTokens: 1,
                    cachedTokens: 0,
                    cacheWriteTokens: 0,
                    outputTokens: 1,
                },
            };
            return result;
        };
        const history: AgentMessage[] = [{ role: 'user', content: 'x' }];
        const events: string[] = [];
        const r = await fake({
            apiKey: 'k',
            model: 'deepseek-v4.1-flash',
            system: 's',
            messages: history,
            tools: [],
            maxOutputTokens: 10,
            signal: new AbortController().signal,
            onEvent: e => events.push(e.type),
        });
        expect(r.stopReason).toBe('end');
        expect(events).toEqual(['text']);
    });
});
