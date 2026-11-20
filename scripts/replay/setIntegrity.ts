/**
 * Integrity check of a frozen set, shared by the runner and the labeller: a set whose bars
 * files changed since it was built would compare different data under one name.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sha256Hex } from './fsUtil';
import { REPLAY_SET_ID, type ReplayManifest } from './types';

/**
 * Throws unless the set is the frozen `replay-v1` and every bars file hashes to the value
 * in the manifest, and every case has a bars entry.
 */
export function verifySetHashes(
    setDir: string,
    manifest: ReplayManifest
): void {
    if (manifest.setId !== REPLAY_SET_ID || manifest.frozen !== true) {
        throw new Error('manifest.json is not a frozen replay-v1 set');
    }
    const mismatched = Object.entries(manifest.bars)
        .filter(
            ([, entry]) =>
                sha256Hex(readFileSync(join(setDir, entry.file))) !==
                entry.sha256
        )
        .map(([symbol]) => symbol);
    if (mismatched.length > 0) {
        throw new Error(
            `set hash mismatch for ${mismatched.join(', ')}: the bars files changed since the set was built`
        );
    }
    const unknown = manifest.cases.filter(
        c => manifest.bars[c.symbol] === undefined
    );
    if (unknown.length > 0) {
        throw new Error(
            `cases without bars: ${unknown.map(c => c.caseId).join(', ')}`
        );
    }
}

/** sha256 of the manifest's bars entries: identifies the data a run was made on. */
export function barsFingerprint(manifest: ReplayManifest): string {
    return sha256Hex(JSON.stringify(manifest.bars));
}
