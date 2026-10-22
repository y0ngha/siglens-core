/**
 * Full Elliott structure gate run: 300 synthetic
 * samples per structure per noise level + 1,000 random walks. The vitest
 * `src/__tests__/scripts/elliottGate/elliottGate.test.ts` runs the same
 * harness.
 *
 * Run with: `yarn tsx scripts/elliottGate/run.ts [--all] [--n 300] [--walks 1000]`
 * `--all` enables every structure (the gate's candidate set); without it
 * the shipped `ELLIOTT_ENABLED_STRUCTURES` are used.
 */
import type { ElliottStructure } from '@/domain/types';
import { buildElliottCandidates } from '@/domain/overlays/elliottCandidates';
import { ELLIOTT_ENABLED_STRUCTURES } from '@/domain/overlays/constants';
import { measureGate } from './metrics';

const FMT = {
    timeframe: '1Day' as const,
    quoting: { dp: 2, krxTick: null },
};
const args = process.argv.slice(2);
const opt = (name: string, fallback: number) => {
    const i = args.indexOf(name);
    return i >= 0 ? Number(args[i + 1]) : fallback;
};
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

const ALL_STRUCTURES: readonly ElliottStructure[] = [
    'impulse',
    'diagonal',
    'triangle',
    'combination',
    'abc',
];
const all = args.includes('--all');
const without = args.includes('--without')
    ? args[args.indexOf('--without') + 1].split(',')
    : [];
const enabled = (all ? ALL_STRUCTURES : ELLIOTT_ENABLED_STRUCTURES).filter(
    s => !without.includes(s)
);
const gates = measureGate(
    (bars, atr) => buildElliottCandidates(bars, atr, FMT, enabled),
    opt('--n', 300),
    opt('--walks', 1000),
    opt('--seed', 20261002)
);
console.log(`enabled: ${enabled.join(', ')}`);
console.log(
    'structure    | recall@0.1 | recall@0.25 | FP(walk) | conf@0.1 | conf@0.25 | gate'
);
for (const g of gates) {
    console.log(
        [
            g.structure.padEnd(12),
            pct(g.recall[0.1]).padStart(10),
            pct(g.recall[0.25]).padStart(11),
            pct(g.falsePositive).padStart(8),
            pct(g.confusion[0.1]).padStart(8),
            pct(g.confusion[0.25]).padStart(9),
            g.passes ? 'PASS' : 'fail',
        ].join(' | ')
    );
}
console.log('\nper family:');
for (const g of gates)
    for (const k of g.kinds)
        console.log(
            `  ${k.kind.padEnd(14)} noise ${k.noise}: recall ${pct(k.recall)}, confusion ${pct(k.confusion)} ${JSON.stringify(k.confusedAs)}${k.typeAccuracy === undefined ? '' : `, type ok ${pct(k.typeAccuracy)}`}`
        );
