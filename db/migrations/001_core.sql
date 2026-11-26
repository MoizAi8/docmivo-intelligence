CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE "user" (
  id uuid PRIMARY KEY, name text NOT NULL, email text NOT NULL UNIQUE,
  "emailVerified" boolean NOT NULL DEFAULT false, image text,
  "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE session (
  id uuid PRIMARY KEY, token text NOT NULL UNIQUE, "expiresAt" timestamptz NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now(),
  "ipAddress" text, "userAgent" text, "userId" uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE
);
CREATE INDEX session_user_idx ON session("userId");
CREATE TABLE account (
  id uuid PRIMARY KEY, "accountId" text NOT NULL, "providerId" text NOT NULL,
  "userId" uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  "accessToken" text, "refreshToken" text, "idToken" text, "scope" text, password text,
  "accessTokenExpiresAt" timestamptz, "refreshTokenExpiresAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("providerId","accountId")
);
CREATE INDEX account_user_idx ON account("userId");
CREATE TABLE verification (
  id uuid PRIMARY KEY, identifier text NOT NULL, value text NOT NULL, "expiresAt" timestamptz NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX verification_identifier_idx ON verification(identifier);

CREATE FUNCTION tenant() RETURNS uuid LANGUAGE sql STABLE
AS 'SELECT nullif(current_setting(''docmivo.workspace'', true), '''')::uuid';

CREATE TABLE workspaces (
  id uuid PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'My workspace', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80), UNIQUE(workspace_id,id)
);
CREATE UNIQUE INDEX folders_name_idx ON folders(workspace_id,lower(name));
CREATE TABLE tags (LIKE folders INCLUDING ALL);
ALTER TABLE tags ADD FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

CREATE TABLE documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  folder_id uuid, title text NOT NULL CHECK (length(title) BETWEEN 1 AND 180),
  mime text NOT NULL, size integer NOT NULL CHECK (size BETWEEN 1 AND 2097152),
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  classification text NOT NULL CHECK (classification IN ('PRIVATE','SYNTHETIC')),
  sample_key text, status text NOT NULL CHECK (status IN ('UPLOADED','PARSING','READY','FAILED')),
  error_code text, favorite boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(), viewed_at timestamptz,
  title_vector tsvector GENERATED ALWAYS AS (to_tsvector('simple',title)) STORED,
  UNIQUE(workspace_id,id), UNIQUE(workspace_id,sha256),
  CHECK ((classification = 'SYNTHETIC') = (sample_key IS NOT NULL)),
  FOREIGN KEY(workspace_id,folder_id) REFERENCES folders(workspace_id,id) ON DELETE SET NULL (folder_id)
);
CREATE INDEX documents_library_idx ON documents(workspace_id,updated_at DESC,id);
CREATE INDEX documents_status_idx ON documents(workspace_id,status,mime,id);
CREATE INDEX documents_title_fts_idx ON documents USING gin(title_vector) WHERE status='READY';
CREATE INDEX documents_title_trgm_idx ON documents USING gin(lower(title) gin_trgm_ops) WHERE status='READY';
CREATE TABLE document_tags (
  workspace_id uuid NOT NULL, document_id uuid NOT NULL, tag_id uuid NOT NULL, PRIMARY KEY(workspace_id,document_id,tag_id),
  FOREIGN KEY(workspace_id,document_id) REFERENCES documents(workspace_id,id) ON DELETE CASCADE,
  FOREIGN KEY(workspace_id,tag_id) REFERENCES tags(workspace_id,id) ON DELETE CASCADE
);
CREATE INDEX document_tags_tag_idx ON document_tags(workspace_id,tag_id,document_id);
CREATE TABLE document_files (
  workspace_id uuid NOT NULL, document_id uuid NOT NULL, bytes bytea NOT NULL CHECK (octet_length(bytes) BETWEEN 1 AND 2097152),
  PRIMARY KEY(workspace_id,document_id),
  FOREIGN KEY(workspace_id,document_id) REFERENCES documents(workspace_id,id) ON DELETE CASCADE
);
CREATE TABLE ingestion_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, document_id uuid NOT NULL,
  state text NOT NULL CHECK (state IN ('UPLOADED','PARSING','READY','FAILED')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3), lease_until timestamptz,
  idempotency_key uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id,idempotency_key), UNIQUE(workspace_id,document_id),
  FOREIGN KEY(workspace_id,document_id) REFERENCES documents(workspace_id,id) ON DELETE CASCADE
);
CREATE TABLE document_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, document_id uuid NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal >= 0), page integer CHECK (page > 0), section text,
  start_offset integer NOT NULL CHECK(start_offset >= 0), end_offset integer NOT NULL CHECK (end_offset > start_offset),
  text text NOT NULL CHECK (length(text) BETWEEN 1 AND 2400),
  search_vector tsvector GENERATED ALWAYS AS (to_tsvector('simple',text)) STORED,
  UNIQUE(workspace_id,id), UNIQUE(workspace_id,document_id,id), UNIQUE(workspace_id,document_id,ordinal),
  FOREIGN KEY(workspace_id,document_id) REFERENCES documents(workspace_id,id) ON DELETE CASCADE
);
CREATE INDEX document_chunks_fts_idx ON document_chunks USING gin(search_vector);
CREATE TABLE bookmarks (
  workspace_id uuid NOT NULL, document_id uuid NOT NULL, chunk_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(workspace_id,chunk_id),
  FOREIGN KEY(workspace_id,document_id,chunk_id) REFERENCES document_chunks(workspace_id,document_id,id) ON DELETE CASCADE
);
CREATE TABLE saved_searches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  query text NOT NULL CHECK (length(query) BETWEEN 1 AND 160), filters jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(workspace_id,id), UNIQUE(workspace_id,query,filters)
);
CREATE TABLE conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title text NOT NULL CHECK(length(title) BETWEEN 1 AND 400), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(workspace_id,id)
);
CREATE TABLE messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, conversation_id uuid NOT NULL,
  question text NOT NULL CHECK(length(question) BETWEEN 1 AND 400), answer text,
  state text NOT NULL CHECK(state IN ('PENDING','ANSWERED','INSUFFICIENT','FAILED')), idempotency_key uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(workspace_id,id), UNIQUE(workspace_id,idempotency_key),
  FOREIGN KEY(workspace_id,conversation_id) REFERENCES conversations(workspace_id,id) ON DELETE CASCADE
);
CREATE INDEX messages_conversation_idx ON messages(workspace_id,conversation_id,created_at);
CREATE TABLE citations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, message_id uuid NOT NULL, chunk_id uuid NOT NULL,
  quote text NOT NULL CHECK(length(quote) BETWEEN 12 AND 500), UNIQUE(workspace_id,id), UNIQUE(workspace_id,message_id,chunk_id),
  FOREIGN KEY(workspace_id,message_id) REFERENCES messages(workspace_id,id) ON DELETE CASCADE,
  FOREIGN KEY(workspace_id,chunk_id) REFERENCES document_chunks(workspace_id,id) ON DELETE CASCADE
);
CREATE INDEX citations_chunk_idx ON citations(workspace_id,chunk_id);
CREATE TABLE notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title text NOT NULL CHECK(length(title) BETWEEN 1 AND 180), text text NOT NULL CHECK(length(text) BETWEEN 1 AND 8000),
  source_message_id uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  search_vector tsvector GENERATED ALWAYS AS (setweight(to_tsvector('simple',title),'A') || to_tsvector('simple',text)) STORED,
  UNIQUE(workspace_id,id),
  FOREIGN KEY(workspace_id,source_message_id) REFERENCES messages(workspace_id,id) ON DELETE CASCADE
);
CREATE INDEX notes_fts_idx ON notes USING gin(search_vector);
CREATE UNIQUE INDEX notes_source_idx ON notes(workspace_id,source_message_id);
CREATE TABLE audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  action text NOT NULL CHECK(length(action) <= 40), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_recent_idx ON audit_events(workspace_id,created_at DESC);
CREATE TABLE usage_buckets (
  scope_key text NOT NULL, period_start timestamptz NOT NULL, kind text NOT NULL,
  count integer NOT NULL CHECK(count >= 0), PRIMARY KEY(scope_key,period_start,kind)
);
CREATE TABLE ai_leases (id uuid PRIMARY KEY, expires_at timestamptz NOT NULL);

DO $$
DECLARE tab text;
BEGIN
  ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
  ALTER TABLE workspaces FORCE ROW LEVEL SECURITY;
  CREATE POLICY workspaces_tenant ON workspaces USING (id=tenant()) WITH CHECK (id=tenant());
  FOREACH tab IN ARRAY ARRAY['folders','tags','documents','document_tags','document_files','ingestion_jobs','document_chunks','bookmarks','saved_searches','conversations','messages','citations','notes','audit_events']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',tab);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',tab);
    EXECUTE format('CREATE POLICY tenant_rows ON %I USING (workspace_id=tenant()) WITH CHECK (workspace_id=tenant())',tab);
  END LOOP;
END $$;

GRANT USAGE ON SCHEMA public TO docmivo_runtime;
GRANT SELECT,INSERT,UPDATE,DELETE ON "user",session,account,verification,workspaces,folders,tags,documents,document_tags,document_files,ingestion_jobs,document_chunks,bookmarks,saved_searches,conversations,messages,citations,notes,audit_events,usage_buckets,ai_leases TO docmivo_runtime;
