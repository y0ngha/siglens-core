/**
 * Labels the results of a replay run with the deterministic tooling: the outcome labeller
 * (bars only, no model), the price-provenance check and the plan invariants.
 *
 * Usage:
 *   npx tsx scripts/replay/label.ts --set <set-dir> --run <run-dir>
 *
 * Writes `<run>/labels.jsonl`, one `LabelRow` per result file. The anchor of every row is
 * the case's own `asOf` bar, closed: the bars file ends at the freeze date, so a replayed
 * analysis never has a forming anchor. A row whose result is missing or failed is kept
 * (status `failed`) so the report can count failures.
 */
import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from '../ab-harness/cliArgs';
import { checkPlanInvariants } from '@/domain/analysis/planInvariants';
import { checkPriceProvenance } from '@/domain/analysis/priceProvenance';
import { priceQuoting } from '@/domain/analysis/promptFormat';
import { OUTCOME_HORIZON_BARS } from '@/domain/outcomes/constants';
import { buildOutcomeWindow } from '@/domain/outcomes/buildOutcomeWindow';
import { extractOutcomeSubject } from '@/domain/outcomes/extractOutcomeSubject';
import { labelAnalysisOutcome } from '@/domain/outcomes/labelAnalysisOutcome';
import type { AnalysisResponse } from '@/domain/types';
import { assertOutsideRepo, readJson, writeFileAtomic } from './fsUtil';
import { marketOfSymbol, profileOf } from './markets';
import { redactProviderText } from './redact';
import { verifySetHashes } from './setIntegrity';
import { mean } from './stats';
import { JOINED_GENERATION_ERROR } from './types';
import type {
    CaseResultFile,
    LabelRow,
    ProvenanceSummary,
    ReplayCase,
    ReplayManifest,
    StoredBars,
} from './types';

/**
 * Mean `h`-bar return (percent) over every start bar of the symbol's whole bars file, for
 * each horizon: the period baseline an unconditional holder would have earned. `null` for
 * a horizon the file does not cover.
 */
export function periodBaselinePct(
    closes: readonly number[]
): Record<string, number | null> {
    return Object.fromEntries(
        OUTCOME_HORIZON_BARS.map(h => [
            String(h),
            mean(
                closes
                    .slice(0, Math.max(0, closes.length - h))
                    .map((close, j) => (closes[j + h] / close - 1) * 100)
            ),
        ])
    );
}

/**
 * The provenance check of one result against one prompt. A result missing `priceTargets`,
 * one scenario, `keyLevels` or `patternSummaries` is still read (the missing part adds no
 * values). A result whose fields have the wrong type (e.g. a non-array `keyLevels.support`)
 * is a corrupt file the check cannot read: it has no provenance (`null`) rather than
 * failing the whole labelling run.
 */
function safeProvenance(
    promptDynamic: string,
    result: AnalysisResponse,
    priceDecimals: number
): ProvenanceSummary | null {
    try {
        return summarize(
            checkPriceProvenance({ promptDynamic, result, priceDecimals })
        );
    } catch {
        return null;
    }
}

/** Distinct ids of the plan invariants a result breaks; none for a result too malformed to check. */
function safeInvariants(result: AnalysisResponse, lastClose: number): string[] {
    try {
        // The ATR the stop floor is judged with is the one the result's own plan state was
        // measured with; a result without a state predates the floor, which then is not
        // evaluated (the instrument's `plan` mode recomputes the ATR from the bars).
        const atr = result.actionRecommendation?.planState?.atr ?? null;
        return [
            ...new Set(
                checkPlanInvariants(
                    result.actionRecommendation,
                    lastClose,
                    atr
                ).map(violation => violation.id)
            ),
        ];
    } catch {
        return [];
    }
}

function summarize(
    report: ReturnType<typeof checkPriceProvenance>
): ProvenanceSummary {
    return {
        checked: { ...report.checked },
        ungrounded: {
            plan: report.plan.length,
            other: report.other.length,
            keyPrices: report.keyPrices.length,
        },
    };
}

export interface LabelInput {
    case: ReplayCase;
    result: CaseResultFile;
    stored: StoredBars;
    /** Another case's dynamic prompt, for the provenance control; `null` when there is none. */
    controlPrompt: string | null;
}

function dataAsOfOf(
    result: unknown
): { barTime?: unknown; close?: unknown } | null {
    const value =
        typeof result === 'object' && result !== null
            ? // `result` is a non-null object; `dataAsOf` is read as `unknown` and narrowed to an
              // object below, and its fields stay `unknown` until used, so nothing is trusted.
              (result as { dataAsOf?: unknown }).dataAsOf
            : null;
    return typeof value === 'object' && value !== null ? value : null;
}

