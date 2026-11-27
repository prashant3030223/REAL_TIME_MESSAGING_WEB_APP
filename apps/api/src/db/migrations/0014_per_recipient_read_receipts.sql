ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS read_receipts_enabled boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS app_message_receipts (
  message_id uuid NOT NULL REFERENCES app_messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  delivered_at timestamptz,
  read_at timestamptz,
  receipt_state text NOT NULL DEFAULT 'sent'
    CHECK (receipt_state IN ('sent', 'delivered', 'read', 'unknown')),
  PRIMARY KEY (message_id, user_id),
  CONSTRAINT app_message_receipts_read_after_delivery
    CHECK (read_at IS NULL OR delivered_at IS NOT NULL)
);

INSERT INTO app_message_receipts (message_id, user_id, receipt_state)
SELECT message.id,
       member.user_id,
       CASE WHEN message.status = 'read' THEN 'read'
            WHEN message.status = 'delivered' THEN 'delivered'
            ELSE 'sent'
       END
FROM app_messages message
JOIN app_conversations conversation ON conversation.id = message.conversation_id
JOIN app_conversation_members member ON member.conversation_id = message.conversation_id
WHERE conversation.type = 'direct'
  AND member.user_id <> message.sender_id
ON CONFLICT (message_id, user_id) DO NOTHING;

UPDATE app_messages message
SET status = 'delivered'
FROM app_conversations conversation
WHERE conversation.id = message.conversation_id
  AND conversation.type IN ('group', 'channel')
  AND message.status = 'read';
