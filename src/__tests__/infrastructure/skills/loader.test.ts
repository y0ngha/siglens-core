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

        it('fundamental 카테고리 스킬을 로드한다', async () => {
            const fundamentalFrontmatter = `---
name: Value Investing
description: DCF-based value investing framework
type: strategy
category: fundamental
indicators: []
confidence_weight: 0.8
---
Focus on intrinsic value and margin of safety.`;

            mockReaddir.mockResolvedValue([makeDirent('value-investing.md')]);
            mockReadFile.mockResolvedValue(fundamentalFrontmatter);

            const loader = new FileSkillsLoader();
            const skills = await loader.loadSkills();
            const fundamental = skills.filter(
                (s) => s.category === 'fundamental',
            );

            expect(fundamental.length).toBeGreaterThanOrEqual(1);
            expect(fundamental[0].category).toBe('fundamental');
            expect(fundamental[0].name).toBe('Value Investing');
        });

        it('news 카테고리 스킬을 로드한다', async () => {
            const newsFrontmatter = `---
name: Event Driven
description: Event-driven news reaction framework
type: strategy
category: news
indicators: []
confidence_weight: 0.7
---
Analyze market-moving news events and their impact on price.`;

            mockReaddir.mockResolvedValue([makeDirent('event-driven.md')]);
            mockReadFile.mockResolvedValue(newsFrontmatter);

            const loader = new FileSkillsLoader();
            const skills = await loader.loadSkills();
            const news = skills.filter((s) => s.category === 'news');

            expect(news.length).toBeGreaterThanOrEqual(1);
            expect(news[0].category).toBe('news');
            expect(news[0].name).toBe('Event Driven');
        });

        it('fundamental/news 카테고리가 기존 카테고리와 함께 로드된다', async () => {
            const fundamentalFrontmatter = `---
name: Quality Investing
description: Quality factors framework
type: strategy
category: fundamental
indicators: []
confidence_weight: 0.9
---
Focus on high-quality businesses with durable competitive advantages.`;

            const technicalFrontmatter = `---
name: Reversal Pattern
description: Bullish reversal pattern
type: pattern
category: reversal_bullish
indicators: [RSI]
confidence_weight: 0.8
---
Identifies bullish reversal setups.`;

            mockReaddir.mockResolvedValue([
                makeDirent('quality-investing.md'),
                makeDirent('reversal.md'),
            ]);
            mockReadFile
                .mockResolvedValueOnce(fundamentalFrontmatter)
                .mockResolvedValueOnce(technicalFrontmatter);

            const loader = new FileSkillsLoader();
            const skills = await loader.loadSkills();

            expect(skills).toHaveLength(2);
            expect(
                skills.some((s) => s.category === 'fundamental'),
            ).toBe(true);
            expect(
                skills.some((s) => s.category === 'reversal_bullish'),
            ).toBe(true);
        });
    });
});
