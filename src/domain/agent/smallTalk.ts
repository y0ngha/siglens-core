/**
 * Thanks and "I understood" words in the four answer languages. A message
 * counts as small talk only when it contains at least one of these: a bare
 * "네", "응" or "ok" right after the assistant offered follow-up questions is
 * accepting the offer, a real request, so fillers alone never qualify.
 */
const ACKNOWLEDGEMENT_WORDS: ReadonlySet<string> = new Set([
    // Korean
    '고마워',
    '고마워요',
    '고맙습니다',
    '감사',
    '감사해',
    '감사해요',
    '감사합니다',
    '땡큐',
    '알겠어',
    '알겠어요',
    '알겠습니다',
    '알았어',
    '알았어요',
    '그렇구나',
    '그렇군요',
    '그렇군',
    '이해했어',
    '이해했어요',
    '이해했습니다',
    // English
    'thanks',
    'thank',
    'thx',
    'ty',
    'understood',
    // Japanese / Chinese
    'ありがとう',
    'ありがとうございます',
    '了解',
    '了解です',
    'なるほど',
    '谢谢',
    '明白了',
    '知道了',
]);

/**
 * Words that may sit next to an acknowledgement without making the message a
 * request ("아 그렇구나", "ㅇㅋ 고마워", "ok thanks", "got it, thanks").
 */
const FILLER_WORDS: ReadonlySet<string> = new Set([
    '네',
    '응',
    '넵',
    '예',
    'ㅇㅇ',
    'ㅇㅋ',
    '오케이',
    '좋아',
    '좋아요',
    '아',
    '아하',
    '오',
    '흠',
    '음',
    '와',
    'you',
    'ok',
    'okay',
    'cool',
    'great',
    'nice',
    'got',
    'it',
    'i',
    'see',
    'ah',
    'oh',
    '好的',
]);

/** Longest message considered at all; small talk is short. */
const SMALL_TALK_MAX_CHARS = 30;

/**
 * Whether `message` is only thanks or an acknowledgement, optionally with
 * fillers ("고마워", "아 그렇구나", "ㅇㅋ 고마워", "thanks!") — a turn that
 * needs no data.
 *
 * Used to skip the forced first tool call on text-only (guest) transcripts:
 * that guard exists so a "tell me more" is answered from fresh tool results
 * instead of re-quoted or invented figures, but a thank-you has nothing to
 * fetch, and forcing a call there only spent a tool round-trip before a
 * one-line reply (measured 2026-11-14 replay: "고마워" → get_bars_indicators →
 * "천만에요."). Conservative by construction: every word must be an
 * acknowledgement or a filler and at least one must be an acknowledgement
 * ({@link ACKNOWLEDGEMENT_WORDS}), so a question with a thank-you in it, and a
 * bare "네"/"ok" accepting an offered follow-up, still get the forced call.
 *
 * Pure: no I/O.
 *
 * @param message - The user's message, verbatim.
 * @returns `true` only for an acknowledgement with nothing else asked.
 */
export function isSmallTalkMessage(message: string): boolean {
    const trimmed = message.trim();
    if (trimmed === '' || trimmed.length > SMALL_TALK_MAX_CHARS) return false;
    const words = trimmed
        .toLowerCase()
        // Laughter jamo ("ㅋ", "ㅎㅎ", "고마워ㅎ") carry no request. The ㅋ of
        // "ㅇㅋ" (okay) is kept: a ㅋ/ㅎ run right after ㅇ is not stripped.
        .replace(/(?<!ㅇ)[ㅋㅎ]+/g, ' ')
        // Keep letters, digits and whitespace; drop punctuation and emoji.
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .split(/\s+/)
        .filter(w => w !== '');
    return (
        words.some(w => ACKNOWLEDGEMENT_WORDS.has(w)) &&
        words.every(w => ACKNOWLEDGEMENT_WORDS.has(w) || FILLER_WORDS.has(w))
    );
}
