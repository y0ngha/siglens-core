/**
 * Markdown report of a labelled replay run.
 *
 * Usage:
 *   npx tsx scripts/replay/report.ts --run <run-dir> [--compare <run-dir>] [--noise <run-dir>] [--out report.md]
 *
 * Reads `<run>/labels.jsonl` (written by `label.ts`). Every rate is printed with its `n`
 * and split by the plan's recommendation; see `reportCompute.ts` for what enters a
 * headline number. `--compare B` pairs the two runs by case and repeat and prints the
 * flips per label and the paired difference of each rate. The noise floor is the pairwise
 * flip rate of the run's own repeats (a variance run); `--noise <run>` takes the flip
 * rates from another run instead (for a full replay with one repeat per case). A
 * difference smaller than the flip rate of its label is printed as "within run-to-run
 * noise"; with no repeats anywhere the report says the noise floor is unknown.
 */
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from '../ab-harness/cliArgs';
import { OUTCOME_HORIZON_BARS } from '@/domain/outcomes/constants';
import {
    assertOutsideRepo,
    readJson,
    readLabelRows,
    writeFileAtomic,
} from './fsUtil';
import {
    FLIP_LABELS,
    FULL_GROUPS,
    MARGINAL_GROUPS,
    PLACEBO_SHIFTS,
    PLAN_OUTCOMES,
    bucketOf,
    collectWarnings,
    compareRuns,
    computeFlipRates,
    headlineRows,
    noiseVerdict,
    summarizeCounts,
    summarizeForward,
    summarizeInvariants,
    summarizeLevels,
    summarizePatterns,
    summarizePlans,
    summarizeProvenance,
    summarizeVariance,
    verdictOf,
    type FlipLabel,
    type FlipRates,
    type Group,
    type MeanStat,
    type Rate,
} from './reportCompute';
import { VERDICTS, type LabelRow, type RunMeta, type Verdict } from './types';

// ─── Formatting ───────────────────────────────────────────────────────────────
const EMPTY = '–';

const signed = (value: number, digits: number): string =>
    `${value >= 0 ? '+' : ''}${value.toFixed(digits)}`;

export function pct(share: number | null, digits = 1): string {
    return share === null ? EMPTY : `${(share * 100).toFixed(digits)}%`;
}

/** `k/n (p%)`, or `– (n=0)` for an empty denominator. */
export function rateCell(r: Rate): string {
    return r.n === 0 ? `${EMPTY} (n=0)` : `${r.count}/${r.n} (${pct(r.share)})`;
}

/** `+1.23% ±0.45 (n=12)`; the standard error only with two or more values. */
export function meanCell(m: MeanStat, unit = '%'): string {
    if (m.mean === null) return `${EMPTY} (n=${m.n})`;
    const se = m.se === null ? '' : ` ±${m.se.toFixed(2)}`;
    return `${signed(m.mean, 2)}${unit}${se} (n=${m.n})`;
}

const NOTE: Record<'within_noise' | 'unknown', string> = {
    within_noise: ' (within run-to-run noise)',
    unknown: ' (noise floor unknown)',
};

/** A difference of two shares in percentage points, with the noise note for `label`. */
export function diffCell(
    diff: number | null,
    flips: FlipRates | null,
    label: FlipLabel | null
): string {
    if (diff === null) return EMPTY;
    const verdict = noiseVerdict(
        diff,
        flips === null || label === null ? null : flips[label].rate
    );
    return `${signed(diff * 100, 1)}pp${verdict === 'above_noise' ? '' : NOTE[verdict]}`;
}

/**
 * A model-minus-null (or real-minus-placebo) difference in percentage points with its
 * sampling standard error (sample SD over √n) and n. It is a sampling error that treats the
 * cases as independent; it is not compared with the run-to-run flip rate, which measures
 * something else.
 */
export function diffStatCell(stat: MeanStat): string {
    if (stat.mean === null) return `${EMPTY} (n=${stat.n})`;
    const se = stat.se === null ? '' : ` ±${(stat.se * 100).toFixed(1)}`;
    return `${signed(stat.mean * 100, 1)}pp${se} (n=${stat.n})`;
}

function table(
    headers: readonly string[],
    rows: readonly (readonly string[])[]
): string {
    const line = (cells: readonly string[]): string =>
        `| ${cells.join(' | ')} |`;
    return [
        line(headers),
        line(headers.map(() => '---')),
        ...rows.map(line),
    ].join('\n');
}

