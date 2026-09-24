-- ============================================================
-- GUARANTEE: a DOS can assign MORE THAN ONE subject to a
-- teacher in the SAME class.
-- teacher_assignments stores ONE row per (teacher, class,
-- subject, year, term), so multiple subjects per class are
-- naturally supported by the schema + RLS. The only thing that
-- can block this is a stray UNIQUE constraint/index on the
-- teacher+class pair (or teacher+class+everything). This script
-- (1) diagnoses, (2) drops any blocking unique constraint/index,
-- (3) re-creates the intended NON-unique composite indexes and
-- (4) verifies the INSERT policy is per-row (not uniqueness-
-- based). Run in Supabase SQL Editor. Idempotent.
-- ============================================================

-- ------------------------------------------------------------
-- 1) DIAGNOSE: list any constraint/index that could block
--    multiple subjects per teacher+class
-- ------------------------------------------------------------
SELECT 'constraints'                 AS kind, conname AS name,
       pg_get_constraintdef(oid)     AS definition
FROM pg_constraint
WHERE conrelid = 'public.teacher_assignments'::regclass
ORDER BY conname;

SELECT 'indexes'                     AS kind, indexname AS name,
       indexdef                     AS definition
FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'teacher_assignments'
  AND indexdef ILIKE '%UNIQUE%'
ORDER BY indexname;

-- ------------------------------------------------------------
-- 2) FIX: drop ONLY unique indexes/constraints that would
--    prevent a teacher holding several subjects in one class.
--    The primary key and the foreign keys already have the
--    right shape; we keep the unique PK and ignore FKs.
-- ------------------------------------------------------------
DO $$
DECLARE r RECORD;
BEGIN
  -- 2a) Unique constraints
  FOR r IN
    SELECT conname, pg_get_constraintdef(oid) AS def
    FROM pg_constraint
    WHERE conrelid = 'public.teacher_assignments'::regclass
      AND contype IN ('u', 'x')   -- 'u'=UNIQUE, 'x'=EXCLUDE
      AND conname <> 'teacher_assignments_pkey'
  LOOP
    IF r.def ILIKE '%teacher_id%' AND r.def ~* 'class_id|subject_id' THEN
      EXECUTE format('ALTER TABLE public.teacher_assignments DROP CONSTRAINT %I', r.conname);
      RAISE NOTICE 'Dropped unique constraint % (%): would block multi-subject per class', r.conname, r.def;
    ELSE
      RAISE NOTICE 'Kept constraint %: does not restrict teacher+class', r.conname;
    END IF;
  END LOOP;

  -- 2b) Unique indexes
  FOR r IN
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'teacher_assignments'
      AND indexdef ILIKE '%UNIQUE%'
      AND indexname <> 'teacher_assignments_pkey'
  LOOP
    IF r.indexdef ~* 'teacher_id' THEN
      EXECUTE format('DROP INDEX IF EXISTS %I', r.indexname);
      RAISE NOTICE 'Dropped unique index % (%): would block multi-subject per class', r.indexname, r.indexdef;
    ELSE
      RAISE NOTICE 'Kept unique index %: does not restrict teacher+class', r.indexname;
    END IF;
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- 3) RE-CREATE the intended NON-unique lookups (fast queries,
--    no uniqueness enforced)
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_teacher_assignments_teacher_class_subject
  ON public.teacher_assignments (teacher_id, class_id, subject_id);
CREATE INDEX IF NOT EXISTS idx_teacher_assignments_teacher_class
  ON public.teacher_assignments (teacher_id, class_id);
CREATE INDEX IF NOT EXISTS idx_teacher_assignments_wizard_all
  ON public.teacher_assignments (teacher_id, class_id, subject_id, academic_year_id, term_id);

-- ------------------------------------------------------------
-- 4) VERIFY: duplicates are only prevented by the PK on id,
--    so a teacher can hold (P1, Mathematics), (P1, English),
--    (P1, Kinyarwanda) in class P1 at once.
-- ------------------------------------------------------------
SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.teacher_assignments'::regclass
ORDER BY conname;

SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'teacher_assignments'
  AND indexdef ILIKE '%UNIQUE%';

SELECT policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'teacher_assignments'
ORDER BY cmd;

-- Reload PostgREST so the fix applies immediately
NOTIFY pgrst, 'reload schema';