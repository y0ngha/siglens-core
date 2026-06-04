# Inquiry Submission Feature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose a `submitInquiry` use-case that persists a visitor's contact form (title, content, email) to a new `inquiries` PostgreSQL table via Drizzle ORM.

**Architecture:** Standard layered pattern — DB schema + interface in `infrastructure/db/`, thin use-case in `application/inquiry/`, public exports wired through `src/index.ts`. No domain logic; no server-side validation; write-only.

**Tech Stack:** TypeScript, Drizzle ORM, Neon serverless PostgreSQL, Vitest

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `src/infrastructure/db/schema.ts` | Modify | Add `inquiries` table |
| `src/infrastructure/db/types.ts` | Modify | Add `InquiryInput`, `InquiryRepository` |
| `src/infrastructure/db/inquiryRepository.ts` | Create | `DrizzleInquiryRepository` implementation |
| `src/infrastructure/db/index.ts` | Modify | Export new repository and types |
| `src/application/inquiry/types.ts` | Create | `SubmitInquiryDeps` |
| `src/application/inquiry/submitInquiry.ts` | Create | `submitInquiry` use-case function |
| `src/application/inquiry/index.ts` | Create | Barrel export for the inquiry module |
| `src/__tests__/application/inquiry/submitInquiry.test.ts` | Create | Unit tests (stub repository) |
| `src/index.ts` | Modify | Tier 1 + Tier 4 public exports |

---

## Task 1: Add `inquiries` table to schema and types

**Files:**
- Modify: `src/infrastructure/db/schema.ts`
- Modify: `src/infrastructure/db/types.ts`

- [ ] **Step 1: Add the `inquiries` table to `schema.ts`**

Open `src/infrastructure/db/schema.ts`. The file already imports `boolean`, `pgTable`, `text`, `timestamp`, `uuid`, `varchar` from `drizzle-orm/pg-core`. Add the following table definition after the last export in the file:

```typescript
/** Contact form submissions from visitors. */
export const inquiries = pgTable('inquiries', {
    id: uuid('id').primaryKey().defaultRandom(),
    title: text('title').notNull(),
    content: text('content').notNull(),
    email: varchar('email', { length: 320 }).notNull(),
    answered: boolean('answered').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true })
        .notNull()
        .defaultNow(),
});
```

- [ ] **Step 2: Add `InquiryInput` and `InquiryRepository` to `types.ts`**

Open `src/infrastructure/db/types.ts`. Add the following at the end of the file (before or after `AssetTranslationRecord` — keep it grouped with other write-focused interfaces):

```typescript
/** Input required to create a new inquiry record. */
export interface InquiryInput {
    /** Short subject line for the inquiry. */
    title: string;
    /** Full body text of the inquiry. */
    content: string;
    /** Reply-to email address provided by the visitor. */
    email: string;
}

/** Repository for persisting visitor inquiries. */
export interface InquiryRepository {
    /**
     * Insert a new inquiry record.
     * The `answered` flag defaults to `false` at the database level.
     */
    create(input: InquiryInput): Promise<void>;
}
```

- [ ] **Step 3: Type-check**

```bash
yarn typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/infrastructure/db/schema.ts src/infrastructure/db/types.ts
git commit -m "feat(db): add inquiries table schema and InquiryRepository interface"
```

---

## Task 2: Implement `DrizzleInquiryRepository`

**Files:**
- Create: `src/infrastructure/db/inquiryRepository.ts`
- Modify: `src/infrastructure/db/index.ts`

- [ ] **Step 1: Create `inquiryRepository.ts`**

Create `src/infrastructure/db/inquiryRepository.ts` with the following content:

```typescript
import { inquiries } from './schema';
import type { InquiryInput, InquiryRepository, SiglensDatabase } from './types';

export class DrizzleInquiryRepository implements InquiryRepository {
    constructor(private readonly db: SiglensDatabase) {}

    async create(input: InquiryInput): Promise<void> {
        await this.db.insert(inquiries).values(input);
    }
}
```

