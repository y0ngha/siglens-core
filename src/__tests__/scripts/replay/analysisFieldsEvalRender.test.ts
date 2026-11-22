import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    groupOf,
    renderWithCore,
    type RenderInput,
} from '../../../../scripts/replay/analysisFieldsEvalRender';
import type { AssembledPromptRecord } from '@/domain/types';

/**
 * Core is replaced by stubs: what is under test is how the renderer treats the process
 * (cwd, `fetch`, the console, the API key variable) around the call, not the analysis.
 */
type RunAnalysisStub = (
    symbol: string,
    companyName: string,
    timeframe: string,
    force: boolean,
    fmpSymbol: undefined,
    options: { onPromptAssembled: (record: AssembledPromptRecord) => void }
) => Promise<{ status: string }>;

const core = vi.hoisted(() => ({
    runAnalysis: vi.fn<RunAnalysisStub>(),
}));

vi.mock('@/application/market/runAnalysis', () => ({
    runAnalysis: core.runAnalysis,
}));
vi.mock('@/application/chat/constants', () => ({
    DEEPSEEK_V4_1_FLASH_MODEL: 'deepseek-v4.1-flash',
}));
vi.mock('@/infrastructure/skills/loader', () => ({
    loadSkillsCached: async () => ({
        skillsDegraded: false,
        skills: [
            {
                name: 'Core A',
                type: 'indicator_guide',
                gating: { tier: 'always_on' },
                computedCard: 'ma',
            },
            {
                name: 'Smc Full',
                type: 'strategy',
                smcFullGuide: true,
                gating: { tier: 'always_on' },
            },
            {
                name: 'G1',
                category: 'reversal_bullish',
                gating: {
                    tier: 'gated',
                    signalKind: 'event',
                    triggers: ['doji', 'hammer'],
                },
            },
            {
                name: 'State Guide',
                type: 'indicator_guide',
                gating: { tier: 'gated', signalKind: 'state', state: {} },
            },
        ],
    }),
}));
vi.mock('@/domain/analysis/skillWhitelist', () => ({
    isSkillAllowedInContext: () => true,
}));

const originals = {
    fetch: globalThis.fetch,
    info: console.info,
    warn: console.warn,
    error: console.error,
    cwd: process.cwd(),
    key: process.env.DEEPSEEK_API_KEY,
};

