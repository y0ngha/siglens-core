/**
 * Themes `get_theme_snapshot` summarises. SIGLENS curates the baskets: each holds the pure plays that a
 * question about the theme means (3–8 names; the Korean baskets are smaller), not every company that touches it. A user never passes a
 * basket of their own. Symbols use SIGLENS form (Korean stocks carry `.KS` / `.KQ`).
 */
export interface AgentTheme {
    id: string;
    /** Korean name the answer uses for a Korean reader. */
    nameKo: string;
    nameEn: string;
    market: 'us' | 'kr';
    symbols: readonly string[];
}

export const AGENT_THEMES = [
    {
        id: 'quantum',
        nameKo: '양자컴퓨팅',
        nameEn: 'Quantum computing',
        market: 'us',
        symbols: ['IONQ', 'RGTI', 'QBTS', 'QUBT', 'ARQQ', 'LAES'],
    },
    {
        id: 'neocloud',
        nameKo: '네오클라우드·AI 데이터센터',
        nameEn: 'Neocloud and AI data centers',
        market: 'us',
        symbols: ['CRWV', 'NBIS', 'IREN', 'APLD', 'CORZ', 'WULF', 'CIFR'],
    },
    {
        id: 'ai_semis',
        nameKo: 'AI 반도체',
        nameEn: 'AI semiconductors',
        market: 'us',
        symbols: ['NVDA', 'AMD', 'AVGO', 'TSM', 'MU', 'MRVL', 'ARM', 'ASML'],
    },
    {
        id: 'nuclear',
        nameKo: '원자력·SMR',
        nameEn: 'Nuclear power and SMRs',
        market: 'us',
        symbols: ['OKLO', 'SMR', 'CEG', 'VST', 'CCJ', 'NNE', 'LEU', 'BWXT'],
    },
    {
        id: 'space',
        nameKo: '우주항공',
        nameEn: 'Space',
        market: 'us',
        symbols: ['RKLB', 'ASTS', 'LUNR', 'PL', 'RDW', 'BKSY'],
    },
    {
        id: 'crypto_stocks',
        nameKo: '코인 관련주',
        nameEn: 'Crypto-related stocks',
        market: 'us',
        symbols: ['COIN', 'MSTR', 'HOOD', 'MARA', 'RIOT', 'CLSK'],
    },
    {
        id: 'ev',
        nameKo: '전기차',
        nameEn: 'Electric vehicles',
        market: 'us',
        symbols: ['TSLA', 'RIVN', 'LCID', 'NIO', 'XPEV', 'LI'],
    },
    {
        id: 'kr_semis',
        nameKo: '국내 반도체',
        nameEn: 'Korean semiconductors',
        market: 'kr',
        symbols: ['005930.KS', '000660.KS', '042700.KS'],
    },
    {
        id: 'kr_battery',
        nameKo: '국내 2차전지',
        nameEn: 'Korean batteries',
        market: 'kr',
        symbols: [
            '373220.KS',
            '006400.KS',
            '247540.KQ',
            '086520.KQ',
            '003670.KS',
        ],
    },
    {
        id: 'kr_defense',
        nameKo: '국내 방산',
        nameEn: 'Korean defense',
        market: 'kr',
        symbols: ['012450.KS', '047810.KS', '064350.KS', '079550.KS'],
    },
    {
        id: 'kr_shipbuilding',
        nameKo: '국내 조선',
        nameEn: 'Korean shipbuilding',
        market: 'kr',
        symbols: ['009540.KS', '010140.KS', '042660.KS', '329180.KS'],
    },
] as const satisfies readonly AgentTheme[];

/** One of the theme ids in {@link AGENT_THEMES}. */
export type AgentThemeId = (typeof AGENT_THEMES)[number]['id'];

export const AGENT_THEME_IDS: readonly AgentThemeId[] = AGENT_THEMES.map(
    theme => theme.id
);

/** The theme with this id, or `undefined`. */
export function findAgentTheme(id: string): AgentTheme | undefined {
    return AGENT_THEMES.find(theme => theme.id === id);
}