interface Cell {
    group: string;
    verdict: Verdict;
    rows: readonly LabelRow[];
}

/** Non-empty (group, verdict) cells of the headline rows, groups in the given order. */
function cellsOf(
    rows: readonly LabelRow[],
    groups: readonly Group[]
): readonly Cell[] {
    const headline = headlineRows(rows);
    return groups
        .flatMap(group =>
            VERDICTS.map(verdict => ({
                group: group.name,
                verdict,
                rows: headline.filter(
                    row => group.matches(row) && verdictOf(row) === verdict
                ),
            }))
        )
        .filter(cell => cell.rows.length > 0);
}

// ─── Sections ─────────────────────────────────────────────────────────────────
function noiseSection(flips: FlipRates | null, source: string): string {
    const known =
        flips !== null && FLIP_LABELS.some(label => flips[label].n > 0);
    if (!known) {
        return [
            '## Run-to-run noise (used by the comparison section)',
            '',
            `Noise floor unknown: no case has two or more runs in ${source}. A run-to-run difference in the comparison section is not shown as significant or insignificant; run the variance subset with --repeat 3 and pass it as --noise.`,
        ].join('\n');
    }
    return [
        '## Run-to-run noise (used by the comparison section)',
        '',
        `Pairwise flip rate per label, measured on the repeated runs in ${source}. A difference between two runs (--compare) smaller than the flip rate of its label is printed as "within run-to-run noise".`,
        '',
        table(
            ['label', 'flips', 'comparisons n', 'flip rate'],
            FLIP_LABELS.map(label => [
                label,
                String(flips[label].flips),
                String(flips[label].n),
                pct(flips[label].rate),
            ])
        ),
    ].join('\n');
}

function warningsSection(rows: readonly LabelRow[]): string {
    const w = collectWarnings(rows);
    const lines = [
        w.generatedAt > 0
            ? `WARNING: ${w.generatedAt} rows are anchored on the generation time (anchorSource generated_at); in a replay every anchor is a closed asOf bar, so this should be 0. They are excluded from every headline number.`
            : null,
        w.anchorBarUnobserved > 0
            ? `WARNING: ${w.anchorBarUnobserved} rows have an unobserved anchor bar (anchorBarUnobserved); in a replay this should be 0. They are excluded from every headline number.`
            : null,
        w.dataAsOfMismatch > 0
            ? `WARNING: ${w.dataAsOfMismatch} results name a dataAsOf bar other than the case's asOf bar: the clock or the stored bars were wrong for them.`
            : null,
    ].filter((line): line is string => line !== null);
    return [
        '## Checks',
        '',
        `Excluded bucket (generated_at or unobserved anchor): ${w.excluded} rows. Expected 0 in a replay.`,
        '',
        ...(lines.length === 0 ? ['No warnings.'] : lines),
    ].join('\n');
}

function countsSection(rows: readonly LabelRow[]): string {
    return [
        '## 1. Rows, failures and missing plans',
        '',
        'Failed: the model call failed or returned nothing. Unlabelled: the result could not be labelled (invalid analysis or no usable window). Missing plan: the analysis carried no recommendation at all.',
        '',
        table(
            [
                'group',
                'rows n',
                'failed',
                'unlabelled',
                'excluded',
                'headline',
                'missing plan (of headline)',
            ],
            FULL_GROUPS.flatMap(group => {
                const own = rows.filter(group.matches);
                if (own.length === 0) return [];
                const c = summarizeCounts(own);
                return [
                    [
                        group.name,
                        String(c.rows),
                        rateCell(c.failed),
                        rateCell(c.unlabelled),
                        rateCell(c.excluded),
                        rateCell(c.headline),
                        rateCell(c.missingPlan),
                    ],
                ];
            })
        ),
    ].join('\n');
}

function outcomeSection(rows: readonly LabelRow[]): string {
    const cells = cellsOf(rows, FULL_GROUPS);
    const share = (count: number, n: number): string =>
        n === 0 ? EMPTY : `${count} (${pct(count / n, 0)})`;
    return [
        '## 2. Plan outcomes',
        '',
        'Per group and plan recommendation, headline rows. Cells are `count (share of n)`.',
        '',
        table(
            ['group', 'verdict', 'n', ...PLAN_OUTCOMES],
            cells.map(cell => {
                const s = summarizePlans(cell.rows);
                return [
                    cell.group,
                    cell.verdict,
                    String(s.n),
                    ...PLAN_OUTCOMES.map(o => share(s.outcomes[o], s.n)),
                ];
            })
        ),
    ].join('\n');
}

