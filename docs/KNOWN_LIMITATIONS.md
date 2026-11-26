# Known limitations

- Search uses PostgreSQL lexical ranking and trigram title matching. Semantic embeddings, OCR, team roles, version history, and password recovery are outside this release. Image-only PDFs report that no searchable text was found.
- The reader highlights extracted text and preserves the source page or section. It offers the original file as an authenticated download. Text extraction can differ from the original layout for multicolumn PDFs or complex Word documents.
- File validation and bounded worker threads limit parsing risk. Workers share the application process and are subject to its host limits. The platform uses an explicit Retry button to resume a queued or interrupted ingestion job.
- External inference is limited to approved fictional guides and preset tasks. Google may retain and review submissions on the unpaid tier. Account deletion cannot remove provider-held submissions or expire a managed database backup.
- Gemini can intermittently fail or hit its deadline. Docmivo records the failed request and presents a retryable state. Search and the document reader remain available.
- The hosting setup exposes a direct migration URL to the Vercel Production environment as requested. Application database connections use the restricted pooled runtime URL. Provider recovery windows and capacity follow the Free plans.
- The brand is provisional. Docmivo is a personal portfolio project designed for invited evaluation.
