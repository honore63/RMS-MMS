-- Let assigned teachers create or correct marks while an assessment is
-- draft, rejected, submitted, or legacy-approved. Explicitly locked
-- assessments stay read-only for teachers; DOS access remains governed by RLS.
DROP POLICY IF EXISTS rms_assessments_update ON public.assessments;
CREATE POLICY rms_assessments_update ON public.assessments FOR UPDATE
  USING ((public.rms_is_dos() AND public.rms_dos_can_level(
      (SELECT c.education_level FROM public.classes c WHERE c.id = assessments.class_id)))
    OR (assessments.status <> 'locked' AND EXISTS (
      SELECT 1 FROM public.teachers t
      WHERE t.user_id = auth.uid() AND t.id = assessments.teacher_id)))
  WITH CHECK ((public.rms_is_dos() AND public.rms_dos_can_level(
      (SELECT c.education_level FROM public.classes c WHERE c.id = class_id)))
    OR (teacher_id = assessments.teacher_id
      AND public.rms_teacher_can_assessment_row(teacher_id, class_id, subject_id, academic_year_id)));

DROP POLICY IF EXISTS rms_marks_insert ON public.marks;
CREATE POLICY rms_marks_insert ON public.marks FOR INSERT
  WITH CHECK (public.rms_dos_can_marks(assessment_id)
    OR (public.rms_teacher_can_assessment(assessment_id) AND EXISTS (
      SELECT 1 FROM public.assessments a
      WHERE a.id = assessment_id AND a.status IN ('draft', 'rejected', 'submitted', 'approved')
    )));

DROP POLICY IF EXISTS rms_marks_update ON public.marks;
CREATE POLICY rms_marks_update ON public.marks FOR UPDATE
  USING (public.rms_dos_can_marks(marks.assessment_id)
    OR (public.rms_teacher_can_assessment(marks.assessment_id) AND EXISTS (
      SELECT 1 FROM public.assessments a
      WHERE a.id = marks.assessment_id AND a.status IN ('draft', 'rejected', 'submitted', 'approved')
    )))
  WITH CHECK (public.rms_dos_can_marks(assessment_id)
    OR (public.rms_teacher_can_assessment(assessment_id) AND EXISTS (
      SELECT 1 FROM public.assessments a
      WHERE a.id = assessment_id AND a.status IN ('draft', 'rejected', 'submitted', 'approved')
    )));
