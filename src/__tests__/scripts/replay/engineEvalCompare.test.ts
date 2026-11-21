import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    MAX_INSTANCE_DROP,
    assertComparable,
    compareArms,
    exitCodeOf,
    InvalidEventError,
    parseCompareArgs,
    readArm,
    runCompare,
    type ArmData,
    type RunInfo,
} from '../../../../scripts/replay/engineEvalCompare';
import { summarizeArm } from '../../../../scripts/replay/engineEvalCompute';
import {
    EVAL_CONSTANTS,
    type EvalEvent,
    type G1Gate,
} from '../../../../scripts/replay/engineEvalTypes';
import { REPO_ROOT } from '../../../../scripts/replay/fsUtil';
import { candleEvent, patternEvent, spread } from './engineEvalFixtures';
import { makeTempDir } from './replayFixtures';

const WEEKS = 12;
const WEEK_LIST = Array.from(
    { length: WEEKS },
    (_, i) => `2021-W${String(i + 1).padStart(2, '0')}`
);

function run(name: string, overrides: Partial<RunInfo> = {}): RunInfo {
    return {
        arm: name,
        coreGitSha: 'abc',
        dirtyDiffSha256: null,
        source: { kind: 'set', fingerprint: 'fp', symbols: ['A', 'B'] },
        only: null,
        gate: null,
        constants: { ...EVAL_CONSTANTS },
        ...overrides,
    };
}

function arm(
    name: string,
    options: {
        candleY?: number;
        patternHit?: 'hit' | 'inval';
        counters?: Record<string, number>;
        candles?: boolean;
        patterns?: boolean;
        candleCount?: number;
        gate?: G1Gate | null;
        run?: Partial<RunInfo>;
        pattern?: string;
    } = {}
): ArmData {
    const {
        candleY = 1,
        patternHit = 'hit',
        counters = {},
        candles = true,
        patterns = true,
        candleCount = 24,
        gate = null,
        pattern = 'hammer',
    } = options;
    const candleEvents = spread(candleCount, WEEKS, () =>
        candleEvent({ y: candleY, pattern })
    );
    const patternEvents = spread(24, WEEKS, () =>
        patternEvent({ target60: patternHit })
    );
    return {
        run: run(name, options.run),
        events: [
            ...(candles ? candleEvents : []),
            ...(patterns ? patternEvents : []),
        ],
        summary: summarizeArm({
            arm: name,
            weeks: WEEK_LIST,
            gate,
            candleEvents: candles ? candleEvents : null,
            patternEvents: patterns ? patternEvents : null,
            patternCounters: patterns ? counters : null,
            caseLines: null,
        }),
    };
}

describe('assertComparable', () => {
    it('accepts identical measurement setups, whatever the key order of the constants', () => {
        expect(() =>
            assertComparable(
                run('a', { constants: { x: 1, y: { p: 1, q: 2 } } }),
                run('b', { constants: { y: { q: 2, p: 1 }, x: 1 } })
            )
        ).not.toThrow();
    });

    it('refuses a different data fingerprint, symbol list, `only` or constants', () => {
        const base = run('a');
        const refuse = (other: Partial<RunInfo>, what: string) =>
            expect(() => assertComparable(base, run('b', other))).toThrow(
                `runs are not comparable: ${what} differ`
            );
        refuse(
            { source: { ...base.source, fingerprint: 'other' } },
            'source fingerprint'
        );
        refuse({ source: { ...base.source, symbols: ['A'] } }, 'symbol list');
        refuse({ only: 'candles' }, '`only`');
        refuse({ constants: { ...EVAL_CONSTANTS, seed: 1 } }, 'constants');
    });

    it('names every difference at once', () => {
        expect(() =>
            assertComparable(
                run('a'),
                run('b', { only: 'patterns', constants: {} })
            )
        ).toThrow('`only`, constants differ between a and b');
    });
});

