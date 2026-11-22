/**
 * Readers of what a rendered technical prompt prints (WP-16): the qualified chart-pattern
 * candidates, the candle lines, the guide lists and the sections the pattern and candle
 * guides sit in. They read the prompt text only. The instrument decides "printed" from the
 * text the model is sent, never by asking the selector that put a guide there.
 */

export const CHART_CANDIDATES_HEADER = '## Chart Pattern Candidates (computed)';
export const CANDLES_HEADER = '## Detected Candle Patterns (computed)';
export const PATTERN_GUIDES_HEADER = '## Pattern Analysis';
export const CANDLE_GUIDES_HEADER = '## Candlestick Pattern Guides';

/** Level-3 headings whose block (heading to the next heading) carries pattern or candle writing rules. */
export const PATTERN_RULE_HEADINGS: readonly string[] = [
    'patternSummaries Writing Rules',
    'geometry Writing Rules',
    'candidateId Writing Rules',
    'candlePatterns Writing Rules for Candlestick Skills',
];

/** The text of one `## ` section (header line included) or `''` when the prompt has none. */
export function sectionOf(text: string, header: string): string {
    const at = text.startsWith(header) ? 0 : text.indexOf(`\n${header}`) + 1;
    if (at <= 0 && !text.startsWith(header)) return '';
    const next = text.indexOf('\n## ', at + header.length);
    return text.slice(at, next < 0 ? text.length : next);
}

/** Bullet lines after `marker`, blank lines before the first bullet skipped; stops at the first other line. */
export function listAfter(text: string, marker: string): readonly string[] {
    const at = text.indexOf(marker);
    if (at < 0) return [];
    const lines = text
        .slice(at + marker.length)
        .split('\n')
        .slice(1);
    const first = lines.findIndex(line => line.trim() !== '');
    if (first < 0) return [];
    const rest = lines.slice(first);
    const end = rest.findIndex(line => !line.startsWith('- '));
    return (end < 0 ? rest : rest.slice(0, end)).map(line =>
        line.slice(2).trim()
    );
}

export interface PrintedQualified {
    /** Pattern ids of the `### <id> (<state>)` blocks, in order. */
    ids: readonly string[];
    /** `Candidate id:` values of those blocks. */
    candidateIds: readonly string[];
}

