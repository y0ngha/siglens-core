import type { AuthSessionCookie } from './types';

/** Default cookie name used for the auth session token. */
export const AUTH_SESSION_COOKIE_NAME = 'siglens_session';

/** Default session lifetime in seconds (30 days). */
export const DEFAULT_SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

/** Default cookie path applied to auth session cookies. */
export const DEFAULT_AUTH_COOKIE_PATH = '/';

/** Default SameSite policy applied to auth session cookies. */
export const DEFAULT_AUTH_COOKIE_SAME_SITE = 'lax';

const EXPIRED_COOKIE_DATE = new Date('1970-01-01T00:00:00.000Z');

/** @internal Builds an active HTTP-only session cookie from token and expiry metadata. */
export function createSessionCookie(params: {
    token: string;
    expires: Date;
    maxAgeSeconds: number;
    name?: string;
    secure?: boolean;
    sameSite?: AuthSessionCookie['sameSite'];
    path?: string;
}): AuthSessionCookie {
    return {
        name: params.name ?? AUTH_SESSION_COOKIE_NAME,
        value: params.token,
        httpOnly: true,
        secure: params.secure ?? true,
        sameSite: params.sameSite ?? DEFAULT_AUTH_COOKIE_SAME_SITE,
        path: params.path ?? DEFAULT_AUTH_COOKIE_PATH,
        expires: params.expires,
        maxAgeSeconds: params.maxAgeSeconds,
    };
}

/** @internal Builds a zero-maxAge, epoch-expired cookie for browser-side session clearing. */
export function createExpiredSessionCookie(params?: {
    name?: string;
    secure?: boolean;
    sameSite?: AuthSessionCookie['sameSite'];
    path?: string;
}): AuthSessionCookie {
    return createSessionCookie({
        token: '',
        expires: EXPIRED_COOKIE_DATE,
        maxAgeSeconds: 0,
        name: params?.name,
        secure: params?.secure,
        sameSite: params?.sameSite,
        path: params?.path,
    });
}
