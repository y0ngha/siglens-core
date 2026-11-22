/**
 * Market profiles of the replay: the session, currency and tick table each market's cases
 * are analysed with, and the clock instant a case is analysed at.
 */
import {
    US_EQUITY_SESSION,
    nextRegularSessionBoundaryMs,
} from '@/domain/session';
import type { KrxTickTable } from '@/domain/analysis/krxTick';
import type { MarketSessionSpec } from '@/domain/types';
import type { ReplayCurrency, ReplayMarket } from './types';

type ScheduledSessionSpec = Extract<MarketSessionSpec, { kind: 'scheduled' }>;

/**
 * KRX regular session, 09:00 to 15:30 KST, weekends closed. Core has no KRX spec (the
 * consumer injects it); no holiday calendar is modelled because every case is a bar that
 * exists, i.e. a day the exchange traded.
 */
export const KR_SESSION: ScheduledSessionSpec = {
    kind: 'scheduled',
    timeZone: 'Asia/Seoul',
    openMinute: 9 * 60,
    closeMinute: 15 * 60 + 30,
    weekendDays: [0, 6],
};

export interface MarketProfile {
    market: ReplayMarket;
    session: MarketSessionSpec;
    currency: ReplayCurrency;
    krxTickTable: KrxTickTable;
}

const KR_SUFFIX = /\.(KS|KQ)$/;

/** Korean listings carry a `.KS` / `.KQ` suffix; everything else is a US listing. */
export function marketOfSymbol(symbol: string): ReplayMarket {
    return KR_SUFFIX.test(symbol) ? 'kr' : 'us';
}

export function profileOf(market: ReplayMarket): MarketProfile {
    return market === 'kr'
        ? {
              market,
              session: KR_SESSION,
              currency: 'KRW',
              krxTickTable: 'share',
          }
        : {
              market,
              session: US_EQUITY_SESSION,
              currency: 'USD',
              krxTickTable: 'share',
          };
}

/** Minutes after the session close the clock is set to: the daily bar is final by then. */
export const CLOCK_AFTER_CLOSE_MINUTES = 60;

/**
 * UTC instant (epoch ms) a case on `asOf` is analysed at: that day's regular close plus
 * `CLOCK_AFTER_CLOSE_MINUTES`, from the session's own calendar (DST, half days).
 *
 * Throws when `asOf` is not a trading day of the session: the next trading day's close
 * would come back, and a clock on the wrong day is a look-ahead.
 */
export function sessionCloseInstantMs(
    session: MarketSessionSpec,
    asOf: string,
    afterCloseMinutes = CLOCK_AFTER_CLOSE_MINUTES
): number {
    if (session.kind !== 'scheduled') {
        throw new Error('a replay case needs a scheduled session');
    }
    // `00:00 UTC` is still the previous evening in New York and already the morning in
    // Seoul; in both the boundary search reaches `asOf`'s own close when it is a trading day.
    const instant = nextRegularSessionBoundaryMs(
        session,
        new Date(`${asOf}T00:00:00Z`),
        'close',
        afterCloseMinutes
    );
    if (
        instant === null ||
        new Date(instant).toISOString().slice(0, 10) !== asOf
    ) {
        throw new Error(`${asOf} is not a trading day of the session`);
    }
    return instant;
}

/** The consumer's market benchmark of a symbol (design WP-19 §4.3): a name, a stored-bars key and a label. */
export interface ReplayBenchmark {
    readonly symbol: string;
    readonly fmpSymbol?: string;
    readonly label: string;
}

/**
 * US listings use SPY, `.KS` KOSPI (`^KS11`) and `.KQ` KOSDAQ (`^KQ11`). The instrument's own
 * copy of the consumer's choice: the replay passes it as the `benchmark` option once core
 * reads one, and recomputes the backdrop against the same series.
 */
export function benchmarkOf(symbol: string): ReplayBenchmark {
    if (symbol.endsWith('.KS')) {
        return { symbol: 'KS11', fmpSymbol: '^KS11', label: 'KOSPI' };
    }
    if (symbol.endsWith('.KQ')) {
        return { symbol: 'KQ11', fmpSymbol: '^KQ11', label: 'KOSDAQ' };
    }
    return { symbol: 'SPY', label: 'S&P 500 (SPY)' };
}
