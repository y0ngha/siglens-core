import type {
    Chamber,
    CongressAmountRange,
    CongressOwner,
    CongressTrade,
    CongressTradeSide,
    RawCongressTrade,
} from '@/domain/types';
import { asString } from './normalizePrimitives';

const OWNERS: readonly CongressOwner[] = ['self', 'spouse', 'joint', 'child'];

function toSide(rawType: string): CongressTradeSide {
    const t = rawType.trim().toLowerCase();
    if (t === 'purchase') return 'buy';
    if (t.startsWith('sale')) return 'sell';
    return 'unknown';
}

function toOwner(raw: unknown): CongressOwner {
    const o = asString(raw).trim().toLowerCase();
    // (OWNERS as readonly string[]): `Array.prototype.includes` is typed against the
    // array's element type, so `OWNERS` (typed as `readonly CongressOwner[]`) would
    // reject the arbitrary `string` value `o`. Widening to `readonly string[]` lets
    // the check accept any string.
    // (o as CongressOwner): after `includes` returns true, runtime guarantees `o` is
    // one of the four `CongressOwner` literals, but TypeScript cannot narrow `string`
    // through `includes`. The cast bridges runtime guarantee to compile-time type.
    return (OWNERS as readonly string[]).includes(o)
        ? (o as CongressOwner)
        : 'unknown';
}

function parseAmountValue(s: string): number | null {
    const n = Number(s.replace(/[$,]/g, ''));
    return Number.isFinite(n) ? n : null;
}

function toAmount(raw: unknown): CongressAmountRange {
    const label = asString(raw);
    const nums = label.match(/\$[\d,]+/g);
    if (!nums || nums.length === 0) return { min: null, max: null, label };
    const min = parseAmountValue(nums[0]);
    const max = nums.length >= 2 ? parseAmountValue(nums[1]) : null;
    return { min, max, label };
}

function toTrade(raw: RawCongressTrade, chamber: Chamber): CongressTrade {
    const rawType = asString(raw.type);
    return {
        chamber,
        firstName: asString(raw.firstName),
        lastName: asString(raw.lastName),
        office: asString(raw.office),
        district: asString(raw.district),
        owner: toOwner(raw.owner),
        side: toSide(rawType),
        rawType,
        amount: toAmount(raw.amount),
        assetType: asString(raw.assetType),
        assetDescription: asString(raw.assetDescription),
        transactionDate: asString(raw.transactionDate),
        disclosureDate: asString(raw.disclosureDate),
        link: asString(raw.link),
        capitalGainsOver200USD:
            asString(raw.capitalGainsOver200USD).toLowerCase() === 'true',
    };
}

/**
 * Merge FMP senate and house trade rows into a unified domain model.
 *
 * Both chambers share the same wire schema, so a single mapper is used with an
 * explicit `chamber` argument. Results are sorted by `transactionDate`
 * descending (newest first). Never throws.
 *
 * @param senate - Raw FMP senate trade rows.
 * @param house - Raw FMP house trade rows.
 * @returns Merged, sorted array of normalized {@link CongressTrade} records.
 */
export function normalizeCongressTrades(
    senate: readonly RawCongressTrade[],
    house: readonly RawCongressTrade[]
): CongressTrade[] {
    const merged = [
        ...senate.map(r => toTrade(r, 'senate')),
        ...house.map(r => toTrade(r, 'house')),
    ];
    return merged.sort((a, b) =>
        b.transactionDate.localeCompare(a.transactionDate)
    );
}
