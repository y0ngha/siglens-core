import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('node:fs/promises');

import { readdir, readFile } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { FileSkillsLoader } from '@/infrastructure/skills/loader';

const mockReaddir = readdir as Mock;
const mockReadFile = readFile as Mock;

const validFrontmatter = `---
name: Test Skill
description: Test description
type: pattern
category: reversal_bullish
indicators: [RSI, MACD]
confidence_weight: 0.8
---
Content here`;

const makeDirent = (name: string, isDir = false): Dirent =>
    ({
        name,
        isDirectory: () => isDir,
        isFile: () => !isDir,
    }) as unknown as Dirent;

describe('FileSkillsLoader', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('loadSkills', () => {
        it('마크다운 파일을 읽고 Skill 배열을 반환한다', async () => {
            mockReaddir.mockResolvedValue([makeDirent('test.md')]);
            mockReadFile.mockResolvedValue(validFrontmatter);

            const loader = new FileSkillsLoader();
            const skills = await loader.loadSkills();

            expect(skills).toHaveLength(1);
            expect(skills[0].name).toBe('Test Skill');
            expect(skills[0].description).toBe('Test description');
            expect(skills[0].type).toBe('pattern');
            expect(skills[0].category).toBe('reversal_bullish');
            expect(skills[0].confidenceWeight).toBe(0.8);
        });

        it('frontmatter가 없는 파일은 제외한다', async () => {
            mockReaddir.mockResolvedValue([makeDirent('no-frontmatter.md')]);
            mockReadFile.mockResolvedValue('no frontmatter here');

            const loader = new FileSkillsLoader();
            const skills = await loader.loadSkills();

            expect(skills).toHaveLength(0);
        });

        it('마크다운 파일이 없으면 빈 배열을 반환한다', async () => {
            mockReaddir.mockResolvedValue([]);

            const loader = new FileSkillsLoader();
            const skills = await loader.loadSkills();

            expect(skills).toHaveLength(0);
        });

        it('하위 디렉토리의 파일도 재귀적으로 읽는다', async () => {
            mockReaddir
                .mockResolvedValueOnce([
                    makeDirent('subdir', true),
                    makeDirent('root.md'),
                ])
                .mockResolvedValueOnce([makeDirent('nested.md')]);
            mockReadFile.mockResolvedValue(validFrontmatter);

            const loader = new FileSkillsLoader();
            const skills = await loader.loadSkills();

            expect(skills).toHaveLength(2);
        });

        it('indicators가 배열로 파싱된다', async () => {
            mockReaddir.mockResolvedValue([makeDirent('test.md')]);
            mockReadFile.mockResolvedValue(validFrontmatter);

            const loader = new FileSkillsLoader();
            const skills = await loader.loadSkills();

            expect(Array.isArray(skills[0].indicators)).toBe(true);
            expect(skills[0].indicators).toContain('RSI');
            expect(skills[0].indicators).toContain('MACD');
        });

        it('.md가 아닌 파일은 무시한다', async () => {
            mockReaddir.mockResolvedValue([
                makeDirent('test.txt'),
                makeDirent('image.png'),
            ]);

            const loader = new FileSkillsLoader();
            const skills = await loader.loadSkills();

            expect(skills).toHaveLength(0);
            expect(mockReadFile).not.toHaveBeenCalled();
        });
    });
});
