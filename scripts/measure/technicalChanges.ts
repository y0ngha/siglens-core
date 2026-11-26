/**
 * Offline measurement of `technicalChangesBetween` on the frozen replay set (WP-28 core-1).
 *
 *   npx tsx scripts/measure/technicalChanges.ts --set <set dir> [--out <json>] \
 *       [--stride <n>] [--symbols <n>] [--shard <k>/<n> --sessions-out <json>]
 *   npx tsx scripts/measure/technicalChanges.ts --merge <sessions.json>,<sessions.json>,... \
 *       [--out <json>]
 *
 * No model, no network, no randomness: the set is read through the replay loader (hash
 * verified), every symbol's daily bars from bar 300 on are replayed one session at a time
 * with `fromIndex = last - 1` and the eight hub signal types, no reference analysis. It
 * prints the counts per change kind, the share of trend changes reverted within three
 * sessions and the share of sessions with at least one line for a random 10-symbol list,
 * and the two pre-registered decisions they lead to (`technicalChangesCompute.ts`).
 * `--stride` and `--symbols` shrink a trial run; the numbers for a PR body come from the
 * defaults (every session, every symbol). One session costs about 0.1 s, so the full set
 * takes hours on one process: `--shard k/n` measures the symbols whose index mod n is k and
 * writes the raw per-session records with `--sessions-out`; `--merge` summarizes the shard
 * files (the same numbers as one run, the summary is order-independent). Every output path
 * must be outside the repository.
 */
import { resolve } from 'node:path';
import { parseArgs } from '../ab-harness/cliArgs';
import { loadSet } from '../replay/engineEval';
import { assertOutsideRepo, writeFileAtomic } from '../replay/fsUtil';
import { readFileSync } from 'node:fs';
import {
    measureSymbol,
    summarize,
    type SymbolSessions,
} from './technicalChangesCompute';

export interface MeasureArgs {
    readonly set: string;
    readonly out: string | null;
    readonly stride: number;
    readonly symbols: number | null;
    readonly shard: { readonly index: number; readonly count: number } | null;
    readonly sessionsOut: string | null;
    readonly merge: readonly string[] | null;
}

function positiveInt(raw: string | undefined, name: string): number | null {
    if (raw === undefined) return null;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 1) {
        throw new Error(`--${name} must be a positive integer`);
    }
    return value;
}

export function parseMeasureArgs(argv: readonly string[]): MeasureArgs {
    const raw = parseArgs(argv);
    if (!raw.set && !raw.merge) throw new Error('missing --set or --merge');
    const shardMatch = /^(\d+)\/(\d+)$/.exec(raw.shard ?? '');
    if (raw.shard !== undefined && shardMatch === null) {
        throw new Error('--shard must be <k>/<n>');
    }
    const shard =
        shardMatch === null
            ? null
            : { index: Number(shardMatch[1]), count: Number(shardMatch[2]) };
    if (shard !== null && (shard.count < 1 || shard.index >= shard.count)) {
        throw new Error('--shard needs 0 <= k < n');
    }
    return {
        set: raw.set ? resolve(raw.set) : '',
        shard,
        sessionsOut:
            raw['sessions-out'] === undefined
                ? null
                : resolve(raw['sessions-out']),
        merge:
            raw.merge === undefined
                ? null
                : raw.merge.split(',').map(f => resolve(f)),
        out: raw.out === undefined ? null : resolve(raw.out),
        stride: positiveInt(raw.stride, 'stride') ?? 1,
        symbols: positiveInt(raw.symbols, 'symbols'),
    };
}

export function runMeasure(
    args: MeasureArgs,
    log: (line: string) => void = line => process.stdout.write(`${line}\n`)
): number {
    [args.out, args.sessionsOut].forEach(path => {
        if (path !== null) assertOutsideRepo(path);
    });
    const loaded =
        args.merge === null
            ? null
            : args.merge.flatMap(
                  file =>
                      JSON.parse(
                          readFileSync(file, 'utf-8')
                      ) as SymbolSessions[]
              );
    const data = args.merge === null ? loadSet(args.set) : null;
    const measured =
        loaded ??
        (data?.symbols ?? [])
            .filter(
                (_, i) =>
                    args.shard === null ||
                    i % args.shard.count === args.shard.index
            )
            .slice(0, args.symbols ?? undefined)
            .map(s => measureSymbol(s.symbol, s.bars, args.stride));
    if (args.sessionsOut !== null) {
        writeFileAtomic(args.sessionsOut, JSON.stringify(measured));
    }
    const json = `${JSON.stringify(
        {
            set: data?.fingerprint ?? null,
            stride: args.stride,
            ...summarize(measured),
        },
        null,
        2
    )}\n`;
    if (args.out !== null) writeFileAtomic(args.out, json);
    log(json);
    return 0;
}

if (require.main === module) {
    try {
        process.exitCode = runMeasure(parseMeasureArgs(process.argv.slice(2)));
    } catch (error) {
        process.stderr.write(
            `${error instanceof Error ? error.message : String(error)}\n`
        );
        process.exitCode = 1;
    }
}
