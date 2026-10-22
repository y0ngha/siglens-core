import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('node:fs/promises');

import { readdir, readFile } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import {
    createSkillsProvider,
    loadSkillsCached,
    clearSkillsCache,
} from '@/infrastructure/skills/loader';
import { createSkillSamplingPlan } from '@/infrastructure/skills/sampling';
import { hashSkillCatalog } from '@/infrastructure/hash/analysisInput';
import { withDigest } from '@/__tests__/infrastructure/skills/digestFixture';

const mockReaddir = readdir as Mock;
const mockReadFile = readFile as Mock;

const makeDirent = (name: string, isDir = false): Dirent =>
    ({
        name,
        isDirectory: () => isDir,
        isFile: () => !isDir,
    }) as unknown as Dirent;

// A realistic mixed catalog: an always_on pattern, an event-gated indicator
// guide (with token_cost), and a state-gated indicator guide. These are exactly
// the fields hashSkillCatalog projects (name / gating / tokenCost).
const ALWAYS_ON = `---
name: Head and Shoulders
description: Reversal pattern
type: pattern
category: reversal_bearish
indicators: []
confidence_weight: 0.9
gating:
  tier: always_on
---
${withDigest('Pattern body')}`;

const EVENT_GATED = `---
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
${withDigest('RSI body')}`;

const STATE_GATED = `---
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
token_cost: 600
---
${withDigest('Bollinger body')}`;

/**
 * C1 — determinism guard for the SHARED skill-catalog fingerprint.
 *
 * Every cache-key site funnels through the SAME single loader: the write path
 * (`runAnalysis`) calls `loadSkillsCached()` to load the raw catalog, then
 * tier-samples it through
 * `createSkillSamplingPlan()` (which internally hashes the SAMPLED set via
 * `hashSkillCatalog`). `pollAnalysis` is the intentional exception documented
 * on `loadSkillsCached`: it fingerprints its own provider-loaded skills
 * directly. Because there is only one loader, one sampler, and one hash, this
 * suite is NOT a cross-call-site drift guard: it cannot catch a future edit
 * that makes two production sites compute the fingerprint differently, since
 * the test re-derives both sides from that same shared loader/sampler rather
 * than from the production call sites themselves. (No production site
 * exposes a pure fingerprint helper to import and compare against, so a
 * genuine parity assertion across sites is not available here.)
 *
 * What it DOES prove — and what would genuinely fail if regressed — is that the
 * single shared loader + `hashSkillCatalog` are deterministic, specifically:
 *   - order-independence: the digest is unchanged when the file-walk visits the
 *     same catalog in a different (reversed) order, because `hashSkillCatalog`
 *     sorts by `name` (the falsifiable core of this suite);
 *   - dedupe + projection stability: the loader's by-`name` dedupe and the
 *     `name`/`gating`/`tokenCost` projection feed the hash consistently for the
 *     mixed `always_on` / event-gated / state-gated catalog below;
 *   - the tier-sampling fingerprint (`createSkillSamplingPlan`, the composition
 *     the real submit/peek paths use) is itself deterministic across two calls
 *     with identical (skills, tier, seedParts) and equals `hashSkillCatalog`
 *     of its own sampled set, so the read/write cache-key parity holds on the
 *     tier-sampled fingerprint, not the raw unsampled catalog.
 *
 * The byte-identical assertions below therefore document that the read and
 * write paths share one deterministic fingerprint source — not that two
 * independent derivations were checked for parity.
 */
