# Neon Drizzle DB Schema Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Neon serverless PostgreSQL and Drizzle ORM infrastructure for the premium subscription database schema.

**Architecture:** Keep all database I/O in `src/infrastructure/db`. Define interfaces and env config first, then schema and client creation. Tests mock external packages so no real Neon connection is opened.

**Tech Stack:** TypeScript, Drizzle ORM, Neon serverless driver, Drizzle Kit, Vitest.

---

### Task 1: Dependencies and Drizzle Config

**Files:**
- Modify: `package.json`
- Create: `drizzle.config.ts`
- Test: `src/__tests__/infrastructure/db/config.test.ts`

- [ ] Add `drizzle-orm`, `@neondatabase/serverless`, and `drizzle-kit`.
- [ ] Add Drizzle migration scripts that use `drizzle.config.ts`.
- [ ] Configure Drizzle Kit with `DATABASE_URL`, `src/infrastructure/db/schema.ts`, and `drizzle/` migrations output.
- [ ] Test `readDatabaseConfig` and `tryReadDatabaseConfig` for present and missing `DATABASE_URL`.

### Task 2: DB Types, Config, and Schema

**Files:**
- Create: `src/infrastructure/db/types.ts`
- Create: `src/infrastructure/db/config.ts`
- Create: `src/infrastructure/db/schema.ts`
- Test: `src/__tests__/infrastructure/db/schema.test.ts`

- [ ] Define `UserTier`, `UsageActionType`, `OAuthProvider`, and DB config/client interfaces.
- [ ] Define `users`, `sessions`, `usage_logs`, `oauth_accounts`, `korean_tickers`, and `asset_translations` tables.
- [ ] Include enum constraints through Drizzle `pgEnum`.
- [ ] Test table names and key column names without touching a database.

### Task 3: DB Client and Public Exports

**Files:**
- Create: `src/infrastructure/db/client.ts`
- Create: `src/infrastructure/db/index.ts`
- Modify: `src/index.ts`
- Test: `src/__tests__/infrastructure/db/client.test.ts`
- Test: `src/__tests__/index.test.ts`

- [ ] Create a module-level cached Neon/Drizzle client from `DATABASE_URL`.
- [ ] Provide `createDatabaseClient`, `getDatabaseClient`, and `tryGetDatabaseClient`.
- [ ] Export DB factories, config readers, schema, and types through the public entry point.
- [ ] Mock Neon/Drizzle packages in tests and cover missing env graceful fallback.

### Task 4: Documentation and Validation

**Files:**
- Modify: `docs/API.md`
- Modify: `docs/ARCHITECTURE.md`

- [ ] Document the new DB files, env var, migration commands, and tables.
- [ ] Run `yarn lint`, `yarn format`, `yarn test --run`, `yarn typecheck`, and `yarn build`.
