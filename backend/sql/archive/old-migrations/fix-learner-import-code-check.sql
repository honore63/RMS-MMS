-- ============================================================
-- RMS FIX: Learner import was failing at the database level
-- ============================================================
-- The UNIQUE on learner_code is kept, but the format CHECK that
-- forced exactly 11 digits is removed because the school's real
-- student numbers are 12 digits (e.g. 541023260055). Without
-- this, every import aborts with:
--   "new row violates check-constraint learners_learner_code_format"
-- even though the app preview marks rows as Ready.
--
-- IMPORTANT: do NOT re-run migration-user-codes-account.sql after
-- this, or the 11-digit check will come back.
-- ============================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'learners_learner_code_format'
  ) THEN
    ALTER TABLE public.learners DROP CONSTRAINT learners_learner_code_format;
    RAISE NOTICE 'Dropped learners_learner_code_format (11-digit limit).';
  ELSE
    RAISE NOTICE 'learners_learner_code_format not present — nothing to do.';
  END IF;
END $$;

ALTER TABLE public.learners ALTEr COLUMN learner_code TYPE TEXT;

-- Confirm current shape
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'learners' AND table_schema = 'public'
ORDER BY ordinal_position;

-- Optionally also list any constraint still left on learners
SELECT conname, pg_get_constraintdef(oid) AS def
FROM pg_constraint
WHERE conrelid = 'public.learners'::regclass
ORDER BY conname;