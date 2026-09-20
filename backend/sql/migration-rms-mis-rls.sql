-- ============================================================
-- RMS-MIS ROW LEVEL SECURITY — ASSESSMENTS, TEACHER_ASSIGNMENTS,
-- ASSESSMENT_TYPES
-- Run in Supabase SQL Editor (idempotent).
-- Tightens the previously open assessments / teacher_assignments
-- policies to a scoped model that matches the marks scoping from
-- migration-marks-import.sql:
--   - DOS (role 'dos', active) can do everything.
--   - Teachers see their OWN assessments + the ones matching their
--     class+subject(+year) assignment; create only assessments that
--     match their assignment; update their own; delete their own
--     drafts; never delete anything marked/approved.
--   - Teacher assignments are read-only for teachers (only their
--     own rows), managed by DOS.
--   - assessment_types is readable by everyone, managed by DOS.
-- The helper functions only read users / teachers /
-- teacher_assignments (never assessments) so the policies cannot
-- recurse.
-- Run the companion migration-rms-mis-assessment-flexibility.sql in
-- the same SQL Editor session.
-- ============================================================

-- ------------------------------------------------------------
-- 1) Scope helpers
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rms_is_dos()
RETURNS boolean LANGUAGE sql STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM users u
    WHERE u.id = auth.uid() AND u.role = 'dos' AND u.status = 'active'
  );
$$;

-- Is the caller the teacher recorded against the assessment that
-- would carry the given teacher/class/subject/year? Safe to use in
-- assessments policies: touches only teachers + teacher_assignments.
CREATE OR REPLACE FUNCTION public.rms_teacher_can_assessment_row(
  p_teacher_id UUID, p_class_id UUID, p_subject_id UUID, p_academic_year_id UUID
) RETURNS boolean LANGUAGE sql STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM teachers t
    WHERE t.user_id = auth.uid()
      AND t.id = p_teacher_id
      AND EXISTS (
        SELECT 1 FROM teacher_assignments ta
        WHERE ta.teacher_id = t.id
          AND (ta.class_id IS NULL OR ta.class_id = p_class_id)
          AND (ta.subject_id IS NULL OR ta.subject_id = p_subject_id)
          AND (ta.academic_year_id IS NULL OR p_academic_year_id IS NULL
               OR ta.academic_year_id = p_academic_year_id)
      )
  );
$$;

-- Can the caller VIEW an assessment row, either as its owner-teacher
-- or as a teacher assigned to the same class+subject(+year)? Touches
-- only teachers + teacher_assignments.
CREATE OR REPLACE FUNCTION public.rms_teacher_can_view_assessment_row(
  p_teacher_id UUID, p_class_id UUID, p_subject_id UUID, p_academic_year_id UUID
) RETURNS boolean LANGUAGE sql STABLE
AS $$
  SELECT (
    EXISTS (
      SELECT 1 FROM teachers t
      WHERE t.user_id = auth.uid() AND t.id = p_teacher_id
    )
    OR EXISTS (
      SELECT 1 FROM teacher_assignments ta
      JOIN teachers t ON t.id = ta.teacher_id
      WHERE t.user_id = auth.uid()
        AND (ta.class_id IS NULL OR ta.class_id = p_class_id)
        AND (ta.subject_id IS NULL OR ta.subject_id = p_subject_id)
        AND (ta.academic_year_id IS NULL OR p_academic_year_id IS NULL
             OR ta.academic_year_id = p_academic_year_id)
    )
  );
$$;

-- ------------------------------------------------------------
-- 2) assessment_types policies (read-all, DOS manages)
-- ------------------------------------------------------------
ALTER TABLE public.assessment_types ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rms_assessment_types_select ON public.assessment_types;
DROP POLICY IF EXISTS rms_assessment_types_modify ON public.assessment_types;
CREATE POLICY rms_assessment_types_select ON public.assessment_types
  FOR SELECT USING (true);
CREATE POLICY rms_assessment_types_modify ON public.assessment_types
  FOR ALL USING (public.rms_is_dos()) WITH CHECK (public.rms_is_dos());

-- ------------------------------------------------------------
-- 3) Clear every legacy policy on assessments and
--    teacher_assignments (open or partial, any names)
-- ------------------------------------------------------------
ALTER TABLE public.assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teacher_assignments ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE pol RECORD;
BEGIN
  FOR pol IN
    SELECT pp.policyname, pp.tablename
    FROM pg_policies pp
    WHERE pp.schemaname = 'public'
      AND pp.tablename IN ('assessments', 'teacher_assignments')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, pol.tablename);
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- 4) teacher_assignments policies
--    SELECT = DOS anywhere or the caller's own rows; writes = DOS.
-- ------------------------------------------------------------
CREATE POLICY rms_teacher_assignments_select ON public.teacher_assignments
  FOR SELECT
  USING (
    public.rms_is_dos()
    OR EXISTS (
      SELECT 1 FROM teachers t
      WHERE t.id = teacher_assignments.teacher_id AND t.user_id = auth.uid()
    )
  );
CREATE POLICY rms_teacher_assignments_insert ON public.teacher_assignments
  FOR INSERT WITH CHECK (public.rms_is_dos());
CREATE POLICY rms_teacher_assignments_update ON public.teacher_assignments
  FOR UPDATE USING (public.rms_is_dos()) WITH CHECK (public.rms_is_dos());
CREATE POLICY rms_teacher_assignments_delete ON public.teacher_assignments
  FOR DELETE USING (public.rms_is_dos());

-- ------------------------------------------------------------
-- 5) assessments policies
-- ------------------------------------------------------------
CREATE POLICY rms_assessments_select ON public.assessments
  FOR SELECT
  USING (
    public.rms_is_dos()
    OR public.rms_teacher_can_view_assessment_row(
         assessments.teacher_id, assessments.class_id,
         assessments.subject_id, assessments.academic_year_id)
  );

CREATE POLICY rms_assessments_insert ON public.assessments
  FOR INSERT
  WITH CHECK (
    public.rms_is_dos()
    OR public.rms_teacher_can_assessment_row(
         teacher_id, class_id, subject_id, academic_year_id)
  );

CREATE POLICY rms_assessments_update ON public.assessments
  FOR UPDATE
  USING (
    public.rms_is_dos()
    OR EXISTS (
      SELECT 1 FROM teachers t
      WHERE t.user_id = auth.uid() AND t.id = assessments.teacher_id
    )
  )
  WITH CHECK (
    public.rms_is_dos()
    OR (teacher_id = assessments.teacher_id
        AND public.rms_teacher_can_assessment_row(
             teacher_id, class_id, subject_id, academic_year_id))
  );

-- Teachers may delete only their own still-draft assessments
-- (discarding a mistake). Anything marked/submitted/approved and all
-- other rows are DOS-only.
CREATE POLICY rms_assessments_delete ON public.assessments
  FOR DELETE
  USING (
    public.rms_is_dos()
    OR (
      assessments.status = 'draft'
      AND EXISTS (
        SELECT 1 FROM teachers t
        WHERE t.user_id = auth.uid() AND t.id = assessments.teacher_id
      )
    )
  );

-- ------------------------------------------------------------
-- 6) Verification
-- ------------------------------------------------------------
SELECT tablename, rowsecurity FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('assessments','teacher_assignments','assessment_types');

SELECT tablename, policyname, cmd, permissive
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('assessments','teacher_assignments','assessment_types')
ORDER BY tablename, policyname;