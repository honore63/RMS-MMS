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

-- 3) Verify columns exist
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'school_settings'
  AND column_name IN ('country', 'ministry', 'province', 'district', 'sector', 'ministry_logo_url', 'school_logo_url')
ORDER BY column_name;

-- Run COMMIT; after reviewing output.
