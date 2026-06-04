# Inquiry Submission Feature — Design Spec

**Date:** 2026-05-01  
**Scope:** Write-only inquiry collection (title, content, email) stored in PostgreSQL via Drizzle ORM.

---

## Summary

`siglens` (UI consumer) collects a contact form with three fields — title, content, and reply email — and calls `submitInquiry` from `siglens-core`. The library persists the record to the `inquiries` table in Neon/PostgreSQL. No authentication is required; anyone may submit.

---

## Requirements

- Any visitor (logged-in or anonymous) can submit an inquiry.
- Fields: `title` (text), `content` (text), `email` (varchar 320).
- `answered` boolean tracks whether a reply has been sent; defaults to `false`.
- No server-side validation — the consumer (siglens UI) handles it.
- No admin email notification — operator checks the DB directly.
- No read/list API in this scope — write-only.

---

## Architecture

Follows the existing layered pattern used by `auth`, `market`, and `chat` use-cases.

```
application/inquiry/submitInquiry.ts   ← use-case (orchestration)
      │
      └── infrastructure/db/
              inquiryRepository.ts     ← DrizzleInquiryRepository
              types.ts                 ← InquiryRepository interface, InquiryInput type
              schema.ts                ← inquiries table definition
```

Layer dependency direction is unchanged: `application` → `infrastructure` → `domain`.

---

## DB Schema

```typescript
// src/infrastructure/db/schema.ts
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

- No FK to `users` — anonymous submissions are allowed.
- No `updatedAt` — the only mutation is toggling `answered`, which operators do via direct DB access outside this scope.
- No indexes — no query path in this scope.

---

## Infrastructure Interface

```typescript
// src/infrastructure/db/types.ts (additions)

export interface InquiryInput {
    title: string;
    content: string;
    email: string;
}

export interface InquiryRepository {
    create(input: InquiryInput): Promise<void>;
}
```

`answered` is omitted from `InquiryInput` because the DB default (`false`) handles it.  
Return type is `void` — the caller has no use for the created row.

---

## Infrastructure Implementation

```typescript
// src/infrastructure/db/inquiryRepository.ts
export class DrizzleInquiryRepository implements InquiryRepository {
    constructor(private readonly db: SiglensDatabase) {}

    async create(input: InquiryInput): Promise<void> {
        await this.db.insert(inquiries).values(input);
    }
}
```

---

## Application Use-Case

```typescript
// src/application/inquiry/submitInquiry.ts

export interface SubmitInquiryDeps {
    inquiryRepository: InquiryRepository;
}

export async function submitInquiry(
    input: InquiryInput,
    deps: SubmitInquiryDeps
): Promise<void> {
    await deps.inquiryRepository.create(input);
}
```

Deps-injection pattern matches `registerUser`, `loginUser`, and other auth use-cases.

---

## Public API Export

```typescript
// src/index.ts additions

// === Tier 1: Application Entrypoints ===
export { submitInquiry } from './application/inquiry/submitInquiry';
export type { SubmitInquiryDeps } from './application/inquiry/submitInquiry';

// === Tier 4: Public Types ===
export type { InquiryInput } from './infrastructure/db/types';
```

---

## Testing

File: `src/__tests__/application/inquiry/submitInquiry.test.ts`

Strategy: inject a stub `InquiryRepository` (no real DB). Cover:
- Happy path: `create` is called with the exact input
- Repository error propagation: if `create` throws, `submitInquiry` re-throws

---

## Files Changed / Created

| File | Change |
|---|---|
| `src/infrastructure/db/schema.ts` | Add `inquiries` table |
| `src/infrastructure/db/types.ts` | Add `InquiryRepository`, `InquiryInput` |
| `src/infrastructure/db/inquiryRepository.ts` | New — Drizzle implementation |
| `src/application/inquiry/submitInquiry.ts` | New — use-case function |
| `src/__tests__/application/inquiry/submitInquiry.test.ts` | New — unit tests |
| `src/index.ts` | Export `submitInquiry`, `SubmitInquiryDeps`, `InquiryInput` |
| `drizzle/` | Migration file (generated via `yarn db:generate`) |

---

## Out of Scope

- Admin list/read API
- Operator email notification
- Server-side input validation
- `answered` field mutation via `siglens-core`
