# Handoff
Status: PRE-DEVELOPMENT ONLY. Brand Docmivo; final palette warm ivory/copper/espresso. No code or tests executed, no accounts provisioned. Next: read master, verify stack/provider/hosting, scaffold and implement M1. Each milestone record date, branch/SHA, changed modules, exact test commands and outcomes, evidence path, unresolved blockers, next action. Never write secrets here.

## 2026-11-26 · M0 bootstrap

- Preserved the original specification kit in local Git checkpoint `a69d782` on `main`. Read the project instructions and specifications before adding implementation files. The unpublished checkpoint was assigned the repository's GitHub no-reply identity.
- Verified local Node 24.15.0 and npm 11.14.1. Resolved stable Next.js 16.4.6, React 19.3.1, Better Auth 1.7.28, and the Node parser and test dependencies. `npm install --no-fund --no-audit` completed and generated the lockfile. `npm audit --audit-level=high --json` reported zero vulnerabilities at installation time.
- Reviewed Vercel Node 24, Hobby personal-use and function limits, Neon Free limits, and the Gemini terms and stable Flash-Lite model. Unpaid Gemini can use submissions for product improvement and may involve human review. External inference stays off by default and must be restricted to authorized eligible testers using synthetic content.
- Confirmed authenticated GitHub account `MoizAi8` and that the requested repository did not resolve. Created and linked the dedicated Vercel project. Created `docmivo-db` through the existing Neon integration on `free_v3` in `iad1` and connected it to Docmivo Production. Verified its direct connection over TLS reports PostgreSQL 18.7. No deployment or repository publication has happened.
- Started the isolated PostgreSQL 17 cluster under ignored `.local/pg17`, loopback port 55432. Next milestone is the tenant schema and auth. No application test or workflow is claimed at this checkpoint.

## 2026-11-26 · M1–M2 database, authentication, ingestion, and retrieval

- Implemented Better Auth database-backed sessions and invite registration, a restricted runtime role, forced RLS on workspace rows, composite relationship constraints, PostgreSQL bytea storage, and durable bounded ingestion. PostgreSQL reports 18.7 on dedicated Neon and 17 locally. Both direct and pooled connections passed TLS checks. Migrations 001–004 applied on the isolated cluster and Neon. Migration 003 corrected UUID defaults required by Better Auth's PostgreSQL adapter.
- Added worker-thread extractors for valid PDF, DOCX, TXT and Markdown, bounded parser output, stable page/heading offsets, private downloads, retry state, synchronous leases, and transactional deletion. Added PostgreSQL FTS and trigram search, library filters, snippets and exact source links.
- `npm run test:db` passed 33 PostgreSQL integration tests on the disposable instance. An EXPLAIN test at 5,200 fictional chunks found an RLS barrier prevented the initial GIN plan. Migration 004 adds a static, read-only search function with a pinned search path, restricted execute grant, and mandatory tenant predicates. The revised inner plan used the GIN index and negative tests proved tenant filtering inside and outside the function.

## 2026-11-26 · M3–M5 analysis, frontend, and optional features

- Added Gemini SDK analysis for allowlisted testers using only built-in fictional guides, preset questions and per-request attestation. A direct key probe returned the expected weekday from a fixed fictional sentence. Added source-quote validation, analysis quotas, conversation persistence, answer-to-note, summaries, comparison, structured extraction and Markdown note export.
- Implemented the original copper, ivory and espresso landing page, product and security pages, signed-in library, keyboard search, reader, collections, recent files, favorites, bookmarks, notes, saved searches, settings and activity. Added CSS motion with reduced-motion handling.
- `npm test` passed 99 unit cases. The first Playwright run passed 10 of 12 tests and exposed a landing contrast issue plus a fixture ingestion failure. Desktop and mobile landing screenshots were visually inspected. Remaining checks include revised production build, browser rerun, recorded performance, release audit, repository publication and hosted analysis.

## 2026-11-26 · M6 local release gate

- Corrected contrast during the landing animation and kept the PDF parser on the native worker entry so the production bundle preserves PDF.js package resolution. Confirmed the deployment trace includes the parser and its dependencies.
- Passed `npm run lint`, `npm run typecheck`, `npm run build`, 99 unit tests, 33 disposable PostgreSQL integration tests, and 13 Edge/Chromium Playwright scenarios using the production build. Two axe scans reported zero violations in the tested scopes. The landing layout passed at 360, 390, 768, 1280, 1440, and 1920 pixels. Visually inspected representative desktop and mobile PNGs in `artifacts/visual-qa/`.
- Measured 10.26 ms p50 and 12.43 ms p95 for 50 sequential warm authenticated HTTP keyword requests after five warmups. The local production build used 5,200 synthetic passages across 52 files and PostgreSQL 17. The database plan used GIN for the selective passage query. See `artifacts/benchmark.json`.
- On the dedicated Neon database, verified all four migration records, 15 forced-RLS tables, all three expected GIN indexes, and the restricted pooled runtime role. Verified the Vercel scope is Hobby and the Neon resource uses Free. Synthetic hosted accounts were created in preparation for isolated verification.

## 2026-11-26 · M6 hosted rollout checkpoint

- Published the audited source and deployed Git commit `f3abd92` to Vercel. GitHub Actions passed for that commit. Hosted checks confirmed HTTPS health, sign-in, PDF and DOCX indexing, and a real Gemini answer whose citation and expected weekday were present.
- The first hosted walkthrough found a UUID/text parameter conflict in Settings and usage counts. Corrected the query and added PostgreSQL and browser regressions. Reran the production build and passed 34 PostgreSQL integration tests and 13 browser scenarios. The repeat benchmark measured 9.45 ms p50 and 11.08 ms p95. Final production rollout and hosted acceptance verification follow.
