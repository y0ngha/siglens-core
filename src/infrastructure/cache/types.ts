export interface CacheProvider {
    get<T>(key: string): Promise<T | null>;
    set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
    delete(key: string): Promise<void>;
}

export interface UpstashEnvConfig {
    url: string;
    token: string;
    readonlyToken: string;
}
