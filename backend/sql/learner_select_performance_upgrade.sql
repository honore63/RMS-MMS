-- Avoid a per-row self-lookup in the learner table's restrictive DOS policy.
-- DOS visibility is still constrained by rms_learners_select and rms_dos_level_guard.
CREATE OR REPLACE FUNCTION public.rms_account_can_learner(p_learner_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT CASE public.rms_account_role()
    WHEN 'dos' THEN true
    WHEN 'teacher' THEN EXISTS (
      SELECT 1
      FROM public.learners l
      JOIN public.teacher_assignments ta ON ta.class_id = l.class_id
      WHERE l.id = p_learner_id
        AND ta.teacher_id = public.rms_account_teacher_id()
    )
      OR EXISTS (
        SELECT 1
        FROM public.learners l
        JOIN public.classes c ON c.id = l.class_id
        WHERE l.id = p_learner_id
          AND c.class_teacher_id = public.rms_account_teacher_id()
      )
    WHEN 'headteacher' THEN EXISTS (
      SELECT 1
      FROM public.learners l
      JOIN public.teacher_assignments ta ON ta.class_id = l.class_id
      WHERE l.id = p_learner_id
        AND ta.teacher_id = public.rms_account_teacher_id()
    )
      OR EXISTS (
        SELECT 1
        FROM public.learners l
        JOIN public.classes c ON c.id = l.class_id
        WHERE l.id = p_learner_id
          AND c.class_teacher_id = public.rms_account_teacher_id()
      )
    ELSE false
  END;
$fn$;