/** The chart-pattern candidates the prompt prints (the `qualified` list). */
export function printedQualified(prompt: string): PrintedQualified {
    const section = sectionOf(prompt, CHART_CANDIDATES_HEADER);
    return {
        ids: [...section.matchAll(/^### ([a-z_]+) \(/gm)].map(m => m[1]),
        candidateIds: [...section.matchAll(/^- Candidate id: (\S+)/gm)].map(
            m => m[1]
        ),
    };
}

/** The candle names of the lines printed under the detected-candle header. */
export function printedCandleNames(prompt: string): readonly string[] {
    return [
        ...sectionOf(prompt, CANDLES_HEADER).matchAll(
            /candle pattern: ([a-z_]+) \[trend/g
        ),
    ].map(m => m[1]);
}

/**
 * Index of a skill's digest heading (`### <name> [<confidence>]`) in `text`, or `-1`. The name
 * must end at the bracket or the line, so `### Doji Pattern Guide [..]` is not a heading of a
 * skill named `Doji`.
 */
export function headingPosition(text: string, name: string): number {
    const found = [`### ${name} [`, `### ${name}\n`]
        .map(heading => text.indexOf(heading))
        .filter(at => at >= 0);
    const atEnd = text.endsWith(`### ${name}`)
        ? text.length - name.length - 4
        : -1;
    return [...found, ...(atEnd >= 0 ? [atEnd] : [])].reduce(
        (first, at) => (first < 0 || at < first ? at : first),
        -1
    );
}

const escapeRegExp = (text: string): string =>
    text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Cuts `[start, end)` out of `text`. With `fold`, the blank lines that meet at the cut are
 * folded to one blank line (the seam only: blank lines elsewhere are content).
 */
function cut(text: string, start: number, end: number, fold: boolean): string {
    const left = text.slice(0, start);
    const right = text.slice(end);
    if (!fold) return `${left}${right}`;
    const run =
        (left.match(/\n*$/)?.[0].length ?? 0) +
        (right.match(/^\n*/)?.[0].length ?? 0);
    if (run <= 2) return `${left}${right}`;
    return `${left.replace(/\n*$/, '')}\n\n${right.replace(/^\n*/, '')}`;
}

function cutSection(text: string, header: string, fold: boolean): string {
    const section = sectionOf(text, header);
    return section === ''
        ? text
        : cut(
              text,
              text.indexOf(section),
              text.indexOf(section) + section.length,
              fold
          );
}

/** Cuts one `### <heading>` block: the heading line up to the next `##` or `###` heading. */
function cutBlock(text: string, heading: string, fold: boolean): string {
    const found = new RegExp(
        `### ${escapeRegExp(heading)}[^\\n]*\\n[\\s\\S]*?(?=\\n### |\\n## |$)`
    ).exec(text);
    return found === null
        ? text
        : cut(text, found.index, found.index + found[0].length, fold);
}

/** Cuts the instruction paragraph between the candidates header and the first candidate block. */
function cutCandidateIntro(text: string, fold: boolean): string {
    const section = sectionOf(text, CHART_CANDIDATES_HEADER);
    if (section === '') return text;
    const sectionStart = text.indexOf(section);
    const introStart = sectionStart + CHART_CANDIDATES_HEADER.length + 1;
    const firstBlock = section.indexOf('\n### ');
    const introEnd =
        sectionStart + (firstBlock < 0 ? section.length : firstBlock + 1);
    return introEnd <= introStart
        ? text
        : cut(text, introStart, introEnd, fold);
}

export interface StrippedPrompt {
    /** The remainder with the blank lines at the removal seams folded. */
    folded: string;
    /** The remainder exactly as the removals leave it. */
    unfolded: string;
}

function strip(dynamic: string, fold: boolean): string {
    const withoutIntro = cutCandidateIntro(dynamic, fold);
    const withoutSections = [
        PATTERN_GUIDES_HEADER,
        CANDLE_GUIDES_HEADER,
    ].reduce((text, header) => cutSection(text, header, fold), withoutIntro);
    return PATTERN_RULE_HEADINGS.reduce(
        (text, heading) => cutBlock(text, heading, fold),
        withoutSections
    );
}

/**
 * The dynamic prompt with exactly the parts core-1 is allowed to change removed (D3): the
 * pattern and candle guide sections, the four pattern and candle writing-rule blocks (each
 * with the list it contains) and the instruction paragraph above the chart-pattern candidate
 * blocks (the blocks themselves stay). Both forms are returned: `folded` folds the blank
 * lines that meet at each removal (an absent section leaves different blank lines than a
 * removed one), `unfolded` is the plain remainder. Everything else must stay byte-identical
 * to the arm it is compared with.
 */
export function withoutGuideParts(dynamic: string): StrippedPrompt {
    return { folded: strip(dynamic, true), unfolded: strip(dynamic, false) };
}

/** The numbers printed on a line, without the `NAME(period)` labels in front of values. */
export function numbersOnLine(line: string): readonly number[] {
    const stripped = line.replace(/[A-Za-z%]+\(\d+(?:,\d+)*\)/g, ' ');
    return [...stripped.matchAll(/-?\d[\d,]*(?:\.\d+)?/g)]
        .map(m => Number(m[0].replaceAll(',', '')))
        .filter(Number.isFinite);
}

/** The first line of `text` that starts with `prefix`, or `null`. */
export function lineStarting(text: string, prefix: string): string | null {
    const found = text.split('\n').find(line => line.startsWith(prefix));
    return found ?? null;
}
