/**
 * File helpers of the replay tooling: hashing, atomic JSON writes and the guard that
 * keeps market data and run output out of the repository.
 */
import { createHash } from 'node:crypto';
import {
    closeSync,
    existsSync,
    mkdirSync,
    openSync,
    readFileSync,
    renameSync,
    unlinkSync,
    writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import type { LabelRow } from './types';

/** The repository root: market data and run output must never be written inside it. */
export const REPO_ROOT = resolve(__dirname, '../..');

export function sha256Hex(data: string | Uint8Array): string {
    return createHash('sha256').update(data).digest('hex');
}

/**
 * Throws when `path` is inside the repository. The frozen set and every run hold market
 * data and model output that the public repository must never carry.
 */
export function assertOutsideRepo(path: string, repoRoot = REPO_ROOT): void {
    const rel = relative(repoRoot, resolve(path));
    const inside = rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..');
    if (inside) {
        throw new Error(
            `${path} is inside the repository; keep replay data outside it and pass the path`
        );
    }
}

export function readJson<T>(path: string): T {
    // The cast trusts the caller's `T`: these are files this tooling wrote itself (results,
    // manifests, run.json), and every reader that depends on a field has its own check
    // (`verifySetHashes`, `assertSameRun`, `buildLabelRow`).
    return JSON.parse(readFileSync(path, 'utf-8')) as T;
}

/** Writes through a temp file and a rename so a crash never leaves a half-written result. */
export function writeFileAtomic(path: string, data: string | Uint8Array): void {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.tmp-${process.pid}`;
    writeFileSync(tmp, data);
    renameSync(tmp, path);
}

export function writeJsonAtomic(path: string, value: unknown): void {
    writeFileAtomic(path, `${JSON.stringify(value)}\n`);
}

export function fileExists(path: string): boolean {
    return existsSync(path);
}

/** Parses `<run>/labels.jsonl` (written by `label.ts`) back into rows. */
export function readLabelRows(runDir: string): readonly LabelRow[] {
    return (
        readFileSync(join(runDir, 'labels.jsonl'), 'utf-8')
            .split('\n')
            .filter(line => line !== '')
            // The cast is safe for rows `label.ts` wrote in this shape; the report reads them
            // through typed fields only.
            .map(line => JSON.parse(line) as LabelRow)
    );
}

/**
 * Takes an exclusive lock by creating `path` (`wx`: fails when it exists). Returns the
 * function that removes it, or `null` when the lock is already held. Other errors throw.
 */
export function acquireLock(path: string): (() => void) | null {
    mkdirSync(dirname(path), { recursive: true });
    try {
        closeSync(openSync(path, 'wx'));
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') return null;
        throw error;
    }
    return () => unlinkSync(path);
}
