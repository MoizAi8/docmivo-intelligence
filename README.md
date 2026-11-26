# Docmivo

Docmivo is an invite-only document workspace for uploading, organizing, and searching PDFs, Word documents, text, and Markdown. Search opens the matching extracted passage at its page or heading. Users can bookmark passages, save queries, organize files, and keep notes across sessions.

## Architecture

Browser requests go through the Next.js Node server and Better Auth. PostgreSQL stores bounded private originals, durable ingestion state, extracted passages, and workspace records. The runtime role is separate from the migration role. Workspace access uses explicit tenant filters, composite foreign keys, and forced row-level security. A read-only search function uses a fixed search path and tenant predicates to let PostgreSQL use GIN indexes for full-text and trigram candidates. Private search runs independently of Gemini.

PDF, DOCX, TXT, and Markdown parsing runs in bounded Node worker threads. Text-based PDFs retain page numbers, and Markdown retains headings. The reader uses extracted text and offers an authenticated original download. An indexing failure remains visible with limited retries. Each file may be up to 2 MiB, with a default workspace limit of 20 MiB and 100 documents.

External AI is available only to authorized testers with an eligible location and explicit per-request consent. The Google GenAI SDK receives excerpts from Docmivo's built-in fictional guides and preset questions. Docmivo validates quoted text and source IDs before storing answers. The same policy applies to summary, comparison, and structured extraction. Unpaid Gemini requests are subject to Google's [data use and eligibility terms](https://ai.google.dev/gemini-api/terms).

## Run locally

Use Node 24 and PostgreSQL 17 or 18 with `pg_trgm`. Create a dedicated database and a login named `docmivo_runtime` without ownership or privileges to create roles or bypass RLS. Give `DIRECT_DATABASE_URL` to the migration role and `DATABASE_URL` to the restricted runtime role. Use TLS for hosted database connections.

1. Run `npm ci`.
2. Copy `.env.example` to the ignored `.env.local`. Set the two database URLs, `AUTH_SECRET`, `REGISTRATION_INVITE`, and `APP_URL`. Use independently generated high-entropy values for the auth secret and invite.
3. Run `npm run db:migrate` and `npm run dev`.
4. Open the local URL, choose **Create an account**, and enter the workspace invite.

To enable Gemini, set `EXTERNAL_AI_ENABLED=true`, `GEMINI_API_KEY`, and `GEMINI_MODEL`. For Vercel Production, an explicitly enrolled account must match both `AI_TESTER_EMAILS` and `AI_TESTER_USER_IDS`, and its trusted Vercel country must appear in `AI_ALLOWED_COUNTRIES`. Free Gemini access is denied in the EEA, Switzerland, and UK. Keep enrollment private and confirm current provider eligibility before adding a tester.

## Verify

- `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, and `npm audit --audit-level=high`
- `npm run test:db` with `TEST_DATABASE_URL` pointing to a disposable loopback PostgreSQL database ending in `_test`
- Run `npx playwright install chromium`, then `npm run test:e2e` with the same test URL. To use an existing Chromium-based browser, set `DOCMIVO_BROWSER` to its executable path.

See [PROGRESS.md](PROGRESS.md) for measured results and [known limitations](docs/KNOWN_LIMITATIONS.md) for release scope.
