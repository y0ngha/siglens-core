import {
    date,
    index,
    pgEnum,
    pgTable,
    primaryKey,
    text,
    timestamp,
    uniqueIndex,
    uuid,
    varchar,
} from 'drizzle-orm/pg-core';
import {
    OAUTH_PROVIDER_VALUES,
    USAGE_ACTION_TYPE_VALUES,
    USER_TIER_VALUES,
} from '@/infrastructure/db/constants';

export const userTierEnum = pgEnum('user_tier', USER_TIER_VALUES);

export const usageActionTypeEnum = pgEnum(
    'usage_action_type',
    USAGE_ACTION_TYPE_VALUES
);

export const oauthProviderEnum = pgEnum(
    'oauth_provider',
    OAUTH_PROVIDER_VALUES
);

export const users = pgTable(
    'users',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        email: varchar('email', { length: 320 }).notNull().unique(),
        passwordHash: text('password_hash'),
        name: text('name'),
        avatarUrl: text('avatar_url'),
        tier: userTierEnum('tier').notNull().default('free'),
        createdAt: timestamp('created_at', { withTimezone: true })
            .notNull()
            .defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true })
            .notNull()
            .defaultNow(),
    },
    () => []
);

export const sessions = pgTable(
    'sessions',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        userId: uuid('user_id')
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),
        expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
        createdAt: timestamp('created_at', { withTimezone: true })
            .notNull()
            .defaultNow(),
    },
    table => [
        index('sessions_user_id_idx').on(table.userId),
        index('sessions_expires_at_idx').on(table.expiresAt),
    ]
);

export const usageLogs = pgTable(
    'usage_logs',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        userId: uuid('user_id').references(() => users.id, {
            onDelete: 'set null',
        }),
        ipHash: text('ip_hash').notNull(),
        actionType: usageActionTypeEnum('action_type').notNull(),
        modelUsed: text('model_used').notNull(),
        date: date('date').notNull(),
        createdAt: timestamp('created_at', { withTimezone: true })
            .notNull()
            .defaultNow(),
    },
    table => [
        index('usage_logs_user_id_idx').on(table.userId),
        index('usage_logs_ip_hash_date_idx').on(table.ipHash, table.date),
    ]
);

export const oauthAccounts = pgTable(
    'oauth_accounts',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        userId: uuid('user_id')
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),
        provider: oauthProviderEnum('provider').notNull(),
        providerAccountId: text('provider_account_id').notNull(),
        createdAt: timestamp('created_at', { withTimezone: true })
            .notNull()
            .defaultNow(),
    },
    table => [
        index('oauth_accounts_user_id_idx').on(table.userId),
        uniqueIndex('oauth_accounts_provider_account_uidx').on(
            table.provider,
            table.providerAccountId
        ),
    ]
);

export const koreanTickers = pgTable('korean_tickers', {
    symbol: varchar('symbol', { length: 32 }).primaryKey(),
    koreanName: text('korean_name').notNull(),
    name: text('name').notNull(),
    exchange: varchar('exchange', { length: 32 }).notNull(),
    exchangeFullName: text('exchange_full_name').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
        .notNull()
        .defaultNow(),
});

export const assetTranslations = pgTable(
    'asset_translations',
    {
        symbol: varchar('symbol', { length: 32 }).notNull(),
        name: text('name').notNull(),
        koreanName: text('korean_name').notNull(),
        fmpSymbol: varchar('fmp_symbol', { length: 64 }).notNull(),
        updatedAt: timestamp('updated_at', { withTimezone: true })
            .notNull()
            .defaultNow(),
    },
    table => [primaryKey({ columns: [table.symbol] })]
);
