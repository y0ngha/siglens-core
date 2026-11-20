import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
    REPO_ROOT,
    acquireLock,
    assertOutsideRepo,
    readLabelRows,
    sha256Hex,
    writeFileAtomic,
    writeJsonAtomic,
} from '../../../../scripts/replay/fsUtil';
import { makeRow, makeTempDir } from './replayFixtures';

const temps = new Set<() => void>();

describe('fsUtil', () => {
    afterEach(() => {
        [...temps].forEach(remove => remove());
        temps.clear();
    });
    function temp(): string {
        const { dir, remove } = makeTempDir();
        temps.add(remove);
        return dir;
    }

    describe('sha256Hex', () => {
        it('hashes text and bytes the same way', () => {
            expect(sha256Hex('abc')).toBe(
                'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
            );
            expect(sha256Hex(new TextEncoder().encode('abc'))).toBe(
                sha256Hex('abc')
            );
        });
    });

    describe('assertOutsideRepo', () => {
        it('refuses the repository root and anything under it', () => {
            expect(() => assertOutsideRepo(REPO_ROOT)).toThrow(
                'inside the repository'
            );
            expect(() => assertOutsideRepo(join(REPO_ROOT, 'out/run'))).toThrow(
                'inside the repository'
            );
        });

        it('accepts a sibling of the repository and the OS temp dir', () => {
            expect(() =>
                assertOutsideRepo(`${REPO_ROOT}-data/run`)
            ).not.toThrow();
            expect(() => assertOutsideRepo(temp())).not.toThrow();
        });

        it('accepts the parent of the repository', () => {
            expect(() =>
                assertOutsideRepo(join(REPO_ROOT, '..'))
            ).not.toThrow();
        });

        it('works against a given root', () => {
            expect(() => assertOutsideRepo('/a/b/c', '/a/b')).toThrow();
            expect(() => assertOutsideRepo('/a/bc', '/a/b')).not.toThrow();
        });
    });

    describe('atomic writes', () => {
        it('creates missing directories and leaves no temp file', () => {
            const dir = temp();
            const path = join(dir, 'deep/er/file.json');
            writeJsonAtomic(path, { a: 1 });
            expect(JSON.parse(readFileSync(path, 'utf-8'))).toEqual({ a: 1 });
            expect(existsSync(`${path}.tmp-${process.pid}`)).toBe(false);
        });

        it('replaces an existing file', () => {
            const dir = temp();
            const path = join(dir, 'f.txt');
            writeFileAtomic(path, 'one');
            writeFileAtomic(path, 'two');
            expect(readFileSync(path, 'utf-8')).toBe('two');
        });
    });

    describe('readLabelRows', () => {
        it('parses one row per non-empty line', () => {
            const dir = temp();
            mkdirSync(dir, { recursive: true });
            const rows = [
                makeRow({ caseId: 'A|1' }),
                makeRow({ caseId: 'B|2' }),
            ];
            writeFileSync(
                join(dir, 'labels.jsonl'),
                `${rows.map(r => JSON.stringify(r)).join('\n')}\n\n`
            );
            expect(readLabelRows(dir).map(r => r.caseId)).toEqual([
                'A|1',
                'B|2',
            ]);
        });
    });

    describe('acquireLock', () => {
        it('creates the lock once, refuses it while held and allows it again after release', () => {
            const path = join(temp(), 'sub', '.lock');
            const release = acquireLock(path);
            expect(release).not.toBeNull();
            expect(existsSync(path)).toBe(true);
            expect(acquireLock(path)).toBeNull();
            release?.();
            expect(existsSync(path)).toBe(false);
            expect(acquireLock(path)).not.toBeNull();
        });

        it('rethrows an error that is not "already exists"', () => {
            const dir = temp();
            writeFileSync(join(dir, 'file'), 'x');
            expect(() => acquireLock(join(dir, 'file', '.lock'))).toThrow();
        });
    });
});