- [ ] **Step 2: Export from `db/index.ts`**

Open `src/infrastructure/db/index.ts`. Add the following two lines — one for the implementation class, one for the new types:

After the last `export { Drizzle... }` line (currently `export { DrizzleUsageRepository, hashUsageIp } from './usageRepository';`), add:

```typescript
export { DrizzleInquiryRepository } from './inquiryRepository';
```

In the `export type { ... } from './types'` block, add `InquiryInput` and `InquiryRepository` to the list.

The updated type export block should include (among the existing entries):
```typescript
export type {
    // ... existing entries ...
    InquiryInput,
    InquiryRepository,
    // ... existing entries ...
} from './types';
```

- [ ] **Step 3: Add `inquiries` to the schema export block in `db/index.ts`**

In the existing `export { assetTranslations, koreanTickers, ... } from './schema';` block, add `inquiries`:

```typescript
export {
    assetTranslations,
    inquiries,
    koreanTickers,
    oauthAccounts,
    oauthProviderEnum,
    sessions,
    usageActionTypeEnum,
    usageLogs,
    users,
    userTierEnum,
} from './schema';
```

- [ ] **Step 4: Type-check**

```bash
yarn typecheck
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/infrastructure/db/inquiryRepository.ts src/infrastructure/db/index.ts
git commit -m "feat(db): add DrizzleInquiryRepository"
```

---

## Task 3: Write tests for `submitInquiry`

**Files:**
- Create: `src/__tests__/application/inquiry/submitInquiry.test.ts`

Write the test file **before** implementing the use-case (TDD).

- [ ] **Step 1: Create the test file**

Create `src/__tests__/application/inquiry/submitInquiry.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest';
import type { InquiryInput, InquiryRepository } from '@/infrastructure/db/types';

// Import will fail until the module is created — that's expected at this step.
import { submitInquiry } from '@/application/inquiry/submitInquiry';
import type { SubmitInquiryDeps } from '@/application/inquiry/types';

function makeDeps(overrides?: Partial<SubmitInquiryDeps>): {
    deps: SubmitInquiryDeps;
    create: ReturnType<typeof vi.fn>;
} {
    const create = vi.fn<InquiryRepository['create']>().mockResolvedValue(undefined);
    const inquiryRepository: InquiryRepository = { create };
    return {
        deps: { inquiryRepository, ...overrides },
        create,
    };
}

const validInput: InquiryInput = {
    title: 'Test title',
    content: 'Test content body',
    email: 'visitor@example.com',
};

describe('submitInquiry', () => {
    it('calls repository.create with the exact input', async () => {
        const { deps, create } = makeDeps();

        await submitInquiry(validInput, deps);

        expect(create).toHaveBeenCalledOnce();
        expect(create).toHaveBeenCalledWith(validInput);
    });

    it('propagates repository errors to the caller', async () => {
        const dbError = new Error('db connection lost');
        const create = vi.fn<InquiryRepository['create']>().mockRejectedValue(dbError);
        const deps: SubmitInquiryDeps = {
            inquiryRepository: { create },
        };

        await expect(submitInquiry(validInput, deps)).rejects.toThrow('db connection lost');
    });
});
```

- [ ] **Step 2: Run the test — expect failure**

```bash
yarn test src/__tests__/application/inquiry/submitInquiry.test.ts
```

Expected: FAIL — `Cannot find module '@/application/inquiry/submitInquiry'`

---

## Task 4: Implement `submitInquiry` use-case

**Files:**
- Create: `src/application/inquiry/types.ts`
- Create: `src/application/inquiry/submitInquiry.ts`
- Create: `src/application/inquiry/index.ts`

- [ ] **Step 1: Create `types.ts`**

Create `src/application/inquiry/types.ts`:

```typescript
import type { InquiryRepository } from '@/infrastructure/db/types';

/** Dependencies required by the `submitInquiry` use-case. */
export interface SubmitInquiryDeps {
    inquiryRepository: InquiryRepository;
}
```

