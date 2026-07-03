import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('node:fs/promises');

import { readdir, readFile } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { FileSkillsLoader } from '@/infrastructure/skills/loader';
import { withDigest } from '@/__tests__/infrastructure/skills/digestFixture';

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
  signal_kind: event
  triggers: [rsi_oversold, rsi_overbought]
token_cost: 850
---
${withDigest('RSI body content')}`;

const stateGatedFrontmatter = `---
name: Bollinger Guide
description: Bollinger interpretation
type: indicator_guide
category: neutral
indicators: [Bollinger]
confidence_weight: 0.8
gating:
  tier: gated
  signal_kind: state
  state:
    feature: bollinger
    predicate: pctB
    hi: 0.98
    lo: 0.02
---
${withDigest('Bollinger body content')}`;

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
${withDigest('Pattern body content')}`;

const untaggedFrontmatter = `---
name: Legacy Skill
description: No gating block
type: pattern
category: neutral
indicators: []
confidence_weight: 0.7
---
${withDigest('Legacy body')}`;

describe('FileSkillsLoader gating frontmatter', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('maps snake_case signal_kind/token_cost frontmatter to camelCase Skill fields', async () => {
        mockReaddir.mockResolvedValue([makeDirent('rsi.md')]);
        mockReadFile.mockResolvedValue(eventGatedFrontmatter);

        const skills = await new FileSkillsLoader().loadSkills();

        expect(skills).toHaveLength(1);
        // Frontmatter authored `signal_kind` / `token_cost` (snake_case, the
        // repo convention); the loader exposes them camelCased.
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

    it('parses an always_on gating block (no signal_kind required)', async () => {
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
        expect(skills[0].smcFullGuide).toBe(false);
    });

    it('maps the snake_case smc_full_guide flag to smcFullGuide', async () => {
        const smcGuide = `---
name: Renamed SMC Skill
description: SMC full guide identified by flag, not name
type: indicator_guide
category: neutral
indicators: []
confidence_weight: 0.8
smc_full_guide: true
gating:
  tier: always_on
---
${withDigest('SMC body content')}`;
        mockReaddir.mockResolvedValue([makeDirent('smc.md')]);
        mockReadFile.mockResolvedValue(smcGuide);

        const skills = await new FileSkillsLoader().loadSkills();

        expect(skills[0].smcFullGuide).toBe(true);
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
${withDigest('Body')}`;
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
  signal_kind: event
---
${withDigest('Body')}`;
        mockReaddir.mockResolvedValue([makeDirent('unreachable.md')]);
        mockReadFile.mockResolvedValue(gatedNoPath);

        const skills = await new FileSkillsLoader().loadSkills();

        expect(skills[0].gating).toBeUndefined();
    });

    it('drops a gated block whose signal_kind is an unknown literal (parseGating reject)', async () => {
        // `signal_kind: momentum` is not in SIGNAL_KINDS (event | state). These
        // .md files are untrusted authored input, so the rejection path must
        // fail safe to `undefined` rather than produce a malformed gating shape.
        const badSignalKind = `---
name: Bad Signal Kind
description: signal_kind is not event or state
type: pattern
category: neutral
indicators: []
confidence_weight: 0.7
gating:
  tier: gated
  signal_kind: momentum
  triggers: [rsi_oversold]
---
${withDigest('Body')}`;
        mockReaddir.mockResolvedValue([makeDirent('bad-signal-kind.md')]);
        mockReadFile.mockResolvedValue(badSignalKind);

        const skills = await new FileSkillsLoader().loadSkills();

        expect(skills).toHaveLength(1);
        expect(skills[0].gating).toBeUndefined();
    });

    it('drops a state block whose feature is unknown (parseStatePredicate reject)', async () => {
        // `feature: momentum` is not in SKILL_STATE_FEATURES — parseStatePredicate
        // returns undefined, which bubbles up to drop the whole gating block.
        const badFeature = `---
name: Bad State Feature
description: state.feature is not a known feature
type: indicator_guide
category: neutral
indicators: []
confidence_weight: 0.8
gating:
  tier: gated
  signal_kind: state
  state:
    feature: momentum
    predicate: pctB
    hi: 0.98
---
${withDigest('Body')}`;
        mockReaddir.mockResolvedValue([makeDirent('bad-feature.md')]);
        mockReadFile.mockResolvedValue(badFeature);

        const skills = await new FileSkillsLoader().loadSkills();

        expect(skills[0].gating).toBeUndefined();
    });

    it('drops a state block whose predicate is unknown (parseStatePredicate reject)', async () => {
        // `predicate: slope` is not in SKILL_STATE_PREDICATE_KINDS — the
        // predicate is rejected and the gating block falls back to undefined.
        const badPredicate = `---
name: Bad State Predicate
description: state.predicate is not a known predicate kind
type: indicator_guide
category: neutral
indicators: []
confidence_weight: 0.8
gating:
  tier: gated
  signal_kind: state
  state:
    feature: bollinger
    predicate: slope
    hi: 0.98
---
${withDigest('Body')}`;
        mockReaddir.mockResolvedValue([makeDirent('bad-predicate.md')]);
        mockReadFile.mockResolvedValue(badPredicate);

        const skills = await new FileSkillsLoader().loadSkills();

        expect(skills[0].gating).toBeUndefined();
    });

    it('parses a state predicate with neither hi nor lo (both optional bounds omitted)', async () => {
        // A `level`/`channelProximity`-style predicate may carry no numeric
        // bound. Both conditional spreads in parseStatePredicate fall to their
        // empty-object branch, so the predicate is valid but has no hi/lo keys.
        const noBounds = `---
name: Bound-free State
description: state predicate with no hi and no lo
type: indicator_guide
category: neutral
indicators: []
confidence_weight: 0.8
gating:
  tier: gated
  signal_kind: state
  state:
    feature: vwap
    predicate: level
---
${withDigest('Body')}`;
        mockReaddir.mockResolvedValue([makeDirent('no-bounds.md')]);
        mockReadFile.mockResolvedValue(noBounds);

        const skills = await new FileSkillsLoader().loadSkills();

        expect(skills[0].gating).toEqual({
            tier: 'gated',
            signalKind: 'state',
            state: { feature: 'vwap', predicate: 'level' },
        });
        // Both optional bounds were omitted, not set to undefined.
        if (
            skills[0].gating?.tier === 'gated' &&
            skills[0].gating.signalKind === 'state'
        ) {
            expect('hi' in skills[0].gating.state).toBe(false);
            expect('lo' in skills[0].gating.state).toBe(false);
        }
    });

    it('ignores a non-numeric token_cost', async () => {
        const badToken = `---
name: Bad Token
description: token_cost is a string
type: pattern
category: neutral
indicators: []
confidence_weight: 0.7
token_cost: lots
---
${withDigest('Body')}`;
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
${withDigest('First body')}`;
        const secondLoses = `---
name: Duplicate
description: second occurrence
type: pattern
category: neutral
indicators: []
confidence_weight: 0.1
---
${withDigest('Second body')}`;
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
