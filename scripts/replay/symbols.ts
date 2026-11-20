/**
 * The 65 symbols of the frozen replay set: the 40 US tickers the daily-AI backtest ran
 * on, 15 US additions for sector and size spread, and 10 Korean listings.
 */

/** The 40 tickers of the published daily-AI backtest (bars exist for each). */
export const REPLAY_US_BASE_SYMBOLS: readonly string[] = [
    'NVDA',
    'TSLA',
    'PLTR',
    'AMD',
    'AAPL',
    'MSFT',
    'META',
    'AMZN',
    'GOOGL',
    'AVGO',
    'COIN',
    'MSTR',
    'SMCI',
    'RKLB',
    'HOOD',
    'SPY',
    'QQQ',
    'MU',
    'TSM',
    'ASML',
    'MRVL',
    'LRCX',
    'AMAT',
    'QCOM',
    'ARM',
    'ANET',
    'NFLX',
    'CRM',
    'ADBE',
    'NOW',
    'SHOP',
    'UBER',
    'CRWD',
    'PANW',
    'SNOW',
    'NET',
    'DDOG',
    'ZS',
    'APP',
    'ORCL',
];

/** US additions for sector and size spread. */
export const REPLAY_US_ADDED_SYMBOLS: readonly string[] = [
    'IWM',
    'JPM',
    'XOM',
    'UNH',
    'WMT',
    'CAT',
    'PFE',
    'KO',
    'SOUN',
    'IONQ',
    'UPST',
    'RIOT',
    'MARA',
    'JOBY',
    'ACHR',
];

/** Korean listings (KOSPI `.KS`, KOSDAQ `.KQ`). */
export const REPLAY_KR_SYMBOLS: readonly string[] = [
    '005930.KS',
    '000660.KS',
    '005380.KS',
    '035420.KS',
    '035720.KS',
    '105560.KS',
    '051910.KS',
    '207940.KS',
    '086520.KQ',
    '058470.KQ',
];

export const REPLAY_US_SYMBOLS: readonly string[] = [
    ...REPLAY_US_BASE_SYMBOLS,
    ...REPLAY_US_ADDED_SYMBOLS,
];

export const REPLAY_SYMBOLS: readonly string[] = [
    ...REPLAY_US_SYMBOLS,
    ...REPLAY_KR_SYMBOLS,
];

/** First bar date every symbol is fetched from, so 2020 cases have a full MA200. */
export const REPLAY_BARS_FROM = '2017-01-03';
