/**
 * Skill-catalog loader for the A/B prompt-quality harness (plan Task 2.5,
 * `docs/superpowers/plans/2026-07-03-prompt-size-quality-redesign.md`).
 *
 * The harness must build TWO prompt variants from the SAME skill catalog
 * metadata (name / category / gating / tokenCost / confidenceWeight):
 * - `digest`: the current production loader's `PROMPT_DIGEST` content.
 * - `full`: the pre-digest production content — the skill's full body with
 *   the `PROMPT_DIGEST` block (markers included) stripped back out.
 *
 * Reusing the REAL {@link FileSkillsLoader} for every field except `content`
 * (rather than hand-rolling a second YAML/gating parser) guarantees the two
 * variants can never drift from production selection/gating behavior — only
 * the swapped `content` differs.
 */
import { readdir, readFile } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import type { Skill } from '@/domain/types';

export type PromptMode = 'full' | 'digest';

/** Exact markers wrapping a skill's compressed prompt-facing digest (mirrors `infrastructure/skills/loader.ts`). */
const PROMPT_DIGEST_START = '<!-- PROMPT_DIGEST:START -->';
const PROMPT_DIGEST_END = '<!-- PROMPT_DIGEST:END -->';

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/**
 * Remove the `PROMPT_DIGEST` block (start/end markers included) from a skill
 * body, reconstructing the pre-digest production prompt content. When no
 * digest block is present, the body is returned trimmed and unchanged — some
 * catalogs (e.g. a hand-written test fixture) may not have one.
 *
 * Pure — no I/O — directly unit-testable without touching the filesystem.
 */
export function stripDigestBlock(body: string): string {
    const startIdx = body.indexOf(PROMPT_DIGEST_START);
    if (startIdx === -1) return body.trim();
    const endIdx = body.indexOf(PROMPT_DIGEST_END, startIdx);
    if (endIdx === -1) return body.trim();
    const before = body.slice(0, startIdx);
    const after = body.slice(endIdx + PROMPT_DIGEST_END.length);
    return (before + after).trim();
}

/**
 * Extract the `name:` frontmatter value from a raw skill `.md` file's text.
 * Deliberately minimal (not a full YAML parser) — every other field
 * (gating/category/tokenCost/etc.) is reused verbatim from the production
 * {@link FileSkillsLoader}, so only `name` is needed here to key the
 * full-body map back onto the skills it parsed.
 *
 * Returns `null` when the file has no frontmatter block or no `name` key.
 */
export function extractFrontmatterName(raw: string): string | null {
    const fmMatch = FRONTMATTER_RE.exec(raw);
    if (!fmMatch) return null;
    const nameMatch = /^name:\s*(.+)$/m.exec(fmMatch[1]);
    if (!nameMatch) return null;
    return nameMatch[1].trim().replace(/^['"]|['"]$/g, '');
}

/** Split raw `.md` text into its body (everything after the frontmatter block). */
export function extractBody(raw: string): string {
    const fmMatch = FRONTMATTER_RE.exec(raw);
    return fmMatch ? fmMatch[2] : raw;
}

async function collectMdFiles(dir: string): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true });
    const results = await Promise.all(
        entries.map(async (entry: Dirent) => {
            const fullPath = join(dir, entry.name);
            if (entry.isDirectory()) return collectMdFiles(fullPath);
            if (entry.name.endsWith('.md')) return [fullPath];
            return [];
        })
    );
    return results.flat();
}

/**
 * Build a `name -> pre-digest full body` map by re-reading every skill `.md`
 * file directly. Used only in `full` mode — `digest` mode never needs this
 * (the production loader already returns the digest as `content`).
 */
export async function buildFullBodyMap(
    skillsDir: string
): Promise<Map<string, string>> {
    const files = await collectMdFiles(skillsDir);
    const map = new Map<string, string>();
    for (const file of files) {
        const raw = await readFile(file, 'utf-8');
        const name = extractFrontmatterName(raw);
        if (name === null) continue;
        map.set(name, stripDigestBlock(extractBody(raw)));
    }
    return map;
}

/**
 * Load the skill catalog for the A/B harness in either `digest` (current
 * production content) or `full` (pre-digest production content) mode.
 *
 * `FileSkillsLoader` resolves its `skills/` directory from a module-level
 * `const SKILLS_DIR = join(process.cwd(), 'skills')` captured at MODULE
 * EVALUATION time — not per call — so simply calling `process.chdir()`
 * before invoking an already-imported loader has no effect. This function
 * works around that by `chdir`-ing to the parent of `skillsPath` and only
 * THEN dynamically `import()`-ing the loader module, so its module-level
 * `SKILLS_DIR` is captured against the redirected `cwd`. `cwd` is always
 * restored (including on error) before this function returns.
 *
 * Caveat (acceptable for this harness): because Node caches ES modules,
 * calling this function twice **in the same process** with two different
 * `skillsPath` values would reuse the first call's `SKILLS_DIR`. Real usage
 * never hits this — each CLI invocation (`npx tsx buildPrompts.ts --mode
 * full|digest`) is a fresh process and builds exactly one mode.
 *
 * @param skillsPath - Absolute or cwd-relative path to a directory literally
 *   named `skills` (a hard constraint inherited from reusing the production
 *   loader verbatim — it always reads `<cwd>/skills`).
 */
export async function loadSkillCatalog(
    mode: PromptMode,
    skillsPath: string
): Promise<Skill[]> {
    const resolvedSkillsDir = resolve(skillsPath);
    if (basename(resolvedSkillsDir) !== 'skills') {
        throw new Error(
            `--skills must point at a directory named "skills" (got: ${resolvedSkillsDir})`
        );
    }

    const originalCwd = process.cwd();
    process.chdir(dirname(resolvedSkillsDir));
    let digestSkills: Skill[];
    try {
        const { FileSkillsLoader } =
            await import('@/infrastructure/skills/loader');
        digestSkills = await new FileSkillsLoader().loadSkills();
    } finally {
        process.chdir(originalCwd);
    }

    if (mode === 'digest') return digestSkills;

    const fullBodyByName = await buildFullBodyMap(resolvedSkillsDir);
    return digestSkills.map(skill => {
        const fullBody = fullBodyByName.get(skill.name);
        if (fullBody === undefined) {
            console.warn(
                `[ab-harness] no full-body match for skill "${skill.name}" — keeping digest content`
            );
            return skill;
        }
        return { ...skill, content: fullBody };
    });
}
