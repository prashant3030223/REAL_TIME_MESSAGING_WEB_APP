CREATE TABLE app_scheduled_messages (
  id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES app_conversations(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  text text NOT NULL,
  reply_to_id uuid REFERENCES app_messages(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  scheduled_for timestamptz NOT NULL,
  state text NOT NULL DEFAULT 'scheduled' CHECK (state IN ('scheduled', 'sent', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);

CREATE INDEX app_scheduled_messages_due_idx
  ON app_scheduled_messages (scheduled_for)
  WHERE state = 'scheduled';

CREATE INDEX app_scheduled_messages_sender_idx
  ON app_scheduled_messages (conversation_id, sender_id, scheduled_for)
  WHERE state = 'scheduled';
