# Security Policy

`@y0ngha/siglens-core` is the analysis engine behind [Siglens](https://siglens.io). It runs inside the Siglens web app, its background workers and the `ai.siglens.io` agent, where it handles user-supplied LLM API keys, analysis caches, re-analysis cooldowns and usage counters. Vulnerability reports are genuinely welcome.

## Reporting a vulnerability

**Please do not open a public issue, discussion, or pull request for a security problem.** A public report exposes the flaw to everyone before it can be fixed.

Report privately through GitHub Security Advisories:

**→ [Report a vulnerability](https://github.com/y0ngha/siglens-core/security/advisories/new)**

That creates a private thread visible only to the maintainer. If the link is unavailable to you for any reason, open a normal issue titled `Security contact request` containing **no technical details**, and a private channel will be arranged.

### What to include

- What the vulnerability lets an attacker do, and how severe you judge it
- Steps to reproduce — a minimal input, a short script, or a failing test
- The affected surface: an exported function, an infrastructure adapter, or a dependency
- The package version (or commit) you observed it on

## What to expect

This is maintained by one person, so timelines are best-effort rather than contractual:

| Stage | Target |
|---|---|
| Acknowledgement of your report | Within 3 days |
| Initial assessment and severity call | Within 7 days |
| Fix released for a confirmed high-severity issue | As quickly as a fix can be validated and published |

Fixes ship as a new package release. You will be credited in the advisory unless you ask not to be.

## Scope

**In scope**

- This repository's source code and the published `@y0ngha/siglens-core` package
- Handling of API keys passed to the AI provider adapters (leaking a key into logs, cache keys, prompts or error messages)
- Injection through data the library puts into AI prompts or cache keys
- Cache, cooldown and usage-limit logic that lets one caller read or exhaust another caller's data or quota
- The build and publish configuration in `.github/workflows/`

**Out of scope**

- The Siglens web app itself — report those at [y0ngha/siglens](https://github.com/y0ngha/siglens/security/advisories/new)
- Vulnerabilities in third-party services or SDKs this package depends on (Upstash, Anthropic, Google, DeepSeek/OpenAI-compatible APIs, FMP) — please report those to the vendor
- The correctness or profitability of analysis output. This library produces analysis only; a result you disagree with is not a security issue
- Automated scanner output submitted without a demonstrated impact

## Supported versions

Only the latest released version is supported. Fixes land on `main` and ship in the next release rather than being backported.

## A note on secrets

The library reads credentials only from the environment or from values its consumer passes in; the repository contains no real keys. If you believe a real credential has been committed to this repository or its history, treat it as a high-severity report and use the private channel above.
