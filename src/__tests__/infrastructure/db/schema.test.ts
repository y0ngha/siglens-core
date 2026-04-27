import {
    assetTranslations,
    koreanTickers,
    oauthAccounts,
    oauthProviderEnum,
    sessions,
    usageActionTypeEnum,
    usageLogs,
    users,
    userTierEnum,
} from '@/infrastructure/db/schema';
import { getTableColumns, getTableName } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

const columnNames = (table: Parameters<typeof getTableColumns>[0]): string[] =>
    Object.values(getTableColumns(table)).map(column => column.name);

describe('database enums', () => {
    it('defines user tier values', () => {
        expect(userTierEnum.enumValues).toEqual(['free', 'member', 'pro']);
    });

    it('defines usage action type values', () => {
        expect(usageActionTypeEnum.enumValues).toEqual(['analysis', 'chatbot']);
    });

    it('defines OAuth provider values', () => {
        expect(oauthProviderEnum.enumValues).toEqual([
            'google',
            'kakao',
            'apple',
        ]);
    });
});

describe('database schema tables', () => {
    it('defines users table columns', () => {
        expect(getTableName(users)).toBe('users');
        expect(columnNames(users)).toEqual([
            'id',
            'email',
            'password_hash',
            'name',
            'avatar_url',
            'tier',
            'created_at',
            'updated_at',
        ]);
    });

    it('defines sessions table columns', () => {
        expect(getTableName(sessions)).toBe('sessions');
        expect(columnNames(sessions)).toEqual([
            'id',
            'user_id',
            'expires_at',
            'created_at',
        ]);
    });

    it('defines usage logs table columns', () => {
        expect(getTableName(usageLogs)).toBe('usage_logs');
        expect(columnNames(usageLogs)).toEqual([
            'id',
            'user_id',
            'ip_hash',
            'action_type',
            'model_used',
            'date',
            'created_at',
        ]);
    });

    it('defines OAuth accounts table columns', () => {
        expect(getTableName(oauthAccounts)).toBe('oauth_accounts');
        expect(columnNames(oauthAccounts)).toEqual([
            'id',
            'user_id',
            'provider',
            'provider_account_id',
            'created_at',
        ]);
    });

    it('defines Korean tickers table columns', () => {
        expect(getTableName(koreanTickers)).toBe('korean_tickers');
        expect(columnNames(koreanTickers)).toEqual([
            'symbol',
            'korean_name',
            'name',
            'exchange',
            'exchange_full_name',
            'updated_at',
        ]);
    });

    it('defines asset translations table columns', () => {
        expect(getTableName(assetTranslations)).toBe('asset_translations');
        expect(columnNames(assetTranslations)).toEqual([
            'symbol',
            'name',
            'korean_name',
            'fmp_symbol',
            'updated_at',
        ]);
    });

    it('defines no indexes for users table', () => {
        expect(getTableConfig(users).indexes).toEqual([]);
    });

    it('defines lookup indexes for sessions table', () => {
        expect(
            getTableConfig(sessions).indexes.map(index => index.config.name)
        ).toEqual(['sessions_user_id_idx', 'sessions_expires_at_idx']);
    });

    it('defines lookup indexes for usage logs table', () => {
        expect(
            getTableConfig(usageLogs).indexes.map(index => index.config.name)
        ).toEqual(['usage_logs_user_id_idx', 'usage_logs_ip_hash_date_idx']);
    });

    it('defines lookup indexes for OAuth accounts table', () => {
        expect(
            getTableConfig(oauthAccounts).indexes.map(
                index => index.config.name
            )
        ).toEqual([
            'oauth_accounts_user_id_idx',
            'oauth_accounts_provider_account_uidx',
        ]);
    });

    it('defines no indexes for Korean tickers table', () => {
        expect(getTableConfig(koreanTickers).indexes).toEqual([]);
    });

    it('defines no indexes for asset translations table', () => {
        expect(getTableConfig(assetTranslations).indexes).toEqual([]);
    });

    it('enforces primary key constraint on asset_translations', () => {
        expect(getTableColumns(assetTranslations).symbol.primary).toBe(true);
    });

    it('enforces primary key constraint on korean_tickers', () => {
        expect(getTableColumns(koreanTickers).symbol.primary).toBe(true);
    });

    it('enforces unique constraint on users.email', () => {
        expect(getTableColumns(users).email.isUnique).toBe(true);
    });
});
