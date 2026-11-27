ALTER TABLE app_conversations
  ADD COLUMN disappearing_timer_hours integer NOT NULL DEFAULT 0
    CHECK (disappearing_timer_hours BETWEEN 0 AND 720);

ALTER TABLE app_messages
  ADD COLUMN expires_at timestamptz;

CREATE INDEX app_messages_expiry_idx
  ON app_messages (expires_at)
  WHERE expires_at IS NOT NULL;
