-- RMS-MIS repair: teacher_assignments RLS recursion (42P17)
-- Run this after migration-fix-report-rls-recursion.sql.

CREATE OR REPLACE FUNCTION public.rms_report_assignment_visible(
  p_teacher_id UUID,
  p_class_id UUID,
  p_subject_id UUID
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    (
      public.rms_is_dos()
      AND public.rms_dos_can_level(
        (SELECT c.education_level FROM public.classes c WHERE c.id = p_class_id)
      )
      AND public.rms_dos_can_subject(
        (SELECT s.level FROM public.subjects s WHERE s.id = p_subject_id)
      )
    )
    OR EXISTS (
      SELECT 1 FROM public.teachers t
      WHERE t.id = p_teacher_id AND t.user_id = auth.uid()
    );
$$;

DO $$
DECLARE policy_row record;
BEGIN
  FOR policy_row IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'teacher_assignments'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.teacher_assignments', policy_row.policyname);
  END LOOP;
END $$;

CREATE POLICY rms_teacher_assignments_report_select
  ON public.teacher_assignments FOR SELECT
  USING (public.rms_report_assignment_visible(
    teacher_assignments.teacher_id,
    teacher_assignments.class_id,
    teacher_assignments.subject_id
  ));

CREATE POLICY rms_teacher_assignments_report_insert
  ON public.teacher_assignments FOR INSERT
  WITH CHECK (
    public.rms_is_dos()
    AND public.rms_report_assignment_visible(teacher_id, class_id, subject_id)
  );

CREATE POLICY rms_teacher_assignments_report_update
  ON public.teacher_assignments FOR UPDATE
  USING (public.rms_report_assignment_visible(
    teacher_assignments.teacher_id,
    teacher_assignments.class_id,
    teacher_assignments.subject_id
  ))
  WITH CHECK (
    public.rms_is_dos()
    AND public.rms_report_assignment_visible(teacher_id, class_id, subject_id)
  );

CREATE POLICY rms_teacher_assignments_report_delete
  ON public.teacher_assignments FOR DELETE
  USING (
    public.rms_is_dos()
    AND public.rms_report_assignment_visible(
      teacher_assignments.teacher_id,
      teacher_assignments.class_id,
      teacher_assignments.subject_id
    )
  );

GRANT EXECUTE ON FUNCTION public.rms_report_assignment_visible(UUID, UUID, UUID)
  TO authenticated;

SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'teacher_assignments'
ORDER BY policyname;
