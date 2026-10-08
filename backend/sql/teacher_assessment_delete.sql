-- Allow teachers to permanently delete their own assessments regardless of
-- status, including associated marks. Existing restrictive account and DOS
-- education-level policies remain in force.

DROP POLICY IF EXISTS rms_assessments_delete ON public.assessments;
CREATE POLICY rms_assessments_delete ON public.assessments FOR DELETE
  USING (
    (public.rms_is_dos() AND public.rms_dos_can_level(
      (SELECT c.education_level
       FROM public.classes c
       WHERE c.id = assessments.class_id)))
    OR EXISTS (
      SELECT 1
      FROM public.teachers t
      WHERE t.user_id = auth.uid()
        AND t.id = assessments.teacher_id)
  );

DROP POLICY IF EXISTS rms_marks_delete ON public.marks;
CREATE POLICY rms_marks_delete ON public.marks FOR DELETE
  USING (
    (public.rms_is_dos() AND public.rms_dos_can_marks(marks.assessment_id))
    OR EXISTS (
      SELECT 1
      FROM public.assessments a
      JOIN public.teachers t ON t.id = a.teacher_id
      WHERE a.id = marks.assessment_id
        AND t.user_id = auth.uid())
  );
