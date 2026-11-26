import { medianOfSorted, round2 } from '@/domain/agent/statsMath';

/** Indices `get_index_history_stats` covers. */
export const AGENT_HISTORY_INDICES = [
    'sp500',
    'nasdaq',
    'kospi',
    'kosdaq',
] as const;
export type AgentHistoryIndex = (typeof AGENT_HISTORY_INDICES)[number];

/** One month-end close; `month` is `YYYY-MM`. */
export interface MonthEndClose {
    month: string;
    close: number;
}

export interface AnnualReturn {
    year: number;
    returnPct: number;
    /** Deepest fall from a running month-end peak within the year (previous December close counts as the start), ≤ 0. */
    maxDrawdownPct: number;
}

export interface ReturnStats {
    samples: number;
    /** Samples above zero. */
    positive: number;
    avgPct: number | null;
    medianPct: number | null;
    /** Share of samples above zero, in percent. */
    positivePct: number | null;
}

export type PresidentialCyclePosition =
    'post_election' | 'midterm' | 'pre_election' | 'election';

export interface IndexHistoryStats {
    firstMonth: string;
    lastMonth: string;
    firstFullYear: number | null;
    lastFullYear: number | null;
    annual: AnnualReturn[];
    annualSummary: ReturnStats;
    /** Calendar month 1–12: the month's own return (its close vs the previous month-end). */
    monthly: (ReturnStats & { month: number })[];
    /** US indices only (`null` otherwise): annual returns grouped by the year's place in the presidential cycle. */
    presidentialCycle:
        | (ReturnStats & {
              position: PresidentialCyclePosition;
              years: number[];
          })[]
        | null;
    /** US indices only: from the end of October of each midterm year to the end of October a year later. */
    midtermForward12m: {
        rows: { year: number; returnPct: number }[];
        summary: ReturnStats;
    } | null;
}

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
/** Cycle positions in reading order with each one's `year % 4` (election years are divisible by 4). */
const CYCLE: readonly { position: PresidentialCyclePosition; mod: number }[] = [
    { position: 'post_election', mod: 1 },
    { position: 'midterm', mod: 2 },
    { position: 'pre_election', mod: 3 },
    { position: 'election', mod: 0 },
];

function pct(from: number, to: number): number {
    return round2((to / from - 1) * 100);
}

function stats(values: readonly number[]): ReturnStats {
    if (values.length === 0)
        return {
            samples: 0,
            positive: 0,
            avgPct: null,
            medianPct: null,
            positivePct: null,
        };
    const sorted = values.toSorted((a, b) => a - b);
    const positive = values.filter(v => v > 0).length;
    return {
        samples: values.length,
        positive,
        avgPct: round2(values.reduce((sum, v) => sum + v, 0) / values.length),
        medianPct: medianOfSorted(sorted),
        positivePct: round2((positive / values.length) * 100),
    };
}

function previousMonth(month: string): string {
    const [, y, m] = MONTH.exec(month)!;
    const year = Number(y);
    const mon = Number(m);
    return mon === 1
        ? `${year - 1}-12`
        : `${year}-${String(mon - 1).padStart(2, '0')}`;
}

/**
 * Turns month-end closes into the tables `get_index_history_stats` returns: full-year returns with the year's
 * deepest month-end drawdown, month-of-year seasonality, and for US indices the presidential-cycle grouping and
 * the 12 months after each midterm October. Months at or after `currentMonth` (still in progress) and malformed
 * or non-positive closes are dropped. A year counts only with its own December and the previous December; a
 * month's return needs the previous month. Pure.
 *
 * @param monthEnds - Month-end closes of the index, oldest-first.
 * @param options - `usCycle` adds the US presidential-cycle tables; `currentMonth` (`YYYY-MM`) is the month still in progress.
 * @returns The history tables, or `null` when no complete year can be formed.
 */
export function computeIndexHistoryStats(
    monthEnds: readonly MonthEndClose[],
    options: { usCycle: boolean; currentMonth: string }
): IndexHistoryStats | null {
    const closes = new Map<string, number>();
    for (const row of monthEnds) {
        if (!MONTH.test(row.month) || row.month >= options.currentMonth)
            continue;
        if (!Number.isFinite(row.close) || row.close <= 0) continue;
        closes.set(row.month, row.close);
    }
    const months = [...closes.keys()].toSorted();
    if (months.length === 0) return null;

    const years = [...new Set(months.map(m => Number(m.slice(0, 4))))];
    const annual: AnnualReturn[] = years.flatMap(year => {
        const start = closes.get(`${year - 1}-12`);
        const end = closes.get(`${year}-12`);
        if (start === undefined || end === undefined) return [];
        let peak = start;
        let maxDrawdown = 0;
        for (let m = 1; m <= 12; m++) {
            const close = closes.get(`${year}-${String(m).padStart(2, '0')}`);
            if (close === undefined) continue;
            peak = Math.max(peak, close);
            maxDrawdown = Math.min(maxDrawdown, close / peak - 1);
        }
        return [
            {
                year,
                returnPct: pct(start, end),
                maxDrawdownPct: round2(maxDrawdown * 100),
            },
        ];
    });

    const monthly = Array.from({ length: 12 }, (_, i) => {
        const mon = String(i + 1).padStart(2, '0');
        const values = months.flatMap(month => {
            if (month.slice(5) !== mon) return [];
            const prev = closes.get(previousMonth(month));
            return prev === undefined ? [] : [pct(prev, closes.get(month)!)];
        });
        return { month: i + 1, ...stats(values) };
    });

    const presidentialCycle = options.usCycle
        ? CYCLE.map(({ position, mod }) => {
              const rows = annual.filter(row => row.year % 4 === mod);
              return {
                  position,
                  years: rows.map(row => row.year),
                  ...stats(rows.map(row => row.returnPct)),
              };
          })
        : null;

    const midtermRows = options.usCycle
        ? years
              .filter(year => year % 4 === 2)
              .flatMap(year => {
                  const from = closes.get(`${year}-10`);
                  const to = closes.get(`${year + 1}-10`);
                  return from === undefined || to === undefined
                      ? []
                      : [{ year, returnPct: pct(from, to) }];
              })
        : null;

    return {
        firstMonth: months[0]!,
        lastMonth: months.at(-1)!,
        firstFullYear: annual[0]?.year ?? null,
        lastFullYear: annual.at(-1)?.year ?? null,
        annual,
        annualSummary: stats(annual.map(row => row.returnPct)),
        monthly,
        presidentialCycle,
        midtermForward12m:
            midtermRows === null
                ? null
                : {
                      rows: midtermRows,
                      summary: stats(midtermRows.map(row => row.returnPct)),
                  },
    };
}
