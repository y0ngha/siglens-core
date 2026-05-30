import type { SMCSwingPoint } from '@/domain/types';

export const makeSwing = (
    price: number,
    type: SMCSwingPoint['type']
): SMCSwingPoint => ({ index: 0, price, type });
