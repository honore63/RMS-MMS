-- RMS-MIS repair: remove recursive report RLS policies
-- Run this after migration-report-generation-access.sql.
-- The previous report policies queried teacher_assignments from the classes
-- policy while teacher_assignments queried classes, producing Supabase 500s.

CREATE OR REPLACE FUNCTION public.rms_report_teacher_has_class(p_class_id UUID)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    JOIN public.teachers t ON t.user_id = u.id
    JOIN public.teacher_assignments ta ON ta.teacher_id = t.id
    WHERE u.id = auth.uid()
      AND u.role = 'teacher'
      AND u.status = 'active'
      AND ta.class_id = p_class_id
  );
$$;

CREATE OR REPLACE FUNCTION public.rms_report_teacher_has_subject(p_subject_id UUID)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    JOIN public.teachers t ON t.user_id = u.id
    JOIN public.teacher_assignments ta ON ta.teacher_id = t.id
    WHERE u.id = auth.uid()
      AND u.role = 'teacher'
      AND u.status = 'active'
      AND ta.subject_id = p_subject_id
  );
$$;

CREATE OR REPLACE FUNCTION public.rms_report_teacher_has_learner(p_class_id UUID)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.rms_report_teacher_has_class(p_class_id);
$$;

DROP POLICY IF EXISTS rms_report_teacher_classes_select ON public.classes;
CREATE POLICY rms_report_teacher_classes_select ON public.classes
  FOR SELECT
  USING (public.rms_report_teacher_has_class(classes.id));

DROP POLICY IF EXISTS rms_report_teacher_subjects_select ON public.subjects;
CREATE POLICY rms_report_teacher_subjects_select ON public.subjects
  FOR SELECT
  USING (public.rms_report_teacher_has_subject(subjects.id));

DROP POLICY IF EXISTS rms_report_teacher_learners_select ON public.learners;
CREATE POLICY rms_report_teacher_learners_select ON public.learners
  FOR SELECT
  USING (public.rms_report_teacher_has_learner(learners.class_id));

GRANT EXECUTE ON FUNCTION public.rms_report_teacher_has_class(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rms_report_teacher_has_subject(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rms_report_teacher_has_learner(UUID) TO authenticated;

-- Verification: these requests should return rows or an empty 200 response,
-- never a recursive-policy 500.
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND policyname LIKE 'rms_report_%'
ORDER BY tablename, policyname;
