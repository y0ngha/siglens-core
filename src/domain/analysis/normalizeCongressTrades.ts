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
    return (OWNERS as readonly string[]).includes(o)
        ? (o as CongressOwner)
        : 'unknown';
}

function toAmount(raw: unknown): CongressAmountRange {
    const label = asString(raw);
    const nums = label.match(/\$[\d,]+/g);
    const parse = (s: string): number | null => {
        const n = Number(s.replace(/[$,]/g, ''));
        return Number.isFinite(n) ? n : null;
    };
    if (!nums || nums.length === 0) return { min: null, max: null, label };
    const min = parse(nums[0]);
    const max = nums.length >= 2 ? parse(nums[1]) : null;
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
    return merged.toSorted((a, b) =>
        b.transactionDate.localeCompare(a.transactionDate)
    );
}
