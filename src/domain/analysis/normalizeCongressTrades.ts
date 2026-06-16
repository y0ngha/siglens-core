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
 * FMP senate-trades + house-trades wire 배열을 통합 도메인 모델로 정규화한다.
 * 상·하원 스키마가 동일하므로 단일 매퍼 + chamber 인자를 쓴다.
 * 거래일(transactionDate) 내림차순 정렬. 절대 throw하지 않는다.
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
