import { medianOfSorted, round2 } from '@/domain/agent/statsMath';
import type { AgentTheme } from '@/domain/agent/themes';

/** Lookbacks `get_theme_snapshot` reports, in completed daily sessions. */
export const THEME_CHANGE_WINDOWS = { '1d': 1, '5d': 5, '20d': 20 } as const;
export type ThemeChangeWindow = keyof typeof THEME_CHANGE_WINDOWS;
/** Sessions the 52-week high is read over. */
const HIGH_LOOKBACK_SESSIONS = 252;

/** One member's completed daily closes, oldest first. `closes` may be empty when its bars could not be loaded. */
export interface ThemeMemberCloses {
    symbol: string;
    name: string | null;
    closes: readonly number[];
    /** Date (`YYYY-MM-DD`) of the last close, or `null` without closes. */
    lastDate: string | null;
}

export interface ThemeMemberStats {
    symbol: string;
    name: string | null;
    lastClose: number;
    lastDate: string | null;
    changePct: Record<ThemeChangeWindow, number | null>;
    /** Last close vs the highest close of the last 252 sessions (≤ 0), or `null` with fewer closes. */
    fromHigh52wPct: number | null;
}

export interface ThemeWindowSummary {
    /** Members that had a value for this window. */
    members: number;
    avgPct: number | null;
    medianPct: number | null;
    up: number;
    down: number;
    flat: number;
    best: { symbol: string; pct: number } | null;
    worst: { symbol: string; pct: number } | null;
}

export interface ThemeSnapshot {
    theme: { id: string; nameKo: string; nameEn: string; market: 'us' | 'kr' };
    /** Members with closes, best day change first. */
    members: ThemeMemberStats[];
    summary: Record<ThemeChangeWindow, ThemeWindowSummary>;
    /** Symbols of the basket whose closes could not be loaded. */
    missing: string[];
}

function pctChange(from: number, to: number): number | null {
    return from > 0 && Number.isFinite(from) && Number.isFinite(to)
        ? round2((to / from - 1) * 100)
        : null;
}

/**
 * The trailing run of valid closes (finite, positive). A bad close in the middle cuts the series there instead of
 * being skipped, so every lookback still counts consecutive sessions; a bad last close leaves nothing.
 */
function trailingValidCloses(closes: readonly number[]): number[] {
    const lastBad = closes.findLastIndex(
        close => !Number.isFinite(close) || close <= 0
    );
    return closes.slice(lastBad + 1);
}

function memberStats(member: ThemeMemberCloses): ThemeMemberStats | null {
    const closes = trailingValidCloses(member.closes);
    const last = closes.at(-1);
    if (last === undefined) return null;
    const changeOver = (sessions: number): number | null => {
        const base = closes.at(-1 - sessions);
        return base === undefined ? null : pctChange(base, last);
    };
    const highWindow = closes.slice(-HIGH_LOOKBACK_SESSIONS);
    return {
        symbol: member.symbol,
        name: member.name,
        lastClose: last,
        lastDate: member.lastDate,
        changePct: {
            '1d': changeOver(THEME_CHANGE_WINDOWS['1d']),
            '5d': changeOver(THEME_CHANGE_WINDOWS['5d']),
            '20d': changeOver(THEME_CHANGE_WINDOWS['20d']),
        },
        fromHigh52wPct:
            closes.length >= HIGH_LOOKBACK_SESSIONS
                ? pctChange(Math.max(...highWindow), last)
                : null,
    };
}

function summarizeWindow(
    stats: readonly ThemeMemberStats[],
    window: ThemeChangeWindow
): ThemeWindowSummary {
    const values = stats.flatMap(member => {
        const pct = member.changePct[window];
        return pct === null ? [] : [{ symbol: member.symbol, pct }];
    });
    const sorted = values.map(v => v.pct).toSorted((a, b) => a - b);
    const byPct = values.toSorted((a, b) => b.pct - a.pct);
    return {
        members: values.length,
        avgPct:
            values.length === 0
                ? null
                : round2(sorted.reduce((sum, v) => sum + v, 0) / values.length),
        medianPct: medianOfSorted(sorted),
        up: values.filter(v => v.pct > 0).length,
        down: values.filter(v => v.pct < 0).length,
        flat: values.filter(v => v.pct === 0).length,
        best: byPct[0] ?? null,
        worst: byPct.at(-1) ?? null,
    };
}

/**
 * Summarises a theme basket from each member's completed daily closes: per-member 1/5/20-session changes and
 * distance from the 52-week closing high, then per window the equal-weight average, the median, how many
 * members rose or fell, and the best and worst. Only the trailing run of valid closes is read (a non-finite or
 * non-positive close cuts the series there). A member without a valid last close is listed in `missing` and left out of
 * every figure; a member with too few closes for a window is left out of that window only (`members` says how
 * many were counted). Pure — the consumer loads the closes.
 */
export function summarizeTheme(
    theme: AgentTheme,
    members: readonly ThemeMemberCloses[]
): ThemeSnapshot {
    const stats: ThemeMemberStats[] = [];
    const missing: string[] = [];
    for (const member of members) {
        const result = memberStats(member);
        if (result === null) missing.push(member.symbol);
        else stats.push(result);
    }
    const summary: Record<ThemeChangeWindow, ThemeWindowSummary> = {
        '1d': summarizeWindow(stats, '1d'),
        '5d': summarizeWindow(stats, '5d'),
        '20d': summarizeWindow(stats, '20d'),
    };
    return {
        theme: {
            id: theme.id,
            nameKo: theme.nameKo,
            nameEn: theme.nameEn,
            market: theme.market,
        },
        members: stats.toSorted(
            (a, b) =>
                (b.changePct['1d'] ?? -Infinity) -
                (a.changePct['1d'] ?? -Infinity)
        ),
        summary,
        missing,
    };
}
