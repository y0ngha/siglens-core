import { describe, expect, it } from 'vitest';
import {
    parseArgs,
    parsePositiveIntArg,
} from '../../../../scripts/ab-harness/cliArgs';

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

// Shared by every ab-harness script with a repeat-count flag — was
// duplicated as `parsePassesArg` (judge.ts) and `parseSamplesArg`
// (runModels.ts) before being consolidated here.
describe('parsePositiveIntArg', () => {
    it('defaults to 1 when unset', () => {
        expect(parsePositiveIntArg(undefined, 'passes')).toBe(1);
    });

    it('parses a valid positive integer string', () => {
        expect(parsePositiveIntArg('5', 'passes')).toBe(5);
    });

    it('rejects zero, negative, and non-integer values (worst case)', () => {
        expect(() => parsePositiveIntArg('0', 'passes')).toThrow(
            /positive integer/
        );
        expect(() => parsePositiveIntArg('-1', 'passes')).toThrow(
            /positive integer/
        );
        expect(() => parsePositiveIntArg('1.5', 'passes')).toThrow(
            /positive integer/
        );
        expect(() => parsePositiveIntArg('abc', 'passes')).toThrow(
            /positive integer/
        );
    });

    it('interpolates the given flag name into both the flag reference and the invalid value in the error message', () => {
        expect(() => parsePositiveIntArg('abc', 'samples')).toThrow(
            /--samples must be a positive integer \(got "abc"\)/
        );
        expect(() => parsePositiveIntArg('abc', 'passes')).toThrow(
            /--passes must be a positive integer \(got "abc"\)/
        );
    });
});
