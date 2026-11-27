ALTER TABLE app_messages
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS app_messages_idempotency_idx
  ON app_messages (conversation_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;