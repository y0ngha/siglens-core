import type { AuthSessionCookie } from './types';
import type {
    AuthSessionRecord,
    SessionRepository,
} from '@/infrastructure/auth/types';

export const AUTH_SESSION_COOKIE_NAME = 'siglens_session';
export const DEFAULT_SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
export const DEFAULT_AUTH_COOKIE_PATH = '/';
export const DEFAULT_AUTH_COOKIE_SAME_SITE = 'lax';

const MILLISECONDS_PER_SECOND = 1000;
const EXPIRED_COOKIE_DATE = new Date('1970-01-01T00:00:00.000Z');

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

export function addSeconds(date: Date, seconds: number): Date {
    return new Date(date.getTime() + seconds * MILLISECONDS_PER_SECOND);
}

export async function createAuthSession(params: {
    userId: string;
    sessions: SessionRepository;
    now: Date;
    sessionTtlSeconds?: number;
    cookieName?: string;
    secureCookie?: boolean;
    sameSite?: AuthSessionCookie['sameSite'];
    path?: string;
}): Promise<{ session: AuthSessionRecord; cookie: AuthSessionCookie }> {
    const sessionTtlSeconds =
        params.sessionTtlSeconds ?? DEFAULT_SESSION_TTL_SECONDS;
    const expiresAt = addSeconds(params.now, sessionTtlSeconds);
    const session = await params.sessions.createSession({
        userId: params.userId,
        expiresAt,
    });
    const cookie = createSessionCookie({
        token: session.id,
        expires: session.expiresAt,
        maxAgeSeconds: sessionTtlSeconds,
        name: params.cookieName,
        secure: params.secureCookie,
        sameSite: params.sameSite,
        path: params.path,
    });

    return { session, cookie };
}