- [ ] **Step 2: Create `submitInquiry.ts`**

Create `src/application/inquiry/submitInquiry.ts`:

```typescript
import type { InquiryInput } from '@/infrastructure/db/types';
import type { SubmitInquiryDeps } from './types';

/**
 * Persist a visitor's contact form submission to the database.
 *
 * @param input - Title, content, and reply-to email from the contact form.
 * @param deps - Injected repository dependency.
 */
export async function submitInquiry(
    input: InquiryInput,
    deps: SubmitInquiryDeps,
): Promise<void> {
    await deps.inquiryRepository.create(input);
}
```

- [ ] **Step 3: Create `index.ts`**

Create `src/application/inquiry/index.ts`:

```typescript
export { submitInquiry } from './submitInquiry';
export type { SubmitInquiryDeps } from './types';
```

- [ ] **Step 4: Run the tests — expect pass**

```bash
yarn test src/__tests__/application/inquiry/submitInquiry.test.ts
```

Expected:
```
✓ src/__tests__/application/inquiry/submitInquiry.test.ts (2)
  ✓ submitInquiry > calls repository.create with the exact input
  ✓ submitInquiry > propagates repository errors to the caller
```

- [ ] **Step 5: Type-check**

```bash
yarn typecheck
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/application/inquiry/types.ts src/application/inquiry/submitInquiry.ts src/application/inquiry/index.ts src/__tests__/application/inquiry/submitInquiry.test.ts
git commit -m "feat(inquiry): add submitInquiry use-case with tests"
```

---

## Task 5: Wire public exports in `src/index.ts`

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Add Tier 1 entrypoint export**

Open `src/index.ts`. Find the `// Auth` comment block under `// Tier 1`. Add an `// Inquiry` block after the usage block (`export { checkAnalysisLimit, checkChatbotLimit } from './application/usage';`):

```typescript
// Inquiry
export { submitInquiry } from './application/inquiry';
export type { SubmitInquiryDeps } from './application/inquiry';
```

- [ ] **Step 2: Add Tier 4 type export**

Find the Tier 4 section in `src/index.ts` where infrastructure DB types are exported. Locate the block that exports from `'./infrastructure/db'`. Add `InquiryInput` and `InquiryRepository` to that block.

The existing block looks like:
```typescript
export type {
    DatabaseClient,
    DatabaseConfig,
    // ... many types ...
} from './infrastructure/db';
```

Add `InquiryInput` and `InquiryRepository` in alphabetical order within that block.

- [ ] **Step 3: Type-check and run all tests**

```bash
yarn typecheck && yarn test
```

Expected: no type errors, all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat(inquiry): export submitInquiry and types from public API"
```

---

## Task 6: Generate Drizzle migration

- [ ] **Step 1: Generate the migration**

```bash
yarn db:generate
```

Expected: a new SQL file is created under `drizzle/` with a statement similar to:

```sql
CREATE TABLE "inquiries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "title" text NOT NULL,
  "content" text NOT NULL,
  "email" varchar(320) NOT NULL,
  "answered" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
```

- [ ] **Step 2: Verify the generated SQL**

Open the newly created file in `drizzle/` and confirm it contains the `CREATE TABLE "inquiries"` statement with all six columns. There should be no FK, no indexes.

- [ ] **Step 3: Commit**

```bash
git add drizzle/
git commit -m "feat(db): add inquiries migration"
```

---

## Done

The `submitInquiry` use-case is now:
- Tested with a stub repository (no real DB in tests)
- Exported from `src/index.ts` as Tier 1 (function) and Tier 4 (types)
- Backed by a Drizzle migration ready to apply with `yarn db:migrate`

Consumer usage (e.g. in siglens Next.js app):
```typescript
import {
    submitInquiry,
    DrizzleInquiryRepository,
    getDatabaseClient,
} from '@y0ngha/siglens-core';

const { db } = getDatabaseClient();
await submitInquiry(
    { title, content, email },
    { inquiryRepository: new DrizzleInquiryRepository(db) },
);
```
