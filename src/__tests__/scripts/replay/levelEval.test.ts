import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { writeSet } from '../../../../scripts/replay/buildSet';
import { REPO_ROOT } from '../../../../scripts/replay/fsUtil';
import {
    defaultDeps,
    levelGates,
    parseLevelEvalArgs,
    runLevelEval,
    type GateInput,
    type LevelEvalArgs,
} from '../../../../scripts/replay/levelEval';
import { L0_REFERENCE } from '../../../../scripts/replay/levelEvalTypes';
import { makeTempDir, tradingBars, writeBarsDir } from './replayFixtures';

const force = vi.hoisted(() => ({ on: false }));

// The real labeller, unless a test forces it to disagree with the instrument's evaluator.
vi.mock('@/domain/outcomes/labelLevelOutcome', async importOriginal => {
    const actual =
        await importOriginal<
            typeof import('@/domain/outcomes/labelLevelOutcome')
        >();
    return {
        ...actual,
        labelLevelOutcome: (
            ...args: Parameters<typeof actual.labelLevelOutcome>
        ) => {
            const label = actual.labelLevelOutcome(...args);
            return force.on && label.outcome === 'respected'
                ? { ...label, outcome: 'broken' as const }
                : label;
        },
    };
});

const temps = new Set<() => void>();
afterEach(() => {
    force.on = false;
    [...temps].forEach(remove => remove());
    temps.clear();
});

function makeSet(): { dir: string; setDir: string } {
    const { dir, remove } = makeTempDir();
    temps.add(remove);
    const symbols = ['NVDA', '005930.KS'];
    writeBarsDir(
        join(dir, 'src'),
        symbols.map(symbol => ({
            symbol,
            bars: tradingBars({
                symbol,
                startIso: '2018-01-02',
                count: 700,
                close: i =>
                    100 +
                    0.05 * i +
                    12 * Math.sin(i / 5) +
                    4 * Math.sin(i / 1.7),
            }),
        }))
    );
    const setDir = join(dir, 'set');
    writeSet(join(dir, 'src'), setDir, {
        createdAt: 'x',
        allowPartial: true,
        force: false,
    });
    return { dir, setDir };
}

const deps = (log = vi.fn<(line: string) => void>()) => ({
    log,
    gitSha: () => 'abc123+dirty',
    dirtyDiffSha256: () => 'f'.repeat(64),
});

const argsOf = (over: Partial<LevelEvalArgs>): LevelEvalArgs => ({
    set: '',
    out: '',
    arm: 'test',
    step: 60,
    symbols: null,
    gate: null,
    ...over,
});

const readJson = (path: string): Record<string, unknown> =>
    JSON.parse(readFileSync(path, 'utf-8'));

describe('parseLevelEvalArgs', () => {
    it('needs --set and --out and validates the step', () => {
        expect(() => parseLevelEvalArgs(['--out', 'o'])).toThrow(
            '--set is required'
        );
        expect(() => parseLevelEvalArgs(['--set', 's'])).toThrow(
            '--out is required'
        );
        expect(() =>
            parseLevelEvalArgs(['--set', 's', '--out', 'o', '--step', '0'])
        ).toThrow('--step must be a positive integer');
    });

    it('reads the options and resolves paths', () => {
        const parsed = parseLevelEvalArgs([
            '--set',
            's',
            '--out',
            'o',
            '--step',
            '5',
            '--arm',
            'x',
            '--symbols',
            'A,B',
            '--gate',
            'L0,G42',
        ]);
        expect(parsed).toMatchObject({
            step: 5,
            arm: 'x',
            symbols: ['A', 'B'],
            gate: ['L0', 'G42'],
        });
        expect(parsed.set).toMatch(/\/s$/);
        expect(
            parseLevelEvalArgs(['--set', 's', '--out', 'o', '--gate', 'all'])
                .gate
        ).toEqual(['L0', 'L-gate', 'G42']);
        expect(parseLevelEvalArgs(['--set', 's', '--out', 'o'])).toMatchObject({
            step: 3,
            arm: 'unnamed',
            symbols: null,
            gate: null,
        });
    });

    it('refuses an unknown gate id', () => {
        expect(() =>
            parseLevelEvalArgs(['--set', 's', '--out', 'o', '--gate', 'Z9'])
        ).toThrow('--gate ids must be among L0, L-gate, G42');
    });
});

const gateInput = (over: Partial<GateInput> = {}): GateInput => ({
    isReferencePopulation: true,
    held: L0_REFERENCE.held,
    transplantHeld: L0_REFERENCE.transplantHeld,
    aucTest: L0_REFERENCE.auc,
    topMinusTransplant: { mean: L0_REFERENCE.topMinusTransplant, low: -0.024 },
    topByMarket: { us: -0.01, kr: 0.02 },
    topByHalf: { first: -0.003, second: -0.01 },
    labelDisagreements: 0,
    nonPositiveTotal: 0,
    measurableDays: 100,
    ...over,
});

