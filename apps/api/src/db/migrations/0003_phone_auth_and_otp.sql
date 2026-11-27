-- Support Phone Number Authentication and OTP verification

ALTER TABLE app_users ADD COLUMN IF NOT EXISTS phone text;
CREATE UNIQUE INDEX IF NOT EXISTS app_users_phone_idx ON app_users (phone) WHERE phone IS NOT NULL;

-- Allow phone-based accounts without requiring initial email/password
ALTER TABLE app_users ALTER COLUMN email DROP NOT NULL;
ALTER TABLE app_users ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE app_users ALTER COLUMN username DROP NOT NULL;

ALTER TABLE app_users ADD COLUMN IF NOT EXISTS avatar text;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS bio text DEFAULT 'Hey there! I am using ConnectSphere.';
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS status_text text DEFAULT 'Available';

-- OTP storage table
CREATE TABLE IF NOT EXISTS app_otps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text NOT NULL,
  otp_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  verified boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS app_otps_phone_lookup_idx
  ON app_otps (phone, expires_at)
  WHERE verified = false;
