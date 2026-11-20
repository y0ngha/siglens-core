import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { writeSet } from '../../../../scripts/replay/buildSet';
import {
    barsFingerprint,
    verifySetHashes,
} from '../../../../scripts/replay/setIntegrity';
import type { ReplayManifest } from '../../../../scripts/replay/types';
import { makeTempDir, tradingBars, writeBarsDir } from './replayFixtures';

const temps = new Set<() => void>();

describe('set integrity', () => {
    afterEach(() => {
        [...temps].forEach(remove => remove());
        temps.clear();
    });

    function makeSet(): { setDir: string; manifest: ReplayManifest } {
        const { dir, remove } = makeTempDir();
        temps.add(remove);
        writeBarsDir(
            join(dir, 'src'),
            ['NVDA', '005930.KS'].map(symbol => ({
                symbol,
                bars: tradingBars({
                    symbol,
                    startIso: '2020-01-02',
                    count: 420,
                }),
            }))
        );
        const setDir = join(dir, 'set');
        const manifest = writeSet(join(dir, 'src'), setDir, {
            createdAt: 'x',
            allowPartial: true,
            force: false,
        });
        return { setDir, manifest };
    }

    describe('verifySetHashes', () => {
        it('accepts an untouched set', () => {
            const { setDir, manifest } = makeSet();
            expect(manifest.cases.length).toBeGreaterThan(0);
            expect(() => verifySetHashes(setDir, manifest)).not.toThrow();
        });

        it('refuses a set whose bars file changed by one byte, naming the symbol', () => {
            const { setDir, manifest } = makeSet();
            const file = join(setDir, manifest.bars.NVDA.file);
            writeFileSync(file, `${readFileSync(file, 'utf-8')} `);
            expect(() => verifySetHashes(setDir, manifest)).toThrow(
                /set hash mismatch for NVDA/
            );
        });

        it('names every changed file, not just the first', () => {
            const { setDir, manifest } = makeSet();
            Object.values(manifest.bars).forEach(entry => {
                const file = join(setDir, entry.file);
                writeFileSync(file, `${readFileSync(file, 'utf-8')}\n`);
            });
            expect(() => verifySetHashes(setDir, manifest)).toThrow(
                /005930\.KS, NVDA/
            );
        });

        it('refuses a manifest that is not frozen or not replay-v1', () => {
            const { setDir, manifest } = makeSet();
            expect(() =>
                verifySetHashes(setDir, {
                    ...manifest,
                    frozen: false as unknown as true,
                })
            ).toThrow('frozen replay-v1');
            expect(() =>
                verifySetHashes(setDir, {
                    ...manifest,
                    setId: 'other' as 'replay-v1',
                })
            ).toThrow('frozen replay-v1');
        });

        it('refuses a case whose symbol has no bars entry', () => {
            const { setDir, manifest } = makeSet();
            const cases = [
                ...manifest.cases,
                {
                    ...manifest.cases[0],
                    caseId: 'ZZZ|2024-01-02',
                    symbol: 'ZZZ',
                },
            ];
            expect(() =>
                verifySetHashes(setDir, { ...manifest, cases })
            ).toThrow('cases without bars: ZZZ|2024-01-02');
        });
    });

    describe('barsFingerprint', () => {
        it('is stable for the same bars and changes when a bars hash does', () => {
            const { manifest } = makeSet();
            expect(barsFingerprint(manifest)).toBe(
                barsFingerprint({ ...manifest })
            );
            const changed = {
                ...manifest,
                bars: {
                    ...manifest.bars,
                    NVDA: { ...manifest.bars.NVDA, sha256: '0'.repeat(64) },
                },
            };
            expect(barsFingerprint(changed)).not.toBe(
                barsFingerprint(manifest)
            );
        });

        it('does not depend on the cases', () => {
            const { manifest } = makeSet();
            expect(barsFingerprint({ ...manifest, cases: [] })).toBe(
                barsFingerprint(manifest)
            );
        });
    });
});
