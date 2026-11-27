-- Migration: 0003_phone_auth.sql
-- Enables WhatsApp-style phone number authentication, OTP verification, and profile management

-- 1. Update app_users to support phone authentication
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS phone text UNIQUE;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS avatar text;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS about text DEFAULT 'Hey there! I am using ConnectSphere.';

-- Make email, username, password_hash optional for phone-authenticated users
ALTER TABLE app_users ALTER COLUMN email DROP NOT NULL;
ALTER TABLE app_users ALTER COLUMN username DROP NOT NULL;
ALTER TABLE app_users ALTER COLUMN password_hash DROP NOT NULL;

-- 2. Create table for phone OTP verification records
CREATE TABLE IF NOT EXISTS app_phone_otps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text NOT NULL,
  otp_code text NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  verified boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS app_phone_otps_lookup_idx
  ON app_phone_otps (phone, expires_at)
  WHERE verified = false;
