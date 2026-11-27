CREATE TABLE app_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  username text NOT NULL UNIQUE,
  display_name text NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT app_users_email_normalized CHECK (email = lower(email)),
  CONSTRAINT app_users_username_format CHECK (username ~ '^[a-z0-9_]{3,30}$'),
  CONSTRAINT app_users_display_name_nonempty CHECK (length(trim(display_name)) > 0),
  CONSTRAINT app_users_password_hash_nonempty CHECK (length(password_hash) > 0)
);

CREATE TABLE app_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  token_hash bytea NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CONSTRAINT app_sessions_expiry_after_creation CHECK (expires_at > created_at)
);

CREATE INDEX app_sessions_user_active_idx
  ON app_sessions (user_id, expires_at)
  WHERE revoked_at IS NULL;

CREATE INDEX app_sessions_expiry_idx
  ON app_sessions (expires_at);