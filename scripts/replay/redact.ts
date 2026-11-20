/**
 * Provider-controlled text (an HTTP error body, an exception message) ends up in result
 * files and in the labels. It is capped and anything key-shaped is masked first, so a
 * provider that echoes a credential back never writes it to disk.
 *
 * Rule: mask `sk-…` style keys, `Bearer <token>` values and any unbroken run of 32 or more
 * characters from the hex / base64 / URL-safe base64 alphabets; then cut to
 * {@link MAX_STORED_ERROR_CHARS} characters.
 */
export const MAX_STORED_ERROR_CHARS = 500;

const REDACTED = '[redacted]';

const SECRET_SHAPES: readonly RegExp[] = [
    /\bsk-[A-Za-z0-9_-]{8,}/g,
    /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,
    /[A-Za-z0-9+/_=-]{32,}/g,
];

export function redactProviderText(text: string): string {
    const masked = SECRET_SHAPES.reduce(
        (current, shape) => current.replace(shape, REDACTED),
        text
    );
    return masked.length > MAX_STORED_ERROR_CHARS
        ? `${masked.slice(0, MAX_STORED_ERROR_CHARS)}…`
        : masked;
}
