-- ============================================================
-- RMS-MIS: Add new school settings fields for official report header
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor)
-- ============================================================

-- 1) Add country information fields
ALTER TABLE public.school_settings
  ADD COLUMN IF NOT EXISTS country TEXT DEFAULT 'Republic of Rwanda',
  ADD COLUMN IF NOT EXISTS ministry TEXT DEFAULT 'Ministry of Education',
  ADD COLUMN IF NOT EXISTS province TEXT DEFAULT 'Eastern Province',
  ADD COLUMN IF NOT EXISTS district TEXT DEFAULT 'Kayonza',
  ADD COLUMN IF NOT EXISTS sector TEXT DEFAULT 'Gahini';

-- 2) Add logo URL fields for Ministry and School logos
ALTER TABLE public.school_settings
  ADD COLUMN IF NOT EXISTS ministry_logo_url TEXT,
  ADD COLUMN IF NOT EXISTS school_logo_url TEXT;

-- 3) Add DOS names for PRIMARY and SECONDARY — appear on report headers & signatures
ALTER TABLE public.school_settings
  ADD COLUMN IF NOT EXISTS dos_primary_name TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS dos_secondary_name TEXT DEFAULT '';

-- 4) Seed default DOS names if empty
UPDATE public.school_settings
  SET dos_primary_name = COALESCE(NULLIF(dos_primary_name, ''), 'Primary DOS'),
      dos_secondary_name = COALESCE(NULLIF(dos_secondary_name, ''), 'Secondary DOS');

-- 5) Verify all columns exist
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'school_settings'
  AND column_name IN ('country', 'ministry', 'province', 'district', 'sector', 'ministry_logo_url', 'school_logo_url', 'dos_primary_name', 'dos_secondary_name')
ORDER BY column_name;

-- Run COMMIT; after reviewing output.
