import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('node:fs/promises');

import { readdir, readFile } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import {
    FileSkillsLoader,
    countSkillFiles,
    createSkillsProvider,
    loadSkillsCached,
    clearSkillsCache,
} from '@/infrastructure/skills/loader';
import type { SkillCounts } from '@/domain/types';

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
                s => s.category === 'fundamental'
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
            const news = skills.filter(s => s.category === 'news');

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
            expect(skills.some(s => s.category === 'fundamental')).toBe(true);
            expect(skills.some(s => s.category === 'reversal_bullish')).toBe(
                true
            );
        });
    });
});

describe('countSkillFiles', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('모든 카테고리 디렉토리에서 파일 수를 합산한다', async () => {
        // Each call to readdir returns a different set of files per subdirectory
        mockReaddir
            .mockResolvedValueOnce([
                makeDirent('rsi.md'),
                makeDirent('macd.md'),
            ]) // indicators — 2
            .mockResolvedValueOnce([makeDirent('doji.md')]) // candlesticks — 1
            .mockResolvedValueOnce([makeDirent('head-shoulders.md')]) // patterns — 1
            .mockResolvedValueOnce([
                makeDirent('breakout.md'),
                makeDirent('trend.md'),
            ]) // strategies — 2
            .mockResolvedValueOnce([makeDirent('support.md')]) // support-resistance — 1
            .mockResolvedValueOnce([
                makeDirent('dcf.md'),
                makeDirent('ratio.md'),
            ]) // fundamental — 2
            .mockResolvedValueOnce([makeDirent('earnings.md')]); // news — 1

        const counts = await countSkillFiles();

        expect(counts.indicators).toBe(2);
        expect(counts.candlesticks).toBe(1);
        expect(counts.patterns).toBe(1);
        expect(counts.strategies).toBe(2);
        expect(counts.supportResistance).toBe(1);
        expect(counts.fundamental).toBe(2);
        expect(counts.news).toBe(1);
    });

    it('SkillCounts 타입의 모든 필드를 반환한다', async () => {
        // All directories empty
        mockReaddir.mockResolvedValue([]);

        const counts = await countSkillFiles();

        // Regression test: if a field is missing from countSkillFiles, this assertion fails.
        const expectedKeys: Array<keyof SkillCounts> = [
            'indicators',
            'candlesticks',
            'patterns',
            'strategies',
            'supportResistance',
            'fundamental',
            'news',
        ];
        expect(Object.keys(counts).sort()).toEqual(expectedKeys.sort());
    });

    it('fundamental 디렉토리가 비어 있으면 0을 반환한다', async () => {
        mockReaddir.mockResolvedValue([]);

        const counts = await countSkillFiles();

        expect(counts.fundamental).toBe(0);
        expect(counts.news).toBe(0);
    });

    it('디렉토리 내 .md가 아닌 파일은 집계에서 제외한다', async () => {
        // indicators dir has 1 md + 1 non-md; countMdFiles filters non-.md
        mockReaddir
            .mockResolvedValueOnce([
                makeDirent('rsi.md'),
                makeDirent('image.png'),
            ]) // indicators — only 1 md
            .mockResolvedValue([]); // all other dirs empty

        const counts = await countSkillFiles();

        expect(counts.indicators).toBe(1);
    });
});

// ─────────────────────────────────────────
// IC-4: loadSkillsCached — module-level memoization
// ─────────────────────────────────────────

describe('loadSkillsCached', () => {
    beforeEach(() => {
        clearSkillsCache();
        // Simulate no skill files found (empty skills dir)
        mockReaddir.mockResolvedValue([]);
    });

    afterEach(() => {
        clearSkillsCache();
    });

    it('첫 번째 호출에서 FileSkillsLoader.loadSkills 를 호출한다', async () => {
        const loadSkillsSpy = vi.spyOn(
            FileSkillsLoader.prototype,
            'loadSkills'
        );

        await loadSkillsCached();

        expect(loadSkillsSpy).toHaveBeenCalledTimes(1);
        loadSkillsSpy.mockRestore();
    });

    it('두 번째 호출에서는 FileSkillsLoader.loadSkills 를 호출하지 않는다 (캐시 히트)', async () => {
        const loadSkillsSpy = vi
            .spyOn(FileSkillsLoader.prototype, 'loadSkills')
            .mockResolvedValue([]);

        await loadSkillsCached();
        await loadSkillsCached();

        expect(loadSkillsSpy).toHaveBeenCalledTimes(1);
        loadSkillsSpy.mockRestore();
    });

    it('성공 시 skills 배열과 skillsDegraded: false 를 반환한다', async () => {
        const loadSkillsSpy = vi
            .spyOn(FileSkillsLoader.prototype, 'loadSkills')
            .mockResolvedValue([]);

        const result = await loadSkillsCached();

        expect(result.skills).toEqual([]);
        expect(result.skillsDegraded).toBe(false);
        loadSkillsSpy.mockRestore();
    });

    it('loadSkills 가 실패하면 skills: [], skillsDegraded: true 를 반환한다', async () => {
        const loadSkillsSpy = vi
            .spyOn(FileSkillsLoader.prototype, 'loadSkills')
            .mockRejectedValue(new Error('ENOENT'));

        const result = await loadSkillsCached();

        expect(result.skills).toEqual([]);
        expect(result.skillsDegraded).toBe(true);
        loadSkillsSpy.mockRestore();
    });

    it('loadSkills 가 실패하면 console.error 를 호출한다', async () => {
        const error = new Error('ENOENT: no such file or directory');
        const loadSkillsSpy = vi
            .spyOn(FileSkillsLoader.prototype, 'loadSkills')
            .mockRejectedValue(error);
        const consoleErrorSpy = vi
            .spyOn(console, 'error')
            .mockImplementation(() => {});

        await loadSkillsCached();

        expect(consoleErrorSpy).toHaveBeenCalledWith(
            '[loadSkillsCached] Skills load failed:',
            error
        );
        loadSkillsSpy.mockRestore();
        consoleErrorSpy.mockRestore();
    });

    it('clearSkillsCache 호출 후 다시 loadSkills 를 호출한다', async () => {
        const loadSkillsSpy = vi
            .spyOn(FileSkillsLoader.prototype, 'loadSkills')
            .mockResolvedValue([]);

        await loadSkillsCached();
        clearSkillsCache();
        await loadSkillsCached();

        expect(loadSkillsSpy).toHaveBeenCalledTimes(2);
        loadSkillsSpy.mockRestore();
    });
});

// ─────────────────────────────────────────
// createSkillsProvider — factory wrapper for SkillsProvider port
// ─────────────────────────────────────────

describe('createSkillsProvider', () => {
    it('FileSkillsLoader 인스턴스를 SkillsProvider로 반환한다', () => {
        const provider = createSkillsProvider();

        expect(provider).toBeInstanceOf(FileSkillsLoader);
    });

    it('호출마다 새로운 인스턴스를 생성한다', () => {
        const first = createSkillsProvider();
        const second = createSkillsProvider();

        expect(first).not.toBe(second);
    });

    it('반환된 provider는 loadSkills 메서드를 노출한다', () => {
        const provider = createSkillsProvider();

        expect(typeof provider.loadSkills).toBe('function');
    });
});