function targetSection(rows: readonly LabelRow[]): string {
    const cells = cellsOf(rows, FULL_GROUPS);
    return [
        '## 3. target_first against the random-walk null',
        '',
        'Compared over ALL triggered plans (target_first, stop_first, ambiguous, open_at_horizon): the null has no horizon, so open and ambiguous plans stay in the denominator. not_triggered, void_at_entry and no_plan are shown apart and never counted as wins. The difference is the mean of `1[target_first] − rwNullTargetFirst` over the triggered plans, with its sampling standard error (cases treated as independent).',
        '',
        table(
            [
                'group',
                'verdict',
                'triggered n',
                'target_first',
                'null (mean rwNullTargetFirst)',
                'difference ± se',
                'not_triggered',
                'void_at_entry',
                'no_plan',
            ],
            cells.map(cell => {
                const s = summarizePlans(cell.rows);
                return [
                    cell.group,
                    cell.verdict,
                    String(s.targetFirst.n),
                    rateCell(s.targetFirst),
                    meanCell(s.nullMean, ''),
                    diffStatCell(s.diffStat),
                    rateCell({
                        count: s.outcomes.not_triggered,
                        n: s.n,
                        share:
                            s.n === 0 ? null : s.outcomes.not_triggered / s.n,
                    }),
                    rateCell({
                        count: s.outcomes.void_at_entry,
                        n: s.n,
                        share:
                            s.n === 0 ? null : s.outcomes.void_at_entry / s.n,
                    }),
                    rateCell({
                        count: s.outcomes.no_plan,
                        n: s.n,
                        share: s.n === 0 ? null : s.outcomes.no_plan / s.n,
                    }),
                ];
            })
        ),
        '',
        '### Plan exit returns',
        '',
        'Mean return of exits (target_first, stop_first, open_at_horizon) and its excess over the same-symbol mean return of the same length (exposure-matched). Gap exits (a bar that opened through the level) are shown apart from level exits.',
        '',
        table(
            [
                'group',
                'verdict',
                'return, level exits',
                'return, gap exits',
                'excess, level exits',
                'excess, gap exits',
            ],
            cells.map(cell => {
                const s = summarizePlans(cell.rows);
                return [
                    cell.group,
                    cell.verdict,
                    meanCell(s.returnNonGap),
                    meanCell(s.returnGap),
                    meanCell(s.excessNonGap),
                    meanCell(s.excessGap),
                ];
            })
        ),
        '',
        '### Why a plan was not evaluated or voided (headline rows, per verdict)',
        '',
        table(
            ['verdict', 'outcome:reason', 'n'],
            VERDICTS.flatMap(verdict =>
                Object.entries(
                    summarizePlans(
                        headlineRows(rows).filter(
                            row => verdictOf(row) === verdict
                        )
                    ).reasons
                )
                    .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
                    .map(([key, count]) => [verdict, key, String(count)])
            )
        ),
    ].join('\n');
}

function levelSection(rows: readonly LabelRow[]): string {
    const cells = cellsOf(rows, FULL_GROUPS);
    return [
        '## 4. Levels against the placebo',
        '',
        'respected / evaluated levels, compared with the same level moved by the shift (in ATR units; + is farther from the price) only where both the real level and the placebo were evaluated (neither skipped). The placebo list is the base rate: a level set is informative only if it beats it. `resolved` counts touches that were respected or broken.',
        '',
        table(
            [
                'group',
                'verdict',
                'shift',
                'pairs n',
                'real respected',
                'placebo respected',
                'difference ± se',
                'real resolved: respected',
                'placebo resolved: respected',
                'real broken by gap',
            ],
            cells.flatMap(cell =>
                PLACEBO_SHIFTS.flatMap(shift => {
                    const s = summarizeLevels(cell.rows, shift);
                    if (s.pairs === 0) return [];
                    return [
                        [
                            cell.group,
                            cell.verdict,
                            signed(shift, 1),
                            String(s.pairs),
                            rateCell({
                                count: s.real.respected,
                                n: s.pairs,
                                share: s.real.respected / s.pairs,
                            }),
                            rateCell({
                                count: s.placebo.respected,
                                n: s.pairs,
                                share: s.placebo.respected / s.pairs,
                            }),
                            diffStatCell(s.diffStat),
                            rateCell({
                                count: s.real.respected,
                                n: s.real.resolved,
                                share:
                                    s.real.resolved === 0
                                        ? null
                                        : s.real.respected / s.real.resolved,
                            }),
                            rateCell({
                                count: s.placebo.respected,
                                n: s.placebo.resolved,
                                share:
                                    s.placebo.resolved === 0
                                        ? null
                                        : s.placebo.respected /
                                          s.placebo.resolved,
                            }),
                            String(s.real.brokenByGap),
                        ],
                    ];
                })
            )
        ),
    ].join('\n');
}