describe('C1: shared skill-catalog fingerprint determinism (order/dedupe/projection)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        clearSkillsCache();
    });
    afterEach(() => {
        clearSkillsCache();
    });

    it('the direct loader and the cached loader produce a byte-identical fingerprint for one catalog', async () => {
        mockReaddir.mockResolvedValue([
            makeDirent('hns.md'),
            makeDirent('rsi.md'),
            makeDirent('bollinger.md'),
        ]);
        mockReadFile
            .mockResolvedValueOnce(ALWAYS_ON)
            .mockResolvedValueOnce(EVENT_GATED)
            .mockResolvedValueOnce(STATE_GATED);

        // A write-path shape (a prior implementation used it): a direct
        // `createSkillsProvider().loadSkills()` fed to `hashSkillCatalog`.
        const pollSkills = await createSkillsProvider().loadSkills();
        const pollFingerprint = hashSkillCatalog(pollSkills);

        clearSkillsCache();
        mockReaddir.mockResolvedValue([
            makeDirent('hns.md'),
            makeDirent('rsi.md'),
            makeDirent('bollinger.md'),
        ]);
        mockReadFile
            .mockResolvedValueOnce(ALWAYS_ON)
            .mockResolvedValueOnce(EVENT_GATED)
            .mockResolvedValueOnce(STATE_GATED);

        // The cached-loader shape the write path uses (the peek no longer
        // samples skills — it reads the peek pointer key):
        // `loadSkillsCached()` (which wraps the SAME loader) fed to the same hash.
        const { skills: readSkills } = await loadSkillsCached();
        const readFingerprint = hashSkillCatalog(readSkills);

        // Byte-identical: same string, not just same length/prefix. This holds
        // because both go through the one shared loader + hash — it documents
        // the shared source, it does not independently verify two call sites.
        expect(pollFingerprint).toBe(readFingerprint);
    });

    it('stays identical even when the loader walks files in a different order', async () => {
        // The falsifiable core of this suite: a real regression in
        // `hashSkillCatalog`'s sort-by-name (or the loader's dedupe/projection)
        // would change the digest below and fail this test.
        //
        // First load walks hns → rsi → bollinger.
        mockReaddir.mockResolvedValue([
            makeDirent('hns.md'),
            makeDirent('rsi.md'),
            makeDirent('bollinger.md'),
        ]);
        mockReadFile
            .mockResolvedValueOnce(ALWAYS_ON)
            .mockResolvedValueOnce(EVENT_GATED)
            .mockResolvedValueOnce(STATE_GATED);
        const pollFingerprint = hashSkillCatalog(
            await createSkillsProvider().loadSkills()
        );

        clearSkillsCache();
        // Second load walks the SAME files in REVERSE order. The fingerprint
        // sorts by name, so the digest must be unchanged despite the walk order.
        mockReaddir.mockResolvedValue([
            makeDirent('bollinger.md'),
            makeDirent('rsi.md'),
            makeDirent('hns.md'),
        ]);
        mockReadFile
            .mockResolvedValueOnce(STATE_GATED)
            .mockResolvedValueOnce(EVENT_GATED)
            .mockResolvedValueOnce(ALWAYS_ON);
        const readFingerprint = hashSkillCatalog(
            (await loadSkillsCached()).skills
        );

        expect(pollFingerprint).toBe(readFingerprint);
    });

    it('createSkillSamplingPlan, the shared write/read tier-sampling step, is deterministic for identical (skills, tier, seedParts)', async () => {
        mockReaddir.mockResolvedValue([
            makeDirent('rsi.md'),
            makeDirent('bollinger.md'),
        ]);
        mockReadFile
            .mockResolvedValueOnce(EVENT_GATED)
            .mockResolvedValueOnce(STATE_GATED);
        // Conceptual write path: runAnalysis loads via loadSkillsCached()
        // then tier-samples the loaded catalog.
        const { skills: writeSkills } = await loadSkillsCached();
        const writePlan = createSkillSamplingPlan(writeSkills, 'free', [
            'technical',
            'AAPL',
            '1Day',
        ]);

        clearSkillsCache();
        mockReaddir.mockResolvedValue([
            makeDirent('rsi.md'),
            makeDirent('bollinger.md'),
        ]);
        mockReadFile
            .mockResolvedValueOnce(EVENT_GATED)
            .mockResolvedValueOnce(STATE_GATED);
        // Conceptual read path: peekAnalysisCache loads via the same
        // loadSkillsCached() then tier-samples with the same seed parts, so
        // it must reproduce the exact write-path fingerprint.
        const { skills: readSkills } = await loadSkillsCached();
        const readPlan = createSkillSamplingPlan(readSkills, 'free', [
            'technical',
            'AAPL',
            '1Day',
        ]);

        expect(readPlan.fingerprint).toBe(writePlan.fingerprint);
        // The plan's fingerprint is exactly hashSkillCatalog of the SAMPLED
        // set (not the raw catalog), which is what createSkillSamplingPlan
        // pins internally.
        expect(writePlan.fingerprint).toBe(hashSkillCatalog(writePlan.skills));
        expect(readPlan.fingerprint).toBe(hashSkillCatalog(readPlan.skills));
    });
});
