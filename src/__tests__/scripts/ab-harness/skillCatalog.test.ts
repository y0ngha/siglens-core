import { describe, expect, it } from 'vitest';
import {
    extractBody,
    extractFrontmatterName,
    stripDigestBlock,
} from '../../../../scripts/ab-harness/skillCatalog';

const PROMPT_DIGEST_START = '<!-- PROMPT_DIGEST:START -->';
const PROMPT_DIGEST_END = '<!-- PROMPT_DIGEST:END -->';

describe('stripDigestBlock', () => {
    it('removes the digest block INCLUDING both markers, keeping the full body', () => {
        const body = [
            '# RSI Signal Guide',
            '',
            'Full human-facing content goes here.',
            '',
            PROMPT_DIGEST_START,
            'Compressed digest text.',
            PROMPT_DIGEST_END,
        ].join('\n');

        const result = stripDigestBlock(body);

        expect(result).toContain('Full human-facing content goes here.');
        expect(result).not.toContain('Compressed digest text.');
        expect(result).not.toContain(PROMPT_DIGEST_START);
        expect(result).not.toContain(PROMPT_DIGEST_END);
    });

    it('returns the body trimmed and unchanged when no digest block is present', () => {
        const body = '\n# No digest here\n\nJust prose.\n';
        expect(stripDigestBlock(body)).toBe('# No digest here\n\nJust prose.');
    });

    it('returns the body trimmed and unchanged when the end marker is missing (malformed)', () => {
        const body = `# Title\n\n${PROMPT_DIGEST_START}\nunterminated digest`;
        expect(stripDigestBlock(body)).toBe(body.trim());
    });
});

describe('extractFrontmatterName', () => {
    it('extracts a plain (unquoted) name value', () => {
        const raw = '---\nname: RSI Signal Guide\ntype: pattern\n---\nBody.';
        expect(extractFrontmatterName(raw)).toBe('RSI Signal Guide');
    });

    it('strips surrounding double or single quotes', () => {
        expect(
            extractFrontmatterName('---\nname: "Quoted Name"\n---\nBody.')
        ).toBe('Quoted Name');
        expect(
            extractFrontmatterName("---\nname: 'Quoted Name'\n---\nBody.")
        ).toBe('Quoted Name');
    });

    it('returns null when there is no frontmatter block', () => {
        expect(
            extractFrontmatterName('Just a body, no frontmatter.')
        ).toBeNull();
    });

    it('returns null when frontmatter has no name key (worst case)', () => {
        expect(
            extractFrontmatterName('---\ntype: pattern\n---\nBody.')
        ).toBeNull();
    });
});

describe('extractBody', () => {
    it('returns everything after the frontmatter block', () => {
        const raw = '---\nname: X\n---\nActual body text.';
        expect(extractBody(raw)).toBe('Actual body text.');
    });

    it('returns the raw text unchanged when there is no frontmatter block', () => {
        expect(extractBody('no frontmatter here')).toBe('no frontmatter here');
    });
});