function patternSection(rows: readonly LabelRow[]): string {
    const cells = cellsOf(rows, FULL_GROUPS);
    return [
        '## 5. Patterns',
        '',
        'Per detected pattern. Raced = a breakout happened and the target / invalidation race ran; target_first is compared with the mean no-horizon null over all raced patterns that have an invalidation. `target_reached` (already at the target when analysed) and `target_reached_on_breakout` are separate skip reasons.',
        '',
        table(
            [
                'group',
                'verdict',
                'patterns n',
                'geometry_invalid',
                'target_reached',
                'target_reached_on_breakout',
                'no_breakout',
                'invalidated_before_breakout',
                'raced n',
                'target_first',
                'null',
                'difference ± se',
                'gap exits',
            ],
            cells.flatMap(cell => {
                const s = summarizePatterns(cell.rows);
                if (s.n === 0) return [];
                return [
                    [
                        cell.group,
                        cell.verdict,
                        String(s.n),
                        String(s.skipReasons.geometry_invalid),
                        String(s.skipReasons.target_reached),
                        String(s.skipReasons.target_reached_on_breakout),
                        String(s.outcomes.no_breakout),
                        String(s.outcomes.invalidated_before_breakout),
                        String(s.raced),
                        rateCell(s.targetFirst),
                        meanCell(s.nullMean, ''),
                        diffStatCell(s.diffStat),
                        String(s.gapExits),
                    ],
                ];
            })
        ),
    ].join('\n');
}

function forwardSection(rows: readonly LabelRow[]): string {
    const cells = cellsOf(rows, MARGINAL_GROUPS);
    return [
        '## 6. Forward returns against the baselines',
        '',
        "Mean return `h` bars after the analysis, minus (a) the mean `h`-bar return of the symbol over the window's own closes and (b) the symbol's mean `h`-bar return over its whole bars file (the audit-style period baseline). Standard error is of the mean of the per-case excess.",
        '',
        table(
            [
                'group',
                'verdict',
                'h',
                'return',
                'excess over window baseline',
                'excess over period baseline',
            ],
            cells.flatMap(cell =>
                OUTCOME_HORIZON_BARS.map(h => {
                    const s = summarizeForward(cell.rows, h);
                    return [
                        cell.group,
                        cell.verdict,
                        String(h),
                        meanCell(s.returns),
                        meanCell(s.excessWindow),
                        meanCell(s.excessPeriod),
                    ];
                })
            )
        ),
    ].join('\n');
}

function provenanceSection(rows: readonly LabelRow[]): string {
    const withResult = rows.filter(
        row => row.status !== 'failed' && row.provenance !== null
    );
    const lines = MARGINAL_GROUPS.flatMap(group =>
        VERDICTS.flatMap(verdict => {
            const own = withResult.filter(
                row => group.matches(row) && verdictOf(row) === verdict
            );
            if (own.length === 0) return [];
            const s = summarizeProvenance(own);
            return [
                [
                    group.name,
                    verdict,
                    String(s.rows),
                    rateCell(s.plan),
                    rateCell(s.planControl),
                    rateCell(s.other),
                    rateCell(s.keyPrices),
                ],
            ];
        })
    );
    return [
        '## 7. Price provenance',
        '',
        "Ungrounded = a price the model wrote that no number of the prompt grounds. The control checks the same results against another symbol's prompt: a rate near it means the check cannot tell grounded from coincidence. Rows of every bucket with a result are included (provenance does not depend on the bars). Korean prices are tick-snapped before they reach the stored result, so a made-up Korean price can look grounded: read the kr rows with that bias in mind.",
        '',
        table(
            [
                'group',
                'verdict',
                'rows n',
                'plan prices ungrounded',
                'control: same plans, other prompt',
                'other prices ungrounded',
                'key prices ungrounded',
            ],
            lines
        ),
    ].join('\n');
}

