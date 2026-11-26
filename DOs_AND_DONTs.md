# Non-negotiable engineering rules
## Do
- Build responsive original editorial UI; use warm ivory, espresso and copper. Preserve accessibility and keyboard shortcuts.
- Put keyword search first: index titles, tags, file content and snippets; keep it independent of inference and provide deterministic ranking.
- Use explicit tenant filters and server-side auth for every route, export, download, citation, search and deletion; defense-in-depth database policies where feasible.
- Validate uploads before parsing; use limits for bytes, decompression, pages, tokens, time and concurrency. Quarantine unsupported/malicious files. Never execute document macros or follow remote links.
- Use transactional state transitions, idempotency, bounded retries and durable job state. Report failures honestly.
- Make provider consent per operation, data eligibility enforced by server, and default private. Use local keyword extraction/search for private records.
- Use real source-linked answers for eligible documents; validate citation IDs and quotations against retrieved spans.
- Use migrations, constraints, indexes, isolated tests, safe logging and quotas. Inspect actual browser screenshots. Record measured latency with test conditions.
- Prefer stable supported versions with lockfile; verify provider plans and deployment limits. Update PROGRESS.md at every milestone.
## Don't
- No generic purple/neon template, repetitive cards, decorative animations in search critical path, fake statistics, dummy controls, fake citations or prerecorded AI presented as live.
- No cross-tenant cache, public buckets, public document URLs, secrets in client bundles, query parameters, commits or screenshots.
- No unrestricted public uploads or AI; no automatic external transmission of uploaded private text (including embeddings or OCR APIs).
- No unlimited regex, unsafe SQL, raw rendered HTML, archive extraction without bounds, shell interpolation or model-triggered privileged actions.
- No claim of encryption-at-rest, compliance, malware scanning, vector RAG or OCR unless verified. Do not promise zero risk.
- No irreversible production migrations, destructive tests on user data, hidden background fire-and-forget jobs, or fake test counts.
- No paid subscriptions, public release of unreviewed secrets or copying proprietary assets. No unrelated refactor. Do not hide blockers with a fake demo.
