/**
 * Shapes shared by the replay tooling: the frozen set on disk, a run's result files and
 * the label rows the report reads. The set and every run live outside the repository and
 * are passed by path; nothing here holds market data.
 */
import type {
    AnalysisOutcomeLabels,
    Bar,
    EntryRecommendation,
    OutcomeSubject,
    Timeframe,
} from '@/domain/types';

export type ReplayMarket = 'us' | 'kr';
export type ReplayCurrency = 'USD' | 'KRW';
export type ReplayRegime = 'crash' | 'downtrend' | 'uptrend' | 'range';

/** Regimes in the order cases are selected (earlier regimes claim their dates first). */
export const REPLAY_REGIMES: readonly ReplayRegime[] = [
    'crash',
    'downtrend',
    'uptrend',
    'range',
];

export const REPLAY_SET_ID = 'replay-v1';

/** One symbol's daily bars as stored in `<set>/bars/<SYMBOL>.json`. */
export interface StoredBars {
    ticker: string;
    companyName: string;
    fetchedAt: string;
    /** First and last bar date, `YYYY-MM-DD`. */
    from: string;
    to: string;
    /** Oldest first, daily bars stamped at UTC midnight. */
    bars: Bar[];
}

export interface ReplayBarsEntry {
    /** Path relative to the set directory, e.g. `bars/NVDA.json`. */
    file: string;
    /** sha256 (hex) of the file's bytes; a run refuses a set whose files do not match. */
    sha256: string;
    from: string;
    to: string;
    count: number;
    market: ReplayMarket;
    currency: ReplayCurrency;
}

export interface ReplayCase {
    /** `${symbol}|${asOf}` */
    caseId: string;
    symbol: string;
    timeframe: Timeframe;
    /** The analysed (closed) daily bar, `YYYY-MM-DD`. */
    asOf: string;
    regime: ReplayRegime;
    /** Member of the 100-case variance subset. */
    variance: boolean;
}

export interface ReplayManifest {
    setId: typeof REPLAY_SET_ID;
    createdAt: string;
    frozen: true;
    bars: Record<string, ReplayBarsEntry>;
    cases: ReplayCase[];
}

/** What identifies a run: a resumed run must match every field but `startedAt`. */
export interface RunMeta {
    setId: string;
    /**
     * sha256 of the manifest's bars entries (file hashes), so two runs can be shown to
     * share data.
     */
    setBarsSha256: string;
    coreGitSha: string;
    promptTemplateVersion: string;
    model: string;
    tier: string;
    /** Chart timeframe the cases were analysed at; absent in runs made before WP-19 (`1Day`). */
    timeframe?: Timeframe;
    skillsSha256: string;
    repeat: number;
    subset: 'variance' | null;
    limit: number | null;
    startedAt: string;
}

export interface UsageRecord {
    inputTokens: number | null;
    outputTokens: number | null;
    cachedTokens: number | null;
}

export interface PromptHashes {
    system: string;
    stable: string;
    dynamic: string;
    /** sha256(system + "\n\n" + dynamic). */
    full: string;
}

/** `<run>/results/<symbol>_<asOf>.r<k>.json` */
export interface CaseResultFile {
    caseId: string;
    symbol: string;
    asOf: string;
    /** 1-based repeat index. */
    repeat: number;
    /** The analysis before the tier filter (`runAnalysis().unfilteredResult`), `null` on failure. */
    unfilteredResult: unknown;
    promptVersion: string | null;
    promptHashes: PromptHashes | null;
    promptDynamic: string | null;
    usage: UsageRecord | null;
    /** Provider exchanges the call made (retries and a regeneration add to it); `0` when none were recorded. */
    exchangeCount: number;
    latencyMs: number;
    /** `null` on success. */
    error: string | null;
}

export type RowStatus =
    | 'labelled'
    | 'failed'
    | 'subject_invalid'
    | 'anchor_missing'
    | 'anchor_mismatch'
    | 'insufficient_forward';

/** Ungrounded prices next to the prices checked, per class (see `checkPriceProvenance`). */
export interface ProvenanceSummary {
    checked: { plan: number; other: number; keyPrices: number };
    ungrounded: { plan: number; other: number; keyPrices: number };
}

/** One line of `<run>/labels.jsonl`. */
export interface LabelRow {
    caseId: string;
    symbol: string;
    market: ReplayMarket;
    regime: ReplayRegime;
    asOf: string;
    repeat: number;
    variance: boolean;
    status: RowStatus;
    error: string | null;
    /** The result's own `dataAsOf.barTime` is the `asOf` bar; `null` without `dataAsOf`. */
    dataAsOfMatches: boolean | null;
    subject: OutcomeSubject | null;
    labels: AnalysisOutcomeLabels | null;
    /** Mean `h`-bar return (percent) over the symbol's whole bars file, keyed by `h`. */
    periodBaselinePct: Record<string, number | null>;
    provenance: ProvenanceSummary | null;
    /** The same result checked against another case's prompt. */
    provenanceControl: ProvenanceSummary | null;
    /** Ids of the plan invariants the result breaks. */
    invariants: string[];
}

/** `plan.recommendation`, or `none` when the plan carried no verdict. */
export type Verdict = EntryRecommendation | 'none';

export const VERDICTS: readonly Verdict[] = ['enter', 'wait', 'avoid', 'none'];

/**
 * Error stored for a call that reported success without assembling a prompt of its own:
 * core hands a concurrent caller on the same cache key another caller's raw reply, so the
 * result is not this job's.
 */
export const JOINED_GENERATION_ERROR =
    "joined another generation: no prompt was assembled for this job, so its result is not this job's own";
