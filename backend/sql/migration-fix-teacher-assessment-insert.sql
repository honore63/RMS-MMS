-- Allow a teacher to create a draft assessment only for an assigned
-- class/subject combination. Run in Supabase SQL Editor.

ALTER TABLE public.assessments ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON public.assessments TO authenticated;

DROP POLICY IF EXISTS rms_assessments_insert ON public.assessments;

CREATE POLICY rms_assessments_insert
ON public.assessments
FOR INSERT
WITH CHECK (
  (
    public.rms_is_dos()
    AND public.rms_dos_can_level(
      (SELECT c.education_level
       FROM public.classes c
       WHERE c.id = class_id)
    )
  )
  OR EXISTS (
    SELECT 1
    FROM public.teachers t
    JOIN public.teacher_assignments ta ON ta.teacher_id = t.id
    WHERE t.user_id = auth.uid()
      AND t.id = teacher_id
      AND (ta.class_id IS NULL OR ta.class_id = class_id)
      AND (ta.subject_id IS NULL OR ta.subject_id = subject_id)
      AND (
        ta.academic_year_id IS NULL
        OR academic_year_id IS NULL
        OR ta.academic_year_id = academic_year_id
      )
  )
);

NOTIFY pgrst, 'reload schema';

-- Verify the logged-in teacher is linked to the teacher row and assignment.
SELECT
  auth.uid() AS auth_user_id,
  t.id AS teacher_id,
  t.full_name,
  ta.class_id,
  ta.subject_id,
  ta.academic_year_id
FROM public.teachers t
LEFT JOIN public.teacher_assignments ta ON ta.teacher_id = t.id
WHERE t.user_id = auth.uid();