function invariantSection(rows: readonly LabelRow[]): string {
    const s = summarizeInvariants(rows);
    return [
        '## 8. Plan invariants',
        '',
        `Rows with a result: ${s.n}. Rows breaking each rule:`,
        '',
        table(
            ['rule', 'rows', 'share'],
            Object.entries(s.byRule)
                .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
                .map(([rule, count]) => [
                    rule,
                    String(count),
                    pct(s.n === 0 ? null : count / s.n),
                ])
        ),
    ].join('\n');
}

function varianceSection(rows: readonly LabelRow[]): string {
    const s = summarizeVariance(rows);
    if (s.cases === 0) return '';
    const atr = (stat: {
        n: number;
        median: number | null;
        p90: number | null;
    }): string[] => [
        stat.median === null ? EMPTY : stat.median.toFixed(2),
        stat.p90 === null ? EMPTY : stat.p90.toFixed(2),
        String(stat.n),
    ];
    return [
        '## 9. Variance across repeats',
        '',
        `Cases with at least two runs: ${s.cases}. Usable runs per case (a run counts when it carries an analysis): ${s.runCounts.map(c => `${c.cases} cases with ${c.runs}`).join(', ')}. A case with fewer runs than the run's repeat count is still used, with the runs it has; its agreement and flips are over those runs.`,
        '',
        table(
            [
                'label',
                'cases whose runs all agree',
                'flip rate (pairwise)',
                'comparisons n',
            ],
            FLIP_LABELS.map(label => [
                label,
                rateCell(s.agreement[label]),
                pct(s.flips[label].rate),
                String(s.flips[label].n),
            ])
        ),
        '',
        table(
            [
                'plan price spread (max − min, ATR units)',
                'median',
                'p90',
                'cases n',
            ],
            [
                ['stop', ...atr(s.spreadAtr.stop)],
                ['entry zone high', ...atr(s.spreadAtr.zoneHigh)],
                ['first target', ...atr(s.spreadAtr.firstTarget)],
            ]
        ),
        '',
        `Mean Jaccard overlap of the key-level sets over run pairs: ${meanCell(s.levelJaccard, '')}.`,
    ].join('\n');
}

function compareSection(
    a: readonly LabelRow[],
    b: readonly LabelRow[],
    flips: FlipRates | null
): string {
    const c = compareRuns(a, b);
    return [
        '## 10. Comparison, B against A',
        '',
        `Pairs by case and repeat: ${c.pairs}. Differences are B minus A; the standard error is of the paired differences. A difference smaller than A's flip rate for the related label is printed as within run-to-run noise.`,
        '',
        table(
            ['label', 'flips', 'comparisons n', 'flip rate'],
            FLIP_LABELS.map(label => [
                label,
                String(c.flips[label].flips),
                String(c.flips[label].n),
                pct(c.flips[label].rate),
            ])
        ),
        '',
        table(
            ['rate', 'n', 'A', 'B', 'B − A', 'B − A (±se)'],
            c.paired.map(item => [
                item.name,
                String(item.n),
                pct(item.meanA),
                pct(item.meanB),
                diffCell(item.diff.mean, flips, item.noiseLabel),
                item.diff.se === null
                    ? EMPTY
                    : `±${(item.diff.se * 100).toFixed(1)}pp`,
            ])
        ),
    ].join('\n');
}

// ─── Report ───────────────────────────────────────────────────────────────────
export interface ReportInput {
    title: string;
    rows: readonly LabelRow[];
    meta: RunMeta | null;
    compare: {
        title: string;
        rows: readonly LabelRow[];
        meta: RunMeta | null;
    } | null;
    /** Rows the noise floor is measured on, and a description of where they came from. */
    noise: { rows: readonly LabelRow[]; source: string };
}

function metaLines(title: string, meta: RunMeta | null): readonly string[] {
    return meta === null
        ? [`${title}: no run.json`]
        : [
              `${title}: set ${meta.setId}, core ${meta.coreGitSha}, prompt ${meta.promptTemplateVersion}, model ${meta.model}, tier ${meta.tier}, skills ${meta.skillsSha256.slice(0, 12)}, repeat ${meta.repeat}`,
          ];
}

export interface CompareChecks {
    /** The two runs are not comparable: the report is not produced. */
    errors: readonly string[];
    warnings: readonly string[];
}

/**
 * Whether two runs can be compared. Different sets or bars are an error (the cases differ);
 * a different model is only a warning (an A/B across models is legitimate); the same core
 * sha and prompt version mean nothing differs between the arms but the sampling.
 */