/** One result to its row; never throws on a bad result (it becomes a status). */
export function buildLabelRow(input: LabelInput): LabelRow {
    const { case: replayCase, result, stored, controlPrompt } = input;
    const market = marketOfSymbol(replayCase.symbol);
    const closes = stored.bars.map(bar => bar.close);
    const base = {
        caseId: replayCase.caseId,
        symbol: replayCase.symbol,
        market,
        regime: replayCase.regime,
        asOf: replayCase.asOf,
        repeat: result.repeat,
        variance: replayCase.variance,
        dataAsOfMatches: null,
        subject: null,
        labels: null,
        periodBaselinePct: periodBaselinePct(closes),
        provenance: null,
        provenanceControl: null,
        invariants: [],
    };
    if (result.error !== null) {
        return {
            ...base,
            status: 'failed',
            error: redactProviderText(result.error),
        };
    }
    if (result.unfilteredResult === null) {
        return { ...base, status: 'failed', error: 'no result' };
    }
    if (result.promptDynamic === null) {
        // A result stored as done without the prompt it was generated from did not generate:
        // it is the reply of another job that shared its cache key.
        return { ...base, status: 'failed', error: JOINED_GENERATION_ERROR };
    }
    const subject = extractOutcomeSubject(
        result.unfilteredResult,
        result.promptDynamic
    );
    if (subject === null) {
        return { ...base, status: 'subject_invalid', error: null };
    }

    const asOfTime = Date.parse(`${replayCase.asOf}T00:00:00Z`) / 1000;
    const anchorBar = stored.bars.find(bar => bar.time === asOfTime);
    const seen = dataAsOfOf(result.unfilteredResult)?.close;
    const closeAtAnalysis =
        typeof seen === 'number' && seen > 0
            ? seen
            : (anchorBar?.close ?? Number.NaN);
    const window = buildOutcomeWindow(stored.bars, {
        barTime: asOfTime,
        closeAtAnalysis,
        closedAtAnalysis: true,
    });

    const profile = profileOf(market);
    const priceDecimals = priceQuoting(
        anchorBar?.close,
        profile.currency,
        'equity',
        profile.krxTickTable
    ).dp;
    // The stored result came from `runAnalysis` and has its full shape, but a corrupt or
    // hand-edited file can be malformed. Missing `priceTargets`/`keyLevels`/
    // `patternSummaries` no longer throw in `checkPriceProvenance` (they just add no
    // values), but wrong types (e.g. a non-array `keyLevels.support`) still do, as can
    // `checkPlanInvariants`. `safeProvenance` and `safeInvariants` catch that and report
    // nothing for such a result.
    const analysis = result.unfilteredResult as AnalysisResponse;
    const provenanceOf = (prompt: string | null): ProvenanceSummary | null =>
        prompt === null
            ? null
            : safeProvenance(prompt, analysis, priceDecimals);
    const common = {
        ...base,
        error: null,
        dataAsOfMatches:
            subject.anchor === null
                ? null
                : subject.anchor.barTime === asOfTime,
        subject,
        provenance: provenanceOf(result.promptDynamic),
        provenanceControl: provenanceOf(controlPrompt),
        invariants: safeInvariants(analysis, anchorBar?.close ?? Number.NaN),
    };
    return window.status === 'ok'
        ? {
              ...common,
              status: 'labelled',
              labels: labelAnalysisOutcome(subject, window.window),
          }
        : { ...common, status: window.status };
}

/**
 * For each result, the dynamic prompt of the next result (cyclically) from another symbol
 * that has one: the provenance control. A prompt from another symbol cannot ground a price
 * of this one except by coincidence, which is what the control measures.
 */
export function controlPrompts(
    results: readonly CaseResultFile[]
): readonly (string | null)[] {
    return results.map((result, i) => {
        const donor = [...results.slice(i + 1), ...results.slice(0, i)].find(
            other =>
                other.symbol !== result.symbol && other.promptDynamic !== null
        );
        return donor?.promptDynamic ?? null;
    });
}

/** Labels every result of `runDir`; returns the rows in result-file order. */
export function labelRun(setDir: string, runDir: string): readonly LabelRow[] {
    assertOutsideRepo(runDir);
    const manifest = readJson<ReplayManifest>(join(setDir, 'manifest.json'));
    verifySetHashes(setDir, manifest);
    const names = readdirSync(join(runDir, 'results'))
        .filter(name => name.endsWith('.json'))
        .toSorted();
    const results = names.map(name =>
        readJson<CaseResultFile>(join(runDir, 'results', name))
    );
    const byId = new Map(manifest.cases.map(c => [c.caseId, c]));
    const stored = new Map(
        [...new Set(results.map(result => result.symbol))].map(symbol => [
            symbol,
            readJson<StoredBars>(join(setDir, manifest.bars[symbol].file)),
        ])
    );
    const controls = controlPrompts(results);
    const rows = results.map((result, i): LabelRow => {
        const replayCase = byId.get(result.caseId);
        const bars = stored.get(result.symbol);
        if (replayCase === undefined || bars === undefined) {
            throw new Error(
                `${names[i]}: case ${result.caseId} is not in the set`
            );
        }
        return buildLabelRow({
            case: replayCase,
            result,
            stored: bars,
            controlPrompt: controls[i],
        });
    });
    writeFileAtomic(
        join(runDir, 'labels.jsonl'),
        `${rows.map(row => JSON.stringify(row)).join('\n')}\n`
    );
    return rows;
}

function main(): void {
    const args = parseArgs(process.argv.slice(2));
    if (!args.set || !args.run) {
        throw new Error('usage: label.ts --set <set-dir> --run <run-dir>');
    }
    const rows = labelRun(resolve(args.set), resolve(args.run));
    const labelled = rows.filter(row => row.status === 'labelled').length;
    console.log(`labelled ${labelled} of ${rows.length} results`);
}

if (require.main === module) {
    main();
}