describe('compareArms', () => {
    it('reports the pooled candle and pattern deltas with intervals inside one resample', () => {
        const report = compareArms(
            arm('before', {
                candleY: 1,
                patternHit: 'inval',
                counters: { instances: 10 },
            }),
            arm('after', {
                candleY: 3,
                patternHit: 'hit',
                counters: { instances: 9 },
            })
        );
        expect(report.before).toBe('before');
        expect(report.after).toBe('after');
        expect(report.warnings).toEqual([]);
        expect(report.candles?.pooled.primary.delta).toBeCloseTo(2, 12);
        expect(report.candles?.bullish.horizons.h1.delta).toBeCloseTo(2, 12);
        expect(report.candles?.bearish.primary.nBefore).toBe(0);
        expect(report.patterns?.target.delta).toBeCloseTo(1, 12);
        expect(report.patterns?.targetBlock.delta).toBeCloseTo(1, 12);
        expect(report.patterns?.cons.delta).toBeCloseTo(0, 12);
        expect(report.gates.g2.candleUpperBoundNonNegative).toBe(true);
        expect(report.gates.g2.patternUpperBoundNonNegative).toBe(true);
        expect(report.gates.g2.pass).toBe(true);
    });

    it('fails G2 when a pooled upper bound is below zero', () => {
        const report = compareArms(
            arm('before', {
                candleY: 3,
                patternHit: 'hit',
                counters: { instances: 10 },
            }),
            arm('after', {
                candleY: 1,
                patternHit: 'inval',
                counters: { instances: 10 },
            })
        );
        expect(report.gates.g2.candleUpperBoundNonNegative).toBe(false);
        expect(report.gates.g2.patternUpperBoundNonNegative).toBe(false);
        expect(report.gates.g2.pass).toBe(false);
    });

    it('fails a bound that cannot be computed when both arms measured the half', () => {
        const report = compareArms(
            arm('before', { candleCount: 0 }),
            arm('after', { candleCount: 0 })
        );
        expect(report.gates.g2.candleUpperBoundNonNegative).toBe(false);
        expect(report.gates.g2.pass).toBe(false);
    });

    it('leaves a half neither arm measured undecided and skips it', () => {
        const report = compareArms(
            arm('before', { patterns: false, run: { only: 'candles' } }),
            arm('after', { patterns: false, run: { only: 'candles' } })
        );
        expect(report.patterns).toBeNull();
        expect(report.instances).toBeNull();
        expect(report.gates.g2.patternUpperBoundNonNegative).toBeNull();
        expect(report.gates.g2.instancesWithinBound).toBeNull();
        expect(report.gates.g2.pass).toBe(true);
        const patternOnly = compareArms(
            arm('before', { candles: false, run: { only: 'patterns' } }),
            arm('after', { candles: false, run: { only: 'patterns' } })
        );
        expect(patternOnly.candles).toBeNull();
        expect(patternOnly.candleEventCounts).toBeNull();
        expect(patternOnly.gates.g2.candleUpperBoundNonNegative).toBeNull();
    });

    it('fails closed when neither half was measured', () => {
        const report = compareArms(
            arm('before', { candles: false, patterns: false }),
            arm('after', { candles: false, patterns: false })
        );
        expect(report.gates.g2.candleUpperBoundNonNegative).toBeNull();
        expect(report.gates.g2.patternUpperBoundNonNegative).toBeNull();
        expect(report.gates.g2.pass).toBe(false);
    });

    it('refuses runs that are not comparable', () => {
        expect(() =>
            compareArms(
                arm('before'),
                arm('after', {
                    run: {
                        source: {
                            kind: 'set',
                            fingerprint: 'x',
                            symbols: ['A', 'B'],
                        },
                    },
                })
            )
        ).toThrow('not comparable');
    });

    it('warns about a dirty checkout, naming its diff hash', () => {
        const report = compareArms(
            arm('before'),
            arm('after', {
                run: { coreGitSha: 'abc+dirty', dirtyDiffSha256: 'deadbeef' },
            })
        );
        expect(report.warnings).toEqual([
            'after ran on a dirty checkout (abc+dirty, diff deadbeef)',
        ]);
        const unhashed = compareArms(
            arm('before', { run: { coreGitSha: 'abc+dirty' } }),
            arm('after')
        );
        expect(unhashed.warnings[0]).toContain('unhashed');
    });

    it('lists the detected candle events per pattern, before and after', () => {
        const report = compareArms(
            arm('before', { candleCount: 24, pattern: 'hammer' }),
            arm('after', { candleCount: 12, pattern: 'hammer' })
        );
        expect(report.candleEventCounts).toEqual([
            { pattern: 'hammer', before: 24, after: 12 },
        ]);
        const gone = compareArms(
            arm('before', { candleCount: 6, pattern: 'doji' }),
            arm('after', { candleCount: 6, pattern: 'hammer' })
        );
        expect(gone.candleEventCounts).toEqual([
            { pattern: 'doji', before: 6, after: 0 },
            { pattern: 'hammer', before: 0, after: 6 },
        ]);
    });

    it('takes G1 from the after arm, scored for its gate', () => {
        const pass = compareArms(
            arm('before', { counters: { wrongSideDays: 5 }, gate: 'geometry' }),
            arm('after', { counters: {}, gate: 'geometry' })
        );
        expect(pass.gates.g1).toMatchObject({ pass: true, gate: 'geometry' });
        const failing = compareArms(
            arm('before', { counters: {} }),
            arm('after', { counters: { wrongSideDays: 1 }, gate: 'geometry' })
        );
        expect(failing.gates.g1.pass).toBe(false);
        expect(failing.gates.g1.after.patterns.wrongSideDays).toBe(1);
        const ungated = compareArms(arm('before'), arm('after'));
        expect(ungated.gates.g1).toMatchObject({ pass: false, gate: null });
    });

    it('flags qualified-instance drops beyond the bound, per family, without failing G2', () => {
        const report = compareArms(
            arm('before', {
                counters: {
                    instances: 100,
                    'instances:bull_flag': 40,
                    'instances:wedge': 60,
                },
            }),
            arm('after', {
                counters: {
                    instances: 70,
                    'instances:bull_flag': 38,
                    'instances:wedge': 32,
                },
            })
        );
        expect(MAX_INSTANCE_DROP).toBe(0.25);
        expect(report.instances?.total.change).toBeCloseTo(-0.3, 12);
        expect(report.instances?.droppedFamilies.map(f => f.family)).toEqual([
            'wedge',
        ]);
        expect(report.gates.g2.instancesWithinBound).toBe(false);
        expect(report.gates.g2.pass).toBe(true);
    });

    it('treats a family with no instances before as an unknown change, and a drop of exactly the bound as within it', () => {
        const report = compareArms(
            arm('before', { counters: { instances: 100, 'instances:a': 0 } }),
            arm('after', { counters: { instances: 75, 'instances:a': 4 } })
        );
        expect(report.instances?.byFamily[0]).toEqual({
            family: 'a',
            before: 0,
            after: 4,
            change: null,
        });
        expect(report.instances?.droppedFamilies).toEqual([]);
        expect(report.gates.g2.instancesWithinBound).toBe(true);
        const noInstances = compareArms(
            arm('before', { counters: {} }),
            arm('after', { counters: { instances: 3 } })
        );
        expect(noInstances.gates.g2.instancesWithinBound).toBeNull();
    });

    it('lists a pattern family delta only when both arms have minFamilyN events', () => {
        const many = (
            id: string,
            count: number,
            hit: 'hit' | 'inval'
        ): EvalEvent[] =>
            spread(count, WEEKS, () => patternEvent({ id, target60: hit }));
        const build = (name: string, events: EvalEvent[]): ArmData => ({
            run: run(name),
            events,
            summary: summarizeArm({
                arm: name,
                weeks: WEEK_LIST,
                gate: null,
                candleEvents: null,
                patternEvents: events.filter(e => e.kind === 'pattern'),
                patternCounters: {},
                caseLines: null,
            }),
        });
        const n = EVAL_CONSTANTS.minFamilyN;
        const report = compareArms(
            build('before', [
                ...many('a', n, 'inval'),
                ...many('b', n - 1, 'inval'),
            ]),
            build('after', [...many('a', n, 'hit'), ...many('b', n, 'hit')])
        );
        expect(report.patterns?.families.map(f => f.family)).toEqual(['a']);
    });
});