export function compareChecks(
    a: RunMeta | null,
    b: RunMeta | null
): CompareChecks {
    if (a === null || b === null) {
        return {
            errors: [],
            warnings: [
                'a run.json is missing, so the sets, bars and model of the two runs cannot be checked',
            ],
        };
    }
    return {
        errors: [
            ...(a.setId === b.setId
                ? []
                : [`the runs used different sets (${a.setId}, ${b.setId})`]),
            ...(a.setBarsSha256 === b.setBarsSha256
                ? []
                : ['the runs used different bars (set bars hashes differ)']),
        ],
        warnings: [
            ...(a.model === b.model
                ? []
                : [`the runs used different models (${a.model}, ${b.model})`]),
            ...(a.coreGitSha === b.coreGitSha &&
            a.promptTemplateVersion === b.promptTemplateVersion
                ? [
                      'core sha and prompt version are identical: the runs differ only by sampling, so this compares a run with itself',
                  ]
                : []),
        ],
    };
}

export function renderReport(input: ReportInput): string {
    const noiseFlips = computeFlipRates(input.noise.rows);
    const flips = FLIP_LABELS.some(label => noiseFlips[label].n > 0)
        ? noiseFlips
        : null;
    const checks =
        input.compare === null
            ? null
            : compareChecks(input.meta, input.compare.meta);
    if (checks !== null && checks.errors.length > 0) {
        throw new Error(`cannot compare: ${checks.errors.join('; ')}`);
    }
    // One observation per case: repeats of a case are not independent, so counting them
    // would shrink every standard error. Variance sections use all repeats.
    const firstRepeat = (rows: readonly LabelRow[]): readonly LabelRow[] =>
        rows.filter(row => row.repeat === 1);
    const rows = firstRepeat(input.rows);
    return [
        '# Replay report',
        '',
        ...metaLines(input.title, input.meta),
        ...(input.compare === null
            ? []
            : metaLines(input.compare.title, input.compare.meta)),
        ...(checks?.warnings ?? []).map(warning => `WARNING: ${warning}.`),
        `Rows: ${input.rows.length} in the run; the headline sections use repeat 1 of each case only (${rows.length} rows, ${rows.filter(row => bucketOf(row) === 'headline').length} headline), because repeats of one case are not independent observations. Repeats are used only in the variance section. Labels are measurements with their n, never a performance claim.`,
        '',
        noiseSection(flips, input.noise.source),
        '',
        // Warnings look at every row, repeats included: a bad row in repeat 2 is still bad.
        warningsSection(input.rows),
        '',
        countsSection(rows),
        '',
        outcomeSection(rows),
        '',
        targetSection(rows),
        '',
        levelSection(rows),
        '',
        patternSection(rows),
        '',
        forwardSection(rows),
        '',
        provenanceSection(rows),
        '',
        invariantSection(rows),
        '',
        varianceSection(input.rows),
        '',
        input.compare === null
            ? ''
            : compareSection(rows, firstRepeat(input.compare.rows), flips),
        '',
    ]
        .filter((part, i, all) => part !== '' || all[i - 1] !== '')
        .join('\n');
}

function loadMeta(runDir: string): RunMeta | null {
    const path = join(runDir, 'run.json');
    return existsSync(path) ? readJson<RunMeta>(path) : null;
}

function main(): void {
    const args = parseArgs(process.argv.slice(2));
    if (!args.run) {
        throw new Error(
            'usage: report.ts --run <run-dir> [--compare <run-dir>] [--noise <run-dir>] [--out report.md]'
        );
    }
    const runDir = resolve(args.run);
    const rows = readLabelRows(runDir);
    const noise = args.noise
        ? {
              rows: readLabelRows(resolve(args.noise)),
              source: resolve(args.noise),
          }
        : { rows, source: 'this run' };
    const markdown = renderReport({
        title: `A (${runDir})`,
        rows,
        meta: loadMeta(runDir),
        compare: args.compare
            ? {
                  title: `B (${resolve(args.compare)})`,
                  rows: readLabelRows(resolve(args.compare)),
                  meta: loadMeta(resolve(args.compare)),
              }
            : null,
        noise,
    });
    if (args.out) {
        assertOutsideRepo(resolve(args.out));
        writeFileAtomic(resolve(args.out), `${markdown}\n`);
    } else {
        console.log(markdown);
    }
}

if (require.main === module) {
    main();
}
