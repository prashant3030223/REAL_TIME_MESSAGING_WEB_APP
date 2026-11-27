ALTER TABLE app_conversation_members
  ADD COLUMN IF NOT EXISTS is_locked boolean NOT NULL DEFAULT false;
