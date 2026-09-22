-- ============================================================
-- RMS-MIS: Comprehensive Report Center Migration
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor)
-- ============================================================

BEGIN;

-- ============================================================================
-- 1) SCHOOL_SETTINGS: Add new fields for official report header
-- ============================================================================

ALTER TABLE public.school_settings
  ADD COLUMN IF NOT EXISTS country TEXT DEFAULT 'Republic of Rwanda',
  ADD COLUMN IF NOT EXISTS ministry TEXT DEFAULT 'Ministry of Education',
  ADD COLUMN IF NOT EXISTS province TEXT DEFAULT 'Eastern Province',
  ADD COLUMN IF NOT EXISTS district TEXT DEFAULT 'Kayonza',
  ADD COLUMN IF NOT EXISTS sector TEXT DEFAULT 'Gahini',
  ADD COLUMN IF NOT EXISTS ministry_logo_url TEXT,
  ADD COLUMN IF NOT EXISTS school_logo_url TEXT;

-- ============================================================================
-- 2) IMPORT_HISTORY: Create table if missing (fixes 404 error)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.import_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  import_type TEXT NOT NULL,
  details JSONB DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'partial', 'failed')),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.import_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rms_import_history_all ON public.import_history;
CREATE POLICY rms_import_history_all ON public.import_history
  FOR ALL USING (true) WITH CHECK (true);

-- ============================================================================
-- 3) SCHOOL_SETTINGS: Ensure RLS is enabled
-- ============================================================================

ALTER TABLE public.school_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rms_school_settings_all ON public.school_settings;
CREATE POLICY rms_school_settings_all ON public.school_settings
  FOR ALL USING (true) WITH CHECK (true);

-- ============================================================================
-- 4) INSERT/UPDATE default school settings
-- ============================================================================

INSERT INTO public.school_settings (
  school_name, school_code, school_email, school_phone,
  country, ministry, province, district, sector,
  pass_mark, ranking_enabled, decimal_marks_enabled
) VALUES (
  'Rukara Model School', '541023', 'info@rukaramodelschool.rw', '+250 788 123 456',
  'Republic of Rwanda', 'Ministry of Education', 'Eastern Province', 'Kayonza', 'Gahini',
  50, true, true
)
ON CONFLICT DO NOTHING;

-- Update existing row with defaults if columns were just added
UPDATE public.school_settings
SET country = 'Republic of Rwanda',
    ministry = 'Ministry of Education',
    province = 'Eastern Province',
    district = 'Kayonza',
    sector = 'Gahini',
    school_code = '541023'
WHERE country IS NULL;

-- ============================================================================
-- 5) Verify all columns exist
-- ============================================================================

SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'school_settings'
  AND column_name IN (
    'country', 'ministry', 'province', 'district', 'sector',
    'ministry_logo_url', 'school_logo_url', 'school_code', 'school_email', 'school_phone',
    'pass_mark', 'ranking_enabled', 'decimal_marks_enabled',
    'school_name', 'headteacher_name', 'dos_name'
  )
ORDER BY column_name;

-- ============================================================================
-- 6) Verify import_history exists
-- ============================================================================

SELECT table_name, row_count
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('school_settings', 'import_history');

COMMIT;

-- Run COMMIT; after reviewing output.
