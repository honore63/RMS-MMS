-- ============================================================
-- RMS MARKS IMPORT — DATABASE SUPPORT
-- Run in Supabase SQL Editor (idempotent).
-- 1. Extends import_history with the fields the marks-import
--    module writes (file_type, class/subject/assessment/term,
--    assessment_id, errors, details).
-- 2. Enables ROW LEVEL SECURITY on marks (scoped):
--      - DOS (role 'dos') can do everything everywhere.
--      - Teachers can only read/write marks for assessments they
--        own OR that match their class+subject (+year) assignment.
--    Until this migration runs, marks RLS may be open/disabled and
--    the marks-import feature still works end-to-end for everyone.
-- ============================================================

-- ------------------------------------------------------------
-- 1) import_history: extra detail columns
-- ------------------------------------------------------------
ALTER TABLE public.import_history
  ADD COLUMN IF NOT EXISTS file_type TEXT,
  ADD COLUMN IF NOT EXISTS term_name TEXT,
  ADD COLUMN IF NOT EXISTS class_name TEXT,
  ADD COLUMN IF NOT EXISTS subject_name TEXT,
  ADD COLUMN IF NOT EXISTS assessment_name TEXT,
  ADD COLUMN IF NOT EXISTS assessment_id UUID,
  ADD COLUMN IF NOT EXISTS errors INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS details JSONB;

-- Keep an open policy on import_history (log table: everyone who
-- can use the app may write/read the log).
ALTER TABLE public.import_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rms_import_history_all ON public.import_history;
CREATE POLICY rms_import_history_all ON public.import_history
  FOR ALL USING (true) WITH CHECK (true);

-- ------------------------------------------------------------
-- 2) marks RLS: enable + replace the open policy with scoped rules
-- ------------------------------------------------------------
ALTER TABLE public.marks ENABLE ROW LEVEL SECURITY;

-- Remove any pre-existing marks policies (open or legacy).
DROP POLICY IF EXISTS rms_marks_all ON public.marks;
DROP POLICY IF EXISTS "DOS can manage all marks" ON public.marks;
DROP POLICY IF EXISTS "Teachers can view marks for assigned assessments" ON public.marks;
DROP POLICY IF EXISTS "Teachers can insert marks for assigned assessments" ON public.marks;
DROP POLICY IF EXISTS "Teachers can update marks for assigned assessments" ON public.marks;

-- Scope helper: is the caller a DOS? (uses users.id == auth.uid())
CREATE OR REPLACE FUNCTION public.rms_is_dos()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM users u
    WHERE u.id = auth.uid() AND u.role = 'dos' AND u.status = 'active'
  );
$$;

-- Scope helper: does this assessment belong to the caller's teacher
-- profile OR to their class+subject assignment?
CREATE OR REPLACE FUNCTION public.rms_teacher_can_assessment(p_assessment_id UUID)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM teachers t
    JOIN assessments a ON a.id = p_assessment_id
    WHERE t.user_id = auth.uid()
      AND (
            a.teacher_id = t.id
         OR EXISTS (
              SELECT 1 FROM teacher_assignments ta
              WHERE ta.teacher_id = t.id
                AND ta.class_id = a.class_id
                AND ta.subject_id = a.subject_id
                AND (ta.academic_year_id IS NULL OR a.academic_year_id IS NULL
                     OR ta.academic_year_id = a.academic_year_id)
            )
      )
  );
$$;

-- SELECT: DOS anywhere, teachers for their own/assigned assessments.
DROP POLICY IF EXISTS rms_marks_select ON public.marks;
CREATE POLICY rms_marks_select ON public.marks
  FOR SELECT
  USING (
    public.rms_is_dos()
    OR public.rms_teacher_can_assessment(assessment_id)
  );

-- INSERT: DOS anywhere, teachers only for their own/assigned
-- assessments. This is what protects bulk-imported marks.
DROP POLICY IF EXISTS rms_marks_insert ON public.marks;
CREATE POLICY rms_marks_insert ON public.marks
  FOR INSERT
  WITH CHECK (
    public.rms_is_dos()
    OR public.rms_teacher_can_assessment(assessment_id)
  );

-- UPDATE: same scope as SELECT/INSERT (teachers can update marks on
-- their own assessments; DOS everywhere).
DROP POLICY IF EXISTS rms_marks_update ON public.marks;
CREATE POLICY rms_marks_update ON public.marks
  FOR UPDATE
  USING (
    public.rms_is_dos()
    OR public.rms_teacher_can_assessment(assessment_id)
  )
  WITH CHECK (
    public.rms_is_dos()
    OR public.rms_teacher_can_assessment(assessment_id)
  );

-- DELETE: DOS only (teachers never delete marks records).
DROP POLICY IF EXISTS rms_marks_delete ON public.marks;
CREATE POLICY rms_marks_delete ON public.marks
  FOR DELETE
  USING (public.rms_is_dos());

-- ------------------------------------------------------------
-- 3) Verification
-- ------------------------------------------------------------
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'import_history'
  AND column_name IN ('file_type','term_name','class_name','subject_name',
                      'assessment_name','assessment_id','errors','details');

SELECT tablename, rowsecurity FROM pg_tables
WHERE schemaname = 'public' AND tablename IN ('marks', 'import_history');

SELECT policyname FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'marks'
ORDER BY policyname;