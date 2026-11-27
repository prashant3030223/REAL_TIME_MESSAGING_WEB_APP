ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE app_user_connections (
  user_low uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  user_high uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_low, user_high),
  CONSTRAINT app_user_connections_ordered CHECK (user_low < user_high)
);

CREATE TABLE app_contact_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT app_contact_requests_distinct_users CHECK (sender_id <> recipient_id),
  UNIQUE (sender_id, recipient_id)
);

CREATE INDEX app_contact_requests_recipient_pending_idx
  ON app_contact_requests (recipient_id, created_at DESC)
  WHERE status = 'pending';

CREATE TABLE app_user_blocks (
  blocker_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  blocked_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CONSTRAINT app_user_blocks_distinct_users CHECK (blocker_id <> blocked_id)
);

INSERT INTO app_user_connections (user_low, user_high)
SELECT LEAST(first_member.user_id, second_member.user_id),
       GREATEST(first_member.user_id, second_member.user_id)
FROM app_conversations conversation
JOIN app_conversation_members first_member
  ON first_member.conversation_id = conversation.id
JOIN app_conversation_members second_member
  ON second_member.conversation_id = conversation.id
 AND first_member.user_id < second_member.user_id
WHERE conversation.type = 'direct'
ON CONFLICT DO NOTHING;
