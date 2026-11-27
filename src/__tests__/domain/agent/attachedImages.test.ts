import { describe, expect, it } from 'vitest';
import {
    AGENT_IMAGES_PER_MESSAGE_MAX,
    formatAttachedImagesMarker,
} from '@/domain/agent/attachedImages';
import { buildAgentSystemPrompt } from '@/domain/agent/buildAgentSystemPrompt';
import { TEST_AGENT_TOOL_SET } from '@/__tests__/fixtures/agentToolSet';

describe('formatAttachedImagesMarker', () => {
    it('이미지 수를 표식 줄로 만든다', () => {
        expect(formatAttachedImagesMarker(2)).toBe('[attached images: 2]');
    });

    it('시스템 프롬프트가 같은 표식 모양을 설명한다', () => {
        const prompt = buildAgentSystemPrompt({
            locale: 'ko',
            tools: [],
            toolSet: TEST_AGENT_TOOL_SET,
        });
        expect(prompt).toContain(formatAttachedImagesMarker('N'));
    });

    it('메시지당 상한은 4장이다', () => {
        expect(AGENT_IMAGES_PER_MESSAGE_MAX).toBe(4);
    });
});
