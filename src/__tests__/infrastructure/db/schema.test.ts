import {
    OAUTH_PROVIDER_VALUES,
    USAGE_ACTION_TYPE_VALUES,
    USER_TIER_VALUES,
} from '@/infrastructure/db/constants';
import {
    assetTranslations,
    koreanTickers,
    oauthAccounts,
    oauthProviderEnum,
    passwordResets,
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
        expect(userTierEnum.enumValues).toEqual([...USER_TIER_VALUES]);
    });

    it('defines usage action type values', () => {
        expect(usageActionTypeEnum.enumValues).toEqual([
            ...USAGE_ACTION_TYPE_VALUES,
        ]);
        expect(USAGE_ACTION_TYPE_VALUES).toContain('premium_model');
    });

    it('defines OAuth provider values', () => {
        expect(oauthProviderEnum.enumValues).toEqual([
            ...OAUTH_PROVIDER_VALUES,
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

    it('defines password reset table columns', () => {
        expect(getTableName(passwordResets)).toBe('password_resets');
        expect(columnNames(passwordResets)).toEqual([
            'id',
            'user_id',
            'token_hash',
            'expires_at',
            'used_at',
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
            'access_token',
            'refresh_token',
            'token_expires_at',
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

    it('defines lookup indexes for password reset table', () => {
        expect(
            getTableConfig(passwordResets).indexes.map(
                index => index.config.name
            )
        ).toEqual([
            'password_resets_user_id_idx',
            'password_resets_expires_at_idx',
        ]);
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

    it('enforces unique constraint on password reset token hash', () => {
        expect(getTableColumns(passwordResets).tokenHash.isUnique).toBe(true);
    });
});