let root = '';
beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'render-test-'));
    mkdirSync(join(root, 'app', 'skills'), { recursive: true });
    core.runAnalysis.mockReset();
});
afterEach(() => {
    process.chdir(originals.cwd);
    rmSync(root, { recursive: true, force: true });
    if (originals.key === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = originals.key;
});

const input = (): RenderInput => ({
    skillsDir: join(root, 'app', 'skills'),
    cases: [
        {
            caseId: 'NVDA|2024-03-08',
            symbol: 'NVDA',
            timeframe: '1Day',
            asOf: '2024-03-08',
            regime: 'range',
            variance: false,
        },
    ],
    storedOf: symbol => ({
        ticker: symbol,
        companyName: `${symbol} Inc`,
        fetchedAt: 'x',
        from: '2024-01-01',
        to: '2024-03-08',
        bars: [],
    }),
    log: () => undefined,
});

/** The process state the renderer touches, as it is right now. */
const processState = () => ({
    fetch: globalThis.fetch,
    info: console.info,
    warn: console.warn,
    error: console.error,
    key: process.env.DEEPSEEK_API_KEY,
});

describe('groupOf', () => {
    it('is the type, else the category, else regular', () => {
        expect(
            groupOf({ type: 'strategy', category: 'reversal_bullish' })
        ).toBe('strategy');
        expect(groupOf({ category: 'reversal_bullish' })).toBe(
            'reversal_bullish'
        );
        expect(groupOf({})).toBe('regular');
    });
});

describe('renderWithCore', () => {
    it('puts fetch, the console and the key variable back when a case fails to assemble a prompt', async () => {
        core.runAnalysis.mockResolvedValue({ status: 'error' });
        const before = processState();
        await expect(renderWithCore(input())).rejects.toThrow(
            'NVDA|2024-03-08 (free): no prompt was assembled'
        );
        expect(processState()).toEqual(before);
    });

    it('puts them back when the analysis throws, and that error is the one reported', async () => {
        core.runAnalysis.mockImplementation(() => {
            throw new Error('boom');
        });
        const before = processState();
        await expect(renderWithCore(input())).rejects.toThrow('boom');
        expect(processState()).toEqual(before);
    });

    it('blocks the network and mutes the console only while rendering', async () => {
        const during: { fetchThrows: boolean; muted: boolean; key: boolean }[] =
            [];
        core.runAnalysis.mockImplementation(
            async (_symbol, _name, _timeframe, _force, _fmp, options) => {
                during.push({
                    fetchThrows: (() => {
                        try {
                            void globalThis.fetch('https://example.test');
                            return false;
                        } catch {
                            return true;
                        }
                    })(),
                    muted: console.info !== originals.info,
                    key: process.env.DEEPSEEK_API_KEY !== undefined,
                });
                options.onPromptAssembled({
                    system: 's',
                    stable: '### Core A (guide)',
                    dynamic: '### G1 (guide)',
                    promptVersion: 'p34',
                });
                return { status: 'error' };
            }
        );
        const before = processState();
        const rendered = await renderWithCore(input());
        expect(during).toEqual([
            { fetchThrows: true, muted: true, key: true },
            { fetchThrows: true, muted: true, key: true },
        ]);
        expect(processState()).toEqual(before);
        expect(rendered.samples.map(s => s.tier)).toEqual(['free', 'member']);
        expect(rendered.catalog).toEqual([
            {
                name: 'Core A',
                group: 'indicator_guide',
                alwaysOn: true,
                injected: true,
                computedCard: 'ma',
            },
            {
                name: 'Smc Full',
                group: 'strategy',
                alwaysOn: true,
                injected: false,
            },
            {
                name: 'G1',
                group: 'reversal_bullish',
                alwaysOn: false,
                injected: true,
                triggers: ['doji', 'hammer'],
            },
            {
                name: 'State Guide',
                group: 'indicator_guide',
                alwaysOn: false,
                injected: true,
                computedCard: undefined,
            },
        ]);
    });

    it('renders only the tiers asked for', async () => {
        core.runAnalysis.mockImplementation(
            async (_symbol, _name, _timeframe, _force, _fmp, options) => {
                options.onPromptAssembled({
                    system: 's',
                    stable: 'a',
                    dynamic: 'b',
                    promptVersion: 'p34',
                });
                return { status: 'error' };
            }
        );
        const rendered = await renderWithCore({
            ...input(),
            tiers: ['member'],
        });
        expect(rendered.samples.map(s => s.tier)).toEqual(['member']);
        expect(core.runAnalysis).toHaveBeenCalledTimes(1);
    });

    it('carries the computed cards of an assembled prompt, and none when it has none', async () => {
        const assembled = {
            system: 's',
            stable: 'a',
            dynamic: 'b',
            promptVersion: 'p34',
        } satisfies AssembledPromptRecord;
        // Typed fields of `AssembledPromptRecord`: renaming one on core breaks this build, so the
        // instrument cannot silently read `undefined` (the pin of the typed read).
        const indicatorCards = [
            { indicatorName: 'MA Signal Guide', signals: [] },
        ] satisfies AssembledPromptRecord['indicatorCards'];
        core.runAnalysis.mockImplementationOnce(
            async (_symbol, _name, _timeframe, _force, _fmp, options) => {
                options.onPromptAssembled({
                    ...assembled,
                    indicatorCards,
                    cycleCards: [],
                });
                return { status: 'error' };
            }
        );
        core.runAnalysis.mockImplementationOnce(
            async (_symbol, _name, _timeframe, _force, _fmp, options) => {
                options.onPromptAssembled(assembled);
                return { status: 'error' };
            }
        );
        const rendered = await renderWithCore(input());
        expect(rendered.samples[0].cards).toEqual({
            indicator: indicatorCards,
            cycle: [],
        });
        expect(rendered.samples[1].cards).toBeNull();
    });
});

describe('renderWithCore: timeframe and benchmarks', () => {
    const assembled = (options: {
        onPromptAssembled: (r: AssembledPromptRecord) => void;
    }): { status: string } => {
        options.onPromptAssembled({
            system: 's',
            stable: 'a',
            dynamic: 'b',
            promptVersion: 'p',
        });
        return { status: 'error' };
    };

    it('analyses at 1Day unless a timeframe is given, and at the given one otherwise', async () => {
        core.runAnalysis.mockImplementation(
            async (_s, _n, _t, _f, _x, options) => assembled(options)
        );
        await renderWithCore(input());
        expect(core.runAnalysis.mock.calls.map(c => c[2])).toEqual([
            '1Day',
            '1Day',
        ]);
        core.runAnalysis.mockClear();
        await renderWithCore({ ...input(), timeframe: '1Hour' });
        expect(core.runAnalysis.mock.calls.map(c => c[2])).toEqual([
            '1Hour',
            '1Hour',
        ]);
    });

    it("passes the benchmark of the case's market only when its bars are held, and serves them behind the asOf barrier", async () => {
        const served: { symbol: string; times: number[] }[] = [];
        core.runAnalysis.mockImplementation(
            async (_s, _n, _t, _f, _x, options) => {
                const provider = (
                    options as unknown as {
                        marketDataProvider: {
                            getBars: (o: {
                                symbol: string;
                                timeframe: string;
                            }) => Promise<{ time: number }[]>;
                        };
                    }
                ).marketDataProvider;
                served.push({
                    symbol: 'SPY',
                    times: (
                        await provider.getBars({
                            symbol: 'SPY',
                            timeframe: '1Day',
                        })
                    ).map(b => b.time),
                });
                return assembled(options);
            }
        );
        const bar = (iso: string) => ({
            time: Date.parse(`${iso}T00:00:00Z`) / 1000,
            open: 1,
            high: 2,
            low: 1,
            close: 1,
            volume: 1,
        });
        const benchmarks = new Map([
            ['SPY', [bar('2024-03-07'), bar('2024-03-08'), bar('2024-03-11')]],
        ]);
        await renderWithCore({ ...input(), benchmarks });
        expect(served[0].times).toEqual([
            bar('2024-03-07').time,
            bar('2024-03-08').time,
        ]);
        const options = core.runAnalysis.mock.calls.map(
            c => c[5] as unknown as { benchmark?: { symbol: string } }
        );
        expect(options.every(o => o.benchmark?.symbol === 'SPY')).toBe(true);
        core.runAnalysis.mockClear();
        core.runAnalysis.mockImplementation(
            async (_s, _n, _t, _f, _x, options) => assembled(options)
        );
        await renderWithCore({ ...input(), benchmarks: new Map() });
        expect(
            core.runAnalysis.mock.calls.every(
                c =>
                    (c[5] as unknown as { benchmark?: unknown }).benchmark ===
                    undefined
            )
        ).toBe(true);
    });
});
