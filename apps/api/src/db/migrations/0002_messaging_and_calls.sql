CREATE TABLE app_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL CHECK (type IN ('direct', 'group', 'channel')),
  name text,
  description text,
  avatar text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app_conversation_members (
  conversation_id uuid NOT NULL REFERENCES app_conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE app_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES app_conversations(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  text text NOT NULL DEFAULT '',
  attachments jsonb,
  voice_note jsonb,
  reply_to_id uuid REFERENCES app_messages(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'sent' CHECK (status IN ('pending', 'sent', 'delivered', 'read')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX app_messages_conv_created_idx
  ON app_messages (conversation_id, created_at DESC);

CREATE TABLE app_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  initiator_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  peer_name text NOT NULL,
  type text NOT NULL CHECK (type IN ('voice', 'video')),
  direction text NOT NULL CHECK (direction IN ('incoming', 'outgoing', 'missed', 'declined')),
  duration_seconds integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app_call_telemetry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id uuid REFERENCES app_calls(id) ON DELETE CASCADE,
  rtt_ms integer NOT NULL,
  jitter_ms integer NOT NULL,
  packet_loss_percent numeric(5, 2) NOT NULL,
  bitrate_bps integer NOT NULL,
  risk_level text NOT NULL,
  risk_score integer NOT NULL,
  adaptation_action text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);