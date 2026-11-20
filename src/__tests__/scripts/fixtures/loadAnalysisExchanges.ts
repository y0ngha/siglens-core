import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import type { ProvenanceFinding } from '@/domain/analysis/priceProvenance';
import type { AnalysisExchangeFixture } from '../../../../scripts/fixtures/evaluateAnalysisExchange';

export const ANALYSIS_EXCHANGES_DIR = join(
    __dirname,
    '../../fixtures/analysisExchanges'
);

/** What `expected.json` pins per fixture: the class it was chosen for and its provenance report. */
export interface ExpectedExchange {
    readonly class:
        | 'salvage'
        | 'reversed_entry'
        | 'stop_not_below_zone'
        | 'target_not_above_zone'
        | 'ungrounded_plan_price'
        | 'clean';
    readonly provenance: {
        readonly checked: {
            readonly plan: number;
            readonly other: number;
            readonly keyPrices: number;
        };
        readonly plan: readonly ProvenanceFinding[];
        readonly other: readonly ProvenanceFinding[];
        readonly keyPrices: readonly ProvenanceFinding[];
    };
    /** Share of prices within ±10% of the last close that the prompt would ground by chance. */
    readonly falseGroundingRate: number;
}

const fixtureFiles = readdirSync(ANALYSIS_EXCHANGES_DIR)
    .filter(file => file.endsWith('.json.gz'))
    .toSorted();

/** Total size of the committed sample (fixtures plus `expected.json`), in bytes. */
export const ANALYSIS_EXCHANGES_BYTES = readdirSync(ANALYSIS_EXCHANGES_DIR)
    .filter(file => file.endsWith('.json.gz') || file === 'expected.json')
    .reduce(
        (total, file) =>
            total + statSync(join(ANALYSIS_EXCHANGES_DIR, file)).size,
        0
    );

export const EXPECTED_EXCHANGES = JSON.parse(
    readFileSync(join(ANALYSIS_EXCHANGES_DIR, 'expected.json'), 'utf8')
) as Record<string, ExpectedExchange>;

export const ANALYSIS_EXCHANGE_FIXTURES: readonly AnalysisExchangeFixture[] =
    fixtureFiles.map(
        file =>
            JSON.parse(
                gunzipSync(
                    readFileSync(join(ANALYSIS_EXCHANGES_DIR, file))
                ).toString('utf8')
            ) as AnalysisExchangeFixture
    );
