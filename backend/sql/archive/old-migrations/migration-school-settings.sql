-- =====================================================
-- MIGRATION: Expand school_settings with full school info
-- Run this in Supabase SQL Editor AFTER the main schema
-- =====================================================

ALTER TABLE school_settings ADD COLUMN IF NOT EXISTS school_phone TEXT;
ALTER TABLE school_settings ADD COLUMN IF NOT EXISTS school_email TEXT;
ALTER TABLE school_settings ADD COLUMN IF NOT EXISTS school_website TEXT;
ALTER TABLE school_settings ADD COLUMN IF NOT EXISTS school_motto TEXT;
ALTER TABLE school_settings ADD COLUMN IF NOT EXISTS school_code TEXT;

ALTER TABLE school_settings ADD COLUMN IF NOT EXISTS headteacher_name TEXT;
ALTER TABLE school_settings ADD COLUMN IF NOT EXISTS headteacher_phone TEXT;
ALTER TABLE school_settings ADD COLUMN IF NOT EXISTS headteacher_email TEXT;

ALTER TABLE school_settings ADD COLUMN IF NOT EXISTS deputy_academic_name TEXT;
ALTER TABLE school_settings ADD COLUMN IF NOT EXISTS deputy_academic_phone TEXT;

ALTER TABLE school_settings ADD COLUMN IF NOT EXISTS deputy_admin_name TEXT;
ALTER TABLE school_settings ADD COLUMN IF NOT EXISTS deputy_admin_phone TEXT;

ALTER TABLE school_settings ADD COLUMN IF NOT EXISTS dos_name TEXT;
ALTER TABLE school_settings ADD COLUMN IF NOT EXISTS dos_phone TEXT;
ALTER TABLE school_settings ADD COLUMN IF NOT EXISTS dos_email TEXT;

ALTER TABLE school_settings ADD COLUMN IF NOT EXISTS logo_url TEXT;
