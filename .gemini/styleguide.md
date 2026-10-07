# Code Review Guidelines

All review comments must be written in **Korean**.

---

## Reference Documents

Before reviewing, read the following project documents in order:

1. `docs/CONVENTIONS.md` — coding paradigm, TypeScript rules, test rules, and the Gotchas sections (`CP`, `TS`, `JD`, `DS`, `TE` rule IDs; highest priority)
2. `docs/PUBLIC_API.md` — tiers and the Export 변경 체크리스트 (`API` rule IDs; highest priority when `src/index*.ts` change)
3. `src/domain/CLAUDE.md`, `src/application/CLAUDE.md`, `src/infrastructure/CLAUDE.md` — layer rules (`DOM`, `APP`, `INF` rule IDs; highest priority, read the layer you review)
4. `docs/FF.md` — FF 4 principles: Readability, Predictability, Cohesion, Coupling
5. `docs/DOMAIN.md` — indicator specs, domain rules, IndicatorResult structure
6. `docs/ARCHITECTURE.md` — layer structure (domain ↔ infrastructure), folder layout
7. `docs/API.md` — external services consumed by infrastructure/ (AI providers, Upstash Redis, Neon)

When a comment flags a rule violation, cite its rule ID (for example `CONVENTIONS.md#TE-5`).

Apply all rules defined in these documents as your review criteria.
Do not rely on general knowledge — always derive criteria from the documents above.

---

## Test Scope

This is a pure TypeScript library. Only `domain/`, `application/` and `infrastructure/` exist as
reviewable source layers — each must meet the 90% branch coverage threshold via Vitest.

Do not flag the absence of UI / React / component tests — this repository has no UI layer.
