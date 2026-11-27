ALTER TABLE app_conversations
  ADD COLUMN group_permissions jsonb NOT NULL DEFAULT '{
    "sendMessages": "everyone",
    "sendMedia": "everyone",
    "addMembers": "admins",
    "editGroupInfo": "admins",
    "pinMessages": "everyone",
    "createPolls": "everyone"
  }'::jsonb;

ALTER TABLE app_conversations
  ADD CONSTRAINT app_conversations_group_permissions_check
  CHECK (
    jsonb_typeof(group_permissions) = 'object'
    AND group_permissions ?& ARRAY[
      'sendMessages', 'sendMedia', 'addMembers',
      'editGroupInfo', 'pinMessages', 'createPolls'
    ]
    AND group_permissions - ARRAY[
      'sendMessages', 'sendMedia', 'addMembers',
      'editGroupInfo', 'pinMessages', 'createPolls'
    ] = '{}'::jsonb
    AND COALESCE(group_permissions->>'sendMessages' IN ('everyone', 'admins'), false)
    AND COALESCE(group_permissions->>'sendMedia' IN ('everyone', 'admins'), false)
    AND COALESCE(group_permissions->>'addMembers' IN ('everyone', 'admins'), false)
    AND COALESCE(group_permissions->>'editGroupInfo' IN ('everyone', 'admins'), false)
    AND COALESCE(group_permissions->>'pinMessages' IN ('everyone', 'admins'), false)
    AND COALESCE(group_permissions->>'createPolls' IN ('everyone', 'admins'), false)
  );
