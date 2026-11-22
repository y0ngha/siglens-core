import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
    parseSkillFrontmatter,
    readSkillCatalog,
} from '../../../../scripts/replay/analysisFieldsEvalCatalog';
import { makeTempDir } from './replayFixtures';

const temps = new Set<() => void>();
afterEach(() => {
    [...temps].forEach(remove => remove());
    temps.clear();
});

const file = (lines: readonly string[]): string =>
    `---\n${lines.join('\n')}\n---\n\n## Body\ntext`;

describe('parseSkillFrontmatter', () => {
    it('reads the name, type, tier, triggers and computed card', () => {
        expect(
            parseSkillFrontmatter(
                file([
                    'name: 이중천장',
                    'type: pattern',
                    'category: reversal_bearish',
                    'gating:',
                    '  tier: gated',
                    '  signal_kind: event',
                    '  triggers: [double_top, "double_top_2"]',
                    'computed_card: rsi',
                    'token_cost: 779',
                ])
            )
        ).toEqual({
            name: '이중천장',
            type: 'pattern',
            tier: 'gated',
            triggers: ['double_top', 'double_top_2'],
            computedCard: 'rsi',
        });
    });

    it('has no triggers, tier or card when the file has none', () => {
        expect(
            parseSkillFrontmatter(
                file(['name: "Core Reference"', 'type: indicator_guide'])
            )
        ).toEqual({
            name: 'Core Reference',
            type: 'indicator_guide',
            tier: null,
            triggers: [],
            computedCard: null,
        });
    });

    it('is null for a file without frontmatter or without a name', () => {
        expect(parseSkillFrontmatter('## no frontmatter')).toBeNull();
        expect(parseSkillFrontmatter(file(['type: pattern']))).toBeNull();
        expect(parseSkillFrontmatter(file(['name: ']))).toBeNull();
    });
});

describe('readSkillCatalog', () => {
    it('reads every skill file under the directory, sorted by name', () => {
        const { dir, remove } = makeTempDir();
        temps.add(remove);
        mkdirSync(join(dir, 'patterns'));
        writeFileSync(
            join(dir, 'patterns', 'b.md'),
            file(['name: B', 'type: pattern'])
        );
        writeFileSync(join(dir, 'a.md'), file(['name: A', 'type: strategy']));
        writeFileSync(join(dir, 'notes.txt'), 'ignored');
        writeFileSync(join(dir, 'CLAUDE.md'), '# not a skill');
        expect(readSkillCatalog(dir).map(s => s.name)).toEqual(['A', 'B']);
    });

    it('throws when no skill file parses', () => {
        const { dir, remove } = makeTempDir();
        temps.add(remove);
        expect(() => readSkillCatalog(dir)).toThrow('no skill file found');
    });
});
