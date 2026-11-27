-- Profile photo screenshot protection preference
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS profile_photo_protection text DEFAULT 'nobody';
