-- ============================================================
--  Migration: Admin PIN Verification
--  Run in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

-- Add PIN hash column to profiles (null = no PIN set yet)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS admin_pin_hash   text    DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS pin_attempts     int     DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pin_locked_until timestamptz DEFAULT NULL;

-- Only admins ever have a pin — students always null
-- Index for fast lookup on admin accounts
CREATE INDEX IF NOT EXISTS idx_profiles_admin_pin
  ON public.profiles(id)
  WHERE role = 'admin';

-- ── DEFAULT PIN FOR YOUR FIRST ADMIN ─────────────────────────
-- The default PIN is 000000 (bcrypt hash below).
-- Change it immediately after first login via Settings.
-- To generate a new hash: node -e "const b=require('bcryptjs');console.log(b.hashSync('123456',12))"

-- Set default PIN = 000000 for all existing admin accounts that have no PIN yet
-- (you can change this to any 6-digit number)
UPDATE public.profiles
SET admin_pin_hash = '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TiGVXF0WrROBhBCe5l5bU7.vMN3O'
WHERE role = 'admin'
  AND admin_pin_hash IS NULL;

-- ── NOTE ─────────────────────────────────────────────────────
-- The hash above corresponds to PIN: 000000
-- After running this migration, log in as admin and immediately
-- change your PIN in Settings → Admin PIN.
