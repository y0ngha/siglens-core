import { MS_PER_MINUTE } from '@/domain/constants/time';
import { TIMEFRAME_MINUTES } from '@/domain/constants/market';
import { OUTCOME_WINDOW_BARS } from '@/domain/outcomes/constants';
import type { Timeframe } from '@/domain/types';

/**
 * The earliest moment an analysis generated at `generatedAt` can have a full outcome
 * window: `OUTCOME_WINDOW_BARS` bars of wall-clock time later.
 *
 * It is a lower bound, not a schedule. Session gaps make 20 trading bars span more than 20
 * bars of wall-clock time (a daily window is 20 calendar days at the least, about 28
 * usually), so a consumer that asks at this time can still get `insufficient_forward` and
 * must retry from the `have` / `need` of that result.
 *
 * @param generatedAt - When the analysis was generated.
 * @param timeframe - The analysis timeframe.
 * @returns A new `Date`; `generatedAt` is not modified.
 */
export function outcomeEarliestLabelTime(
    generatedAt: Date,
    timeframe: Timeframe
): Date {
    return new Date(
        generatedAt.getTime() +
            OUTCOME_WINDOW_BARS * TIMEFRAME_MINUTES[timeframe] * MS_PER_MINUTE
    );
}