const gateOf = (input: GateInput, id: string) =>
    levelGates(input).find(g => g.id === id);

describe('levelGates', () => {
    it('L0 passes when every figure is within the tolerance of WP-18 section 1', () => {
        expect(gateOf(gateInput(), 'L0')?.pass).toBe(true);
        expect(
            gateOf(gateInput({ held: L0_REFERENCE.held + 0.0019 }), 'L0')?.pass
        ).toBe(true);
    });

    it('L0 fails when one figure drifts past the tolerance', () => {
        expect(
            gateOf(gateInput({ held: L0_REFERENCE.held + 0.0025 }), 'L0')?.pass
        ).toBe(false);
        expect(gateOf(gateInput({ aucTest: 0.53 }), 'L0')?.pass).toBe(false);
    });

    it('L0 is not computable for another population or a missing figure', () => {
        expect(
            gateOf(gateInput({ isReferencePopulation: false }), 'L0')?.pass
        ).toBeNull();
        expect(gateOf(gateInput({ aucTest: null }), 'L0')?.pass).toBeNull();
        expect(
            gateOf(gateInput({ topMinusTransplant: null }), 'L0')?.pass
        ).toBeNull();
    });

    it('L0 is not computable when the instrument disagrees with the labeller', () => {
        const gate = gateOf(gateInput({ labelDisagreements: 3 }), 'L0');
        expect(gate?.pass).toBeNull();
        expect(gate?.value).toContain('3 real levels are labelled differently');
    });

    it('L-gate needs a positive lower bound and positive points in every market and half', () => {
        // Today: -0.6 pp (-2.4..+1.3): no score ships.
        expect(gateOf(gateInput(), 'L-gate')?.pass).toBe(false);
        const good = gateInput({
            topMinusTransplant: { mean: 0.02, low: 0.005 },
            topByMarket: { us: 0.01, kr: 0.03 },
            topByHalf: { first: 0.02, second: 0.01 },
        });
        expect(gateOf(good, 'L-gate')?.pass).toBe(true);
        expect(
            gateOf({ ...good, topByMarket: { us: 0.01, kr: -0.001 } }, 'L-gate')
                ?.pass
        ).toBe(false);
        expect(
            gateOf(
                { ...good, topByHalf: { first: null, second: 0.01 } },
                'L-gate'
            )?.pass
        ).toBeNull();
        expect(
            gateOf({ ...good, topMinusTransplant: null }, 'L-gate')?.pass
        ).toBeNull();
    });

    it('G42 passes only with no non-positive level and at least one measured day', () => {
        expect(gateOf(gateInput(), 'G42')?.pass).toBe(true);
        expect(gateOf(gateInput({ nonPositiveTotal: 3 }), 'G42')?.pass).toBe(
            false
        );
        expect(
            gateOf(gateInput({ measurableDays: 0 }), 'G42')?.pass
        ).toBeNull();
    });
});

