import { describe, expect, it } from 'vitest';
import { parseArgs } from '../../../../scripts/ab-harness/cliArgs';

describe('parseArgs', () => {
    it('parses --flag value pairs', () => {
        expect(parseArgs(['--mode', 'full', '--out', 'file.json'])).toEqual({
            mode: 'full',
            out: 'file.json',
        });
    });

    it('treats a flag with no following value as boolean true', () => {
        expect(parseArgs(['--verbose'])).toEqual({ verbose: 'true' });
    });

    it('treats a flag immediately followed by another flag as boolean true', () => {
        expect(parseArgs(['--force', '--out', 'x.json'])).toEqual({
            force: 'true',
            out: 'x.json',
        });
    });

    it('ignores bare positional args that do not start with --', () => {
        expect(parseArgs(['positional', '--mode', 'digest'])).toEqual({
            mode: 'digest',
        });
    });

    it('returns an empty record for empty argv (worst case)', () => {
        expect(parseArgs([])).toEqual({});
    });
});
