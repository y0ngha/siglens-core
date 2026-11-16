import { describe, expect, it } from 'vitest';
import {
    AGENT_THEME_IDS,
    AGENT_THEMES,
    findAgentTheme,
} from '@/domain/agent/themes';

describe('AGENT_THEMES', () => {
    it('id가 유일하고 테마마다 종목 3~8개, 종목은 중복 없이 시장에 맞는 모양이다', () => {
        expect(new Set(AGENT_THEME_IDS).size).toBe(AGENT_THEMES.length);
        for (const theme of AGENT_THEMES) {
            expect(theme.symbols.length).toBeGreaterThanOrEqual(3);
            expect(theme.symbols.length).toBeLessThanOrEqual(8);
            expect(new Set(theme.symbols).size).toBe(theme.symbols.length);
            for (const symbol of theme.symbols)
                expect(symbol).toMatch(
                    theme.market === 'kr' ? /^\d{6}\.(KS|KQ)$/ : /^[A-Z]{1,5}$/
                );
        }
    });

    it('findAgentTheme은 id로 찾고 없으면 undefined', () => {
        expect(findAgentTheme('quantum')?.symbols).toContain('IONQ');
        expect(findAgentTheme('nope')).toBeUndefined();
    });
});