describe('runLevelEval', () => {
    it('writes the run, the summary and the gates, and exits 0 without --gate', () => {
        const { dir, setDir } = makeSet();
        const out = join(dir, 'out');
        const log = vi.fn<(line: string) => void>();
        const code = runLevelEval(argsOf({ set: setDir, out }), deps(log));
        expect(code).toBe(0);
        const run = readJson(join(out, 'run.json'));
        expect(run).toMatchObject({
            tool: 'levelEval',
            arm: 'test',
            coreGitSha: 'abc123+dirty',
            step: 60,
            referencePopulation: false,
        });
        const summary = readJson(join(out, 'summary.json'));
        expect(summary).toMatchObject({
            scope: { timeframe: '1Day', symbols: 2 },
            labelAgreement: { disagreements: 0 },
        });
        expect(Object.keys(summary)).toEqual(
            expect.arrayContaining([
                'overall',
                'tables',
                'score',
                'robust',
                'structural',
                'nonPositive',
                'gates',
            ])
        );
        const lines = log.mock.calls.map(([l]) => l).join('\n');
        expect(lines).toContain('NOTICE: no --gate given');
        expect(lines).toContain('L0 NOT COMPUTABLE');
    });

    it('warns and leaves L0 not computable when the labeller and the evaluator disagree', () => {
        const { dir, setDir } = makeSet();
        const out = join(dir, 'out');
        const log = vi.fn<(line: string) => void>();
        force.on = true;
        runLevelEval(argsOf({ set: setDir, out }), deps(log));
        const summary = readJson(join(out, 'summary.json'));
        const agreement = summary.labelAgreement;
        expect(
            typeof agreement === 'object' &&
                agreement !== null &&
                'disagreements' in agreement &&
                typeof agreement.disagreements === 'number' &&
                agreement.disagreements > 0
        ).toBe(true);
        expect(log.mock.calls.map(([l]) => l).join('\n')).toContain('WARNING:');
        expect(
            runLevelEval(
                argsOf({ set: setDir, out: join(dir, 'g'), gate: ['L0'] }),
                deps()
            )
        ).toBe(2);
    });

    it('is byte-identical on the same input', () => {
        const { dir, setDir } = makeSet();
        runLevelEval(argsOf({ set: setDir, out: join(dir, 'a') }), deps());
        runLevelEval(argsOf({ set: setDir, out: join(dir, 'b') }), deps());
        expect(readFileSync(join(dir, 'a', 'summary.json'), 'utf-8')).toBe(
            readFileSync(join(dir, 'b', 'summary.json'), 'utf-8')
        );
    });

    it('exits 2 when a selected gate cannot be computed or fails, 0 when it passes', () => {
        const { dir, setDir } = makeSet();
        expect(
            runLevelEval(
                argsOf({ set: setDir, out: join(dir, 'l0'), gate: ['L0'] }),
                deps()
            )
        ).toBe(2);
        expect(
            runLevelEval(
                argsOf({ set: setDir, out: join(dir, 'g42'), gate: ['G42'] }),
                deps()
            )
        ).toBe(0);
    });

    it('exits 2 for every selected gate set that holds a gate which is not computable, whatever passes beside it', () => {
        const { dir, setDir } = makeSet();
        // G42 passes on this set; L0 is not computable (step 60 is not the reference population).
        expect(
            runLevelEval(
                argsOf({
                    set: setDir,
                    out: join(dir, 'mixed'),
                    gate: ['G42', 'L0'],
                }),
                deps()
            )
        ).toBe(2);
        expect(
            runLevelEval(
                argsOf({
                    set: setDir,
                    out: join(dir, 'all'),
                    gate: ['L0', 'L-gate', 'G42'],
                }),
                deps()
            )
        ).toBe(2);
        // Not selected: the same not-computable L0 no longer decides the exit code.
        expect(
            runLevelEval(
                argsOf({ set: setDir, out: join(dir, 'g42'), gate: ['G42'] }),
                deps()
            )
        ).toBe(0);
    });

    it('exits 2 on the L0 gate when the labeller and the evaluator disagree, even with G42 selected beside it', () => {
        const { dir, setDir } = makeSet();
        force.on = true;
        expect(
            runLevelEval(
                argsOf({
                    set: setDir,
                    out: join(dir, 'disagree'),
                    gate: ['G42', 'L0'],
                }),
                deps()
            )
        ).toBe(2);
    });

    it('narrows to the symbols asked for, and refuses an unknown or empty list', () => {
        const { dir, setDir } = makeSet();
        runLevelEval(
            argsOf({ set: setDir, out: join(dir, 'one'), symbols: ['NVDA'] }),
            deps()
        );
        expect(readJson(join(dir, 'one', 'summary.json'))).toMatchObject({
            scope: { symbols: 1 },
        });
        expect(() =>
            runLevelEval(
                argsOf({ set: setDir, out: join(dir, 'x'), symbols: ['NOPE'] }),
                deps()
            )
        ).toThrow('--symbols not in the data: NOPE');
    });

    it('refuses an output path inside the repository and a set whose bars changed', () => {
        const { dir, setDir } = makeSet();
        expect(() =>
            runLevelEval(
                argsOf({ set: setDir, out: join(REPO_ROOT, 'level-eval-out') }),
                deps()
            )
        ).toThrow('is inside the repository');
        const tampered = join(setDir, 'bars', 'NVDA.json');
        // Same JSON, different bytes: the hash in the manifest must catch it.
        writeFileSync(
            tampered,
            readFileSync(tampered, 'utf-8').replace('"close":', '"close": ')
        );
        expect(() =>
            runLevelEval(argsOf({ set: setDir, out: join(dir, 'y') }), deps())
        ).toThrow('set hash mismatch');
    });

    it('fails when a bars file is too short to hold a study day', () => {
        const { dir, remove } = makeTempDir();
        temps.add(remove);
        writeBarsDir(join(dir, 'src'), [
            {
                symbol: 'NVDA',
                bars: tradingBars({
                    symbol: 'NVDA',
                    startIso: '2020-01-02',
                    count: 320,
                }),
            },
        ]);
        const setDir = join(dir, 'set');
        writeSet(join(dir, 'src'), setDir, {
            createdAt: 'x',
            allowPartial: true,
            force: false,
        });
        expect(() =>
            runLevelEval(argsOf({ set: setDir, out: join(dir, 'o') }), deps())
        ).toThrow('measured no day or no level');
    });
});

describe('defaultDeps', () => {
    it('names the checkout by its commit', () => {
        expect(defaultDeps.gitSha()).toMatch(/^[0-9a-f]{40}(\+dirty)?$/);
    });
});
