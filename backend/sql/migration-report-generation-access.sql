-- RMS-MIS report-generation read access
-- Run after the scoped RLS migrations. This only adds SELECT access needed by
-- authenticated report consumers; it does not broaden INSERT/UPDATE/DELETE.

ALTER TABLE public.classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academic_years ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.terms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grading_scales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assessment_types ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.rms_report_teacher_has_class(p_class_id UUID)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users u
    JOIN public.teachers t ON t.user_id = u.id
    JOIN public.teacher_assignments ta ON ta.teacher_id = t.id
    WHERE u.id = auth.uid() AND u.role = 'teacher' AND u.status = 'active'
      AND ta.class_id = p_class_id
  );
$$;

CREATE OR REPLACE FUNCTION public.rms_report_teacher_has_subject(p_subject_id UUID)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users u
    JOIN public.teachers t ON t.user_id = u.id
    JOIN public.teacher_assignments ta ON ta.teacher_id = t.id
    WHERE u.id = auth.uid() AND u.role = 'teacher' AND u.status = 'active'
      AND ta.subject_id = p_subject_id
  );
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
  USING (public.rms_report_teacher_has_class(learners.class_id));

DROP POLICY IF EXISTS rms_report_reference_years_select ON public.academic_years;
CREATE POLICY rms_report_reference_years_select ON public.academic_years
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS rms_report_reference_terms_select ON public.terms;
CREATE POLICY rms_report_reference_terms_select ON public.terms
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS rms_report_reference_grading_select ON public.grading_scales;
CREATE POLICY rms_report_reference_grading_select ON public.grading_scales
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS rms_report_reference_settings_select ON public.school_settings;
CREATE POLICY rms_report_reference_settings_select ON public.school_settings
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS rms_report_reference_assessment_types_select ON public.assessment_types;
CREATE POLICY rms_report_reference_assessment_types_select ON public.assessment_types
  FOR SELECT USING (auth.uid() IS NOT NULL);

SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND policyname LIKE 'rms_report_%'
ORDER BY tablename, policyname;
