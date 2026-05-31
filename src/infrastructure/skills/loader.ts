import { readdir, readFile } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { join } from 'node:path';
import type {
    Skill,
    SkillCategory,
    SkillCounts,
    SkillDisplay,
    SkillGating,
    SkillStateFeature,
    SkillStatePredicate,
    SkillStatePredicateKind,
    SkillType,
    SignalKind,
} from '@/domain/types';
import type { SkillsProvider } from '@/domain/ports/skillsProvider';
import { hashSkillCatalog } from '@/infrastructure/hash/analysisInput';
import type { LoadSkillsCachedResult } from './types';

const SKILLS_DIR = join(process.cwd(), 'skills');

const SKILL_CATEGORIES: readonly SkillCategory[] = [
    'reversal_bullish',
    'reversal_bearish',
    'continuation_bullish',
    'continuation_bearish',
    'neutral',
    'fundamental',
    'news',
];

const parseYamlValue = (value: string): unknown => {
    if (value === '[]') return [];
    if (value.startsWith('[') && value.endsWith(']')) {
        const inner = value.slice(1, -1).trim();
        if (inner === '') return [];
        return inner.split(',').map(s => s.trim().replace(/^['"]|['"]$/g, ''));
    }
    const num = Number(value);
    if (value !== '' && !isNaN(num)) return num;
    // 따옴표로 감싸진 문자열 처리
    if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
    ) {
        return value.slice(1, -1);
    }
    return value;
};

type YamlNode = Record<string, unknown>;

type ParsedLine =
    | { kind: 'skip' }
    | { kind: 'deeper' }
    | { kind: 'break' }
    | { kind: 'leaf'; key: string; value: unknown }
    | { kind: 'block'; key: string };

const classifyLine = (line: string, baseIndent: number): ParsedLine => {
    const trimmed = line.trimStart();
    if (trimmed === '' || !trimmed.includes(':')) return { kind: 'skip' };

    const indent = line.length - trimmed.length;
    if (indent < baseIndent) return { kind: 'break' };
    if (indent > baseIndent) return { kind: 'deeper' };

    const colonIdx = trimmed.indexOf(':');
    const key = trimmed.slice(0, colonIdx).trim();
    const rawVal = trimmed.slice(colonIdx + 1).trim();

    if (rawVal !== '')
        return { kind: 'leaf', key, value: parseYamlValue(rawVal) };
    return { kind: 'block', key };
};

const parseYamlBlock = (lines: string[], baseIndent: number): YamlNode => {
    const result: YamlNode = {};
    let i = 0;
    while (i < lines.length) {
        const classified = classifyLine(lines[i], baseIndent);
        if (classified.kind === 'break') break;
        if (classified.kind === 'skip' || classified.kind === 'deeper') {
            i++;
            continue;
        }
        if (classified.kind === 'leaf') {
            result[classified.key] = classified.value;
            i++;
            continue;
        }
        // block kind
        const { key } = classified;
        const childLines = lines.slice(i + 1).filter(childLine => {
            const childTrimmed = childLine.trimStart();
            if (childTrimmed === '') return true;
            const childIndent = childLine.length - childTrimmed.length;
            return childIndent > baseIndent;
        });
        result[key] = parseYamlBlock(childLines, baseIndent + 2);
        i += 1 + childLines.length;
    }
    return result;
};

const parseFrontmatter = (
    raw: string
): { data: Record<string, unknown>; content: string } | null => {
    const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(raw);
    if (!match) return null;

    const lines = match[1].split('\n');
    const data = parseYamlBlock(lines, 0);

    return { data, content: match[2].trim() };
};

const isSkillCategory = (value: unknown): value is SkillCategory =>
    typeof value === 'string' &&
    (SKILL_CATEGORIES as readonly string[]).includes(value);

const parseSkillDisplay = (raw: unknown): SkillDisplay | undefined => {
    if (typeof raw !== 'object' || raw === null) return undefined;

    // typeof raw === 'object' && raw !== null guard passed; cast is safe
    const obj = raw as YamlNode;
    const chartRaw = obj.chart;
    if (typeof chartRaw !== 'object' || chartRaw === null) return undefined;

    // typeof chartRaw === 'object' && chartRaw !== null guard passed; cast is safe
    const chart = chartRaw as YamlNode;
    if (
        typeof chart.show !== 'boolean' &&
        chart.show !== 'true' &&
        chart.show !== 'false'
    )
        return undefined;

    const show =
        typeof chart.show === 'boolean' ? chart.show : chart.show === 'true';
    const type = String(chart.type ?? '');
    const color = String(chart.color ?? '');
    const label = String(chart.label ?? '');

    if (type !== 'line' && type !== 'marker' && type !== 'region')
        return undefined;

    return {
        chart: { show, type, color, label },
    };
};

const SKILL_TYPES: readonly SkillType[] = [
    'pattern',
    'indicator_guide',
    'strategy',
    'candlestick',
    'support_resistance',
];

const isSkillType = (value: unknown): value is SkillType =>
    typeof value === 'string' &&
    (SKILL_TYPES as readonly string[]).includes(value);

const SKILL_GATING_TIERS: readonly SkillGating['tier'][] = [
    'always_on',
    'gated',
];
const SIGNAL_KINDS: readonly SignalKind[] = ['event', 'state'];
const SKILL_STATE_FEATURES: readonly SkillStateFeature[] = [
    'bollinger',
    'keltner',
    'williamsR',
    'stochastic',
    'stochRsi',
    'donchian',
    'vwap',
    'buySellVolume',
];
const SKILL_STATE_PREDICATE_KINDS: readonly SkillStatePredicateKind[] = [
    'pctB',
    'bandDistAtr',
    'level',
    'ratio',
    'channelProximity',
];

/** Parse a state predicate; returns undefined when any required field is invalid. */
const parseStatePredicate = (raw: unknown): SkillStatePredicate | undefined => {
    if (typeof raw !== 'object' || raw === null) return undefined;
    const obj = raw as YamlNode;
    const { feature, predicate, hi, lo } = obj;
    if (
        typeof feature !== 'string' ||
        !(SKILL_STATE_FEATURES as readonly string[]).includes(feature) ||
        typeof predicate !== 'string' ||
        !(SKILL_STATE_PREDICATE_KINDS as readonly string[]).includes(predicate)
    ) {
        return undefined;
    }
    return {
        feature: feature as SkillStateFeature,
        predicate: predicate as SkillStatePredicateKind,
        ...(typeof hi === 'number' ? { hi } : {}),
        ...(typeof lo === 'number' ? { lo } : {}),
    };
};

/**
 * Validate and normalize a `gating` frontmatter block.
 *
 * Frontmatter keys are snake_case (repo convention, matching `confidence_weight`):
 * `signal_kind` maps to the camelCase {@link SkillGating} `signalKind` field.
 *
 * Returns `undefined` (the loader's safe default — the skill is then treated as
 * untagged and {@link selectSkills} includes it fail-open) when the block is
 * malformed or unreachable:
 * - `tier` not in {@link SKILL_GATING_TIERS};
 * - `tier: gated` with a missing/invalid `signal_kind`;
 * - `signal_kind: event` with no non-empty `triggers`;
 * - `signal_kind: state` with no valid `state` predicate.
 *
 * The downstream PR3 validation CI rejects unreachable gated skills at build
 * time; here we simply fail safe so a bad block never crashes the loader.
 */
const parseGating = (raw: unknown): SkillGating | undefined => {
    if (typeof raw !== 'object' || raw === null) return undefined;
    const obj = raw as YamlNode;
    const tier = obj.tier;
    if (
        typeof tier !== 'string' ||
        !(SKILL_GATING_TIERS as readonly string[]).includes(tier)
    ) {
        return undefined;
    }
    if (tier === 'always_on') return { tier: 'always_on' };

    // tier === 'gated' → a signal_kind path is required.
    // Frontmatter key is snake_case (`signal_kind`); map → camelCase `signalKind`.
    const signalKind = obj.signal_kind;
    if (
        typeof signalKind !== 'string' ||
        !(SIGNAL_KINDS as readonly string[]).includes(signalKind)
    ) {
        return undefined;
    }

    if (signalKind === 'event') {
        const triggers = obj.triggers;
        if (
            !Array.isArray(triggers) ||
            triggers.length === 0 ||
            !triggers.every((t): t is string => typeof t === 'string')
        ) {
            return undefined;
        }
        return {
            tier: 'gated',
            signalKind: 'event',
            triggers: triggers as string[],
        };
    }

    // signalKind === 'state'
    const state = parseStatePredicate(obj.state);
    if (state === undefined) return undefined;
    return { tier: 'gated', signalKind: 'state', state };
};

/**
 * Coerce a frontmatter boolean. The minimal YAML parser keeps an unquoted
 * `true` as the string `'true'` (it only special-cases arrays/numbers), so a
 * flag must accept both the boolean and the string form.
 */
const isYamlTrue = (value: unknown): boolean =>
    value === true || value === 'true';

const toSkill = (data: Record<string, unknown>, content: string): Skill => ({
    name: String(data.name ?? ''),
    description: String(data.description ?? ''),
    type: isSkillType(data.type) ? data.type : undefined,
    category: isSkillCategory(data.category) ? data.category : undefined,
    pattern: data.pattern != null ? String(data.pattern) : undefined,
    indicators: Array.isArray(data.indicators)
        ? (data.indicators as string[])
        : [],
    confidenceWeight:
        typeof data.confidence_weight === 'number' ? data.confidence_weight : 0,
    content,
    display: parseSkillDisplay(data.display),
    gating: parseGating(data.gating),
    // Frontmatter is snake_case by repo convention (matching `confidence_weight`);
    // map snake → camel here. PR3 authors `token_cost` / `signal_kind` in `skills/*.md`.
    tokenCost:
        typeof data.token_cost === 'number' ? data.token_cost : undefined,
    smcFullGuide: isYamlTrue(data.smc_full_guide),
});

/**
 * Drop duplicate skills by `name`, keeping the first occurrence.
 *
 * Two `.md` files declaring the same `name` would otherwise both reach the
 * prompt and the cache fingerprint. The loader's file walk is deterministic
 * (stable `readdir` order), so "first wins" yields a stable, reproducible
 * catalog. The relative order of the surviving skills is preserved.
 */
const dedupeByName = (skills: Skill[]): Skill[] => {
    const seen = new Set<string>();
    const result: Skill[] = [];
    for (const skill of skills) {
        if (seen.has(skill.name)) continue;
        seen.add(skill.name);
        result.push(skill);
    }
    return result;
};

const collectMdFiles = async (dir: string): Promise<string[]> => {
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
};

const countMdFiles = async (subdir: string): Promise<number> => {
    const files = await collectMdFiles(join(SKILLS_DIR, subdir));
    return files.length;
};

// ─────────────────────────────────────────
// Module-level cached loader
// ─────────────────────────────────────────

let _cachedSkills: Skill[] | null = null;
let _cachedSkillsDegraded: boolean = false;

/**
 * Load all skills from disk, memoizing the result for the module lifetime.
 *
 * The first call invokes {@link createSkillsProvider} and calls
 * `loadSkills()` on the returned provider, then stores the result.
 * Subsequent calls return the cached array without hitting the filesystem
 * again. On failure the cache is set to `[]` so the second call does not
 * retry the filesystem unnecessarily.
 *
 * Use {@link clearSkillsCache} in test setup/teardown to reset memoization.
 *
 * @returns `{ skills, skillsDegraded }` — `skillsDegraded` is `true` when
 *   the filesystem load threw and the skills list is empty.
 * @internal
 */
export async function loadSkillsCached(): Promise<LoadSkillsCachedResult> {
    if (_cachedSkills !== null) {
        return { skills: _cachedSkills, skillsDegraded: _cachedSkillsDegraded };
    }
    try {
        _cachedSkills = await createSkillsProvider().loadSkills();
        _cachedSkillsDegraded = false;
    } catch (error) {
        console.error('[loadSkillsCached] Skills load failed:', error);
        _cachedSkills = [];
        _cachedSkillsDegraded = true;
    }
    return { skills: _cachedSkills, skillsDegraded: _cachedSkillsDegraded };
}

/**
 * Deterministic fingerprint of the cached skill catalog's selection metadata,
 * folded into the chart and fundamental cache keys.
 *
 * This is the single named source of the read/write key contract: every app
 * site that builds an analysis cache key derives the fingerprint through this
 * helper, so the submit (write) and peek (read) paths cannot drift. Because
 * {@link loadSkillsCached} is memoized, repeated calls reuse the loaded catalog.
 *
 * `pollAnalysis` is the intentional exception — it fingerprints its own
 * provider-loaded `skills` (the load that fed `enrichAnalysisWithConfidence`),
 * so the cached label always matches the data actually used by that path.
 *
 * @returns 16-character lowercase hex prefix of the SHA-256 digest.
 * @internal
 */
export async function getSkillCatalogFingerprint(): Promise<string> {
    const { skills } = await loadSkillsCached();
    return hashSkillCatalog(skills);
}

/**
 * Reset the module-level skills cache.
 *
 * @internal Test-only. Call in `beforeEach`/`afterEach` to prevent cross-test
 * cache pollution when mocking {@link createSkillsProvider}.
 */
export function clearSkillsCache(): void {
    _cachedSkills = null;
    _cachedSkillsDegraded = false;
}

/**
 * @internal Count `.md` files per skill category for diagnostic/test reporting.
 */
export async function countSkillFiles(): Promise<SkillCounts> {
    const [
        indicators,
        candlesticks,
        patterns,
        strategies,
        supportResistance,
        fundamental,
        news,
    ] = await Promise.all([
        countMdFiles('indicators'),
        countMdFiles('candlesticks'),
        countMdFiles('patterns'),
        countMdFiles('strategies'),
        countMdFiles('support-resistance'),
        countMdFiles('fundamental'),
        countMdFiles('news'),
    ]);
    return {
        indicators,
        candlesticks,
        patterns,
        strategies,
        supportResistance,
        fundamental,
        news,
    };
}

/**
 * @internal Filesystem-backed {@link SkillsProvider} adapter that parses `skills/*.md`.
 * @adapter implements {@link SkillsProvider}
 *
 * Filesystem-backed implementation of {@link SkillsProvider}.
 *
 * Recursively walks the `skills/` directory under the current working
 * directory, parses each `.md` file's YAML frontmatter (name, description,
 * type, category, pattern, indicators, confidence weight, display config),
 * and pairs it with the body content as a {@link Skill}.
 *
 * Files that fail to parse a frontmatter block are silently dropped —
 * downstream callers should treat the loader as best-effort and degrade
 * gracefully when a single skill file is malformed.
 *
 * @example
 * ```ts
 * const loader = new FileSkillsLoader();
 * const skills = await loader.loadSkills();
 * ```
 *
 * @see Skill
 * @see SkillsProvider
 */
export class FileSkillsLoader implements SkillsProvider {
    /**
     * Load every skill defined under `skills/`.
     *
     * @returns The full list of parsed skills.
     */
    async loadSkills(): Promise<Skill[]> {
        const mdFiles = await collectMdFiles(SKILLS_DIR);

        const skills = await Promise.all(
            mdFiles.map(async file => {
                const raw = await readFile(file, 'utf-8');
                const parsed = parseFrontmatter(raw);
                if (!parsed) return null;
                return toSkill(parsed.data, parsed.content);
            })
        );

        return dedupeByName(skills.filter((s): s is Skill => s !== null));
    }
}

/**
 * @internal Factory constructing a filesystem-backed {@link SkillsProvider}.
 *
 * Construct a {@link SkillsProvider} backed by the filesystem. Thin
 * wrapper around {@link FileSkillsLoader} that aligns the skills module
 * with the `create<Port>Provider()` convention used by other adapters
 * (e.g. `createCacheProvider`).
 *
 * Unlike `createCacheProvider`, this factory always succeeds — there is
 * no env configuration to read, and a missing `skills/` directory or
 * malformed file is surfaced at `loadSkills()` call time rather than at
 * construction.
 *
 * @returns A configured skills provider.
 *
 * @example
 * ```ts
 * const skillsProvider = createSkillsProvider();
 * const skills = await skillsProvider.loadSkills();
 * ```
 *
 * @see SkillsProvider
 * @see FileSkillsLoader
 */
export function createSkillsProvider(): SkillsProvider {
    return new FileSkillsLoader();
}
