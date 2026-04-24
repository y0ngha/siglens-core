# Code Review Guidelines

All review comments must be written in **Korean**.

---

## Reference Documents

Before reviewing, read the following project documents in order:

1. `docs/CONVENTIONS.md` — coding paradigm, TypeScript rules, layer dependency rules, Vitest test rules
2. `docs/MISTAKES.md` — common mistakes to flag (highest priority)
3. `docs/FF.md` — FF 4 principles: Readability, Predictability, Cohesion, Coupling
4. `docs/DOMAIN.md` — indicator specs, domain rules, IndicatorResult structure
5. `docs/ARCHITECTURE.md` — layer structure (domain ↔ infrastructure), folder layout
6. `docs/API.md` — external services consumed by infrastructure/ (AI providers, Upstash Redis, Neon)

Apply all rules defined in these documents as your review criteria.
Do not rely on general knowledge — always derive criteria from the documents above.

---

## Test Scope

This is a pure TypeScript library. Only `domain/` and `infrastructure/` exist as reviewable
source layers — both must have 100% branch coverage via Vitest.

Do not flag the absence of UI / React / component tests — this repository has no UI layer.
