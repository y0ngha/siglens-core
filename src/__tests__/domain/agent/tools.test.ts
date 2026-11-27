import { describe, expect, it } from 'vitest';
import {
    AGENT_BARS_TIMEFRAMES,
    FRESH_ANALYSIS_KINDS,
} from '@/domain/agent/tools';
import { PROVIDER_TIMEFRAMES } from '@/domain/constants/market';

/*
 * The tool specs, routing rows and tool rules live in the consumer's tool set
 * (siglens `features/agent-tools`), with their tests. What stays here is the
 * two lists the consumer's schemas take their enums from.
 */

describe('AGENT_BARS_TIMEFRAMES', () => {
    it('제공자 타임프레임 여섯 개 뒤에 주봉·월봉을 붙인 목록이다', () => {
        // Literal lists: core now analyses `1Week` too, but the released values stay.
        const released = ['5Min', '15Min', '30Min', '1Hour', '4Hour', '1Day'];
        expect(PROVIDER_TIMEFRAMES).toEqual(released);
        expect(AGENT_BARS_TIMEFRAMES).toEqual([...released, '1Week', '1Month']);
    });
});

describe('FRESH_ANALYSIS_KINDS', () => {
    it('새로 만들 수 있는 분석 종류 네 개다', () => {
        expect(FRESH_ANALYSIS_KINDS).toEqual([
            'technical',
            'overall',
            'news',
            'options',
        ]);
    });
});
