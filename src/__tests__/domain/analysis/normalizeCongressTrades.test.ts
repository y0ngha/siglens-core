import { describe, expect, it } from 'vitest';
import { normalizeCongressTrades } from '@/domain/analysis/normalizeCongressTrades';
import type { RawCongressTrade } from '@/domain/types';

const senateRaw: RawCongressTrade = {
    senateID: 'C001047',
    disclosureDate: '2026-05-07',
    transactionDate: '2026-04-17',
    firstName: 'Shelley',
    lastName: 'Moore Capito',
    office: 'Shelley Moore Capito',
    district: 'WV',
    owner: 'Spouse',
    assetDescription: 'Apple Inc',
    assetType: 'Stock',
    type: 'Sale',
    amount: '$1,001 - $15,000',
    capitalGainsOver200USD: 'False',
    link: 'https://efdsearch.senate.gov/x',
};
const houseRaw: RawCongressTrade = {
    senateID: null,
    disclosureDate: '2026-06-04',
    transactionDate: '2025-02-07',
    firstName: 'Tim',
    lastName: 'Walberg',
    office: 'Tim Walberg',
    district: '',
    owner: 'Joint',
    assetDescription: 'Apple Inc',
    assetType: 'Stock',
    type: 'Purchase',
    amount: '$15,001 - $50,000',
    capitalGainsOver200USD: 'False',
    link: 'https://disclosures-clerk.house.gov/x.pdf',
};

describe('normalizeCongressTrades', () => {
    it('상·하원을 chamber로 태깅해 합친다', () => {
        const out = normalizeCongressTrades([senateRaw], [houseRaw]);
        expect(out).toHaveLength(2);
        expect(out.map(t => t.chamber).sort()).toEqual(['house', 'senate']);
    });
    it('거래일(transactionDate) 내림차순으로 정렬한다', () => {
        const out = normalizeCongressTrades([senateRaw], [houseRaw]);
        expect(out[0].transactionDate).toBe('2026-04-17');
        expect(out[1].transactionDate).toBe('2025-02-07');
    });
    it('Purchase는 buy로 매핑한다', () => {
        expect(normalizeCongressTrades([], [houseRaw])[0].side).toBe('buy');
    });
    it.each(['Sale', 'Sale (Full)', 'Sale (Partial)', 'Sale Partial'])(
        '매도 변종 "%s"를 모두 sell로 흡수한다',
        type => {
            const out = normalizeCongressTrades([{ ...senateRaw, type }], []);
            expect(out[0].side).toBe('sell');
            expect(out[0].rawType).toBe(type);
        }
    );
    it('알 수 없는 type은 unknown으로 보존(드롭 금지)', () => {
        const out = normalizeCongressTrades(
            [{ ...senateRaw, type: 'Exchange' }],
            []
        );
        expect(out[0].side).toBe('unknown');
        expect(out).toHaveLength(1);
    });
    it('amount 구간을 min/max/label로 구조화한다', () => {
        expect(normalizeCongressTrades([senateRaw], [])[0].amount).toEqual({
            min: 1001,
            max: 15000,
            label: '$1,001 - $15,000',
        });
    });
    it('파싱 불가 amount는 min/max null + 원문 label 보존(throw 금지)', () => {
        expect(
            normalizeCongressTrades([{ ...senateRaw, amount: 'N/A' }], [])[0]
                .amount
        ).toEqual({ min: null, max: null, label: 'N/A' });
    });
    it('상한 없는 구간("$50,000,000 +")은 max=null', () => {
        const a = normalizeCongressTrades(
            [{ ...senateRaw, amount: '$50,000,000 +' }],
            []
        )[0].amount;
        expect(a.min).toBe(50000000);
        expect(a.max).toBeNull();
    });
    it('owner를 소문자 enum으로 정규화하고 빈/미지값은 unknown', () => {
        expect(
            normalizeCongressTrades([{ ...senateRaw, owner: 'Spouse' }], [])[0]
                .owner
        ).toBe('spouse');
        expect(
            normalizeCongressTrades([{ ...senateRaw, owner: '' }], [])[0].owner
        ).toBe('unknown');
        expect(
            normalizeCongressTrades([{ ...senateRaw, owner: 'Trustee' }], [])[0]
                .owner
        ).toBe('unknown');
    });
    it('capitalGainsOver200USD "True"/"False"를 boolean으로', () => {
        expect(
            normalizeCongressTrades(
                [{ ...senateRaw, capitalGainsOver200USD: 'True' }],
                []
            )[0].capitalGainsOver200USD
        ).toBe(true);
        expect(
            normalizeCongressTrades([senateRaw], [])[0].capitalGainsOver200USD
        ).toBe(false);
    });
    it('누락/null 문자열 필드는 빈 문자열로 안전 처리', () => {
        const out = normalizeCongressTrades(
            [{ type: 'Purchase' } as RawCongressTrade],
            []
        );
        expect(out[0].firstName).toBe('');
        expect(out[0].office).toBe('');
        expect(out[0].link).toBe('');
    });
    it('빈 입력은 빈 배열', () => {
        expect(normalizeCongressTrades([], [])).toEqual([]);
    });
});
