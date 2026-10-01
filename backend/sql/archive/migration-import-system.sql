-- ============================================================
-- RMS IMPORT SYSTEM — DATABASE SUPPORT
-- Run in Supabase SQL Editor (idempotent).
-- Adds:
--   1. import_history table (record of every bulk import)
--   2. classes.academic_year_id (nullable, class-year association)
--   3. learners.date_of_birth (student import DOB field)
--   4. Exactly-11-digit learner_code check (NOT VALID so existing
--      rows are never touched; new inserts are still enforced)
-- ============================================================

-- 1) Import history table
CREATE TABLE IF NOT EXISTS public.import_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID,
  user_name TEXT,
  import_type TEXT NOT NULL,
  file_name TEXT NOT NULL,
  academic_year_name TEXT,
  total_records INTEGER NOT NULL DEFAULT 0,
  imported INTEGER NOT NULL DEFAULT 0,
  updated INTEGER NOT NULL DEFAULT 0,
  skipped INTEGER NOT NULL DEFAULT 0,
  duplicates INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'partial', 'failed')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2) RLS (open policies, consistent with the rest of this project)
ALTER TABLE public.import_history ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE p TEXT;
BEGIN
  FOR p IN
    SELECT policyname FROM pg_policies WHERE tablename = 'import_history' AND schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.import_history', p);
  END LOOP;
END $$;
DROP POLICY IF EXISTS rms_import_history_all ON public.import_history;
CREATE POLICY rms_import_history_all ON public.import_history FOR ALL USING (true) WITH CHECK (true);

-- 3) Class → academic year association (nullable, backward compatible)
ALTER TABLE public.classes
  ADD COLUMN IF NOT EXISTS academic_year_id UUID REFERENCES public.academic_years(id);

-- 4) Student date of birth (nullable)
ALTER TABLE public.learners
  ADD COLUMN IF NOT EXISTS date_of_birth DATE;

-- 5) Exactly 11 digits for student codes. NOT VALID keeps existing
--    rows untouched; all NEW inserts are still validated.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'learners_learner_code_format'
  ) THEN
    ALTER TABLE public.learners
      ADD CONSTRAINT learners_learner_code_format
      CHECK (learner_code ~ '^[0-9]{11}$') NOT VALID;
    RAISE NOTICE 'Added learners_learner_code_format (11 digits, new rows only).';
  ELSE
    RAISE NOTICE 'learners_learner_code_format already present.';
  END IF;
END $$;

-- Confirm teacher codes are also exactly 11 digits
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'teachers_teacher_code_format'
  ) THEN
    ALTER TABLE public.teachers
      ADD CONSTRAINT teachers_teacher_code_format
      CHECK (teacher_code ~ '^[0-9]{11}$') NOT VALID;
    RAISE NOTICE 'Added teachers_teacher_code_format (11 digits, new rows only).';
  END IF;
END $$;

-- 6) Verification
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name IN ('import_history');
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'classes' AND column_name = 'academic_year_id';
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'learners' AND column_name = 'date_of_birth';
SELECT policyname FROM pg_policies WHERE tablename = 'import_history';