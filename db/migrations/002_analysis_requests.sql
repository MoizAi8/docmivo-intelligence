ALTER TABLE messages ADD COLUMN request_hash text CHECK (request_hash ~ '^[a-f0-9]{64}$');
ALTER TABLE messages ADD COLUMN findings jsonb NOT NULL DEFAULT '[]';
CREATE INDEX messages_pending_idx ON messages(workspace_id,created_at) WHERE state='PENDING';
CREATE INDEX ai_leases_expiry_idx ON ai_leases(expires_at);
CREATE INDEX usage_period_idx ON usage_buckets(period_start);
