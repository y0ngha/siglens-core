/**
 * A minimal reader of the skill catalog's frontmatter for the `output` mode (WP-16): the
 * name, type, tier and trigger ids of each skill, and the `computed_card` tag. The mode
 * needs the pattern skills' Korean names and trigger ids (to find a pattern a summary names
 * and the entries a qualified candidate got) and nothing from core, so the files are read
 * as text and no loader runs.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface SkillFileMeta {
    name: string;
    type: string | null;
    tier: string | null;
    triggers: readonly string[];
    computedCard: string | null;
}

const unquote = (text: string): string =>
    text.trim().replace(/^(["'])(.*)\1$/, '$2');

/** The frontmatter block of a skill file, or `null` when the file has none. */
export function parseSkillFrontmatter(text: string): SkillFileMeta | null {
    const block = text.match(/^---\n([\s\S]*?)\n---/);
    if (block === null) return null;
    const lines = block[1].split('\n');
    const topLevel = (key: string): string | null => {
        const line = lines.find(l => l.startsWith(`${key}:`));
        return line === undefined ? null : unquote(line.slice(key.length + 1));
    };
    const name = topLevel('name');
    if (name === null || name === '') return null;
    const triggers = lines
        .find(l => /^\s+triggers:\s*\[/.test(l))
        ?.match(/\[(.*)\]/)?.[1];
    const tier = lines.find(l => /^\s+tier:/.test(l));
    return {
        name,
        type: topLevel('type'),
        tier: tier === undefined ? null : unquote(tier.split(':')[1]),
        triggers:
            triggers === undefined
                ? []
                : triggers
                      .split(',')
                      .map(unquote)
                      .filter(t => t !== ''),
        computedCard: topLevel('computed_card'),
    };
}

function markdownFiles(dir: string): readonly string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
        entry.isDirectory()
            ? markdownFiles(join(dir, entry.name))
            : entry.name.endsWith('.md')
              ? [join(dir, entry.name)]
              : []
    );
}

/** Every skill file of `dir`, sorted by name; throws when none parses. */
export function readSkillCatalog(dir: string): readonly SkillFileMeta[] {
    const skills = markdownFiles(dir).flatMap(file => {
        const meta = parseSkillFrontmatter(readFileSync(file, 'utf-8'));
        return meta === null ? [] : [meta];
    });
    if (skills.length === 0) throw new Error(`${dir}: no skill file found`);
    return skills.toSorted((a, b) => a.name.localeCompare(b.name, 'en'));
}