function writeRun(runDir: string, data: ArmData): string {
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, 'run.json'), JSON.stringify(data.run));
    writeFileSync(join(runDir, 'summary.json'), JSON.stringify(data.summary));
    writeFileSync(
        join(runDir, 'events.jsonl'),
        data.events.map(e => `${JSON.stringify(e)}\n`).join('')
    );
    return runDir;
}

describe('exitCodeOf', () => {
    it('is 0 only when G1 and G2 both pass, 2 when either fails', () => {
        const pass = compareArms(
            arm('before', { gate: 'geometry' }),
            arm('after', { gate: 'geometry' })
        );
        expect(exitCodeOf(pass)).toBe(0);
        const g1Fails = compareArms(
            arm('before'),
            arm('after', { counters: { wrongSideDays: 1 }, gate: 'geometry' })
        );
        expect(g1Fails.gates.g2.pass).toBe(true);
        expect(exitCodeOf(g1Fails)).toBe(2);
        const g2Fails = compareArms(
            arm('before', { candleY: 3, gate: 'geometry' }),
            arm('after', { candleY: 1, gate: 'geometry' })
        );
        expect(g2Fails.gates.g1.pass).toBe(true);
        expect(exitCodeOf(g2Fails)).toBe(2);
    });
});

describe('compare CLI', () => {
    const temps = new Set<() => void>();
    afterEach(() => {
        [...temps].forEach(remove => remove());
        temps.clear();
    });

    it('requires all three paths', () => {
        expect(() =>
            parseCompareArgs(['--before', 'a', '--after', 'b'])
        ).toThrow('--before, --after and --out are required');
        expect(
            parseCompareArgs(['--before', 'a', '--after', 'b', '--out', 'c'])
        ).toMatchObject({});
    });

    it('reads two run directories and writes compare.json outside the repository', () => {
        const { dir, remove } = makeTempDir();
        temps.add(remove);
        const before = writeRun(
            join(dir, 'before'),
            arm('before', { counters: { instances: 4 }, gate: 'geometry' })
        );
        const after = writeRun(
            join(dir, 'after'),
            arm('after', {
                counters: { instances: 4 },
                gate: 'geometry',
                run: { coreGitSha: 'abc+dirty' },
            })
        );
        const log = vi.fn<(line: string) => void>();
        const report = runCompare(
            { before, after, out: join(dir, 'out') },
            log
        );
        expect(report.gates.g1.pass).toBe(true);
        const lines = log.mock.calls.flat();
        expect(lines.some(line => line.startsWith('G1'))).toBe(true);
        expect(lines.some(line => line.startsWith('WARNING'))).toBe(true);
        expect(readArm(before).events).toHaveLength(48);
        expect(readArm(before).run.arm).toBe('before');
    });

    it('refuses an events file with a row that is not an event', () => {
        const { dir, remove } = makeTempDir();
        temps.add(remove);
        const runDir = writeRun(join(dir, 'bad'), arm('bad'));
        writeFileSync(join(runDir, 'events.jsonl'), '{"kind":"other"}\n');
        expect(() => readArm(runDir)).toThrow(InvalidEventError);
        writeFileSync(join(runDir, 'events.jsonl'), '[1]\n');
        expect(() => readArm(runDir)).toThrow('not a candle or pattern event');
    });

    it('refuses an output path inside the repository', () => {
        expect(() =>
            runCompare(
                {
                    before: 'x',
                    after: 'y',
                    out: join(REPO_ROOT, 'compare-out'),
                },
                () => undefined
            )
        ).toThrow('inside the repository');
    });
});
