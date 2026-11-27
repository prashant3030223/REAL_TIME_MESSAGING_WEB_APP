ALTER TABLE app_conversation_members
  DROP CONSTRAINT IF EXISTS app_conversation_members_role_check;

ALTER TABLE app_conversation_members
  ADD CONSTRAINT app_conversation_members_role_check
  CHECK (role IN ('owner', 'admin', 'moderator', 'member'));

CREATE TABLE app_group_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES app_conversations(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  target_user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  target_message_id uuid,
  action text NOT NULL CHECK (
    action IN ('member_role_changed', 'member_removed', 'member_left', 'owner_transferred', 'message_moderated')
  ),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX app_group_audit_log_conversation_created_idx
  ON app_group_audit_log (conversation_id, created_at DESC);
