import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('node:fs/promises');

import { readdir, readFile } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { FileSkillsLoader } from '@/infrastructure/skills/loader';

const mockReaddir = readdir as Mock;
const mockReadFile = readFile as Mock;

const makeDirent = (name: string, isDir = false): Dirent =>
    ({
        name,
        isDirectory: () => isDir,
        isFile: () => !isDir,
    }) as unknown as Dirent;

const eventGatedFrontmatter = `---
name: RSI Guide
description: RSI interpretation
type: indicator_guide
category: neutral
indicators: [RSI]
confidence_weight: 0.8
gating:
  tier: gated
  signalKind: event
  triggers: [rsi_oversold, rsi_overbought]
tokenCost: 850
---
RSI body content`;

const stateGatedFrontmatter = `---
name: Bollinger Guide
description: Bollinger interpretation
type: indicator_guide
category: neutral
indicators: [Bollinger]
confidence_weight: 0.8
gating:
  tier: gated
  signalKind: state
  state:
    feature: bollinger
    predicate: pctB
    hi: 0.98
    lo: 0.02
---
Bollinger body content`;

const alwaysOnFrontmatter = `---
name: Head and Shoulders
description: Reversal pattern
type: pattern
category: reversal_bearish
indicators: []
confidence_weight: 0.9
gating:
  tier: always_on
---
Pattern body content`;

const untaggedFrontmatter = `---
name: Legacy Skill
description: No gating block
type: pattern
category: neutral
indicators: []
confidence_weight: 0.7
---
Legacy body`;

describe('FileSkillsLoader gating frontmatter', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('parses an event gating block + tokenCost', async () => {
        mockReaddir.mockResolvedValue([makeDirent('rsi.md')]);
        mockReadFile.mockResolvedValue(eventGatedFrontmatter);

        const skills = await new FileSkillsLoader().loadSkills();

        expect(skills).toHaveLength(1);
        expect(skills[0].gating).toEqual({
            tier: 'gated',
            signalKind: 'event',
            triggers: ['rsi_oversold', 'rsi_overbought'],
        });
        expect(skills[0].tokenCost).toBe(850);
    });

    it('parses a state gating block with a nested predicate', async () => {
        mockReaddir.mockResolvedValue([makeDirent('bollinger.md')]);
        mockReadFile.mockResolvedValue(stateGatedFrontmatter);

        const skills = await new FileSkillsLoader().loadSkills();

        expect(skills[0].gating).toEqual({
            tier: 'gated',
            signalKind: 'state',
            state: {
                feature: 'bollinger',
                predicate: 'pctB',
                hi: 0.98,
                lo: 0.02,
            },
        });
    });

    it('parses an always_on gating block (no signalKind required)', async () => {
        mockReaddir.mockResolvedValue([makeDirent('hns.md')]);
        mockReadFile.mockResolvedValue(alwaysOnFrontmatter);

        const skills = await new FileSkillsLoader().loadSkills();

        expect(skills[0].gating).toEqual({ tier: 'always_on' });
    });

    it('leaves gating + tokenCost undefined for an untagged skill (fail-open)', async () => {
        mockReaddir.mockResolvedValue([makeDirent('legacy.md')]);
        mockReadFile.mockResolvedValue(untaggedFrontmatter);

        const skills = await new FileSkillsLoader().loadSkills();

        expect(skills[0].gating).toBeUndefined();
        expect(skills[0].tokenCost).toBeUndefined();
    });

    it('drops an invalid gating block to undefined (safe default)', async () => {
        const invalidTier = `---
name: Bad Tier
description: invalid tier value
type: pattern
category: neutral
indicators: []
confidence_weight: 0.7
gating:
  tier: sometimes
---
Body`;
        mockReaddir.mockResolvedValue([makeDirent('bad.md')]);
        mockReadFile.mockResolvedValue(invalidTier);

        const skills = await new FileSkillsLoader().loadSkills();

        expect(skills).toHaveLength(1);
        expect(skills[0].gating).toBeUndefined();
    });

    it('drops a gated block with no triggers and no state to undefined', async () => {
        const gatedNoPath = `---
name: Unreachable
description: gated but no path
type: pattern
category: neutral
indicators: []
confidence_weight: 0.7
gating:
  tier: gated
  signalKind: event
---
Body`;
        mockReaddir.mockResolvedValue([makeDirent('unreachable.md')]);
        mockReadFile.mockResolvedValue(gatedNoPath);

        const skills = await new FileSkillsLoader().loadSkills();

        expect(skills[0].gating).toBeUndefined();
    });

    it('ignores a non-numeric tokenCost', async () => {
        const badToken = `---
name: Bad Token
description: tokenCost is a string
type: pattern
category: neutral
indicators: []
confidence_weight: 0.7
tokenCost: lots
---
Body`;
        mockReaddir.mockResolvedValue([makeDirent('badtoken.md')]);
        mockReadFile.mockResolvedValue(badToken);

        const skills = await new FileSkillsLoader().loadSkills();

        expect(skills[0].tokenCost).toBeUndefined();
    });

    it('dedupes skills by name, keeping the first occurrence (stable)', async () => {
        const firstWins = `---
name: Duplicate
description: first occurrence
type: pattern
category: neutral
indicators: []
confidence_weight: 0.9
---
First body`;
        const secondLoses = `---
name: Duplicate
description: second occurrence
type: pattern
category: neutral
indicators: []
confidence_weight: 0.1
---
Second body`;
        mockReaddir.mockResolvedValue([makeDirent('a.md'), makeDirent('b.md')]);
        mockReadFile
            .mockResolvedValueOnce(firstWins)
            .mockResolvedValueOnce(secondLoses);

        const skills = await new FileSkillsLoader().loadSkills();

        expect(skills).toHaveLength(1);
        expect(skills[0].description).toBe('first occurrence');
        expect(skills[0].confidenceWeight).toBe(0.9);
    });
});
